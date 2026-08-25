import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

import { decideToolCall, type YoloMode } from "./policy.ts";
import { createYoloState, installYoloRuntime, restoreYoloMode, YOLO_SESSION_ENTRY } from "./state.ts";

const STATUS_KEY = "pi-yolo";

function renderStatus(ctx: ExtensionContext, mode: YoloMode): void {
  ctx.ui.setStatus(STATUS_KEY, mode === "yolo" ? "YOLO" : "SAFE");
}

function reportMode(ctx: ExtensionContext, mode: YoloMode): void {
  renderStatus(ctx, mode);
  ctx.ui.notify(mode === "yolo" ? "YOLO mode enabled" : "SAFE mode enabled", "warning");
}

function eventArgs(event: ToolCallEvent): Record<string, unknown> {
  return event.input as Record<string, unknown>;
}

export function registerYoloExtension(pi: ExtensionAPI): void {
  pi.registerFlag("yolo", {
    description: "Start in YOLO mode for Pi YOLO/Subagent confirmations",
    type: "boolean",
    default: false,
  });

  const state = createYoloState(pi.getFlag("yolo") === true ? "yolo" : "default", (mode) => {
    pi.appendEntry(YOLO_SESSION_ENTRY, { mode });
  });
  installYoloRuntime({
    getMode: state.getMode,
    setMode: state.setMode,
    isTaskApproved: () => process.env.PI_SUBAGENT_TASK_APPROVED === "1",
  });

  const setMode = (ctx: ExtensionContext, mode: YoloMode, notify = true) => {
    state.setMode(mode);
    if (notify) reportMode(ctx, mode);
    else renderStatus(ctx, mode);
  };
  const toggle = (ctx: ExtensionContext) => setMode(ctx, state.getMode() === "yolo" ? "default" : "yolo");

  // Keep this package independent from pi-tui; this is Pi's canonical KeyId.
  pi.registerShortcut("alt+y", {
    description: "Toggle SAFE/YOLO mode (replaces the default yank-pop shortcut)",
    handler: toggle,
  });

  pi.registerCommand("yolo", {
    description: "Toggle or inspect SAFE/YOLO confirmations",
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();
      if (!argument) return toggle(ctx);
      if (argument === "on") return setMode(ctx, "yolo");
      if (argument === "off") return setMode(ctx, "default");
      if (argument === "status") {
        const mode = state.getMode();
        renderStatus(ctx, mode);
        ctx.ui.notify(`${mode === "yolo" ? "YOLO" : "SAFE"}: controls Pi YOLO/Subagent confirmations only`, "info");
        return;
      }
      ctx.ui.notify("Usage: /yolo [on|off|status]", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const initialMode = pi.getFlag("yolo") === true ? "yolo" : "default";
    setMode(ctx, restoreYoloMode(ctx.sessionManager.getEntries(), initialMode), false);
  });

  pi.on("project_trust", (_event, ctx) => ({
    trusted: state.getMode() === "yolo" ? "yes" : "undecided",
  }));

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    const decision = decideToolCall({
      toolName: event.toolName,
      args: eventArgs(event),
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

export default function yoloExtension(pi: ExtensionAPI): void {
  registerYoloExtension(pi);
}
