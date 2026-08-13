import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_RESOURCES = new Set(["extensions", "skills", "prompts", "themes"]);
const CORE_PACKAGES = new Set([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
]);

async function readJson(file, root, errors) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const relative = path.relative(root, file) || "package.json";
    errors.push(`${relative}: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`);
    return undefined;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function filesCover(files, resource) {
  const normalizedResource = resource.replaceAll("\\", "/").replace(/^\.\//u, "");
  return files.some((entry) => {
    const normalizedEntry = entry.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
    return normalizedResource === normalizedEntry || normalizedResource.startsWith(`${normalizedEntry}/`);
  });
}

export async function discoverPackageDirectories(root) {
  const errors = [];
  const manifest = await readJson(path.join(root, "package.json"), root, errors);
  if (!manifest || !Array.isArray(manifest.workspaces) || !manifest.workspaces.includes("packages/*")) {
    return [];
  }

  const packagesRoot = path.join(root, "packages");
  let entries;
  try {
    entries = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name))
    .sort();
}

async function validatePackage(root, packageDirectory, errors) {
  const relativeDirectory = path.relative(root, packageDirectory).replaceAll(path.sep, "/");
  const label = `${relativeDirectory}/package.json`;
  const manifest = await readJson(path.join(packageDirectory, "package.json"), root, errors);
  if (!manifest) return;

  if (typeof manifest.name !== "string" || !/^@misterzhou\/pi-[a-z0-9][a-z0-9-]*$/u.test(manifest.name)) {
    errors.push(`${label}: name must match @misterzhou/pi-*`);
  }
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) {
    errors.push(`${label}: keywords must include keyword pi-package`);
  }
  if (manifest.repository?.directory !== relativeDirectory) {
    errors.push(`${label}: repository.directory must be ${relativeDirectory}`);
  }

  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((entry) => typeof entry === "string")
    : [];
  if (!filesCover(files, "README.md")) {
    errors.push(`${label}: files must include README.md`);
  }
  if (!(await isFile(path.join(packageDirectory, "README.md")))) {
    errors.push(`${label}: README.md does not exist`);
  }

  const pi = manifest.pi;
  const resources = [];
  if (pi && typeof pi === "object" && !Array.isArray(pi)) {
    for (const [key, value] of Object.entries(pi)) {
      if (!SUPPORTED_RESOURCES.has(key)) continue;
      if (!Array.isArray(value)) continue;
      for (const resource of value) {
        if (typeof resource === "string" && resource.length > 0) resources.push(resource);
      }
    }
  }
  if (resources.length === 0) {
    errors.push(`${label}: pi must declare at least one Pi resource`);
  }

  for (const resource of resources) {
    const resolved = path.resolve(packageDirectory, resource);
    if (!isInside(packageDirectory, resolved)) {
      errors.push(`${label}: Pi resource escapes package: ${resource}`);
      continue;
    }
    if (!(await exists(resolved))) {
      errors.push(`${label}: Pi resource does not exist: ${resource}`);
    }
    if (!filesCover(files, resource)) {
      errors.push(`${label}: files must include Pi resource: ${resource}`);
    }
  }

  const dependencies = manifest.dependencies ?? {};
  const peers = manifest.peerDependencies ?? {};
  for (const packageName of CORE_PACKAGES) {
    if (Object.hasOwn(dependencies, packageName)) {
      errors.push(`${label}: Pi core package ${packageName} must not be in dependencies`);
    }
    if (Object.hasOwn(peers, packageName) && peers[packageName] !== "*") {
      errors.push(`${label}: peer dependency ${packageName} must use *`);
    }
  }

  const importedCorePackages = new Set();
  for (const resource of resources) {
    const resolved = path.resolve(packageDirectory, resource);
    if (!isInside(packageDirectory, resolved) || !(await isFile(resolved))) continue;
    const source = await readFile(resolved, "utf8");
    for (const packageName of CORE_PACKAGES) {
      if (source.includes(`"${packageName}"`) || source.includes(`'${packageName}'`)) {
        importedCorePackages.add(packageName);
      }
    }
  }
  for (const packageName of importedCorePackages) {
    if (!Object.hasOwn(peers, packageName)) {
      errors.push(`${label}: imported Pi core package ${packageName} must be declared in peerDependencies`);
    }
  }
}

async function validateUmbrellaPackage(root, manifest, errors) {
  const label = "package.json";
  if (manifest.name !== "@misterzhou/pi-extensions") {
    errors.push(`${label}: root name must be @misterzhou/pi-extensions`);
  }
  if (manifest.private === true) errors.push(`${label}: umbrella package must be public`);
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) {
    errors.push(`${label}: keywords must include keyword pi-package`);
  }

  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((entry) => typeof entry === "string")
    : [];
  for (const required of ["README.md", "LICENSE"]) {
    if (!filesCover(files, required)) errors.push(`${label}: files must include ${required}`);
    if (!(await isFile(path.join(root, required)))) errors.push(`${label}: ${required} does not exist`);
  }

  const resources = [];
  if (manifest.pi && typeof manifest.pi === "object" && !Array.isArray(manifest.pi)) {
    for (const [key, values] of Object.entries(manifest.pi)) {
      if (!SUPPORTED_RESOURCES.has(key) || !Array.isArray(values)) continue;
      for (const value of values) if (typeof value === "string" && value.length > 0) resources.push(value);
    }
  }
  if (resources.length === 0) errors.push(`${label}: pi must declare at least one Pi resource`);
  for (const resource of resources) {
    const resolved = path.resolve(root, resource);
    if (!isInside(root, resolved)) {
      errors.push(`${label}: Pi resource escapes package: ${resource}`);
      continue;
    }
    if (!(await exists(resolved))) errors.push(`${label}: Pi resource does not exist: ${resource}`);
    if (!filesCover(files, resource)) errors.push(`${label}: files must include Pi resource: ${resource}`);
  }

  const dependencies = manifest.dependencies ?? {};
  const peers = manifest.peerDependencies ?? {};
  for (const packageName of CORE_PACKAGES) {
    if (Object.hasOwn(dependencies, packageName)) {
      errors.push(`${label}: Pi core package ${packageName} must not be in dependencies`);
    }
    if (Object.hasOwn(peers, packageName) && peers[packageName] !== "*") {
      errors.push(`${label}: peer dependency ${packageName} must use *`);
    }
  }
}

export async function validateRepository(root) {
  const errors = [];
  const rootManifest = await readJson(path.join(root, "package.json"), root, errors);
  if (!rootManifest) return errors.sort();

  await validateUmbrellaPackage(root, rootManifest, errors);
  if (!Array.isArray(rootManifest.workspaces) || !rootManifest.workspaces.includes("packages/*")) {
    errors.push("package.json: workspaces must include packages/*");
  }

  const packageDirectories = await discoverPackageDirectories(root);
  for (const packageDirectory of packageDirectories) {
    await validatePackage(root, packageDirectory, errors);
  }
  return errors.sort();
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validateRepository(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    const count = (await discoverPackageDirectories(root)).length;
    console.log(`Validated ${count} standalone Pi package(s) plus umbrella package.`);
  }
}
