import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Message } from "@earendil-works/pi-ai";

import type { AgentConfig } from "./agents.ts";

const STDERR_LIMIT = 16 * 1024;
const childGuardPath = fileURLToPath(new URL("./child-guard.ts", import.meta.url));

export interface ChildAgentRequest {
  agent: AgentConfig;
  task: string;
  cwd: string;
  model: { provider: string; id: string };
  mode: "default" | "yolo";
  taskApproved: boolean;
  signal?: AbortSignal;
}

export interface ChildAgentResult {
  agent: string;
  source: AgentConfig["source"];
  task: string;
  status: "completed" | "failed" | "aborted";
  text: string;
  exitCode?: number;
  stderr?: string;
}

export function parseJsonLines(source: string): Message[] {
  const messages: Message[] = [];
  for (const line of source.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: string; message?: Message };
      if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) messages.push(event.message);
    } catch { /* Ignore non-protocol output. */ }
  }
  return messages;
}

function messageText(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content.filter((item) => item.type === "text").map((item) => item.text).join("\n").trim();
    if (text) return text;
  }
  return "";
}

export function terminateChild(child: Pick<ChildProcess, "kill" | "killed">, timeoutMs = 5_000): NodeJS.Timeout {
  child.kill("SIGTERM");
  const timer = setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, timeoutMs);
  timer.unref();
  return timer;
}

export function buildChildInvocation(request: ChildAgentRequest, promptPath: string): {
  command: string;
  args: string[];
  options: SpawnOptions;
} {
  const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "-e", childGuardPath];
  args.push("--model", `${request.model.provider}/${request.model.id}`);
  if (request.agent.tools?.length) args.push("--tools", request.agent.tools.join(","));
  args.push("--append-system-prompt", promptPath, `Task: ${request.task}`);
  return {
    command: process.env.PI_EXECUTABLE ?? "pi",
    args,
    options: {
      cwd: request.cwd,
      shell: false as const,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_AGENT_MODE: request.mode, PI_IS_SUBAGENT: "1", PI_SUBAGENT_TASK_APPROVED: request.taskApproved ? "1" : "0" },
    },
  };
}

export type SpawnChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export async function runChildAgent(request: ChildAgentRequest, spawnChild: SpawnChild = spawn): Promise<ChildAgentResult> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  try {
    const promptPath = path.join(temporary, "system.md");
    await writeFile(promptPath, request.agent.systemPrompt, { mode: 0o600 });
    const invocation = buildChildInvocation(request, promptPath);
    return await new Promise((resolve) => {
      const child = spawnChild(invocation.command, invocation.args, invocation.options);
      let stdout = ""; let stderr = ""; let aborted = false; let killTimer: NodeJS.Timeout | undefined;
      (child.stdout as Readable | null)?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      (child.stderr as Readable | null)?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT); });
      const abort = () => { aborted = true; killTimer = terminateChild(child); };
      if (request.signal?.aborted) abort(); else request.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => resolve({ agent: request.agent.name, source: request.agent.source, task: request.task, status: aborted ? "aborted" : "failed", text: "", stderr: String(error) }));
      child.once("close", (code) => {
        if (killTimer) clearTimeout(killTimer);
        request.signal?.removeEventListener("abort", abort);
        const text = messageText(parseJsonLines(stdout));
        resolve({ agent: request.agent.name, source: request.agent.source, task: request.task, status: aborted ? "aborted" : code === 0 ? "completed" : "failed", text, exitCode: code ?? undefined, ...(stderr ? { stderr } : {}) });
      });
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
