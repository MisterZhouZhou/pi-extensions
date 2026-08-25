import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  ROOT,
  compareStableVersions,
  pack,
  registryVersion,
  releaseUnits,
  run,
  stableVersion,
  withTempDirectory,
} from "./release-common.mjs";

const USAGE = "usage: npm run release-github -- <package-selector|all>";

function interactiveTerminal(input = process.stdin, output = process.stdout) {
  return input.isTTY === true && output.isTTY === true;
}

export function resolveGithubScope(argv = []) {
  if (argv.length !== 1 || (argv[0] !== "all" && !/^[a-z0-9-]+$/u.test(argv[0]))) throw new Error(USAGE);
  return argv[0];
}

export function releaseCommitPaths(scope, units = {}) {
  if (scope !== "all" && units[scope]) return [units[scope].workspace ? `packages/${scope}/package.json` : "package.json", "package-lock.json"];
  if (scope === "root") return ["package.json", "package-lock.json"];
  if (scope === "all") return [...Object.values(units).map((unit) => unit.workspace ? `packages/${unit.selector}/package.json` : "package.json"), "package-lock.json"];
  throw new Error(USAGE);
}

function tagFor(unit, version) {
  return `${unit.tagPrefix}@${version}`;
}

function commitMessage(scope, units) {
  if (scope === "all") {
    return `chore(release): publish ${Object.entries(units).map(([selector, version]) => `${selector} ${version}`).join(", ")}`;
  }
  return `chore(release): publish ${scope} ${units[scope]}`;
}

async function restoreSnapshots(snapshots) {
  for (const [file, contents] of snapshots) await writeFile(file, contents);
}

async function git(runner, args, root, env) {
  return runner("git", args, { cwd: root, env });
}

async function refExists(runner, args, missingCode, root, env) {
  try {
    await git(runner, args, root, env);
    return true;
  } catch (error) {
    if (error?.code === missingCode) return false;
    throw error;
  }
}

async function ancestor(runner, left, right, root, env) {
  try {
    await git(runner, ["merge-base", "--is-ancestor", left, right], root, env);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function ensureGithubBase(runner, root, env) {
  const branch = await git(runner, ["branch", "--show-current"], root, env);
  if (branch.trim() !== "main") throw new Error("release-github requires the main branch");
  const dirty = await git(runner, ["status", "--porcelain", "--untracked-files=all"], root, env);
  if (dirty) throw new Error(`working tree must be clean before release-github:\n${dirty}`);
  await git(runner, ["remote", "get-url", "origin"], root, env);
  await git(runner, ["fetch", "origin", "main"], root, env);

  const head = (await git(runner, ["rev-parse", "HEAD"], root, env)).trim();
  const remote = (await git(runner, ["rev-parse", "origin/main"], root, env)).trim();
  if (head === remote) return;
  const headBehind = await ancestor(runner, "HEAD", "origin/main", root, env);
  const remoteBehind = await ancestor(runner, "origin/main", "HEAD", root, env);
  if (headBehind && !remoteBehind) {
    await git(runner, ["pull", "--ff-only", "origin", "main"], root, env);
    const branchAfterPull = await git(runner, ["branch", "--show-current"], root, env);
    if (branchAfterPull.trim() !== "main") throw new Error("branch changed while synchronizing release-github");
    const dirtyAfterPull = await git(runner, ["status", "--porcelain", "--untracked-files=all"], root, env);
    if (dirtyAfterPull) throw new Error(`working tree changed while synchronizing release-github:\n${dirtyAfterPull}`);
    return;
  }
  if (remoteBehind) throw new Error("local main is ahead of origin/main; resolve it before release");
  throw new Error("local main and origin/main have diverged");
}

async function versionInput(scope, units, ask) {
  const selectors = scope === "all" ? Object.keys(units).filter((selector) => selector !== "root").concat("root") : [scope];
  const result = {};
  for (const selector of selectors) {
    const unit = units[selector];
    const version = (await ask(`New ${selector} version (current ${unit.manifest.version}): `))?.trim();
    if (!stableVersion(version)) throw new Error(`new version must be a stable X.Y.Z version: ${version}`);
    if (!stableVersion(unit.manifest.version)) {
      throw new Error(`${unit.manifest.name} has invalid stable version: ${unit.manifest.version}`);
    }
    if (compareStableVersions(version, unit.manifest.version) !== 1) {
      throw new Error(`${selector} version must be greater than current version ${unit.manifest.version}`);
    }
    result[selector] = version;
  }
  return result;
}

export async function githubRelease(argv = [], options = {}) {
  const scope = resolveGithubScope(argv);
  const interactive = options.interactive ?? interactiveTerminal(options.input, options.output);
  if (!interactive) throw new Error("release-github requires an interactive terminal");
  const root = options.root ?? ROOT;
  const env = options.env ?? process.env;
  const runner = options.run ?? run;
  await ensureGithubBase(runner, root, env);

  const discovered = options.releaseUnits ? await options.releaseUnits(root) : await releaseUnits(root);
  const units = Object.fromEntries(discovered.map((unit) => [unit.selector, unit]));
  if (scope !== "all" && !units[scope]) throw new Error(`release unit does not exist: ${scope}`);
  const ask = options.ask;
  if (typeof ask !== "function") throw new Error("interactive release input is unavailable");
  const versions = await versionInput(scope, units, ask);
  const selected = (scope === "all" ? Object.keys(units).filter((selector) => selector !== "root").concat("root") : [scope]).map((selector) => ({
    selector,
    unit: units[selector],
    version: versions[selector],
  }));
  const lockfile = path.join(root, "package-lock.json");
  const snapshots = new Map([[lockfile, await readFile(lockfile)]]);
  for (const item of selected) snapshots.set(item.unit.manifestPath, await readFile(item.unit.manifestPath));
  const tags = selected.map(({ unit, version }) => tagFor(unit, version));
  const commitPaths = releaseCommitPaths(scope, units);
  let committed = false;
  try {
    for (const item of selected) {
      const manifest = JSON.parse(snapshots.get(item.unit.manifestPath).toString("utf8"));
      manifest.version = item.version;
      await writeFile(item.unit.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await runner("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, env });
    await runner("npm", ["run", "check"], { cwd: root, env });

    const artifacts = [];
    const lookup = options.registryVersion ?? registryVersion;
    await withTempDirectory("pi-github-release-", async (directory) => {
      for (const item of selected) {
        const prepared = { ...item.unit, manifest: { ...item.unit.manifest, version: item.version } };
        const artifact = await (options.pack ?? pack)(prepared, directory, runner);
        if (await lookup(item.unit.manifest.name, item.version)) {
          throw new Error(`${item.unit.manifest.name}@${item.version} is already published`);
        }
        artifacts.push({ selector: item.selector, artifact });
      }
    });
    if (typeof options.log === "function") options.log(JSON.stringify({ scope, versions, artifacts }, null, 2));
    if ((await ask("Create release commit, tags, and push now? [y/N] ")).trim().toLowerCase() !== "y") {
      await restoreSnapshots(snapshots);
      return { action: "cancelled", scope, versions, tags };
    }

    for (const tag of tags) {
      if (await refExists(runner, ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], 1, root, env)) throw new Error(`tag already exists locally: ${tag}`);
      // `git ls-remote --exit-code` uses status 2 when no matching remote ref exists.
      if (await refExists(runner, ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`], 2, root, env)) throw new Error(`tag already exists remotely: ${tag}`);
    }
    await git(runner, ["add", "--", ...commitPaths], root, env);
    const message = commitMessage(scope, versions);
    const beforeHead = (await git(runner, ["rev-parse", "HEAD"], root, env)).trim();
    try {
      await git(runner, ["commit", "-m", message], root, env);
    } catch (error) {
      const afterHead = (await git(runner, ["rev-parse", "HEAD"], root, env)).trim();
      if (afterHead !== beforeHead) committed = true;
      else {
        await restoreSnapshots(snapshots);
        await git(runner, ["add", "--", ...commitPaths], root, env);
      }
      throw error;
    }
    committed = true;
    for (const tag of tags) await git(runner, ["tag", tag], root, env);
    const pushArgs = ["push", "--atomic", "origin", "main", ...tags];
    try {
      await git(runner, pushArgs, root, env);
    } catch (error) {
      throw new Error(`git ${pushArgs.join(" ")} failed; commit and tags were kept; retry the command`, { cause: error });
    }
    return { action: "pushed", scope, versions, tags, committed };
  } catch (error) {
    if (!committed) await restoreSnapshots(snapshots);
    throw error;
  }
}

async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(JSON.stringify(await githubRelease(process.argv.slice(2), {
      ask: (question) => readline.question(question),
    }), null, 2));
  } finally {
    readline.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
