import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { YoloMode } from "./policy.ts";

export const YOLO_SESSION_ENTRY = "pi-yolo-mode";
const RUNTIME_SYMBOL = Symbol.for("pi.yolo.runtime");

export interface YoloRuntime {
  getMode(): YoloMode;
  setMode(mode: YoloMode): void;
  isTaskApproved(): boolean;
}

export interface YoloState {
  getMode(): YoloMode;
  setMode(mode: YoloMode): void;
  toggle(): YoloMode;
}

export function createYoloState(initialMode: YoloMode, persist: (mode: YoloMode) => void): YoloState {
  let mode = initialMode;
  return {
    getMode: () => mode,
    setMode(nextMode) {
      if (mode === nextMode) return;
      mode = nextMode;
      persist(mode);
    },
    toggle() {
      this.setMode(mode === "yolo" ? "default" : "yolo");
      return mode;
    },
  };
}

function entryMode(entry: SessionEntry): YoloMode | undefined {
  if (entry.type !== "custom" || entry.customType !== YOLO_SESSION_ENTRY) return undefined;
  const data = entry.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== "mode") return undefined;
  const mode = (data as { mode?: unknown }).mode;
  return mode === "default" || mode === "yolo" ? mode : undefined;
}

export function restoreYoloMode(entries: readonly SessionEntry[], initialMode: YoloMode): YoloMode {
  let mode = initialMode;
  for (const entry of entries) mode = entryMode(entry) ?? mode;
  return mode;
}

function runtimeSlot(): { [RUNTIME_SYMBOL]?: YoloRuntime } {
  return globalThis as typeof globalThis & { [RUNTIME_SYMBOL]?: YoloRuntime };
}

export function installYoloRuntime(runtime: YoloRuntime): () => void {
  const slot = runtimeSlot();
  slot[RUNTIME_SYMBOL] = runtime;
  return () => {
    if (slot[RUNTIME_SYMBOL] === runtime) delete slot[RUNTIME_SYMBOL];
  };
}

export function readYoloRuntime(): YoloRuntime {
  return runtimeSlot()[RUNTIME_SYMBOL] ?? {
    getMode: () => "default",
    setMode: () => undefined,
    isTaskApproved: () => process.env.PI_SUBAGENT_TASK_APPROVED === "1",
  };
}
