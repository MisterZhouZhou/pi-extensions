import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRepository } from "../scripts/validate-packages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture({ root = {}, packageJson = {}, files = {}, omit = [] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-package-policy-"));
  const rootManifest = {
    name: "@misterzhou/pi-extensions",
    version: "0.1.0",
    keywords: ["pi-package"],
    files: ["packages/demo", "README.md", "LICENSE"],
    workspaces: ["packages/*"],
    pi: { extensions: ["./packages/demo/index.ts"] },
    peerDependencies: {
      "@earendil-works/pi-coding-agent": "*",
    },
    ...root,
  };
  const manifest = {
    name: "@misterzhou/pi-demo",
    keywords: ["pi-package"],
    repository: {
      type: "git",
      url: "git+https://github.com/MisterZhouZhou/pi-extensions.git",
      directory: "packages/demo",
    },
    files: ["index.ts", "README.md"],
    pi: { extensions: ["index.ts"] },
    peerDependencies: {
      "@earendil-works/pi-coding-agent": "*",
    },
    ...packageJson,
  };

  await mkdir(path.join(directory, "packages/demo"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(rootManifest, null, 2)}\n`,
  );
  await writeFile(
    path.join(directory, "packages/demo/package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (!omit.includes("index.ts")) {
    await writeFile(
      path.join(directory, "packages/demo/index.ts"),
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n',
    );
  }
  if (!omit.includes("README.md")) {
    await writeFile(path.join(directory, "packages/demo/README.md"), "# Demo\n");
  }
  await writeFile(path.join(directory, "README.md"), "# Umbrella\n");
  await writeFile(path.join(directory, "LICENSE"), "MIT\n");

  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

async function errorsFor(options) {
  return validateRepository(await fixture(options));
}

function hasError(errors, fragment) {
  assert.equal(
    errors.some((error) => error.includes(fragment)),
    true,
    `Expected an error containing ${JSON.stringify(fragment)}:\n${errors.join("\n")}`,
  );
}

test("repository package manifests satisfy Pi package policy", async () => {
  assert.deepEqual(await validateRepository(repoRoot), []);
});

test("umbrella and standalone manifests enumerate all three extensions", async () => {
  const root = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.deepEqual(root.pi.extensions, [
    "./packages/notify/index.ts",
    "./packages/yolo/index.ts",
    "./packages/subagent/index.ts",
  ]);
  assert.ok(root.files.includes("packages/notify"));
  assert.ok(root.files.includes("packages/yolo"));
  assert.ok(root.files.includes("packages/subagent"));
  for (const [selector, packageName] of [["yolo", "@misterzhou/pi-yolo"], ["subagent", "@misterzhou/pi-subagent"]]) {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "packages", selector, "package.json"), "utf8"));
    assert.equal(manifest.name, packageName);
    assert.deepEqual(manifest.pi.extensions, ["index.ts"]);
    assert.ok(manifest.files.includes("README.md"));
  }
});

test("requires a public umbrella root with packaged Pi resources", async () => {
  hasError(await errorsFor({ root: { private: true } }), "must be public");
  hasError(await errorsFor({ root: { name: "pi-extensions" } }), "root name must be");
  hasError(await errorsFor({ root: { pi: {} } }), "must declare at least one Pi resource");
  hasError(await errorsFor({ root: { files: ["README.md", "LICENSE"] } }), "files must include Pi resource");
});

test("enforces package naming, keywords, and repository directory", async () => {
  const errors = await errorsFor({
    packageJson: {
      name: "wrong-name",
      keywords: [],
      repository: { directory: "packages/wrong" },
    },
  });
  hasError(errors, "name must match @misterzhou/pi-*");
  hasError(errors, "keyword pi-package");
  hasError(errors, "repository.directory must be packages/demo");
});

test("requires declared Pi resources to exist inside their package", async () => {
  const missing = await errorsFor({
    packageJson: { pi: { extensions: ["missing.ts"] } },
  });
  hasError(missing, "Pi resource does not exist: missing.ts");

  const escaped = await errorsFor({
    packageJson: { pi: { extensions: ["../outside.ts"] } },
  });
  hasError(escaped, "Pi resource escapes package: ../outside.ts");
});

test("requires files to include runtime resources and README", async () => {
  const errors = await errorsFor({ packageJson: { files: ["LICENSE"] } });
  hasError(errors, "files must include README.md");
  hasError(errors, "files must include Pi resource: index.ts");
});

test("allows a files directory to cover resources below it", async () => {
  const errors = await errorsFor({
    packageJson: {
      files: ["src", "README.md"],
      pi: { extensions: ["src/index.ts"] },
    },
    files: { "packages/demo/src/index.ts": "export default () => {};\n" },
  });
  assert.deepEqual(errors, []);
});

test("requires Pi runtime imports to be wildcard peer dependencies", async () => {
  const dependencyErrors = await errorsFor({
    packageJson: {
      dependencies: { "@earendil-works/pi-coding-agent": "^0.84.1" },
      peerDependencies: {},
    },
  });
  hasError(dependencyErrors, "must not be in dependencies");
  hasError(dependencyErrors, "must be declared in peerDependencies");

  const rangeErrors = await errorsFor({
    packageJson: {
      peerDependencies: { "@earendil-works/pi-coding-agent": "^0.84.1" },
    },
  });
  hasError(rangeErrors, "peer dependency @earendil-works/pi-coding-agent must use *");
});

test("requires package README and at least one supported Pi resource", async () => {
  const noReadme = await errorsFor({ omit: ["README.md"] });
  hasError(noReadme, "README.md does not exist");

  const noResources = await errorsFor({ packageJson: { pi: {} } });
  hasError(noResources, "must declare at least one Pi resource");
});
