import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, REGISTRY, VERSION_RE, pack, packageEntries, registryVersion, run, withTempDirectory } from "./release-common.mjs";

const REPOSITORY = "MisterZhouZhou/pi-extensions";
const WORKFLOW = "publish.yml";
const ENVIRONMENT = "npm-release";

function trustedActionsEnvironment(env) {
  return env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REPOSITORY === REPOSITORY &&
    env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_WORKFLOW_REF?.includes(`/.github/workflows/${WORKFLOW}@`) &&
    env.PI_RELEASE_ENVIRONMENT === ENVIRONMENT &&
    !env.NPM_TOKEN && !env.NODE_AUTH_TOKEN;
}

export async function publishRelease(argv, options = {}) {
  const tag = argv.find((argument) => !argument.startsWith("--"));
  if (!tag || !VERSION_RE.test(tag) || !tag.startsWith("v")) throw new Error("release tag must match vX.Y.Z");
  const version = tag.slice(1);
  const dryRun = argv.includes("--dry-run");
  const githubActions = argv.includes("--github-actions");
  const env = options.env ?? process.env;
  if (!dryRun && !githubActions) throw new Error("local publishing is forbidden; use --dry-run");
  if (githubActions && !trustedActionsEnvironment(env)) throw new Error("untrusted GitHub Actions publishing context");

  const root = options.root ?? ROOT;
  const runner = options.run ?? run;
  await runner("git", ["rev-parse", "--verify", `refs/tags/${tag}`], { cwd: root });
  await runner("git", ["merge-base", "--is-ancestor", tag, "origin/main"], { cwd: root });
  const tagCommit = await runner("git", ["rev-list", "-n", "1", tag], { cwd: root });
  if (githubActions && (env.GITHUB_SHA !== tagCommit || await runner("git", ["rev-parse", "HEAD"], { cwd: root }) !== tagCommit)) {
    throw new Error("GitHub Actions checkout must be the release tag commit");
  }

  const releaseDoc = path.join(root, `docs/github-release-${tag}.md`);
  await access(releaseDoc);
  const expectedBody = (await readFile(releaseDoc, "utf8")).trim();
  const actualBody = await runner("gh", ["release", "view", tag, "--repo", REPOSITORY, "--json", "body", "--jq", ".body"], { cwd: root });
  if (actualBody.trim() !== expectedBody) throw new Error("GitHub Release body does not match release document");

  const entries = await packageEntries(root);
  for (const entry of entries) {
    if (!expectedBody.includes(`\`${entry.manifest.name}@${version}\``)) {
      throw new Error(`release document is missing ${entry.manifest.name}@${version}`);
    }
    if (entry.manifest.version !== version) throw new Error(`${entry.manifest.name} version does not match ${tag}`);
  }

  return withTempDirectory("pi-release-", async (directory) => {
    const actions = [];
    for (const entry of entries) {
      const artifact = await pack(entry, directory);
      const published = await (options.registryVersion ?? registryVersion)(entry.manifest.name, version);
      if (published) {
        actions.push({ package: entry.manifest.name, version, action: "skip", integrity: artifact.integrity });
        continue;
      }
      actions.push({ package: entry.manifest.name, version, action: dryRun ? "would-publish" : "publish", integrity: artifact.integrity });
      if (!dryRun) {
        await runner("npm", ["publish", artifact.file, "--ignore-scripts", "--access", "public", "--tag", "latest", `--registry=${REGISTRY}`], { cwd: root, env });
      }
    }
    return { tag, mode: dryRun ? "dry-run" : "github-actions", actions };
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
