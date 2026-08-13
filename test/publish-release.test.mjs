import assert from "node:assert/strict";
import test from "node:test";

import { publishRelease, publishablePaths } from "../scripts/publish-release.mjs";

function unit(selector = "notify", version = "0.2.0") {
  return {
    selector,
    tagPrefix: selector === "root" ? "pi-extensions" : "pi-notify",
    root: selector === "root" ? "/repo" : "/repo/packages/notify",
    manifestPath: selector === "root" ? "/repo/package.json" : "/repo/packages/notify/package.json",
    manifest: {
      name: selector === "root" ? "@misterzhou/pi-extensions" : "@misterzhou/pi-notify",
      version,
      files: selector === "root" ? ["packages/notify", "README.md", "LICENSE"] : ["index.ts"],
    },
    workspace: selector !== "root",
  };
}

function fakes(overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      root: "/repo",
      env: {},
      releaseUnit: async (selector) => {
        if (selector !== "root" && selector !== "notify") throw new Error("selector must be root or notify");
        return unit(selector);
      },
      run: async (command, args) => {
        calls.push({ command, args });
        return "";
      },
      pack: async (releaseUnit, directory) => ({
        file: `${directory}/${releaseUnit.selector}.tgz`,
        integrity: `sha512-${releaseUnit.selector}`,
      }),
      registryVersion: async () => false,
      ...overrides,
    },
  };
}

test("publish-release requires the Actions-only invocation before commands", async () => {
  const state = fakes();
  await assert.rejects(() => publishRelease([], state.options), /internal GitHub Actions command/u);
  await assert.rejects(() => publishRelease(["missing"], state.options), /internal GitHub Actions command/u);
  await assert.rejects(() => publishRelease(["notify", "--dry-run"], state.options), /internal GitHub Actions command/u);
  assert.deepEqual(state.calls, []);
});

test("Actions publishing checks and publishes the selected artifact", async () => {
  const state = fakes({ env: {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "MisterZhouZhou/pi-extensions",
    GITHUB_WORKFLOW_REF: "MisterZhouZhou/pi-extensions/.github/workflows/publish.yml@refs/tags/pi-notify@0.2.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "pi-notify@0.2.0",
    PI_RELEASE_ENVIRONMENT: "npm-release",
    PI_RELEASE_SELECTOR: "notify",
  }});
  const result = await publishRelease(["notify", "--github-actions"], state.options);
  assert.equal(result.action, "published");
  assert.deepEqual(state.calls.map(({ command, args }) => [command, args[0]]), [
    ["npm", "run"],
    ["git", "status"],
    ["git", "merge-base"],
    ["npm", "publish"],
  ]);
  assert.match(state.calls.at(-1).args[1], /notify\.tgz$/u);
});

test("Actions publishing rejects tokens, dirty paths, and existing versions", async () => {
  const base = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "MisterZhouZhou/pi-extensions",
    GITHUB_WORKFLOW_REF: "MisterZhouZhou/pi-extensions/.github/workflows/publish.yml@refs/tags/pi-notify@0.2.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "pi-notify@0.2.0",
    PI_RELEASE_ENVIRONMENT: "npm-release",
    PI_RELEASE_SELECTOR: "notify",
  };
  const tokenState = fakes({ env: { ...base, NPM_TOKEN: "forbidden" } });
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], tokenState.options), /untrusted/u);
  assert.deepEqual(tokenState.calls, []);

  const dirtyState = fakes({
    env: base,
    run: async (command, args) => command === "git" && args[0] === "status" ? " M packages/notify/index.ts" : "",
  });
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], dirtyState.options), /uncommitted changes/u);

  const publishedState = fakes({ env: base, registryVersion: async () => true });
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], publishedState.options), /already published/u);
  assert.equal(publishedState.calls.some(({ args }) => args[0] === "whoami" || args[0] === "publish"), false);
});

test("validates stable manifest versions before commands", async () => {
  const state = fakes({ releaseUnit: async () => unit("notify", "0.2.0-beta.1") });
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], state.options), /invalid stable version/u);
  assert.deepEqual(state.calls, []);
});

test("trusted Actions supports matching package tags and main dispatch", async () => {
  const tagEnv = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "MisterZhouZhou/pi-extensions",
    GITHUB_WORKFLOW_REF: "MisterZhouZhou/pi-extensions/.github/workflows/publish.yml@refs/tags/pi-notify@0.2.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "pi-notify@0.2.0",
    PI_RELEASE_ENVIRONMENT: "npm-release",
    PI_RELEASE_SELECTOR: "notify",
  };
  const tagState = fakes({ env: tagEnv });
  assert.equal((await publishRelease(["notify", "--github-actions"], tagState.options)).action, "published");
  assert.equal(tagState.calls.some(({ command, args }) => command === "git" && args[0] === "merge-base"), true);
  assert.equal(tagState.calls.some(({ args }) => args[0] === "whoami"), false);

  const dispatchState = fakes({
    env: { ...tagEnv, GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main", GITHUB_REF: "refs/heads/main", PI_RELEASE_SELECTOR: "root" },
  });
  assert.equal((await publishRelease(["root", "--github-actions"], dispatchState.options)).action, "published");
});

test("Actions rejects mismatched tags, selectors, repositories, and traditional tokens", async () => {
  const base = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "MisterZhouZhou/pi-extensions",
    GITHUB_WORKFLOW_REF: "MisterZhouZhou/pi-extensions/.github/workflows/publish.yml@refs/tags/pi-notify@0.2.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "pi-notify@0.1.0",
    PI_RELEASE_ENVIRONMENT: "npm-release",
    PI_RELEASE_SELECTOR: "notify",
  };
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], fakes({ env: base }).options), /does not match/u);
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], fakes({ env: { ...base, PI_RELEASE_SELECTOR: "root" } }).options), /untrusted/u);
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], fakes({ env: { ...base, GITHUB_REPOSITORY: "attacker/fork" } }).options), /untrusted/u);
  await assert.rejects(() => publishRelease(["notify", "--github-actions"], fakes({ env: { ...base, NPM_TOKEN: "forbidden" } }).options), /untrusted/u);
});

test("publishable paths are scoped to the selected release unit", () => {
  assert.deepEqual(publishablePaths(unit("notify")), [
    "packages/notify",
    "package-lock.json",
    "scripts/release-common.mjs",
    "scripts/publish-release.mjs",
  ]);
  assert.deepEqual(publishablePaths(unit("root")), [
    "package.json",
    "package-lock.json",
    "README.md",
    "LICENSE",
    "packages/notify",
  ]);
});
