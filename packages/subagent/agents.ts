import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type AgentScope = "builtin" | "user" | "project" | "both";
export type AgentSource = "builtin" | "user" | "project";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir?: string;
}

export interface AgentDiscoveryOptions {
  builtinDir?: string;
  userDir?: string;
}

function parseFrontmatter(source: string): { attributes: Record<string, string>; body: string } | undefined {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u);
  if (!match) return undefined;
  const attributes: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) attributes[key] = value;
  }
  return { attributes, body: match[2].trim() };
}

export function parseAgentMarkdown(source: string, filePath: string, agentSource: AgentSource): AgentConfig | undefined {
  const parsed = parseFrontmatter(source);
  const name = parsed?.attributes.name?.trim();
  const description = parsed?.attributes.description?.trim();
  if (!parsed || !name || !description || !parsed.body) return undefined;
  const tools = parsed.attributes.tools?.split(",").map((tool) => tool.trim()).filter(Boolean);
  return { name, description, tools: tools?.length ? tools : undefined, systemPrompt: parsed.body, source: agentSource, filePath };
}

async function isDirectory(directory: string): Promise<boolean> {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

async function loadDirectory(directory: string, source: AgentSource): Promise<AgentConfig[]> {
  if (!await isDirectory(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const agents: AgentConfig[] = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = path.join(directory, entry.name);
    const agent = parseAgentMarkdown(await readFile(filePath, "utf8"), filePath, source);
    if (agent) agents.push(agent);
  }
  return agents;
}

export async function findNearestProjectAgentsDir(cwd: string): Promise<string | undefined> {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
    if (await isDirectory(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function discoverAgents(cwd: string, scope: AgentScope = "both", options: AgentDiscoveryOptions = {}): Promise<AgentDiscoveryResult> {
  const builtinDir = options.builtinDir ?? fileURLToPath(new URL("./agents/", import.meta.url));
  const userDir = options.userDir ?? path.join(getAgentDir(), "agents");
  const projectAgentsDir = await findNearestProjectAgentsDir(cwd);
  const byName = new Map<string, AgentConfig>();
  const add = (agents: AgentConfig[]) => agents.forEach((agent) => byName.set(agent.name, agent));
  if (scope === "builtin" || scope === "both") add(await loadDirectory(builtinDir, "builtin"));
  if (scope === "user" || scope === "both") add(await loadDirectory(userDir, "user"));
  if ((scope === "project" || scope === "both") && projectAgentsDir) add(await loadDirectory(projectAgentsDir, "project"));
  return { agents: [...byName.values()].sort((left, right) => left.name.localeCompare(right.name)), projectAgentsDir };
}

export function isWritableAgent(agent: Pick<AgentConfig, "tools">): boolean {
  if (!agent.tools || agent.tools.length === 0) return true;
  return agent.tools.some((tool) => tool === "write" || tool === "edit");
}
