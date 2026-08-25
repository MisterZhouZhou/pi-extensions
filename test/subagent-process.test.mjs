import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { buildChildInvocation, parseJsonLines, runChildAgent } from "../packages/subagent/process.ts";

const agent = { name: "explore", description: "Explore", tools: ["read", "bash"], systemPrompt: "Explore.", source: "builtin", filePath: "/agent.md" };
const request = { agent, task: "trace", cwd: "/repo", model: { provider: "openai", id: "gpt-5" }, mode: "yolo", taskApproved: true };
test("builds isolated child invocation and environment", () => {
  const value = buildChildInvocation(request, "/tmp/prompt.md");
  assert.deepEqual(value.args.slice(0, 7), ["--mode", "json", "-p", "--no-session", "--no-extensions", "-e", value.args[6]]);
  assert.deepEqual(value.args.slice(7, 11), ["--model", "openai/gpt-5", "--tools", "read,bash"]);
  assert.equal(value.options.cwd, "/repo"); assert.equal(value.options.env.PI_AGENT_MODE, "yolo"); assert.equal(value.options.env.PI_SUBAGENT_TASK_APPROVED, "1");
});
test("parses only final protocol messages", () => {
  assert.equal(parseJsonLines('bad\n{"type":"message_update"}\n{"type":"message_end","message":{"role":"assistant","content":[]}}\n').length, 1);
});
test("runs child and returns final assistant text", async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true; child.killed = false;
    queueMicrotask(() => { child.stdout.emit("data", '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n'); child.emit("close", 0); });
    return child;
  };
  const result = await runChildAgent(request, fakeSpawn);
  assert.equal(result.status, "completed"); assert.equal(result.text, "done");
});
