import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { PermissionMode } from "./policy.ts";

export const PERMISSION_SESSION_ENTRY = "pi-permissions-mode";
const RUNTIME_SYMBOL = Symbol.for("pi.yolo.runtime");

export interface PermissionRuntime {
  getMode(): "default" | "yolo";
  setMode(mode: "default" | "yolo"): void;
  isTaskApproved(): boolean;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "readonly" || value === "manual" || value === "yolo";
}

export interface PermissionState {
  getMode(): PermissionMode;
  setMode(mode: PermissionMode): void;
  toggle(): PermissionMode;
}

export function createPermissionState(initialMode: PermissionMode, persist: (mode: PermissionMode) => void): PermissionState {
  let mode = initialMode;
  return {
    getMode: () => mode,
    setMode(nextMode) {
      if (mode === nextMode) return;
      mode = nextMode;
      persist(mode);
    },
    toggle() {
      this.setMode(mode === "readonly" ? "manual" : mode === "manual" ? "yolo" : "readonly");
      return mode;
    },
  };
}

export function installPermissionRuntime(runtime: PermissionRuntime): () => void {
  const slot = globalThis as typeof globalThis & { [RUNTIME_SYMBOL]?: PermissionRuntime };
  slot[RUNTIME_SYMBOL] = runtime;
  return () => {
    if (slot[RUNTIME_SYMBOL] === runtime) delete slot[RUNTIME_SYMBOL];
  };
}

export function restorePermissionMode(entries: readonly SessionEntry[], initialMode: PermissionMode): PermissionMode {
  let mode = initialMode;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PERMISSION_SESSION_ENTRY) continue;
    const data = entry.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const candidate = (data as { mode?: unknown }).mode;
    if (isPermissionMode(candidate)) mode = candidate;
  }
  return mode;
}

