import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  incrementStableVersion,
  localRelease,
  releasePaths,
  resolveReleaseSelector,
  resolveTargetVersion,
} from "../scripts/release-local.mjs";

function unit(selector = "notify", version = "0.1.0", root = "/repo") {
  return {
    selector,
    tagPrefix: selector === "root" ? "pi-extensions" : "pi-notify",
    root: selector === "root" ? root : path.join(root, "packages/notify"),
    manifestPath: selector === "root" ? path.join(root, "package.json") : path.join(root, "packages/notify/package.json"),
    manifest: {
      name: selector === "root" ? "@misterzhou/pi-extensions" : "@misterzhou/pi-notify",
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
    name: "@misterzhou/pi-extensions",
    version: "0.1.0",
    files: ["packages/notify", "README.md", "LICENSE"],
    workspaces: ["packages/*"],
  }, null, 2)}\n`);
  await writeFile(notifyManifestPath, `${JSON.stringify({
    name: "@misterzhou/pi-notify",
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
  const questions = [];
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
    questions,
    publishCalls: [],
    publishOptions: [],
    summaries: [],
    warnings: [],
    options: {
      root: files.root,
      env: {},
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return answers.shift() ?? "";
      },
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
      publishTarball: async (file, publishOptions) => {
        calls.push({ operation: "publish", file });
        result.publishCalls.push(file);
        result.publishOptions.push(publishOptions);
        if (options.requireOtp && publishOptions.otp === undefined) {
          throw new Error("EOTP: This operation requires a one-time password");
        }
        if (options.requireTrustedCredential) {
          throw new Error("Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages");
        }
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

test("increments stable versions without numeric precision loss", () => {
  assert.equal(incrementStableVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(incrementStableVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(incrementStableVersion("1.2.3", "major"), "2.0.0");
  assert.equal(
    incrementStableVersion("9007199254740993.2.3", "patch"),
    "9007199254740993.2.4",
  );
  assert.throws(() => incrementStableVersion("1.2.3-beta.1", "patch"), /stable X\.Y\.Z/u);
  assert.throws(() => incrementStableVersion("1.2.3", "other"), /patch, minor, or major/u);
});

test("parses explicit and menu release selectors and rejects unsafe usage", async () => {
  assert.deepEqual(
    await resolveReleaseSelector(["notify", "0.1.1"], { interactive: true, ask: async () => assert.fail() }),
    { selector: "notify", explicitVersion: "0.1.1" },
  );
  assert.deepEqual(await resolveReleaseSelector(["root"], { interactive: true }), {
    selector: "root",
    explicitVersion: undefined,
  });
  const answers = ["1"];
  const questions = [];
  assert.deepEqual(await resolveReleaseSelector([], {
    interactive: true,
    ask: async (question) => { questions.push(question); return answers.shift(); },
  }), {
    selector: "notify",
    explicitVersion: undefined,
  });
  assert.match(questions[0], /1\) notify[\s\S]*2\) root[\s\S]*请输入选择 \(1\/2\)/u);
  for (const [answer, selector] of [["2", "root"], ["notify", "notify"], ["root", "root"]]) {
    assert.deepEqual(await resolveReleaseSelector([], {
      interactive: true,
      ask: async () => answer,
    }), {
      selector,
      explicitVersion: undefined,
    });
  }
  await assert.rejects(
    () => resolveReleaseSelector([], { interactive: true, ask: async () => "missing" }),
    /invalid package selection/u,
  );
  await assert.rejects(() => resolveReleaseSelector(["missing", "0.1.1"], { interactive: true }), /root or notify/u);
  await assert.rejects(() => resolveReleaseSelector(["notify", "0.1.1", "extra"], { interactive: true }), /usage/u);
  await assert.rejects(() => resolveReleaseSelector(["notify", "0.1.1"], { interactive: false }), /interactive terminal/u);
});

test("resolves automatic and custom target versions while explicit versions skip menus", async () => {
  const expected = new Map([["1", "0.1.1"], ["2", "0.2.0"], ["3", "1.0.0"]]);
  for (const [answer, version] of expected) {
    const questions = [];
    assert.equal(await resolveTargetVersion("0.1.0", undefined, {
      ask: async (question) => { questions.push(question); return answer; },
    }), version);
    assert.match(questions[0], /当前版本：0\.1\.0/u);
    assert.match(questions[0], /1\) patch：0\.1\.0 -> 0\.1\.1/u);
    assert.match(questions[0], /2\) minor：0\.1\.0 -> 0\.2\.0/u);
    assert.match(questions[0], /3\) major：0\.1\.0 -> 1\.0\.0/u);
    assert.match(questions[0], /4\) 输入自定义版本号/u);
  }
  const customAnswers = ["4", "0.3.0"];
  assert.equal(await resolveTargetVersion("0.1.0", undefined, {
    ask: async () => customAnswers.shift(),
  }), "0.3.0");
  assert.equal(await resolveTargetVersion("0.1.0", "0.4.0", {
    ask: async () => assert.fail("explicit version must skip the menu"),
  }), "0.4.0");
  await assert.rejects(
    () => resolveTargetVersion("0.1.0", undefined, { ask: async () => "5" }),
    /invalid version selection/u,
  );
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
  for (const version of ["0.0.9", "0.1.1-beta.1", "01.0.0"]) {
    const current = await state();
    t.after(current.cleanup);
    const original = await snapshots(current);
    await assert.rejects(() => localRelease(["notify", version], current.options), /stable|greater/u);
    await assertRestored(current, original);
    assert.deepEqual(current.calls, []);
  }

  for (const version of ["0.1.0", "0.1.1-beta.1"]) {
    const current = await state({ answers: ["4", version] });
    t.after(current.cleanup);
    const original = await snapshots(current);
    await assert.rejects(() => localRelease(["notify"], current.options), /stable|greater/u);
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

test("allows an explicit current version to resume an unpublished release", async (t) => {
  const current = await state();
  t.after(current.cleanup);

  const result = await localRelease(["notify", "0.1.0"], current.options);

  assert.equal(result.action, "published");
  assert.equal(result.version, "0.1.0");
  assert.deepEqual(
    current.calls.find(({ operation }) => operation === "registry").args,
    ["@misterzhou/pi-notify", "0.1.0"],
  );
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
  assert.match(current.summaries[0], /@misterzhou\/pi-notify/u);
  assert.match(current.summaries[0], /0\.1\.0 -> 0\.1\.1/u);
  assert.match(current.summaries[0], /MisterZhouZhou/u);
  assert.match(current.summaries[0], /checked\.tgz/u);
});

test("publishes a package-level patch selected from the version menu", async (t) => {
  const current = await state({ answers: ["1", "y"] });
  t.after(current.cleanup);
  const rootBefore = await readFile(current.rootManifestPath);
  const result = await localRelease(["notify"], current.options);

  assert.deepEqual(result, {
    action: "published",
    selector: "notify",
    package: "@misterzhou/pi-notify",
    version: "0.1.1",
    integrity: "sha512-checked",
  });
  assert.match(current.questions[0], /请选择版本更新类型/u);
  assert.equal(current.questions.at(-1), "Publish now? [y/N] ");
  assert.deepEqual(await readFile(current.rootManifestPath), rootBefore);
  assert.equal(JSON.parse(await readFile(current.notifyManifestPath, "utf8")).version, "0.1.1");
  assert.equal(JSON.parse(await readFile(current.lockfilePath, "utf8")).syncedVersion, "0.1.1");
  const packedUnit = current.calls.find(({ operation }) => operation === "pack").releaseUnit;
  assert.equal(packedUnit.selector, "notify");
  assert.equal(packedUnit.manifest.version, "0.1.1");
  assert.deepEqual(
    current.calls.find(({ operation }) => operation === "registry").args,
    ["@misterzhou/pi-notify", "0.1.1"],
  );
  assert.equal(current.publishCalls.length, 1);
});

test("retries npm publish with an interactive OTP when the registry requires 2FA", async (t) => {
  const current = await state({ answers: ["y", "123456"], requireOtp: true });
  t.after(current.cleanup);

  const result = await localRelease(["notify", "0.1.1"], current.options);

  assert.equal(result.action, "published");
  assert.deepEqual(current.questions, [
    "Publish now? [y/N] ",
    "npm 要求二次验证，请输入 6 位 OTP：",
  ]);
  assert.equal(current.publishCalls.length, 2);
  assert.equal(current.publishOptions[0].otp, undefined);
  assert.equal(current.publishOptions[1].otp, "123456");
});

test("does not request an OTP for the granular-token publishing policy error", async (t) => {
  const current = await state({
    answers: ["y"],
    requireTrustedCredential: true,
  });
  t.after(current.cleanup);

  await assert.rejects(
    () => localRelease(["notify", "0.1.1"], current.options),
    /必须启用账号 2FA.*Bypass 2FA.*不是 OTP 请求/us,
  );
  assert.deepEqual(current.questions, ["Publish now? [y/N] "]);
  assert.equal(current.publishCalls.length, 1);
});

test("selects root and a custom version, then restores exact files on cancellation", async (t) => {
  const current = await state({ answers: ["2", "4", "0.2.0", "n"] });
  t.after(current.cleanup);
  const rootOriginal = await snapshots(current, "root");
  const notifyBefore = await readFile(current.notifyManifestPath);
  const result = await localRelease([], current.options);

  assert.deepEqual(result, {
    action: "cancelled",
    selector: "root",
    package: "@misterzhou/pi-extensions",
    version: "0.2.0",
  });
  assert.match(current.questions[0], /请选择发布包/u);
  assert.match(current.questions[1], /请选择版本更新类型/u);
  assert.equal(current.questions[2], "请输入自定义版本号：");
  assert.equal(current.questions[3], "Publish now? [y/N] ");
  await assertRestored(current, rootOriginal, "root");
  assert.deepEqual(await readFile(current.notifyManifestPath), notifyBefore);
});

test("explicit versions skip menus but still require final confirmation", async (t) => {
  const current = await state({ answers: ["n"] });
  t.after(current.cleanup);
  const original = await snapshots(current);
  const result = await localRelease(["notify", "0.1.1"], current.options);

  assert.equal(result.action, "cancelled");
  assert.deepEqual(current.questions, ["Publish now? [y/N] "]);
  await assertRestored(current, original);
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
