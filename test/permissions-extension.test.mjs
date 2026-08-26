import assert from "node:assert/strict";
import test from "node:test";

import { registerPermissionsExtension } from "../packages/permissions/index.ts";

function fakePi({ permissions = "manual", activeTools = ["read", "bash", "edit", "write", "custom"] } = {}) {
  const flags = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const handlers = new Map();
  const entries = [];
  let currentTools = [...activeTools];
  return {
    flags, commands, shortcuts, handlers, entries,
    registerFlag(name, options) { flags.set(name, options); },
    getFlag(name) { return name === "permissions" ? permissions : undefined; },
    registerCommand(name, options) { commands.set(name, options); },
    registerShortcut(key, options) { shortcuts.set(key, options); },
    appendEntry(type, data) { entries.push([type, data]); },
    on(name, handler) { handlers.set(name, handler); },
    getActiveTools() { return [...currentTools]; },
    setActiveTools(names) { currentTools = [...names]; },
    getCurrentTools() { return [...currentTools]; },
  };
}

function context({ hasUI = true, entries = [], approved = true } = {}) {
  const statuses = [];
  const notices = [];
  const confirms = [];
  return {
    statuses,
    notices,
    confirms,
    value: {
      hasUI,
      sessionManager: {
        getEntries: () => entries,
        getBranch: () => entries,
      },
      ui: {
        setStatus: (...value) => statuses.push(value),
        notify: (...value) => notices.push(value),
        confirm: async (...value) => {
          confirms.push(value);
          return approved;
        },
      },
    },
  };
}

test("registers permission flag, command, shortcut and starts in manual", async () => {
  const pi = fakePi();
  registerPermissionsExtension(pi);
  assert.equal(pi.flags.get("permissions").type, "string");
  assert.match(pi.flags.get("permissions").description, /readonly, manual, or yolo/u);
  assert.equal(pi.commands.has("permissions"), true);
  assert.equal(pi.shortcuts.has("shift+tab"), true);
  assert.match(pi.shortcuts.get("shift+tab").description, /replaces the default thinking-level shortcut/u);

  const ctx = context();
  await pi.handlers.get("session_start")({}, ctx.value);
  assert.deepEqual(ctx.statuses.at(-1), ["pi-permissions", "✋ MANUAL"]);
});

test("readonly filters active tools and restores them when switching", async () => {
  const pi = fakePi();
  registerPermissionsExtension(pi);
  const ctx = context();
  await pi.handlers.get("session_start")({}, ctx.value);
  await pi.commands.get("permissions").handler("readonly", ctx.value);
  assert.deepEqual(pi.getCurrentTools(), ["read", "bash"]);
  await pi.commands.get("permissions").handler("manual", ctx.value);
  assert.deepEqual(pi.getCurrentTools(), ["read", "bash", "edit", "write", "custom"]);
});

test("manual confirms writes and blocks them when rejected", async () => {
  const pi = fakePi();
  registerPermissionsExtension(pi);
  const accepted = context({ approved: true });
  await pi.handlers.get("session_start")({}, accepted.value);
  assert.equal(await pi.handlers.get("tool_call")({ toolName: "write", input: {} }, accepted.value), undefined);
  assert.equal(accepted.confirms.length, 1);

  const rejected = context({ approved: false });
  const result = await pi.handlers.get("tool_call")({ toolName: "write", input: {} }, rejected.value);
  assert.deepEqual(result, { block: true, reason: "Tool call was not approved" });
});

test("manual fails closed without UI and yolo keeps catastrophic Bash blocked", async () => {
  const pi = fakePi({ permissions: "yolo" });
  registerPermissionsExtension(pi);
  const ctx = context({ hasUI: false });
  await pi.handlers.get("session_start")({}, ctx.value);
  assert.equal(await pi.handlers.get("tool_call")({ toolName: "write", input: {} }, ctx.value), undefined);
  assert.deepEqual(await pi.handlers.get("tool_call")({ toolName: "bash", input: { command: "rm -rf /" } }, ctx.value), {
    block: true,
    reason: "Blocked catastrophic Bash command",
  });
});

test("restores the last valid mode from the current session", async () => {
  const pi = fakePi({ permissions: "readonly" });
  registerPermissionsExtension(pi);
  const ctx = context({ entries: [
    { type: "custom", customType: "pi-permissions-mode", data: { mode: "yolo" } },
    { type: "custom", customType: "pi-permissions-mode", data: { mode: "invalid" } },
    { type: "custom", customType: "pi-permissions-mode", data: { mode: "manual" } },
  ] });
  await pi.handlers.get("session_start")({}, ctx.value);
  assert.deepEqual(ctx.statuses.at(-1), ["pi-permissions", "✋ MANUAL"]);
});
