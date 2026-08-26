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

test("release-check reports manifest versions independently without changing the lockfile", async () => {
  const root = await fixture();
  const rootManifestPath = path.join(root, "package.json");
  const notifyManifestPath = path.join(root, "packages/notify/package.json");
  const permissionsManifestPath = path.join(root, "packages/permissions/package.json");
  const subagentManifestPath = path.join(root, "packages/subagent/package.json");
  const statusLineManifestPath = path.join(root, "packages/status-line/package.json");
  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const notifyManifest = JSON.parse(await readFile(notifyManifestPath, "utf8"));
  const permissionsManifest = JSON.parse(await readFile(permissionsManifestPath, "utf8"));
  const subagentManifest = JSON.parse(await readFile(subagentManifestPath, "utf8"));
  const statusLineManifest = JSON.parse(await readFile(statusLineManifestPath, "utf8"));
  rootManifest.version = "2.3.4";
  notifyManifest.version = "7.8.9";
  permissionsManifest.version = "6.7.8";
  subagentManifest.version = "3.4.5";
  statusLineManifest.version = "5.6.7";
  await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  await writeFile(notifyManifestPath, `${JSON.stringify(notifyManifest, null, 2)}\n`);
  await writeFile(permissionsManifestPath, `${JSON.stringify(permissionsManifest, null, 2)}\n`);
  await writeFile(subagentManifestPath, `${JSON.stringify(subagentManifest, null, 2)}\n`);
  await writeFile(statusLineManifestPath, `${JSON.stringify(statusLineManifest, null, 2)}\n`);
  const lockfile = path.join(root, "package-lock.json");
  const lockfileBefore = await readFile(lockfile);
  const calls = [];
  const result = await releaseCheck([], {
    root,
    registryVersion: async (name) => name.endsWith("pi-notify"),
    log: (...args) => calls.push(args),
  });

  assert.deepEqual(result.packages, [
    { selector: "notify", name: "@misterzhou/pi-notify", version: "7.8.9", status: "published" },
    { selector: "permissions", name: "@misterzhou/pi-permissions", version: "6.7.8", status: "pending" },
    { selector: "status-line", name: "@misterzhou/pi-status-line", version: "5.6.7", status: "pending" },
    { selector: "subagent", name: "@misterzhou/pi-subagent", version: "3.4.5", status: "pending" },
    { selector: "root", name: "@misterzhou/pi-extensions", version: "2.3.4", status: "pending" },
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
