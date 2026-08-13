import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROOT,
  pack,
  parseReleaseTag,
  publishTarball,
  registryVersion,
  releaseUnit,
  run,
  stableVersion,
  withTempDirectory,
} from "./release-common.mjs";

const REPOSITORY = "MisterZhouZhou/pi-extensions";
const WORKFLOW = "publish.yml";
const ENVIRONMENT = "npm-release";

const USAGE = "publish-release is an internal GitHub Actions command; usage: npm run publish-release -- <root|notify> --github-actions";

function modeFor(argv) {
  if (argv.length !== 2 || (argv[0] !== "root" && argv[0] !== "notify") || argv[1] !== "--github-actions") {
    throw new Error(USAGE);
  }
  return "github-actions";
}

function validateActionsEnvironment(env, unit) {
  const trusted = env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REPOSITORY === REPOSITORY &&
    env.GITHUB_WORKFLOW_REF?.includes(`/.github/workflows/${WORKFLOW}@`) &&
    env.PI_RELEASE_ENVIRONMENT === ENVIRONMENT &&
    env.PI_RELEASE_SELECTOR === unit.selector &&
    !env.NPM_TOKEN && !env.NODE_AUTH_TOKEN;
  if (!trusted) throw new Error("untrusted GitHub Actions publishing context");

  if (env.GITHUB_REF_TYPE === "tag") {
    const tag = parseReleaseTag(env.GITHUB_REF_NAME);
    if (tag.selector !== unit.selector || tag.version !== unit.manifest.version) {
      throw new Error("release tag does not match the selected package version");
    }
    return "tag";
  }
  if (env.GITHUB_REF === "refs/heads/main") return "manual";
  throw new Error("GitHub Actions publishing must use a release tag or main workflow dispatch");
}

export function publishablePaths(unit) {
  if (unit.selector === "root") {
    return [...new Set(["package.json", "package-lock.json", "README.md", "LICENSE", ...(unit.manifest.files ?? [])])];
  }
  return ["packages/notify", "package-lock.json", "scripts/release-common.mjs", "scripts/publish-release.mjs"];
}

export async function publishRelease(argv, options = {}) {
  const mode = modeFor(argv);
  const selector = argv[0];
  const root = options.root ?? ROOT;
  const getUnit = options.releaseUnit ?? releaseUnit;
  const unit = await getUnit(selector, root);
  if (!stableVersion(unit.manifest.version)) {
    throw new Error(`${unit.manifest.name} has invalid stable version: ${unit.manifest.version}`);
  }

  const env = options.env ?? process.env;
  let actionsEvent;
  if (mode === "github-actions") actionsEvent = validateActionsEnvironment(env, unit);

  const runner = options.run ?? run;
  await runner("npm", ["run", "check"], { cwd: root, env });
  const dirty = await runner(
    "git",
    ["status", "--porcelain", "--untracked-files=no", "--", ...publishablePaths(unit)],
    { cwd: root, env },
  );
  if (dirty) throw new Error(`publishable paths contain uncommitted changes:\n${dirty}`);
  if (actionsEvent === "tag") {
    await runner("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: root, env });
  }

  const packer = options.pack ?? pack;
  const lookup = options.registryVersion ?? registryVersion;
  return withTempDirectory("pi-release-", async (directory) => {
    const artifact = await packer(unit, directory, runner);
    const published = await lookup(unit.manifest.name, unit.manifest.version);
    if (published) throw new Error(`${unit.manifest.name}@${unit.manifest.version} is already published`);
    const publish = options.publishTarball ?? publishTarball;
    await publish(artifact.file, { root, env, runner });
    return {
      selector: unit.selector,
      package: unit.manifest.name,
      version: unit.manifest.version,
      mode,
      action: "published",
      integrity: artifact.integrity,
    };
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await publishRelease(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
