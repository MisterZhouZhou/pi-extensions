import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareStableVersions,
  npmWhoami,
  parseReleaseTag,
  publishTarball,
  releaseUnit,
  releaseUnits,
  run,
  stableVersion,
} from "../scripts/release-common.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("discovers independently versioned release units", async () => {
  assert.deepEqual(
    (await releaseUnits(repoRoot)).map(({ selector, manifest }) => [selector, manifest.name]),
    [
      ["notify", "@misterzhouzhou/pi-notify"],
      ["root", "@misterzhouzhou/pi-extensions"],
    ],
  );
  assert.equal((await releaseUnit("notify", repoRoot)).tagPrefix, "pi-notify");
  assert.equal((await releaseUnit("root", repoRoot)).tagPrefix, "pi-extensions");
});

test("parses only supported package-level stable tags", () => {
  assert.deepEqual(parseReleaseTag("pi-notify@0.2.0"), { selector: "notify", version: "0.2.0" });
  assert.deepEqual(parseReleaseTag("pi-extensions@0.1.1"), { selector: "root", version: "0.1.1" });
  assert.throws(() => parseReleaseTag("v0.2.0"), /unsupported release tag/u);
  assert.throws(() => parseReleaseTag("pi-notify@0.2.0-beta.1"), /stable version/u);
});

test("validates selectors and stable manifest versions", async () => {
  assert.equal(stableVersion("0.1.0"), true);
  assert.equal(stableVersion("10.0.0"), true);
  assert.equal(stableVersion("01.0.0"), false);
  assert.equal(stableVersion("0.1.0-beta.1"), false);
  assert.equal(stableVersion("v0.1.0"), false);
  await assert.rejects(() => releaseUnit("missing", repoRoot), /selector must be root or notify/u);
});

test("compares strict stable versions numerically", () => {
  assert.equal(compareStableVersions("0.10.0", "0.2.0"), 1);
  assert.equal(compareStableVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareStableVersions("1.0.0", "2.0.0"), -1);
  assert.equal(compareStableVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  assert.throws(() => compareStableVersions("v1.0.0", "1.0.0"), /stable versions/u);
});

test("authenticates and publishes an exact tarball through the public registry", async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    return args[0] === "whoami" ? "MisterZhouZhou" : "";
  };

  assert.equal(await npmWhoami({ root: "/repo", env: {}, runner }), "MisterZhouZhou");
  await publishTarball("/tmp/checked.tgz", { root: "/repo", env: {}, runner });

  assert.deepEqual(calls.map(({ args }) => args), [
    ["whoami", "--registry=https://registry.npmjs.org"],
    ["publish", "/tmp/checked.tgz", "--ignore-scripts", "--access", "public", "--tag", "latest", "--registry=https://registry.npmjs.org"],
  ]);
});

test("includes captured stdout when a command fails", async () => {
  await assert.rejects(
    () => run(process.execPath, ["-e", "console.log(process.env.RELEASE_TEST_DETAIL); process.exit(1)"], {
      env: { ...process.env, RELEASE_TEST_DETAIL: "visible failure details" },
    }),
    /visible failure details/u,
  );
});
