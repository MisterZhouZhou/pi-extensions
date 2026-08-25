import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubagentTool,
  registerSubagentExtension,
  resolveRequestedTasks,
  runWithConcurrencyLimit,
} from "../packages/subagent/index.ts";

const agent = (name, source = "builtin", tools = ["read"]) => ({
  name,
  source,
  tools,
  description: `${name} agent`,
  systemPrompt: `${name} prompt`,
  filePath: `/${source}/${name}.md`,
});

function fakeContext(overrides = {}) {
  const confirms = [];
  return {
    confirms,
    value: {
      cwd: "/repo",
      hasUI: true,
      mode: "tui",
      model: { provider: "openai", id: "gpt-5" },
      ui: {
        confirm: async (...args) => {
          confirms.push(args);
          return true;
        },
        notify() {},
      },
      ...overrides,
    },
  };
}

function fakePi() {
  const tools = new Map();
  return { tools, registerTool(tool) { tools.set(tool.name, tool); } };
}

test("requires exactly one single, parallel, or chain mode", async () => {
  const options = { cwd: "/repo", agents: [agent("explore")] };
  await assert.rejects(() => resolveRequestedTasks({}, options), /exactly one/u);
  await assert.rejects(() => resolveRequestedTasks({ agent: "explore", task: "x", tasks: [] }, options), /exactly one/u);
  await assert.rejects(() => resolveRequestedTasks({ tasks: [] }, options), /at least one/u);
  await assert.rejects(() => resolveRequestedTasks({ chain: [{ agent: "explore", task: "x" }], tasks: [{ agent: "explore", task: "x" }] }, options), /exactly one/u);
});

test("project trust is confirmed once and denied project agents fall back", async () => {
  const discovery = {
    agents: [agent("explore", "project"), agent("explore", "user"), agent("planner")],
    projectAgentsDir: "/repo/.pi/agents",
  };
  const ctx = fakeContext();
  ctx.value.ui.confirm = async (...args) => {
    ctx.confirms.push(args);
    return false;
  };
  const resolved = await resolveRequestedTasks(
    { tasks: [{ agent: "explore", task: "trace" }, { agent: "planner", task: "plan" }] },
    { cwd: "/repo", hasUI: true, agents: discovery.agents, projectAgentsDir: discovery.projectAgentsDir, ui: ctx.value.ui },
  );
  assert.equal(ctx.confirms.length, 1);
  assert.match(ctx.confirms[0][0], /project/u);
  assert.equal(resolved.tasks[0].agentConfig.source, "user");
  assert.equal(resolved.tasks[1].agentConfig.source, "builtin");
});

test("writable subagents ask once and pass approval to every child", async () => {
  const pi = fakePi();
  const spawned = [];
  registerSubagentExtension(pi, {
    discover: async () => ({ agents: [agent("worker", "builtin", ["read", "write"]), agent("explore")] }),
    runChild: async (request) => { spawned.push(request); return { agent: request.agent.name, source: request.agent.source, task: request.task, status: "completed", text: "ok" }; },
    runtime: { getMode: () => "default", isTaskApproved: () => false, setMode() {} },
  });
  const ctx = fakeContext();
  await pi.tools.get("subagent").execute("id", { tasks: [{ agent: "worker", task: "one" }, { agent: "worker", task: "two" }] }, undefined, undefined, ctx.value);
  assert.equal(ctx.confirms.filter(([title]) => title === "Run writable subagents?").length, 1);
  assert.deepEqual(spawned.map((item) => item.taskApproved), [true, true]);
});

test("readonly subagents do not receive mutation approval", async () => {
  const pi = fakePi();
  const spawned = [];
  registerSubagentExtension(pi, {
    discover: async () => ({ agents: [agent("explore")] }),
    runChild: async (request) => { spawned.push(request); return { agent: request.agent.name, source: request.agent.source, task: request.task, status: "completed", text: "ok" }; },
    runtime: { getMode: () => "default", isTaskApproved: () => false, setMode() {} },
  });
  const ctx = fakeContext();
  await pi.tools.get("subagent").execute("id", { agent: "explore", task: "trace" }, undefined, undefined, ctx.value);
  assert.equal(ctx.confirms.length, 0);
  assert.equal(spawned[0].taskApproved, false);
});

test("YOLO skips project trust confirmation", async () => {
  const pi = fakePi();
  const spawned = [];
  registerSubagentExtension(pi, {
    discover: async () => ({ agents: [agent("explore", "project")], projectAgentsDir: "/repo/.pi/agents" }),
    runChild: async (request) => { spawned.push(request); return { agent: request.agent.name, source: request.agent.source, task: request.task, status: "completed", text: "ok" }; },
    runtime: { getMode: () => "yolo", isTaskApproved: () => false, setMode() {} },
  });
  const ctx = fakeContext();
  await pi.tools.get("subagent").execute("id", { agent: "explore", task: "trace" }, undefined, undefined, ctx.value);
  assert.equal(ctx.confirms.length, 0);
  assert.equal(spawned[0].agent.source, "project");
});

test("parallel execution is capped at four and results preserve input order", async () => {
  let active = 0;
  let peak = 0;
  const completion = [];
  const results = await runWithConcurrencyLimit(
    [0, 1, 2, 3, 4, 5, 6].map((value) => ({ value })),
    async ({ value }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 0 ? 20 : 2));
      completion.push(value);
      active -= 1;
      return value;
    },
    undefined,
    4,
  );
  assert.ok(peak <= 4);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.notDeepEqual(completion, results);
});

test("chain substitutes previous output and stops after a failure", async () => {
  const pi = fakePi();
  const spawned = [];
  registerSubagentExtension(pi, {
    discover: async () => ({ agents: [agent("explore"), agent("worker", "builtin", ["write"]) ] }),
    runChild: async (request) => {
      spawned.push(request);
      if (request.task.includes("stop")) return { agent: request.agent.name, source: request.agent.source, task: request.task, status: "failed", text: "", stderr: "failed" };
      return { agent: request.agent.name, source: request.agent.source, task: request.task, status: "completed", text: "previous result" };
    },
    runtime: { getMode: () => "yolo", isTaskApproved: () => false, setMode() {} },
  });
  const ctx = fakeContext();
  const result = await pi.tools.get("subagent").execute("id", {
    chain: [{ agent: "explore", task: "first" }, { agent: "explore", task: "stop {previous}" }, { agent: "worker", task: "must not run" }],
  }, undefined, undefined, ctx.value);
  assert.equal(result.details.isError, true);
  assert.equal(spawned.length, 2);
  assert.match(spawned[1].task, /previous result/u);
});

test("registers one naturally callable subagent tool", () => {
  const pi = fakePi();
  const tool = buildSubagentTool({ discover: async () => ({ agents: [] }), runChild: async () => { throw new Error("unused"); } });
  registerSubagentExtension(pi);
  assert.equal(pi.tools.size, 1);
  assert.equal(pi.tools.get("subagent").description, tool.description);
  assert.match(tool.description, /explore.*planner.*worker.*reviewer/s);
});
