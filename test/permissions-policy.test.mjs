import assert from "node:assert/strict";
import test from "node:test";

import { classifyBash, decideToolCall, filterActiveTools } from "../packages/permissions/policy.ts";

const call = (toolName, args = {}, extra = {}) => decideToolCall({
  toolName,
  args,
  mode: "manual",
  hasUI: true,
  ...extra,
});

test("readonly allows inspection tools and read-only Bash", () => {
  for (const toolName of ["read", "grep", "find", "ls"]) {
    assert.deepEqual(decideToolCall({ toolName, args: {}, mode: "readonly", hasUI: true }), { action: "allow" });
  }
  for (const command of ["rg -n auth src", "git status --short", "git diff", "pwd", "ls -la", "cat README.md", "rg foo src && git status"]) {
    assert.equal(classifyBash(command), "readonly", command);
    assert.equal(decideToolCall({ toolName: "bash", args: { command }, mode: "readonly", hasUI: true }).action, "allow", command);
  }
});

test("readonly blocks writes, side effects, and unknown tools", () => {
  assert.equal(call("write", {}, { mode: "readonly" }).action, "block");
  assert.equal(call("edit", {}, { mode: "readonly" }).action, "block");
  assert.equal(call("bash", { command: "npm test" }, { mode: "readonly" }).action, "block");
  assert.equal(call("custom_tool", {}, { mode: "readonly" }).action, "block");
  assert.deepEqual(filterActiveTools(["read", "bash", "edit", "write", "custom_tool"], "readonly"), ["read", "bash"]);
});

test("manual asks for side effects and fails closed without UI", () => {
  assert.equal(call("write").action, "ask");
  assert.equal(call("bash", { command: "npm test" }).action, "ask");
  assert.equal(call("custom_tool").action, "ask");
  assert.equal(call("edit", {}, { hasUI: false }).action, "block");
  assert.equal(call("bash", { command: "npm test" }, { hasUI: false }).action, "block");
});

test("yolo allows ordinary operations but never catastrophic Bash", () => {
  assert.equal(call("write", {}, { mode: "yolo" }).action, "allow");
  assert.equal(call("custom_tool", {}, { mode: "yolo" }).action, "allow");
  assert.equal(call("bash", { command: "npm test" }, { mode: "yolo" }).action, "allow");
  for (const command of ["rm -rf /", "mkfs.ext4 /dev/disk0", "dd if=/dev/zero of=/dev/sda", "shutdown -h now", "git reset --hard HEAD"]) {
    assert.equal(classifyBash(command), "catastrophic", command);
    assert.equal(call("bash", { command }, { mode: "yolo" }).action, "block", command);
  }
});

test("read-only Bash validation fails closed for shell escapes and mutating flags", () => {
  for (const command of ["cat file > out", "echo $(pwd)", "npm test", "sed -i s/a/b/ file", "awk 'BEGIN { system(\"id\") }'", "cat file; pwd"]) {
    assert.notEqual(classifyBash(command), "readonly", command);
  }
});
