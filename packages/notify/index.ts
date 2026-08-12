import { createHash } from "node:crypto";
import path from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  sendNotification,
  type NotificationRequest,
  type NotificationResult,
} from "./notifier.ts";

const EMPTY_RUN_MESSAGE = "当前回合已结束";

export type NotificationSender = (
  request: NotificationRequest,
) => Promise<NotificationResult>;

export function extractAssistantText(
  message: AgentMessage,
): string | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return undefined;
  }

  const text = message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();

  return text || undefined;
}

export interface NotifyRunState {
  start(): void;
  remember(message: AgentMessage): void;
  takeIfSettled(isIdle: boolean): string | undefined;
}

export function createNotifyRunState(): NotifyRunState {
  let started = false;
  let handled = false;
  let lastAssistantText: string | undefined;

  return {
    start() {
      started = true;
      handled = false;
      lastAssistantText = undefined;
    },
    remember(message) {
      const text = extractAssistantText(message);
      if (text) lastAssistantText = text;
    },
    takeIfSettled(isIdle) {
      if (!started || handled || !isIdle) return undefined;
      handled = true;
      return lastAssistantText ?? EMPTY_RUN_MESSAGE;
    },
  };
}

function projectDetails(cwd: string): { subtitle: string; group: string } {
  const resolvedCwd = path.resolve(cwd);
  const digest = createHash("sha256").update(resolvedCwd).digest("hex").slice(0, 16);
  return {
    subtitle: path.basename(resolvedCwd),
    group: `pi-notify:${digest}`,
  };
}

export function registerNotifyExtension(
  pi: ExtensionAPI,
  sender: NotificationSender = sendNotification,
): void {
  const state = createNotifyRunState();

  pi.on("agent_start", () => {
    state.start();
  });

  pi.on("message_end", (event) => {
    state.remember(event.message);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const message = state.takeIfSettled(ctx.isIdle());
    if (!message) return;

    const { subtitle, group } = projectDetails(ctx.cwd);
    try {
      await sender({
        title: "Pi · 回复完成",
        subtitle,
        message,
        sound: "Glass",
        group,
      });
    } catch {
      // Automatic desktop notifications must never interrupt the Pi session.
    }
  });

  pi.registerCommand("notify-test", {
    description: "发送一条 macOS 测试通知",
    handler: async (_args, ctx) => {
      const { subtitle, group } = projectDetails(ctx.cwd);
      try {
        const result = await sender({
          title: "Pi · 通知测试",
          subtitle,
          message: "Pi 通知扩展运行正常",
          sound: "Glass",
          group: `${group}:test`,
        });

        if (result.ok) {
          ctx.ui.notify(`测试通知已通过 ${result.provider} 发送`, "info");
        } else if (result.provider === "unsupported") {
          ctx.ui.notify("当前平台不受支持，Pi Notify 仅支持 macOS", "warning");
        } else {
          ctx.ui.notify("通知发送失败：系统通知发送失败", "warning");
        }
      } catch {
        ctx.ui.notify("通知发送失败：系统通知发送失败", "warning");
      }
    },
  });
}

export default function notifyExtension(pi: ExtensionAPI): void {
  registerNotifyExtension(pi);
}
