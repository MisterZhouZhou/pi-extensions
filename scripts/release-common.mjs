import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRY = "https://registry.npmjs.org";
const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const TAG_SELECTORS = new Map([
  ["pi-extensions", "root"],
  ["pi-notify", "notify"],
]);

export async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function stableVersion(value) {
  return typeof value === "string" && STABLE_VERSION_RE.test(value);
}

export function compareStableVersions(left, right) {
  if (!stableVersion(left) || !stableVersion(right)) {
    throw new Error("version comparison requires stable versions");
  }
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function parseReleaseTag(tag) {
  if (typeof tag !== "string") throw new Error("unsupported release tag");
  const separator = tag.lastIndexOf("@");
  const prefix = tag.slice(0, separator);
  const version = tag.slice(separator + 1);
  const selector = TAG_SELECTORS.get(prefix);
  if (!selector) throw new Error(`unsupported release tag: ${tag}`);
  if (!stableVersion(version)) throw new Error(`release tag must use a stable version: ${tag}`);
  return { selector, version };
}

export async function releaseUnits(root = ROOT) {
  const rootManifest = await readJson(path.join(root, "package.json"));
  const packagesRoot = path.join(root, "packages");
  const directories = await readdir(packagesRoot, { withFileTypes: true });
  const entries = [];
  for (const directory of directories.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const packageRoot = path.join(packagesRoot, directory.name);
    const manifest = await readJson(path.join(packageRoot, "package.json"));
    entries.push({
      selector: directory.name,
      tagPrefix: manifest.name.split("/").at(-1),
      root: packageRoot,
      manifestPath: path.join(packageRoot, "package.json"),
      manifest,
      workspace: true,
    });
  }
  entries.push({
    selector: "root",
    tagPrefix: rootManifest.name.split("/").at(-1),
    root,
    manifestPath: path.join(root, "package.json"),
    manifest: rootManifest,
    workspace: false,
  });
  return entries;
}

export async function releaseUnit(selector, root = ROOT) {
  if (selector !== "root" && selector !== "notify") {
    throw new Error("selector must be root or notify");
  }
  const unit = (await releaseUnits(root)).find((entry) => entry.selector === selector);
  if (!unit) throw new Error(`release unit does not exist: ${selector}`);
  return unit;
}

export async function pack(entry, destination, runner = run) {
  const args = ["pack", "--json", "--ignore-scripts", "--pack-destination", destination];
  if (entry.workspace) args.push("--workspace", entry.manifest.name);
  const repositoryRoot = entry.workspace ? path.resolve(entry.root, "../..") : entry.root;
  const output = JSON.parse(await runner("npm", args, { cwd: repositoryRoot }));
  return { ...output[0], file: path.join(destination, output[0].filename) };
}

export async function withTempDirectory(prefix, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function registryVersion(name, version) {
  try {
    const output = await run("npm", ["view", `${name}@${version}`, "version", "--json", `--registry=${REGISTRY}`]);
    return JSON.parse(output) === version;
  } catch (error) {
    if (error?.stderr?.includes("E404")) return false;
    throw error;
  }
}

export async function npmWhoami(options = {}) {
  const runner = options.runner ?? run;
  return runner("npm", ["whoami", `--registry=${REGISTRY}`], {
    cwd: options.root ?? ROOT,
    env: options.env ?? process.env,
  });
}

export async function publishTarball(file, options = {}) {
  const runner = options.runner ?? run;
  await runner(
    "npm",
    ["publish", file, "--ignore-scripts", "--access", "public", "--tag", "latest", `--registry=${REGISTRY}`],
    { cwd: options.root ?? ROOT, env: options.env ?? process.env },
  );
}
