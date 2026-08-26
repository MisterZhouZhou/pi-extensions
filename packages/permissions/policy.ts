export type PermissionMode = "readonly" | "manual" | "yolo";
export type BashClassification = "readonly" | "unknown" | "catastrophic";

export type GateDecision =
  | { action: "allow" }
  | { action: "ask"; title: string; message: string }
  | { action: "block"; reason: string };

export interface GateInput {
  toolName: string;
  args: Record<string, unknown>;
  mode: PermissionMode;
  hasUI: boolean;
  taskApproved?: boolean;
}

export const READONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const READONLY_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "zcat", "zgrep", "zless", "gzcat",
  "grep", "rg", "ripgrep", "egrep", "fgrep", "find", "fd", "ls", "dir", "eza", "exa",
  "pwd", "realpath", "readlink", "echo", "printf", "wc", "sort", "uniq", "cut", "paste",
  "comm", "diff", "cmp", "file", "stat", "du", "df", "tree", "which", "whereis", "type",
  "uname", "whoami", "id", "hostname", "date", "cal", "uptime", "ps", "top", "htop",
  "sed", "awk",
]);
const READONLY_GIT_COMMANDS = new Set([
  "status", "diff", "log", "show", "branch", "ls-files", "rev-parse",
]);

const CATASTROPHIC_PATTERNS = [
  /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*\s+)*-rf\s+(?:\/|~|\.\.?\/?(?:\s|$))/u,
  /(?:^|[;&|]\s*)mkfs(?:\.[\w-]+)?\b/u,
  /(?:^|[;&|]\s*)dd\b[^\n]*(?:of=\/dev\/|if=\/dev\/zero)/u,
  /(?:^|[;&|]\s*)>(?:>|\s)*\/dev\/(?:sd|nvme|disk|mapper)\b/u,
  /(?:^|[;&|]\s*)chmod\s+(?:-R\s+)?(?:777|a\+rwx)\s+\//u,
  /(?:^|[;&|]\s*)shutdown\b/u,
  /(?:^|[;&|]\s*)reboot\b/u,
  /(?:^|[;&|]\s*)git\s+(?:reset\s+--hard|clean\s+-[^\n]*f|push\s+[^\n]*--force)/u,
];

export function isReadonlyTool(name: string): boolean {
  return READONLY_TOOLS.has(name);
}

function commandSegments(command: string): string[] | undefined {
  const normalized = command.trim();
  if (!normalized || /[;<>$`(){}\n\r`]/u.test(normalized) || /\|\|/u.test(normalized)) return undefined;
  const segments = normalized.split(/&&|\|/u).map((part) => part.trim()).filter(Boolean);
  return segments.length > 0 ? segments : undefined;
}

function isReadonlySegment(segment: string): boolean {
  const words = segment.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return false;
  const executable = words[0]?.split("/").at(-1);
  if (!executable || !/^[A-Za-z_][\w.-]*$/u.test(executable)) return false;
  if (executable === "git") return READONLY_GIT_COMMANDS.has(words[1] ?? "");
  if (!READONLY_COMMANDS.has(executable)) return false;
  if (executable === "sed" && words.some((word) => word === "-i" || word === "--in-place" || word.startsWith("-i"))) return false;
  if (executable === "awk" && words.some((word) => word.includes("system("))) return false;
  return true;
}

export function classifyBash(command: string): BashClassification {
  const normalized = command.trim();
  if (!normalized) return "unknown";
  if (CATASTROPHIC_PATTERNS.some((pattern) => pattern.test(normalized))) return "catastrophic";
  const segments = commandSegments(normalized);
  return segments && segments.every(isReadonlySegment) ? "readonly" : "unknown";
}

function approval(title: string, message: string, hasUI: boolean): GateDecision {
  return hasUI
    ? { action: "ask", title, message }
    : { action: "block", reason: "Interactive permission approval is unavailable" };
}

export function decideToolCall(input: GateInput): GateDecision {
  const { toolName, mode, hasUI } = input;

  if (toolName === "bash") {
    const classification = classifyBash(typeof input.args.command === "string" ? input.args.command : "");
    if (classification === "catastrophic") return { action: "block", reason: "Blocked catastrophic Bash command" };
    if (classification === "readonly") return { action: "allow" };
    if (mode === "readonly") return { action: "block", reason: "Blocked Bash command: readonly mode allows inspection commands only" };
    if (mode === "yolo" || input.taskApproved) return { action: "allow" };
    return approval("Allow Bash command?", "Allow the model to run a command with side effects?", hasUI);
  }

  if (toolName === "write" || toolName === "edit") {
    if (mode === "readonly") return { action: "block", reason: `Blocked ${toolName}: readonly mode does not allow file changes` };
    if (mode === "yolo" || input.taskApproved) return { action: "allow" };
    return approval("Allow file change?", `Allow the model to use ${toolName}?`, hasUI);
  }

  if (isReadonlyTool(toolName)) return { action: "allow" };
  if (mode === "readonly") return { action: "block", reason: `Blocked tool ${toolName}: readonly mode allows inspection tools only` };
  if (mode === "yolo" || input.taskApproved) return { action: "allow" };
  return approval("Allow tool call?", `Allow the model to use ${toolName}?`, hasUI);
}

export function filterActiveTools(active: readonly string[], mode: PermissionMode): string[] {
  if (mode !== "readonly") return [...active];
  return active.filter((name) => READONLY_TOOLS.has(name) || name === "bash");
}
