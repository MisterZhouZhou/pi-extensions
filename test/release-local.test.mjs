import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { localRelease, releasePaths, resolveReleaseInput } from "../scripts/release-local.mjs";

function unit(selector = "notify", version = "0.1.0", root = "/repo") {
  return {
    selector,
    tagPrefix: selector === "root" ? "pi-extensions" : "pi-notify",
    root: selector === "root" ? root : path.join(root, "packages/notify"),
    manifestPath: selector === "root" ? path.join(root, "package.json") : path.join(root, "packages/notify/package.json"),
    manifest: {
      name: selector === "root" ? "@misterzhouzhou/pi-extensions" : "@misterzhouzhou/pi-notify",
      version,
      files: selector === "root" ? ["packages/notify", "README.md", "LICENSE"] : ["index.ts"],
    },
    workspace: selector !== "root",
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-release-test-"));
  await mkdir(path.join(root, "packages/notify"), { recursive: true });
  const rootManifestPath = path.join(root, "package.json");
  const notifyManifestPath = path.join(root, "packages/notify/package.json");
  const lockfilePath = path.join(root, "package-lock.json");
  await writeFile(rootManifestPath, `${JSON.stringify({
    name: "@misterzhouzhou/pi-extensions",
    version: "0.1.0",
    files: ["packages/notify", "README.md", "LICENSE"],
    workspaces: ["packages/*"],
  }, null, 2)}\n`);
  await writeFile(notifyManifestPath, `${JSON.stringify({
    name: "@misterzhouzhou/pi-notify",
    version: "0.1.0",
    files: ["index.ts"],
  }, null, 2)}\n`);
  await writeFile(lockfilePath, "{\n  \"originalLockfile\": true\n}\n");
  return {
    root,
    rootManifestPath,
    notifyManifestPath,
    lockfilePath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function state(options = {}) {
  const files = await fixture();
  const calls = [];
  const answers = options.answers ? [...options.answers] : ["y"];
  const run = async (command, args) => {
    calls.push({ operation: command === "git" ? "git-status" : args[0], command, args });
    if (command === "git") return options.dirty ?? "";
    if (args[0] === "install") {
      await writeFile(files.lockfilePath, "{\n  \"syncedVersion\": \"0.1.1\"\n}\n");
    }
    if (options.failAt === args[0]) throw new Error(`${args[0]} failed`);
    return "";
  };
  const result = {
    ...files,
    calls,
    publishCalls: [],
    summaries: [],
    warnings: [],
    options: {
      root: files.root,
      env: {},
      interactive: true,
      ask: async () => answers.shift() ?? "",
      run,
      pack: async (releaseUnit, directory) => {
        calls.push({ operation: "pack", releaseUnit, directory });
        if (options.failAt === "pack") throw new Error("pack failed");
        return {
          file: path.join(directory, "checked.tgz"),
          filename: "checked.tgz",
          size: 123,
          integrity: "sha512-checked",
        };
      },
      registryVersion: async (...args) => {
        calls.push({ operation: "registry", args });
        if (options.failAt === "registry") throw new Error("registry failed");
        return options.registry?.shift?.() ?? options.published ?? false;
      },
      npmWhoami: async () => {
        calls.push({ operation: "whoami" });
        if (options.failAt === "whoami") throw new Error("whoami failed");
        return "MisterZhouZhou";
      },
      publishTarball: async (file) => {
        calls.push({ operation: "publish", file });
        result.publishCalls.push(file);
        if (options.failAt === "publish") throw new Error("publish failed");
      },
      sleep: async (milliseconds) => calls.push({ operation: "sleep", milliseconds }),
      log: (message) => result.summaries.push(message),
      warn: (message) => result.warnings.push(message),
    },
  };
  return result;
}

async function snapshots(current, selector = "notify") {
  return {
    manifest: await readFile(selector === "root" ? current.rootManifestPath : current.notifyManifestPath),
    lockfile: await readFile(current.lockfilePath),
  };
}

async function assertRestored(current, original, selector = "notify") {
  const actual = await snapshots(current, selector);
  assert.deepEqual(actual.manifest, original.manifest);
  assert.deepEqual(actual.lockfile, original.lockfile);
  assert.deepEqual(current.publishCalls, []);
}

test("accepts complete arguments, prompts for missing values, and rejects unsafe usage", async () => {
  assert.deepEqual(
    await resolveReleaseInput(["notify", "0.1.1"], { interactive: true, ask: async () => assert.fail() }),
    { selector: "notify", version: "0.1.1" },
  );
  const answers = ["notify", "0.1.1"];
  assert.deepEqual(await resolveReleaseInput([], { interactive: true, ask: async () => answers.shift() }), {
    selector: "notify",
    version: "0.1.1",
  });
  await assert.rejects(() => resolveReleaseInput(["missing", "0.1.1"], { interactive: true }), /root or notify/u);
  await assert.rejects(() => resolveReleaseInput(["notify"], { interactive: true }), /usage/u);
  await assert.rejects(() => resolveReleaseInput(["notify", "0.1.1"], { interactive: false }), /interactive terminal/u);
});

test("scopes preflight paths to the selected release unit", () => {
  assert.deepEqual(releasePaths(unit("notify")), [
    "packages/notify",
    "package-lock.json",
    "scripts/release-local.mjs",
    "scripts/release-common.mjs",
    "scripts/publish-release.mjs",
  ]);
  assert.deepEqual(releasePaths(unit("root")), [
    "package.json",
    "package-lock.json",
    "README.md",
    "LICENSE",
    "packages/notify",
    "scripts/release-local.mjs",
    "scripts/release-common.mjs",
    "scripts/publish-release.mjs",
  ]);
});

test("rejects invalid versions, local tokens, and dirty release paths before writing", async (t) => {
  for (const version of ["0.1.0", "0.0.9", "0.1.1-beta.1", "01.0.0"]) {
    const current = await state();
    t.after(current.cleanup);
    const original = await snapshots(current);
    await assert.rejects(() => localRelease(["notify", version], current.options), /stable|greater/u);
    await assertRestored(current, original);
    assert.deepEqual(current.calls, []);
  }

  const token = await state();
  t.after(token.cleanup);
  token.options.env = { NPM_TOKEN: "forbidden" };
  await assert.rejects(() => localRelease(["notify", "0.1.1"], token.options), /npm login/u);
  assert.deepEqual(token.calls, []);

  const dirty = await state({ dirty: " M packages/notify/index.ts" });
  t.after(dirty.cleanup);
  const original = await snapshots(dirty);
  await assert.rejects(() => localRelease(["notify", "0.1.1"], dirty.options), /uncommitted changes/u);
  await assertRestored(dirty, original);
  assert.deepEqual(dirty.calls.map(({ operation }) => operation), ["git-status"]);
  assert.deepEqual(dirty.calls[0].args, [
    "status", "--porcelain", "--untracked-files=no", "--",
    "packages/notify", "package-lock.json", "scripts/release-local.mjs", "scripts/release-common.mjs", "scripts/publish-release.mjs",
  ]);
});

test("rolls back exact bytes for every failure before npm publish and for cancellation", async (t) => {
  for (const failAt of ["install", "run", "pack", "registry", "whoami"]) {
    const current = await state({ failAt });
    t.after(current.cleanup);
    const original = await snapshots(current);
    await assert.rejects(() => localRelease(["notify", "0.1.1"], current.options));
    await assertRestored(current, original);
  }

  const published = await state({ published: true });
  t.after(published.cleanup);
  const publishedOriginal = await snapshots(published);
  await assert.rejects(() => localRelease(["notify", "0.1.1"], published.options), /already published/u);
  await assertRestored(published, publishedOriginal);

  const cancelled = await state({ answers: ["n"] });
  t.after(cancelled.cleanup);
  const cancelledOriginal = await snapshots(cancelled);
  const result = await localRelease(["notify", "0.1.1"], cancelled.options);
  assert.equal(result.action, "cancelled");
  await assertRestored(cancelled, cancelledOriginal);
});

test("checks, summarizes, and publishes the same prepared artifact", async (t) => {
  const current = await state();
  t.after(current.cleanup);
  const rootBefore = await readFile(current.rootManifestPath);
  const result = await localRelease(["notify", "0.1.1"], current.options);

  assert.equal(result.action, "published");
  assert.equal(result.version, "0.1.1");
  assert.equal(current.publishCalls.length, 1);
  assert.match(current.publishCalls[0], /checked\.tgz$/u);
  assert.deepEqual(await readFile(current.rootManifestPath), rootBefore);
  assert.equal(JSON.parse(await readFile(current.notifyManifestPath, "utf8")).version, "0.1.1");
  assert.equal(JSON.parse(await readFile(current.lockfilePath, "utf8")).syncedVersion, "0.1.1");
  assert.deepEqual(current.calls.map(({ operation }) => operation), [
    "git-status", "install", "run", "pack", "registry", "whoami", "publish",
  ]);
  assert.match(current.summaries[0], /@misterzhouzhou\/pi-notify/u);
  assert.match(current.summaries[0], /0\.1\.0 -> 0\.1\.1/u);
  assert.match(current.summaries[0], /MisterZhouZhou/u);
  assert.match(current.summaries[0], /checked\.tgz/u);
});

test("updates root independently from notify", async (t) => {
  const current = await state();
  t.after(current.cleanup);
  const notifyBefore = await readFile(current.notifyManifestPath);
  const result = await localRelease(["root", "0.1.1"], current.options);
  assert.equal(result.selector, "root");
  assert.equal(JSON.parse(await readFile(current.rootManifestPath, "utf8")).version, "0.1.1");
  assert.deepEqual(await readFile(current.notifyManifestPath), notifyBefore);
});

test("keeps version files after publish starts and confirms registry success", async (t) => {
  const current = await state({ failAt: "publish", registry: [false, false, true] });
  t.after(current.cleanup);
  const result = await localRelease(["notify", "0.1.1"], current.options);
  assert.equal(result.action, "published-after-client-error");
  assert.equal(JSON.parse(await readFile(current.notifyManifestPath, "utf8")).version, "0.1.1");
  assert.equal(current.calls.filter(({ operation }) => operation === "sleep").length, 1);
  assert.equal(current.warnings.length, 1);
});

test("keeps version files and reports unknown status when publish cannot be confirmed", async (t) => {
  const current = await state({ failAt: "publish", registry: [false, false, false, false, false, false] });
  t.after(current.cleanup);
  await assert.rejects(
    () => localRelease(["notify", "0.1.1"], current.options),
    /publish status is unknown.*do not retry blindly/us,
  );
  assert.equal(JSON.parse(await readFile(current.notifyManifestPath, "utf8")).version, "0.1.1");
  assert.equal(JSON.parse(await readFile(current.lockfilePath, "utf8")).syncedVersion, "0.1.1");
  assert.equal(current.calls.filter(({ operation }) => operation === "sleep").length, 4);
});

test("keeps version files when post-publish registry checks also fail", async (t) => {
  const current = await state({ failAt: "publish" });
  t.after(current.cleanup);
  let lookupCalls = 0;
  current.options.registryVersion = async () => {
    lookupCalls += 1;
    if (lookupCalls === 1) return false;
    throw new Error("registry unavailable");
  };

  await assert.rejects(
    () => localRelease(["notify", "0.1.1"], current.options),
    /publish status is unknown.*do not retry blindly/us,
  );
  assert.equal(lookupCalls, 6);
  assert.equal(JSON.parse(await readFile(current.notifyManifestPath, "utf8")).version, "0.1.1");
  assert.equal(JSON.parse(await readFile(current.lockfilePath, "utf8")).syncedVersion, "0.1.1");
  assert.equal(current.calls.filter(({ operation }) => operation === "sleep").length, 4);
});
