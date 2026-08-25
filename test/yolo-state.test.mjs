import assert from "node:assert/strict";
import test from "node:test";

import { createYoloState, installYoloRuntime, readYoloRuntime, restoreYoloMode, YOLO_SESSION_ENTRY } from "../packages/yolo/state.ts";

const entry = (customType, data) => ({ type: "custom", customType, data, id: "1", parentId: null, timestamp: "now" });

test("state defaults, toggles, and only persists actual changes", () => {
  const persisted = [];
  const state = createYoloState("default", (mode) => persisted.push(mode));
  assert.equal(state.getMode(), "default");
  state.setMode("default");
  assert.deepEqual(persisted, []);
  assert.equal(state.toggle(), "yolo");
  assert.deepEqual(persisted, ["yolo"]);
});

test("restores the last strict valid session entry", () => {
  const entries = [
    entry("other", { mode: "yolo" }),
    entry(YOLO_SESSION_ENTRY, { mode: "yolo" }),
    entry(YOLO_SESSION_ENTRY, { mode: "default", extra: true }),
    entry(YOLO_SESSION_ENTRY, { mode: "unsafe" }),
  ];
  assert.equal(restoreYoloMode(entries, "default"), "yolo");
  assert.equal(restoreYoloMode([], "yolo"), "yolo");
});

test("runtime bridge exposes live getter state and removes itself safely", () => {
  let mode = "default";
  const uninstall = installYoloRuntime({ getMode: () => mode, setMode: (next) => { mode = next; }, isTaskApproved: () => false });
  assert.equal(readYoloRuntime().getMode(), "default");
  readYoloRuntime().setMode("yolo");
  assert.equal(readYoloRuntime().getMode(), "yolo");
  uninstall();
  assert.equal(readYoloRuntime().getMode(), "default");
});
