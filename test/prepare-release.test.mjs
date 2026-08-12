import assert from "node:assert/strict";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareRelease } from "../scripts/prepare-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("prepare-release rejects invalid versions", async () => {
  await assert.rejects(() => prepareRelease([], { registryVersion: async () => false }), /Usage/u);
  await assert.rejects(() => prepareRelease(["v1.2"], { registryVersion: async () => false }), /Usage/u);
});

test("prepare-release dry-run plans standalone packages before umbrella without writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-prepare-test-"));
  await cp(repoRoot, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.git`) });
  const before = await readFile(path.join(root, "package.json"), "utf8");
  const result = await prepareRelease(["v0.2.0"], { root, registryVersion: async () => false });
  assert.deepEqual(result.packages.map((item) => item.name), ["@misterzhouzhou/pi-notify", "@misterzhouzhou/pi-extensions"]);
  assert.equal(result.write, false);
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), before);
});

test("prepare-release refuses versions already present on npm", async () => {
  await assert.rejects(
    () => prepareRelease(["v0.2.0"], { registryVersion: async (name) => name.endsWith("pi-notify") }),
    /already exists on npm/u,
  );
});
