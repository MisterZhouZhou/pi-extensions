import assert from "node:assert/strict";
import test from "node:test";

import { publishRelease } from "../scripts/publish-release.mjs";

test("publish-release requires an exact v-prefixed stable version", async () => {
  await assert.rejects(() => publishRelease(["0.1.0", "--dry-run"]), /vX\.Y\.Z/u);
  await assert.rejects(() => publishRelease(["v0.1.0-beta.1", "--dry-run"]), /vX\.Y\.Z/u);
});

test("publish-release forbids local real publishing before running commands", async () => {
  let called = false;
  await assert.rejects(
    () => publishRelease(["v0.1.0"], { run: async () => { called = true; return ""; } }),
    /local publishing is forbidden/u,
  );
  assert.equal(called, false);
});

test("publish-release rejects untrusted GitHub Actions context before running commands", async () => {
  let called = false;
  await assert.rejects(
    () => publishRelease(["v0.1.0", "--github-actions"], {
      env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "attacker/fork" },
      run: async () => { called = true; return ""; },
    }),
    /untrusted GitHub Actions/u,
  );
  assert.equal(called, false);
});

test("publish-release rejects traditional npm tokens in Actions", async () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "MisterZhouZhou/pi-extensions",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: "MisterZhouZhou/pi-extensions/.github/workflows/publish.yml@refs/heads/main",
    PI_RELEASE_ENVIRONMENT: "npm-release",
    GITHUB_SHA: "abc",
    NPM_TOKEN: "forbidden",
  };
  await assert.rejects(() => publishRelease(["v0.1.0", "--github-actions"], { env }), /untrusted GitHub Actions/u);
});
