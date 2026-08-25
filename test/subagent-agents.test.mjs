import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverAgents, isWritableAgent, parseAgentMarkdown } from "../packages/subagent/agents.ts";

const agent = (name, tools = "read") => `---\nname: ${name}\ndescription: ${name} agent\ntools: ${tools}\n---\nPrompt for ${name}.\n`;

test("parses only complete agent Markdown and classifies write capability", () => {
  assert.equal(parseAgentMarkdown("no frontmatter", "/x.md", "user"), undefined);
  assert.equal(parseAgentMarkdown("---\nname: x\n---\n", "/x.md", "user"), undefined);
  assert.equal(isWritableAgent({ tools: undefined }), true);
  assert.equal(isWritableAgent({ tools: ["bash"] }), false);
  assert.equal(isWritableAgent({ tools: ["read", "edit"] }), true);
});

test("discovers builtin, user, project agents with project override", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  try {
    const builtinDir = path.join(root, "builtin"); const userDir = path.join(root, "user"); const projectDir = path.join(root, "repo", ".pi", "agents");
    await Promise.all([mkdir(builtinDir, { recursive: true }), mkdir(userDir, { recursive: true }), mkdir(projectDir, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(builtinDir, "explore.md"), agent("explore")), writeFile(path.join(builtinDir, "worker.md"), agent("worker", "write")),
      writeFile(path.join(userDir, "explore.md"), agent("explore", "grep")), writeFile(path.join(userDir, "user-only.md"), agent("user-only")),
      writeFile(path.join(projectDir, "explore.md"), agent("explore", "read")), writeFile(path.join(projectDir, "project-only.md"), agent("project-only")),
    ]);
    const cwd = path.join(root, "repo", "src"); await mkdir(cwd);
    const both = await discoverAgents(cwd, "both", { builtinDir, userDir });
    assert.deepEqual(both.agents.map(({ name, source }) => [name, source]), [["explore", "project"], ["project-only", "project"], ["user-only", "user"], ["worker", "builtin"]]);
    assert.equal((await discoverAgents(cwd, "builtin", { builtinDir, userDir })).agents.length, 2);
    assert.deepEqual((await discoverAgents(cwd, "user", { builtinDir, userDir })).agents.map((item) => item.name), ["explore", "user-only"]);
    assert.deepEqual((await discoverAgents(cwd, "project", { builtinDir, userDir })).agents.map((item) => item.name), ["explore", "project-only"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
