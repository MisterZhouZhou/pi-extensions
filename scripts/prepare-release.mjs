import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, VERSION_RE, packageEntries, registryVersion, run } from "./release-common.mjs";

function usage() {
  return "Usage: npm run prepare-release -- vX.Y.Z [--write]";
}

export async function prepareRelease(argv, options = {}) {
  const versionArgument = argv.find((argument) => !argument.startsWith("--"));
  const match = VERSION_RE.exec(versionArgument ?? "");
  if (!match) throw new Error(usage());
  const version = match[1];
  const tag = `v${version}`;
  const write = argv.includes("--write");
  const root = options.root ?? ROOT;
  const entries = await packageEntries(root);
  for (const entry of entries) {
    if (await (options.registryVersion ?? registryVersion)(entry.manifest.name, version)) {
      throw new Error(`${entry.manifest.name}@${version} already exists on npm`);
    }
  }

  const packages = entries.map((entry) => ({ name: entry.manifest.name, from: entry.manifest.version, to: version }));
  if (!write) return { tag, write: false, packages };

  const originals = new Map();
  const docs = [];
  try {
    for (const entry of entries) {
      const manifestPath = path.join(entry.root, "package.json");
      originals.set(manifestPath, await readFile(manifestPath, "utf8"));
      const manifest = { ...entry.manifest, version };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    const evidence = packages.map((item) => `- \`${item.name}@${item.to}\``).join("\n");
    const files = {
      [`docs/release-notes-${tag}.md`]: `# ${tag} Release Notes\n\n${evidence}\n`,
      [`docs/github-release-${tag}.md`]: `# ${tag}\n\n## Packages\n\n${evidence}\n`,
      [`docs/announcement-${tag}.md`]: `# ${tag} Announcement\n\nPublished packages:\n\n${evidence}\n`,
      [`docs/publish-checklist-${tag}.md`]: `# ${tag} Publish Checklist\n\n- [ ] npm run check\n- [ ] Review both npm pack outputs\n- [ ] Commit, tag, push, and create the matching GitHub Release\n- [ ] Dispatch publish.yml from main and approve npm-release\n\n${evidence}\n`,
    };
    await mkdir(path.join(root, "docs"), { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      originals.set(file, null);
      await writeFile(file, content);
      docs.push(relative);
    }
    await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root });
    return { tag, write: true, packages, docs };
  } catch (error) {
    for (const [file, content] of originals) {
      if (content !== null) await writeFile(file, content);
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await prepareRelease(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
