import assert from "node:assert/strict";
import test from "node:test";

import { registerYoloExtension } from "../packages/yolo/index.ts";

function fakePi({ yolo = false } = {}) {
  const flags = new Map(); const commands = new Map(); const shortcuts = new Map(); const handlers = new Map(); const entries = [];
  return {
    flags, commands, shortcuts, handlers, entries,
    registerFlag(name, options) { flags.set(name, options); }, getFlag(name) { return name === "yolo" ? yolo : undefined; },
    registerCommand(name, options) { commands.set(name, options); }, registerShortcut(key, options) { shortcuts.set(key, options); },
    appendEntry(type, data) { entries.push([type, data]); }, on(name, handler) { handlers.set(name, handler); },
  };
}
function context({ hasUI = true, entries = [], approved = true } = {}) {
  const statuses = []; const notices = []; const confirms = [];
  return {
    statuses,
    notices,
    confirms,
    value: {
      hasUI,
      sessionManager: { getEntries: () => entries },
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

test("registers yolo flag, command and Alt+Y replacing default yank-pop", async () => {
  const pi = fakePi(); registerYoloExtension(pi);
  assert.equal(pi.flags.get("yolo").type, "boolean");
  assert.match(pi.shortcuts.get("alt+y").description, /replaces the default yank-pop/i);
  const ctx = context(); await pi.shortcuts.get("alt+y").handler(ctx.value);
  assert.deepEqual(ctx.statuses.at(-1), ["pi-yolo", "YOLO"]);
  assert.deepEqual(ctx.notices.at(-1), ["YOLO mode enabled", "warning"]);
  assert.deepEqual(pi.entries.at(-1), ["pi-yolo-mode", { mode: "yolo" }]);
});

test("commands, session resume, gates and project trust follow the mode", async () => {
  const pi = fakePi({ yolo: true }); registerYoloExtension(pi);
  const ctx = context({ entries: [{ type: "custom", customType: "pi-yolo-mode", data: { mode: "default" } }] });
  await pi.handlers.get("session_start")({}, ctx.value);
  assert.deepEqual(ctx.statuses.at(-1), ["pi-yolo", "SAFE"]);
  await pi.commands.get("yolo").handler("on", ctx.value);
  assert.deepEqual((await pi.handlers.get("project_trust")({}, ctx.value)), { trusted: "yes" });
  await pi.commands.get("yolo").handler("off", ctx.value);
  assert.deepEqual(pi.entries.at(-1), ["pi-yolo-mode", { mode: "default" }]);
  assert.equal((await pi.handlers.get("tool_call")({ toolName: "write", input: {} }, ctx.value)), undefined);
  const denied = context({ approved: false });
  assert.deepEqual(await pi.handlers.get("tool_call")({ toolName: "write", input: {} }, denied.value), { block: true, reason: "Tool call was not approved" });
  assert.deepEqual(await pi.handlers.get("tool_call")({ toolName: "bash", input: { command: "rm -rf /" } }, ctx.value), { block: true, reason: "Blocked catastrophic Bash command" });
});
