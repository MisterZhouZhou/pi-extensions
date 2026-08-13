import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { githubRelease, releaseCommitPaths, resolveGithubScope } from "../scripts/release-github.mjs";

function releaseUnit(selector, root, version = "0.1.0") {
  const workspace = selector === "notify";
  return {
    selector,
    tagPrefix: workspace ? "pi-notify" : "pi-extensions",
    root: workspace ? path.join(root, "packages/notify") : root,
    manifestPath: workspace ? path.join(root, "packages/notify/package.json") : path.join(root, "package.json"),
    manifest: { name: workspace ? "@misterzhou/pi-notify" : "@misterzhou/pi-extensions", version },
    workspace,
  };
}

async function state({ answers = ["0.1.1", "y"], dirty = "", head = "abc", remoteHead = "abc", fail = "" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-github-release-"));
  await writeFile(path.join(root, "package.json"), '{"name":"@misterzhou/pi-extensions","version":"0.1.0"}\n');
  await writeFile(path.join(root, "package-lock.json"), '{"version":"0.1.0"}\n');
  await writeFile(path.join(root, "notify.json"), '{"name":"@misterzhou/pi-notify","version":"0.1.0"}\n');
  const rootUnit = releaseUnit("root", root);
  const notifyUnit = { ...releaseUnit("notify", root), manifestPath: path.join(root, "notify.json") };
  const units = [notifyUnit, rootUnit];
  const calls = [];
  let answerIndex = 0;
  let currentHead = head;
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    const operation = `${command} ${args.join(" ")}`;
    if (fail && operation.startsWith(fail)) throw new Error(`failed: ${operation}`);
    if (command === "git" && args[0] === "branch") return "main";
    if (command === "git" && args[0] === "status") return dirty;
    if (command === "git" && args[0] === "remote") return "git@github.com:MisterZhouZhou/pi-extensions.git";
    if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return currentHead;
    if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") return remoteHead;
    if (command === "git" && args[0] === "show-ref" && args[1] === "--verify") {
      const error = new Error("missing"); error.code = 1; throw error;
    }
    if (command === "git" && args[0] === "ls-remote") {
      const error = new Error("missing"); error.code = 2; throw error;
    }
    if (command === "git" && args[0] === "commit") currentHead = "release-commit";
    if (command === "npm" && args[0] === "install") {
      await writeFile(path.join(root, "package-lock.json"), '{"version":"changed"}\n');
    }
    return "";
  };
  return {
    root,
    calls,
    units,
    options: {
      root,
      interactive: true,
      ask: async () => answers[answerIndex++],
      run: runner,
      releaseUnits: async () => units,
      pack: async (unit, directory) => ({ file: path.join(directory, `${unit.selector}.tgz`), filename: `${unit.selector}.tgz`, integrity: `sha512-${unit.selector}` }),
      registryVersion: async () => false,
      log: () => {},
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("accepts exactly one mutually exclusive GitHub release scope", () => {
  assert.equal(resolveGithubScope(["notify"]), "notify");
  assert.equal(resolveGithubScope(["root"]), "root");
  assert.equal(resolveGithubScope(["all"]), "all");
  for (const argv of [[], ["notify", "0.1.1"], ["notify", "--all"], ["all", "--notify-version", "0.1.1"]]) {
    assert.throws(() => resolveGithubScope(argv), /usage.*notify.*root.*all/u);
  }
});

test("requires an interactive terminal before Git or file operations", async () => {
  await assert.rejects(() => githubRelease(["notify"], { interactive: false }), /interactive terminal/u);
});

test("uses exact release commit paths for each scope", () => {
  assert.deepEqual(releaseCommitPaths("notify"), ["packages/notify/package.json", "package-lock.json"]);
  assert.deepEqual(releaseCommitPaths("root"), ["package.json", "package-lock.json"]);
  assert.deepEqual(releaseCommitPaths("all"), ["packages/notify/package.json", "package.json", "package-lock.json"]);
});

test("creates one notify release commit, tag, and atomic push", async (t) => {
  const current = await state();
  t.after(current.cleanup);
  const result = await githubRelease(["notify"], current.options);
  assert.equal(result.action, "pushed");
  assert.deepEqual(result.tags, ["pi-notify@0.1.1"]);
  assert.equal(JSON.parse(await readFile(current.units[0].manifestPath, "utf8")).version, "0.1.1");
  assert.ok(current.calls.some((call) => call.join(" ") === "git add -- packages/notify/package.json package-lock.json"));
  assert.ok(current.calls.some((call) => call.join(" ") === "git commit -m chore(release): publish notify 0.1.1"));
  assert.ok(current.calls.some((call) => call.join(" ") === "git tag pi-notify@0.1.1"));
  assert.ok(current.calls.some((call) => call.join(" ") === "git push --atomic origin main pi-notify@0.1.1"));
});

test("all updates both versions in one commit and pushes both tags atomically", async (t) => {
  const current = await state({ answers: ["0.1.1", "0.2.0", "y"] });
  t.after(current.cleanup);
  const result = await githubRelease(["all"], current.options);
  assert.deepEqual(result.tags, ["pi-notify@0.1.1", "pi-extensions@0.2.0"]);
  assert.ok(current.calls.some((call) => call.join(" ") === "git commit -m chore(release): publish notify 0.1.1 and root 0.2.0"));
  assert.ok(current.calls.some((call) => call.join(" ") === "git push --atomic origin main pi-notify@0.1.1 pi-extensions@0.2.0"));
});

test("restores exact release files when a pre-commit operation fails", async (t) => {
  const current = await state({ fail: "npm run check" });
  t.after(current.cleanup);
  const before = await Promise.all(current.units.map((unit) => readFile(unit.manifestPath)));
  const lockBefore = await readFile(path.join(current.root, "package-lock.json"));
  await assert.rejects(() => githubRelease(["notify"], current.options), /failed: npm run check/u);
  assert.deepEqual(await readFile(current.units[0].manifestPath), before[0]);
  assert.deepEqual(await readFile(path.join(current.root, "package-lock.json")), lockBefore);
  assert.equal(current.calls.some((call) => call[1] === "commit" || call[1] === "tag" || call[1] === "push"), false);
});

test("cancellation restores exact release files without creating Git refs", async (t) => {
  const current = await state({ answers: ["0.1.1", "n"] });
  t.after(current.cleanup);
  const manifestBefore = await readFile(current.units[0].manifestPath);
  const lockBefore = await readFile(path.join(current.root, "package-lock.json"));
  const result = await githubRelease(["notify"], current.options);
  assert.equal(result.action, "cancelled");
  assert.deepEqual(await readFile(current.units[0].manifestPath), manifestBefore);
  assert.deepEqual(await readFile(path.join(current.root, "package-lock.json")), lockBefore);
  assert.equal(current.calls.some((call) => call[1] === "commit" || call[1] === "tag" || call[1] === "push"), false);
});

test("rejects dirty worktrees and invalid versions before writing", async (t) => {
  const dirty = await state({ dirty: "?? untracked.txt" });
  t.after(dirty.cleanup);
  await assert.rejects(() => githubRelease(["notify"], dirty.options), /working tree must be clean/u);

  const invalid = await state({ answers: ["0.1.0"] });
  t.after(invalid.cleanup);
  const before = await readFile(invalid.units[0].manifestPath);
  await assert.rejects(() => githubRelease(["notify"], invalid.options), /greater than current/u);
  assert.deepEqual(await readFile(invalid.units[0].manifestPath), before);
});

test("keeps commit and tags after atomic push failure and prints retry command", async (t) => {
  const current = await state({ fail: "git push" });
  t.after(current.cleanup);
  await assert.rejects(
    () => githubRelease(["notify"], current.options),
    /git push --atomic origin main pi-notify@0\.1\.1/u,
  );
  assert.equal(JSON.parse(await readFile(current.units[0].manifestPath, "utf8")).version, "0.1.1");
  assert.ok(current.calls.some((call) => call[1] === "commit"));
  assert.ok(current.calls.some((call) => call[1] === "tag"));
  assert.equal(current.calls.some((call) => call[1] === "reset" || call.includes("-f")), false);
});
