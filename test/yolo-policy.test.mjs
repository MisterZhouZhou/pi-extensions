import assert from "node:assert/strict";
import test from "node:test";

import { classifyBash, decideToolCall, isWritableAgentTools } from "../packages/yolo/policy.ts";

const call = (toolName, args = {}, extra = {}) => decideToolCall({ toolName, args, mode: "default", hasUI: true, ...extra });

test("allows read-only tools and safe inspection Bash", () => {
  for (const toolName of ["read", "grep", "find", "ls"]) assert.equal(call(toolName).action, "allow");
  for (const command of ["rg -n auth src", "git status --short", "git diff", "pwd", "ls -la", "cat README.md", "rg foo src && git status"]) {
    assert.equal(classifyBash(command), "readonly", command);
    assert.equal(call("bash", { command }).action, "allow", command);
  }
});

test("asks for writes and unknown Bash in SAFE mode", () => {
  assert.equal(call("write").action, "ask");
  assert.equal(call("bash", { command: "npm test" }).action, "ask");
  assert.equal(call("edit", {}, { hasUI: false }).action, "block");
  assert.equal(call("bash", { command: "npm test" }, { hasUI: false }).action, "block");
});

test("YOLO allows ordinary writes and Bash but never catastrophic Bash", () => {
  assert.equal(call("write", {}, { mode: "yolo" }).action, "allow");
  assert.equal(decideToolCall({ toolName: "bash", args: { command: "npm test" }, mode: "yolo", hasUI: true }).action, "allow");
  for (const command of ["rm -rf /", "mkfs.ext4 /dev/disk0", "dd if=/dev/zero of=/dev/sda", "shutdown -h now"]) {
    assert.equal(classifyBash(command), "catastrophic", command);
    assert.equal(decideToolCall({ toolName: "bash", args: { command }, mode: "yolo", hasUI: true }).action, "block", command);
  }
});

test("does not intercept unknown third-party tools and classifies agent write capability", () => {
  assert.equal(call("my_custom_tool").action, "allow");
  assert.equal(isWritableAgentTools(undefined), true);
  assert.equal(isWritableAgentTools([]), true);
  assert.equal(isWritableAgentTools(["read", "grep"]), false);
  assert.equal(isWritableAgentTools(["read", "write"]), true);
});
