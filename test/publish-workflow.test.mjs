import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("publish workflow supports package tags and manual single-package publishing", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/publish.yml"), "utf8");
  assert.match(workflow, /push:\s*[\s\S]*tags:/u);
  assert.match(workflow, /pi-extensions@\*/u);
  assert.match(workflow, /pi-notify@\*/u);
  assert.match(workflow, /pi-yolo@\*/u);
  assert.match(workflow, /pi-subagent@\*/u);
  assert.match(workflow, /workflow_dispatch:[\s\S]*type: choice/u);
  assert.match(workflow, /options:[\s\S]*- root[\s\S]*- notify[\s\S]*- yolo[\s\S]*- subagent/u);
  assert.match(workflow, /Resolve release selector/u);
  assert.match(workflow, /PI_RELEASE_SELECTOR: \$\{\{ steps\.release\.outputs\.selector \}\}/u);
  assert.match(workflow, /publish-release -- "\$PI_RELEASE_SELECTOR" --github-actions/u);
  assert.match(workflow, /npm install --global npm@11\.12\.1/u);
  assert.doesNotMatch(workflow, /registry-url/u);
});

test("publish workflow keeps OIDC boundary and contains no publishing token", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/publish.yml"), "utf8");
  assert.match(workflow, /environment: npm-release/u);
  assert.match(workflow, /id-token: write/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.doesNotMatch(workflow, /release_tag|confirmation|GH_TOKEN|github-release/u);
});
