import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, registryVersion, releaseUnits, stableVersion } from "./release-common.mjs";

export async function releaseCheck(argv = [], options = {}) {
  if (argv.length > 0) throw new Error("release-check does not accept arguments; edit package.json versions first");

  const root = options.root ?? ROOT;
  const units = await releaseUnits(root);
  for (const unit of units) {
    if (!stableVersion(unit.manifest.version)) {
      throw new Error(`${unit.manifest.name} has invalid stable version: ${unit.manifest.version}`);
    }
  }

  const lookup = options.registryVersion ?? registryVersion;
  const packages = [];
  for (const unit of units) {
    const published = await lookup(unit.manifest.name, unit.manifest.version);
    packages.push({
      selector: unit.selector,
      name: unit.manifest.name,
      version: unit.manifest.version,
      status: published ? "published" : "pending",
    });
  }

  return { packages, checked: true };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await releaseCheck(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
