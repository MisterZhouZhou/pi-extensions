import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { releaseCheck } from "../scripts/release-check.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-prepare-test-"));
  await cp(repoRoot, root, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.git`),
  });
  return root;
}

test("release-check rejects all arguments", async () => {
  await assert.rejects(() => releaseCheck(["0.2.0"]), /does not accept arguments/u);
  await assert.rejects(() => releaseCheck(["--write"]), /does not accept arguments/u);
});

test("release-check reports independent registry status without changing the lockfile", async () => {
  const root = await fixture();
  const lockfile = path.join(root, "package-lock.json");
  const lockfileBefore = await readFile(lockfile);
  const calls = [];
  const result = await releaseCheck([], {
    root,
    registryVersion: async (name) => name.endsWith("pi-notify"),
    log: (...args) => calls.push(args),
  });

  assert.deepEqual(result.packages, [
    { selector: "notify", name: "@misterzhouzhou/pi-notify", version: "0.1.0", status: "published" },
    { selector: "root", name: "@misterzhouzhou/pi-extensions", version: "0.1.0", status: "pending" },
  ]);
  assert.equal(result.checked, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readFile(lockfile), lockfileBefore);
});

test("release-check validates every manifest before registry commands", async () => {
  const root = await fixture();
  const manifestPath = path.join(root, "packages/notify/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "0.1";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let called = false;
  await assert.rejects(
    () => releaseCheck([], {
      root,
      registryVersion: async () => { called = true; return false; },
    }),
    /invalid stable version/u,
  );
  assert.equal(called, false);
});
