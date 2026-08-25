export type YoloMode = "default" | "yolo";
export type BashClassification = "readonly" | "unknown" | "catastrophic";

export type GateDecision =
  | { action: "allow" }
  | { action: "ask"; title: string; message: string }
  | { action: "block"; reason: string };

export interface GateInput {
  toolName: string;
  args: Record<string, unknown>;
  mode: YoloMode;
  hasUI: boolean;
  taskApproved?: boolean;
}

const READONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const READONLY_COMMANDS = new Set([
  "cat", "cut", "diff", "du", "file", "git", "head", "less", "ls", "pwd",
  "rg", "sed", "sort", "stat", "tail", "wc", "which", "type",
]);
const CATASTROPHIC_PATTERNS = [
  /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*\s+)*-rf\s+(?:\/|~|\.\.?\/?(?:\s|$))/u,
  /(?:^|[;&|]\s*)mkfs(?:\.[\w-]+)?\b/u,
  /(?:^|[;&|]\s*)dd\b[^\n]*(?:of=\/dev\/|if=\/dev\/zero)/u,
  /(?:^|[;&|]\s*)>(?:>|\s)*\/dev\/(?:sd|nvme|disk|mapper)\b/u,
  /(?:^|[;&|]\s*)chmod\s+(?:-R\s+)?(?:777|a\+rwx)\s+\//u,
  /(?:^|[;&|]\s*)shutdown\b/u,
  /(?:^|[;&|]\s*)reboot\b/u,
];

export function isReadonlyTool(name: string): boolean {
  return READONLY_TOOLS.has(name);
}

function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function classifyBash(command: string): BashClassification {
  const normalized = command.trim();
  if (!normalized || CATASTROPHIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return normalized ? "catastrophic" : "unknown";
  }
  const segments = commandSegments(normalized);
  const readonly = segments.length > 0 && segments.every((segment) => {
    if (/[<>]/u.test(segment)) return false;
    const match = segment.match(/^(?:env\s+)?(?:[A-Za-z_][\w.-]*=[^\s]+\s+)*([A-Za-z_][\w.-]*)/u);
    if (!match) return false;
    const executable = match[1];
    if (executable === "git") {
      const words = segment.split(/\s+/u);
      return words[1] === "status" || words[1] === "diff" || words[1] === "log" || words[1] === "show" || words[1] === "branch";
    }
    return READONLY_COMMANDS.has(executable) || READONLY_COMMANDS.has(segment.split(/\s+/u).slice(0, 2).join(" "));
  });
  return readonly ? "readonly" : "unknown";
}

export function isWritableAgentTools(tools: readonly string[] | undefined): boolean {
  if (!tools || tools.length === 0) return true;
  return tools.some((tool) => tool === "write" || tool === "edit");
}

export function decideToolCall(input: GateInput): GateDecision {
  const { toolName, mode, hasUI } = input;
  if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") {
    return { action: "allow" };
  }
  if (toolName === "write" || toolName === "edit") {
    if (mode === "yolo" || input.taskApproved) return { action: "allow" };
    return hasUI
      ? { action: "ask", title: "Allow file change?", message: `Allow model to use ${toolName}?` }
      : { action: "block", reason: `Blocked ${toolName}: interactive approval is unavailable` };
  }
  if (toolName === "bash") {
    const classification = classifyBash(typeof input.args.command === "string" ? input.args.command : "");
    if (classification === "catastrophic") return { action: "block", reason: "Blocked catastrophic Bash command" };
    if (classification === "readonly") return { action: "allow" };
    if (mode === "yolo" || input.taskApproved) return { action: "allow" };
    return hasUI
      ? { action: "ask", title: "Allow Bash command?", message: "Allow model to run a command with side effects?" }
      : { action: "block", reason: "Blocked unknown Bash command: interactive approval is unavailable" };
  }
  return { action: "allow" };
}
