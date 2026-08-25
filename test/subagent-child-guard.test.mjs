import assert from "node:assert/strict";
import test from "node:test";
import { registerChildGuard } from "../packages/subagent/child-guard.ts";

const gate = (env = {}) => { let handler; registerChildGuard({ on: (_name, value) => { handler = value; } }, env); return handler; };
test("child guard always blocks catastrophic Bash", () => {
  assert.deepEqual(gate({ PI_AGENT_MODE: "yolo" })({ toolName: "bash", input: { command: "rm -rf /" } }), { block: true, reason: "Blocked catastrophic Bash command in subagent" });
});
test("child guard fails closed for unapproved mutations and permits exact approvals", () => {
  assert.equal(gate({})({ toolName: "read", input: {} }), undefined);
  assert.equal(gate({})({ toolName: "bash", input: { command: "git status" } }), undefined);
  assert.match(gate({})({ toolName: "write", input: {} }).reason, /not approved/u);
  assert.equal(gate({ PI_AGENT_MODE: "yolo" })({ toolName: "write", input: {} }), undefined);
  assert.equal(gate({ PI_SUBAGENT_TASK_APPROVED: "1" })({ toolName: "bash", input: { command: "npm test" } }), undefined);
  assert.match(gate({ PI_AGENT_MODE: "YOLO" })({ toolName: "edit", input: {} }).reason, /not approved/u);
  assert.equal(gate({})({ toolName: "third_party", input: {} }), undefined);
});
