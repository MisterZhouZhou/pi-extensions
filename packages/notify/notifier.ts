import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const PI_ICON_URL = new URL("./assets/pi.png", import.meta.url).href;

export interface NotificationRequest {
  title: string;
  subtitle: string;
  message: string;
  sound: "Glass";
  group: string;
}

export type NotificationResult =
  | { ok: true; provider: "terminal-notifier" | "osascript" }
  | { ok: false; provider: "unsupported" | "none"; reason: string };

export interface NotificationRuntime {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isExecutable(file: string): Promise<boolean>;
  run(file: string, args: readonly string[]): Promise<boolean>;
}

const TERMINAL_BUNDLE_IDS: Readonly<Record<string, string>> = {
  Apple_Terminal: "com.apple.Terminal",
  "iTerm.app": "com.googlecode.iterm2",
  iTerm2: "com.googlecode.iterm2",
  ghostty: "com.mitchellh.ghostty",
  vscode: "com.microsoft.VSCode",
  WarpTerminal: "dev.warp.Warp-Stable",
  cursor: "com.todesktop.230313mzl4w4u92",
};

const APPLE_SCRIPT = `
on run argv
  set messageText to item 1 of argv
  set titleText to item 2 of argv
  set subtitleText to item 3 of argv
  set soundName to item 4 of argv
  display notification messageText with title titleText subtitle subtitleText sound name soundName
end run
`.trim();

export function resolveActivationBundleId(
  termProgram: string | undefined,
): string | undefined {
  return termProgram ? TERMINAL_BUNDLE_IDS[termProgram] : undefined;
}

export function buildTerminalNotifierArgs(
  request: NotificationRequest,
  bundleId?: string,
): string[] {
  const args = [
    "-title",
    request.title,
    "-subtitle",
    request.subtitle,
    "-message",
    request.message,
    "-sound",
    request.sound,
    "-group",
    request.group,
    "-appIcon",
    PI_ICON_URL,
    "-contentImage",
    PI_ICON_URL,
  ];
  if (bundleId) args.push("-activate", bundleId);
  return args;
}

function buildOsascriptArgs(request: NotificationRequest): string[] {
  return [
    "-e",
    APPLE_SCRIPT,
    request.message,
    request.title,
    request.subtitle,
    request.sound,
  ];
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(file: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(file, args, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 5_000);
    timer.unref();
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

const defaultRuntime: NotificationRuntime = {
  platform: process.platform,
  env: process.env,
  isExecutable,
  run,
};

export async function findTerminalNotifier(
  runtime: NotificationRuntime,
): Promise<string | undefined> {
  const candidates: string[] = [];
  if (runtime.env.PI_NOTIFY_BIN) candidates.push(runtime.env.PI_NOTIFY_BIN);
  for (const directory of (runtime.env.PATH ?? "").split(path.delimiter)) {
    if (directory) candidates.push(path.join(directory, "terminal-notifier"));
  }
  candidates.push(
    "/opt/homebrew/bin/terminal-notifier",
    "/usr/local/bin/terminal-notifier",
  );

  for (const candidate of new Set(candidates)) {
    if (await runtime.isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export async function sendNotification(
  request: NotificationRequest,
  runtime: NotificationRuntime = defaultRuntime,
): Promise<NotificationResult> {
  if (runtime.platform !== "darwin") {
    return {
      ok: false,
      provider: "unsupported",
      reason: "Pi Notify 仅支持 macOS",
    };
  }

  const notifier = await findTerminalNotifier(runtime);
  if (notifier) {
    const bundleId = resolveActivationBundleId(runtime.env.TERM_PROGRAM);
    if (await runtime.run(notifier, buildTerminalNotifierArgs(request, bundleId))) {
      return { ok: true, provider: "terminal-notifier" };
    }
  }

  const osascript = "/usr/bin/osascript";
  if (
    (await runtime.isExecutable(osascript)) &&
    (await runtime.run(osascript, buildOsascriptArgs(request)))
  ) {
    return { ok: true, provider: "osascript" };
  }

  return {
    ok: false,
    provider: "none",
    reason: "系统通知发送失败",
  };
}
