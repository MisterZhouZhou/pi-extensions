import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  REGISTRY,
  ROOT,
  compareStableVersions,
  npmWhoami,
  pack,
  publishTarball,
  registryVersion,
  releaseUnit,
  run,
  stableVersion,
  withTempDirectory,
} from "./release-common.mjs";

const PUBLISH_CHECK_ATTEMPTS = 5;
const PUBLISH_CHECK_DELAY_MS = 2_000;
const USAGE = "usage: npm run release-local [-- <root|notify> <X.Y.Z>]";

function interactiveTerminal(input = process.stdin, output = process.stdout) {
  return input.isTTY === true && output.isTTY === true;
}

function validateSelector(selector) {
  if (selector !== "root" && selector !== "notify") {
    throw new Error("selector must be root or notify");
  }
}

export async function resolveReleaseInput(argv = [], options = {}) {
  const interactive = options.interactive ?? interactiveTerminal(options.input, options.output);
  if (!interactive) throw new Error("local release requires an interactive terminal");
  if (argv.length !== 0 && argv.length !== 2) throw new Error(USAGE);

  let selector;
  let version;
  if (argv.length === 2) {
    [selector, version] = argv;
  } else {
    if (typeof options.ask !== "function") throw new Error("interactive release input is unavailable");
    selector = await options.ask("Release unit (root/notify): ");
    version = await options.ask("New version: ");
  }

  selector = selector?.trim();
  version = version?.trim();
  validateSelector(selector);
  if (!version) throw new Error(USAGE);
  return { selector, version };
}

export function releasePaths(unit) {
  const scripts = [
    "scripts/release-local.mjs",
    "scripts/release-common.mjs",
    "scripts/publish-release.mjs",
  ];
  if (unit.selector === "root") {
    return [...new Set([
      "package.json",
      "package-lock.json",
      "README.md",
      "LICENSE",
      ...(unit.manifest.files ?? []),
      ...scripts,
    ])];
  }
  return ["packages/notify", "package-lock.json", ...scripts];
}

function updatedUnit(unit, version) {
  return {
    ...unit,
    manifest: { ...unit.manifest, version },
  };
}

function releaseIdentity(unit, version, artifact, action) {
  return {
    action,
    selector: unit.selector,
    package: unit.manifest.name,
    version,
    integrity: artifact.integrity,
  };
}

function printSummary(log, unit, previousVersion, version, account, artifact) {
  const lines = [
    `Package:   ${unit.manifest.name}`,
    `Version:   ${previousVersion} -> ${version}`,
    `Registry:  ${REGISTRY}`,
    `Account:   ${account}`,
    `Tarball:   ${artifact.filename ?? path.basename(artifact.file)}`,
  ];
  if (artifact.size !== undefined) lines.push(`Size:      ${artifact.size}`);
  if (artifact.integrity !== undefined) lines.push(`Integrity: ${artifact.integrity}`);
  log(lines.join("\n"));
}

async function restoreSnapshots(snapshots) {
  const failures = [];
  for (const [file, contents] of snapshots) {
    try {
      await writeFile(file, contents);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "failed to restore release files");
}

async function confirmPublishedAfterError({ lookup, name, version, sleep }) {
  let lastLookupError;
  for (let attempt = 0; attempt < PUBLISH_CHECK_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(PUBLISH_CHECK_DELAY_MS);
    try {
      if (await lookup(name, version)) return true;
    } catch (error) {
      lastLookupError = error;
    }
  }
  return { published: false, lastLookupError };
}

export async function releaseLocal(argv = [], options = {}) {
  const root = options.root ?? ROOT;
  const env = options.env ?? process.env;
  const runner = options.run ?? run;
  const ask = options.ask;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const input = await resolveReleaseInput(argv, {
    interactive: options.interactive,
    input: options.input,
    output: options.output,
    ask,
  });

  const getUnit = options.releaseUnit ?? releaseUnit;
  const unit = await getUnit(input.selector, root);
  const previousVersion = unit.manifest.version;
  if (!stableVersion(previousVersion)) {
    throw new Error(`${unit.manifest.name} has invalid stable version: ${previousVersion}`);
  }
  if (!stableVersion(input.version)) {
    throw new Error(`new version must be a stable X.Y.Z version: ${input.version}`);
  }
  if (compareStableVersions(input.version, previousVersion) !== 1) {
    throw new Error(`new version must be greater than current version ${previousVersion}`);
  }
  if (env.NPM_TOKEN || env.NODE_AUTH_TOKEN) {
    throw new Error("local publishing must use npm login, not NPM_TOKEN or NODE_AUTH_TOKEN");
  }

  const dirty = await runner(
    "git",
    ["status", "--porcelain", "--untracked-files=no", "--", ...releasePaths(unit)],
    { cwd: root, env },
  );
  if (dirty) throw new Error(`release paths contain uncommitted changes:\n${dirty}`);

  const lockfilePath = path.join(root, "package-lock.json");
  const snapshots = new Map([
    [unit.manifestPath, await readFile(unit.manifestPath)],
    [lockfilePath, await readFile(lockfilePath)],
  ]);
  let publishStarted = false;
  let restored = false;
  const restore = async () => {
    if (restored) return;
    await restoreSnapshots(snapshots);
    restored = true;
  };

  try {
    const manifest = JSON.parse(snapshots.get(unit.manifestPath).toString("utf8"));
    manifest.version = input.version;
    await writeFile(unit.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await runner(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: root, env },
    );
    await runner("npm", ["run", "check"], { cwd: root, env });

    const preparedUnit = updatedUnit(unit, input.version);
    const packer = options.pack ?? pack;
    const lookup = options.registryVersion ?? registryVersion;
    const authenticate = options.npmWhoami ?? npmWhoami;
    const publishArtifact = options.publishTarball ?? publishTarball;
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

    return await withTempDirectory("pi-local-release-", async (directory) => {
      const artifact = await packer(preparedUnit, directory, runner);
      if (await lookup(unit.manifest.name, input.version)) {
        throw new Error(`${unit.manifest.name}@${input.version} is already published`);
      }
      const account = await authenticate({ root, env, runner });
      printSummary(log, unit, previousVersion, input.version, account, artifact);
      if (typeof ask !== "function") throw new Error("interactive release confirmation is unavailable");
      const answer = await ask("Publish now? [y/N] ");
      if (answer.trim().toLowerCase() !== "y") {
        await restore();
        return {
          action: "cancelled",
          selector: unit.selector,
          package: unit.manifest.name,
          version: input.version,
        };
      }

      publishStarted = true;
      try {
        await publishArtifact(artifact.file, { root, env, runner });
        return releaseIdentity(unit, input.version, artifact, "published");
      } catch (publishError) {
        const verification = await confirmPublishedAfterError({
          lookup,
          name: unit.manifest.name,
          version: input.version,
          sleep,
        });
        if (verification === true) {
          warn("npm publish returned an error, but the version is present in the registry.");
          return releaseIdentity(unit, input.version, artifact, "published-after-client-error");
        }
        const error = new Error(
          "publish status is unknown; version files were kept; check npm before retrying and do not retry blindly",
          { cause: publishError },
        );
        if (verification.lastLookupError) error.registryCause = verification.lastLookupError;
        throw error;
      }
    });
  } catch (error) {
    if (!publishStarted) {
      try {
        await restore();
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "release failed and release files could not be restored");
      }
    }
    throw error;
  }
}

async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await releaseLocal(process.argv.slice(2), {
      ask: (question) => readline.question(question),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    readline.close();
  }
}

export const localRelease = releaseLocal;

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
