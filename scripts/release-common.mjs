import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const REGISTRY = "https://registry.npmjs.org";
export const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/u;

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

export async function packageEntries(root = ROOT) {
  const rootManifest = await readJson(path.join(root, "package.json"));
  const packagesRoot = path.join(root, "packages");
  const directories = await readdir(packagesRoot, { withFileTypes: true });
  const entries = [];
  for (const directory of directories.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const packageRoot = path.join(packagesRoot, directory.name);
    entries.push({ root: packageRoot, manifest: await readJson(path.join(packageRoot, "package.json")), workspace: true });
  }
  entries.push({ root, manifest: rootManifest, workspace: false });
  return entries;
}

export async function pack(entry, destination) {
  const args = ["pack", "--json", "--ignore-scripts", "--pack-destination", destination];
  if (entry.workspace) args.push("--workspace", entry.manifest.name);
  const output = JSON.parse(await run("npm", args, { cwd: entry.workspace ? ROOT : entry.root }));
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
