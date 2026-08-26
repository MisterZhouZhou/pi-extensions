import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

import { decideToolCall, filterActiveTools, type PermissionMode } from "./policy.ts";
import { createPermissionState, installPermissionRuntime, PERMISSION_SESSION_ENTRY, restorePermissionMode } from "./state.ts";

const STATUS_KEY = "pi-permissions";
const PERMISSION_FLAG = "permissions";
const MODES: PermissionMode[] = ["readonly", "manual", "yolo"];

function modeLabel(mode: PermissionMode): string {
  return mode === "readonly" ? "READONLY" : mode === "manual" ? "MANUAL" : "YOLO";
}

function renderStatus(ctx: ExtensionContext, mode: PermissionMode): void {
  const icon = mode === "readonly" ? "🔒" : mode === "manual" ? "✋" : "⚡";
  ctx.ui.setStatus(STATUS_KEY, `${icon} ${modeLabel(mode)}`);
}

function notifyMode(ctx: ExtensionContext, mode: PermissionMode): void {
  renderStatus(ctx, mode);
  const text = mode === "readonly"
    ? "Permission mode: READONLY (file changes and side-effecting Bash are blocked)"
    : mode === "manual"
      ? "Permission mode: MANUAL (side-effecting operations require approval)"
      : "Permission mode: YOLO (ordinary operations are auto-approved; catastrophic Bash remains blocked)";
  ctx.ui.notify(text, mode === "yolo" ? "warning" : "info");
}

function initialMode(value: unknown): PermissionMode {
  return value === "readonly" || value === "manual" || value === "yolo" ? value : "manual";
}

export function registerPermissionsExtension(pi: ExtensionAPI): void {
  pi.registerFlag(PERMISSION_FLAG, {
    description: "Start with a permission mode: readonly, manual, or yolo",
    type: "string",
    default: "manual",
  });

  const cliMode = initialMode(pi.getFlag(PERMISSION_FLAG));
  let savedTools: string[] | undefined;
  const state = createPermissionState(cliMode, (mode: PermissionMode) => {
    pi.appendEntry(PERMISSION_SESSION_ENTRY, { mode });
  });

  const uninstallRuntime = installPermissionRuntime({
    getMode: () => state.getMode() === "yolo" ? "yolo" : "default",
    setMode: (mode) => setModeFromRuntime(mode),
    isTaskApproved: () => process.env.PI_SUBAGENT_TASK_APPROVED === "1",
  });

  function setModeFromRuntime(mode: "default" | "yolo"): void {
    state.setMode(mode === "yolo" ? "yolo" : "manual");
  }

  function applyActiveTools(): void {
    if (state.getMode() !== "readonly") {
      if (savedTools !== undefined) {
        pi.setActiveTools([...new Set([...savedTools, ...pi.getActiveTools()])]);
        savedTools = undefined;
      }
      return;
    }
    if (savedTools === undefined) savedTools = pi.getActiveTools();
    const candidateTools = [...new Set([...savedTools, ...pi.getActiveTools()])];
    pi.setActiveTools(filterActiveTools(candidateTools, "readonly"));
  }

  function setMode(ctx: ExtensionContext, mode: PermissionMode, notify = true): void {
    state.setMode(mode);
    applyActiveTools();
    if (notify) notifyMode(ctx, mode);
    else renderStatus(ctx, mode);
  }

  function chooseMode(ctx: ExtensionContext, argument: string): void {
    const value = argument.trim().toLowerCase();
    if (!value) {
      ctx.ui.notify(`Permission mode: ${modeLabel(state.getMode())}. Usage: /permissions <readonly|manual|yolo|status>`, "info");
      return;
    }
    if (value === "status") {
      renderStatus(ctx, state.getMode());
      ctx.ui.notify(`Permission mode: ${modeLabel(state.getMode())}`, "info");
      return;
    }
    if (!MODES.includes(value as PermissionMode)) {
      ctx.ui.notify("Usage: /permissions <readonly|manual|yolo|status>", "warning");
      return;
    }
    setMode(ctx, value as PermissionMode);
  }

  pi.registerShortcut("shift+tab", {
    description: "Cycle permission mode: readonly -> manual -> yolo (replaces the default thinking-level shortcut)",
    handler: async (ctx) => {
      const next = state.toggle();
      setMode(ctx, next);
    },
  });

  pi.registerCommand("permissions", {
    description: "Show or switch permission mode (readonly, manual, yolo)",
    handler: async (args, ctx) => chooseMode(ctx, args),
  });

  pi.on("session_start", (_event, ctx) => {
    const persisted = restorePermissionMode(ctx.sessionManager.getEntries(), cliMode);
    setMode(ctx, persisted, false);
  });

  pi.on("session_tree", (_event, ctx) => {
    const persisted = restorePermissionMode(ctx.sessionManager.getBranch(), cliMode);
    setMode(ctx, persisted, false);
  });

  pi.on("session_shutdown", () => {
    if (savedTools !== undefined) pi.setActiveTools(savedTools);
    savedTools = undefined;
    uninstallRuntime();
  });

  pi.on("before_agent_start", () => {
    applyActiveTools();
  });

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    const decision = decideToolCall({
      toolName: event.toolName,
      args: event.input as Record<string, unknown>,
      mode: state.getMode(),
      hasUI: ctx.hasUI,
      taskApproved: process.env.PI_SUBAGENT_TASK_APPROVED === "1",
    });
    if (decision.action === "allow") return undefined;
    if (decision.action === "block") return { block: true, reason: decision.reason };
    const approved = ctx.hasUI && await ctx.ui.confirm(decision.title, decision.message);
    return approved ? undefined : { block: true, reason: "Tool call was not approved" };
  });
}

export default function permissionsExtension(pi: ExtensionAPI): void {
  registerPermissionsExtension(pi);
}
