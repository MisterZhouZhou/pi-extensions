import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

type Classification = "readonly" | "unknown" | "catastrophic";

const READONLY = new Set(["cat", "cut", "diff", "du", "file", "head", "less", "ls", "pwd", "rg", "sed", "sort", "stat", "tail", "wc", "which", "type"]);
const CATASTROPHIC = [
  /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*\s+)*-rf\s+(?:\/|~|\.\.?\/?(?:\s|$))/u,
  /(?:^|[;&|]\s*)mkfs(?:\.[\w-]+)?\b/u,
  /(?:^|[;&|]\s*)dd\b[^\n]*(?:of=\/dev\/|if=\/dev\/zero)/u,
  /(?:^|[;&|]\s*)shutdown\b|(?:^|[;&|]\s*)reboot\b/u,
];

export function classifyChildBash(command: string): Classification {
  const normalized = command.trim();
  if (CATASTROPHIC.some((pattern) => pattern.test(normalized))) return "catastrophic";
  const segments = normalized.split(/&&|\|\||[;|]/u).map((part) => part.trim()).filter(Boolean);
  const safe = segments.length > 0 && segments.every((segment) => {
    if (/[<>]/u.test(segment)) return false;
    const executable = segment.match(/^(?:env\s+)?(?:[A-Za-z_][\w.-]*=[^\s]+\s+)*([A-Za-z_][\w.-]*)/u)?.[1];
    if (executable === "git") return /^(?:env\s+)?git\s+(?:status|diff|log|show|branch)\b/u.test(segment);
    return executable ? READONLY.has(executable) : false;
  });
  return safe ? "readonly" : "unknown";
}

function args(event: ToolCallEvent): Record<string, unknown> { return event.input as Record<string, unknown>; }

export function registerChildGuard(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "read" || event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls") return;
    const approved = env.PI_AGENT_MODE === "yolo" || env.PI_SUBAGENT_TASK_APPROVED === "1";
    if (event.toolName === "write" || event.toolName === "edit") {
      return approved ? undefined : { block: true, reason: "Subagent write was not approved by the parent" };
    }
    if (event.toolName !== "bash") return;
    const classification = classifyChildBash(typeof args(event).command === "string" ? args(event).command as string : "");
    if (classification === "catastrophic") return { block: true, reason: "Blocked catastrophic Bash command in subagent" };
    if (classification === "readonly" || approved) return;
    return { block: true, reason: "Subagent Bash command was not approved by the parent" };
  });
}

export default function childGuard(pi: ExtensionAPI): void { registerChildGuard(pi); }
