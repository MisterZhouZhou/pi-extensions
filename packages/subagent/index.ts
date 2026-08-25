import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { discoverAgents, isWritableAgent, type AgentConfig, type AgentDiscoveryResult, type AgentScope } from "./agents.ts";
import { runChildAgent, type ChildAgentRequest, type ChildAgentResult } from "./process.ts";

const MAX_TASKS = 8;
const MAX_CONCURRENCY = 4;
const RUNTIME_SYMBOL = Symbol.for("pi.yolo.runtime");

export interface SubagentTaskInput {
  agent: string;
  task: string;
  cwd?: string;
}

export interface SubagentParams {
  agent?: string;
  task?: string;
  tasks?: SubagentTaskInput[];
  chain?: SubagentTaskInput[];
  agentScope?: AgentScope;
}

export interface ResolvedTask extends SubagentTaskInput {
  agentConfig: AgentConfig;
}

export interface ResolvedTasks {
  mode: "single" | "parallel" | "chain";
  tasks: ResolvedTask[];
}

export interface SubagentDependencies {
  discover?: (cwd: string, scope?: AgentScope) => Promise<AgentDiscoveryResult>;
  runChild?: (request: ChildAgentRequest) => Promise<ChildAgentResult>;
  runtime?: { getMode(): "default" | "yolo"; isTaskApproved(): boolean };
}

interface ResolveOptions {
  cwd: string;
  agents: AgentConfig[];
  projectAgentsDir?: string;
  ui?: Pick<ExtensionContext["ui"], "confirm">;
  hasUI?: boolean;
  projectTrusted?: boolean;
}

const taskSchema = Type.Object({
  agent: Type.String({ minLength: 1 }),
  task: Type.String({ minLength: 1 }),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
});

export const subagentParameters = Type.Object({
  agent: Type.Optional(Type.String({ minLength: 1 })),
  task: Type.Optional(Type.String({ minLength: 1 })),
  tasks: Type.Optional(Type.Array(taskSchema, { maxItems: MAX_TASKS })),
  chain: Type.Optional(Type.Array(taskSchema, { maxItems: MAX_TASKS })),
  agentScope: Type.Optional(Type.Union([
    Type.Literal("builtin"),
    Type.Literal("user"),
    Type.Literal("project"),
    Type.Literal("both"),
  ])),
});

export type SubagentParameters = Static<typeof subagentParameters>;

function modeInputs(params: SubagentParams): Array<"single" | "parallel" | "chain"> {
  return [
    params.agent !== undefined || params.task !== undefined ? "single" : undefined,
    params.tasks !== undefined ? "parallel" : undefined,
    params.chain !== undefined ? "chain" : undefined,
  ].filter((value): value is "single" | "parallel" | "chain" => value !== undefined);
}

function preferredCandidates(agents: AgentConfig[]): Map<string, AgentConfig[]> {
  const candidates = new Map<string, AgentConfig[]>();
  for (const agent of agents) {
    const current = candidates.get(agent.name) ?? [];
    if (!current.some((item) => item.source === agent.source)) current.push(agent);
    candidates.set(agent.name, current);
  }
  for (const values of candidates.values()) {
    values.sort((left, right) => ({ project: 0, user: 1, builtin: 2 }[left.source] - { project: 0, user: 1, builtin: 2 }[right.source]));
  }
  return candidates;
}

function allowedSources(scope: AgentScope): Set<AgentConfig["source"]> {
  if (scope === "builtin") return new Set(["builtin"]);
  if (scope === "user") return new Set(["user", "builtin"]);
  if (scope === "project") return new Set(["project", "builtin"]);
  return new Set(["project", "user", "builtin"]);
}

function taskInputs(params: SubagentParams, mode: "single" | "parallel" | "chain"): SubagentTaskInput[] {
  if (mode === "single") {
    if (typeof params.agent !== "string" || typeof params.task !== "string" || !params.agent.trim() || !params.task.trim()) {
      throw new Error("single mode requires agent and task");
    }
    return [{ agent: params.agent.trim(), task: params.task.trim() }];
  }
  const values = mode === "parallel" ? params.tasks : params.chain;
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${mode} mode requires at least one task`);
  if (values.length > MAX_TASKS) throw new Error(`subagent supports at most ${MAX_TASKS} tasks`);
  return values.map((value) => ({ agent: value.agent.trim(), task: value.task.trim(), ...(value.cwd ? { cwd: value.cwd } : {}) }));
}

/** Validate mode and turn the user-facing shape into executable task records. */
export async function resolveRequestedTasks(params: SubagentParams, options: ResolveOptions): Promise<ResolvedTasks> {
  const modes = modeInputs(params);
  if (modes.length !== 1) throw new Error("subagent requires exactly one of single, parallel, or chain mode");
  const mode = modes[0];
  const inputs = taskInputs(params, mode);
  const scope = params.agentScope ?? "both";
  const candidates = preferredCandidates(options.agents).entries();
  const byName = new Map(candidates);
  const sources = allowedSources(scope);
  const selected: ResolvedTask[] = [];
  const projectTasks: string[] = [];

  for (const input of inputs) {
    const available = (byName.get(input.agent) ?? []).filter((item) => sources.has(item.source));
    const selectedAgent = available[0];
    if (!selectedAgent) {
      const names = [...byName.keys()].sort().join(", ") || "none";
      throw new Error(`Unknown agent ${input.agent}. Available agents: ${names}`);
    }
    if (selectedAgent.source === "project") projectTasks.push(input.agent);
    selected.push({ ...input, agentConfig: selectedAgent });
  }

  if (projectTasks.length > 0 && options.projectTrusted !== true) {
    const trusted = options.hasUI === true && options.ui
      ? await options.ui.confirm("Trust project agents?", `Allow project agents from ${options.projectAgentsDir ?? options.cwd}?`)
      : false;
    if (!trusted) {
      for (let index = 0; index < selected.length; index += 1) {
        if (selected[index].agentConfig.source !== "project") continue;
        const fallback = (byName.get(selected[index].agent) ?? []).find((item) => item.source !== "project" && sources.has(item.source));
        if (!fallback) throw new Error(`Project agent ${selected[index].agent} was not trusted and has no fallback`);
        selected[index] = { ...selected[index], agentConfig: fallback };
      }
    }
  }
  return { mode, tasks: selected };
}

export function writableTasks(tasks: readonly ResolvedTask[]): ResolvedTask[] {
  return tasks.filter((task) => isWritableAgent(task.agentConfig));
}

export async function authorizeRun(tasks: readonly ResolvedTask[], options: {
  hasUI: boolean;
  ui?: Pick<ExtensionContext["ui"], "confirm">;
  runtime?: SubagentDependencies["runtime"];
}): Promise<boolean> {
  if (writableTasks(tasks).length === 0) return true;
  if (options.runtime?.getMode() === "yolo" || options.runtime?.isTaskApproved()) return true;
  if (!options.hasUI || !options.ui) return false;
  const summary = writableTasks(tasks).map((task) => `${task.agentConfig.name}: ${task.task.slice(0, 100)}`).join("\n");
  return options.ui.confirm("Run writable subagents?", `Allow these subagents to modify files or run side-effecting commands?\n${summary}`);
}

export async function runWithConcurrencyLimit<T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R>, signal?: AbortSignal, limit = MAX_CONCURRENCY): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function textResult(text: string): [{ type: "text"; text: string }] {
  return [{ type: "text", text }];
}

function formatResult(result: ChildAgentResult): string {
  const prefix = `[${result.agent} · ${result.source} · ${result.status}]`;
  if (result.status === "completed") return `${prefix}\n${result.text || "(no text result)"}`;
  return `${prefix}\n${result.stderr?.slice(-2000) || "child agent failed"}`;
}

function details(results: ChildAgentResult[], isError = false): Record<string, unknown> {
  return { isError, results };
}

type SubagentRuntime = NonNullable<SubagentDependencies["runtime"]>;

function readRuntime(): SubagentRuntime {
  const value = (globalThis as typeof globalThis & { [RUNTIME_SYMBOL]?: SubagentDependencies["runtime"] })[RUNTIME_SYMBOL];
  return value ?? { getMode: () => "default", isTaskApproved: () => process.env.PI_SUBAGENT_TASK_APPROVED === "1" };
}

async function executeTasks(resolved: ResolvedTasks, ctx: ExtensionContext, approved: boolean, runChild: NonNullable<SubagentDependencies["runChild"]>, runtime: NonNullable<SubagentDependencies["runtime"]>, signal?: AbortSignal): Promise<ChildAgentResult[]> {
  const base = (task: ResolvedTask): ChildAgentRequest => ({
    agent: task.agentConfig,
    task: task.task,
    cwd: task.cwd ?? ctx.cwd,
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : (() => { throw new Error("A current model is required to run subagents"); })(),
    mode: runtime.getMode(),
    taskApproved: approved,
    signal,
  });
  if (resolved.mode === "parallel") return runWithConcurrencyLimit(resolved.tasks, (task) => runChild(base(task)), signal);
  const results: ChildAgentResult[] = [];
  let previous = "";
  for (const task of resolved.tasks) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const current = { ...task, task: task.task.replaceAll("{previous}", previous) };
    const result = await runChild(base(current));
    results.push(result);
    if (result.status !== "completed") break;
    previous = result.text;
  }
  return results;
}

export function buildSubagentTool(dependencies: SubagentDependencies = {}): ToolDefinition<typeof subagentParameters> {
  const discover = dependencies.discover ?? ((cwd, scope) => discoverAgents(cwd, scope));
  const runChild = dependencies.runChild ?? runChildAgent;
  const runtime: SubagentRuntime = dependencies.runtime ?? readRuntime();
  return {
    name: "subagent",
    label: "Subagent",
    promptSnippet: "Delegate focused research, planning, implementation, or review to Pi subagents.",
    description: "Run Pi subagents from natural language requests. Built-in agents: explore, planner, worker, reviewer. Supports one task, parallel tasks, or a chain with {previous}; project agents require trust and writable agents require one approval in SAFE mode.",
    parameters: subagentParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<Record<string, unknown>>> {
      const scope = params.agentScope ?? "both";
      let discovery = await discover(ctx.cwd, scope);
      let projectTrusted = runtime.getMode() === "yolo";
      const requestedNames = taskInputs(params, modeInputs(params)[0] ?? "single").map((task) => task.agent);
      const projectNames = requestedNames.filter((name) => discovery.agents.find((agent) => agent.name === name)?.source === "project");
      if (projectNames.length > 0 && !projectTrusted) {
        projectTrusted = ctx.hasUI && await ctx.ui.confirm("Trust project agents?", `Allow project agents from ${discovery.projectAgentsDir ?? ctx.cwd}?`);
        if (!projectTrusted) {
          const fallbackScope: AgentScope = scope === "project" ? "builtin" : "user";
          discovery = await discover(ctx.cwd, fallbackScope);
        }
      }
      const resolved = await resolveRequestedTasks(params, {
        cwd: ctx.cwd,
        agents: discovery.agents,
        projectAgentsDir: discovery.projectAgentsDir,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        projectTrusted,
      });
      const approved = await authorizeRun(resolved.tasks, { hasUI: ctx.hasUI, ui: ctx.ui, runtime });
      if (!approved) {
        const result: ChildAgentResult[] = [];
        return { content: textResult("Subagent run was not approved."), details: details(result, true) };
      }
      const taskApproved = writableTasks(resolved.tasks).length > 0 && approved;
      const results = await executeTasks(resolved, ctx, taskApproved, runChild, runtime, signal);
      const isError = results.some((result) => result.status !== "completed");
      return { content: textResult(results.map(formatResult).join("\n\n")), details: details(results, isError) };
    },
  };
}

export function registerSubagentExtension(pi: ExtensionAPI, dependencies: SubagentDependencies = {}): void {
  pi.registerTool(buildSubagentTool(dependencies));
}

export default function subagentExtension(pi: ExtensionAPI): void {
  registerSubagentExtension(pi);
}
