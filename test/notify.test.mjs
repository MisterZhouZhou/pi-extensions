import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerminalNotifierArgs,
  findTerminalNotifier,
  resolveActivationBundleId,
  sendNotification,
} from "../packages/notify/notifier.ts";

const request = {
  title: "Pi · 回复完成",
  subtitle: "project",
  message: '完整回复："quotes" `ticks` $HOME',
  sound: "Glass",
  group: "pi-notify:abc",
};

function createRuntime({
  platform = "darwin",
  env = {},
  executable = [],
  results = [],
} = {}) {
  const calls = [];
  return {
    calls,
    value: {
      platform,
      env,
      async isExecutable(file) {
        return executable.includes(file);
      },
      async run(file, args) {
        calls.push([file, [...args]]);
        return results.shift() ?? false;
      },
    },
  };
}

test("maps supported TERM_PROGRAM values", () => {
  assert.equal(resolveActivationBundleId("Apple_Terminal"), "com.apple.Terminal");
  assert.equal(resolveActivationBundleId("iTerm.app"), "com.googlecode.iterm2");
  assert.equal(resolveActivationBundleId("iTerm2"), "com.googlecode.iterm2");
  assert.equal(resolveActivationBundleId("ghostty"), "com.mitchellh.ghostty");
  assert.equal(resolveActivationBundleId("vscode"), "com.microsoft.VSCode");
  assert.equal(resolveActivationBundleId("WarpTerminal"), "dev.warp.Warp-Stable");
  assert.equal(resolveActivationBundleId("cursor"), "com.todesktop.230313mzl4w4u92");
  assert.equal(resolveActivationBundleId("unknown"), undefined);
});

test("passes notification content as argument values without a shell", () => {
  const args = buildTerminalNotifierArgs(request, "com.mitchellh.ghostty");
  assert.deepEqual(args, [
    "-title",
    request.title,
    "-subtitle",
    request.subtitle,
    "-message",
    request.message,
    "-sound",
    "Glass",
    "-group",
    request.group,
    "-appIcon",
    new URL("../packages/notify/assets/pi.png", import.meta.url).href,
    "-contentImage",
    new URL("../packages/notify/assets/pi.png", import.meta.url).href,
    "-activate",
    "com.mitchellh.ghostty",
  ]);
  assert.equal(buildTerminalNotifierArgs(request).includes("-activate"), false);
});

test("uses PI_NOTIFY_BIN first and continues after an invalid override", async () => {
  const preferred = createRuntime({
    env: { PI_NOTIFY_BIN: "/custom/notifier", PATH: "/bin:/usr/local/bin" },
    executable: ["/custom/notifier", "/usr/local/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(preferred.value), "/custom/notifier");

  const fallback = createRuntime({
    env: { PI_NOTIFY_BIN: "/missing/notifier", PATH: "/bin:/usr/local/bin" },
    executable: ["/usr/local/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(fallback.value), "/usr/local/bin/terminal-notifier");
});

test("checks Homebrew paths after PATH candidates", async () => {
  const arm = createRuntime({
    env: { PATH: "/bin" },
    executable: ["/opt/homebrew/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(arm.value), "/opt/homebrew/bin/terminal-notifier");

  const intel = createRuntime({
    env: {},
    executable: ["/usr/local/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(intel.value), "/usr/local/bin/terminal-notifier");
});

test("returns immediately when terminal-notifier succeeds", async () => {
  const fake = createRuntime({
    env: { PATH: "/usr/local/bin", TERM_PROGRAM: "ghostty" },
    executable: ["/usr/local/bin/terminal-notifier", "/usr/bin/osascript"],
    results: [true],
  });
  assert.deepEqual(await sendNotification(request, fake.value), {
    ok: true,
    provider: "terminal-notifier",
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][1].includes("com.mitchellh.ghostty"), true);
});

test("falls back from terminal-notifier to osascript with argv content", async () => {
  const fake = createRuntime({
    env: { PATH: "/usr/local/bin", TERM_PROGRAM: "ghostty" },
    executable: ["/usr/local/bin/terminal-notifier", "/usr/bin/osascript"],
    results: [false, true],
  });
  assert.deepEqual(await sendNotification(request, fake.value), {
    ok: true,
    provider: "osascript",
  });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0][0], "/usr/local/bin/terminal-notifier");
  assert.equal(fake.calls[1][0], "/usr/bin/osascript");
  assert.deepEqual(fake.calls[1][1].slice(-4), [
    request.message,
    request.title,
    request.subtitle,
    request.sound,
  ]);
});

test("reports a safe failure when every sender fails", async () => {
  const fake = createRuntime({
    executable: ["/usr/bin/osascript"],
    results: [false],
  });
  assert.deepEqual(await sendNotification(request, fake.value), {
    ok: false,
    provider: "none",
    reason: "系统通知发送失败",
  });
});

test("does not invoke any sender outside macOS", async () => {
  const fake = createRuntime({ platform: "linux" });
  assert.deepEqual(await sendNotification(request, fake.value), {
    ok: false,
    provider: "unsupported",
    reason: "Pi Notify 仅支持 macOS",
  });
  assert.deepEqual(fake.calls, []);
});

function fakePi() {
  const handlers = new Map();
  const commands = new Map();
  return {
    handlers,
    commands,
    api: {
      on(name, handler) {
        handlers.set(name, handler);
      },
      registerCommand(name, definition) {
        commands.set(name, definition);
      },
    },
  };
}

function assistantMessage(content) {
  return { role: "assistant", content };
}

test("extracts only assistant text blocks and preserves full length", async () => {
  const { extractAssistantText } = await import("../packages/notify/index.ts");
  const longText = "x".repeat(1000);
  const message = assistantMessage([
    { type: "thinking", thinking: "private" },
    { type: "text", text: "第一段\n\n" },
    { type: "toolCall", id: "1", name: "read", arguments: {} },
    { type: "text", text: `第二段\t${longText}` },
  ]);
  const result = extractAssistantText(message);
  assert.equal(result, `第一段 第二段 ${longText}`);
  assert.equal(result.length > 1000, true);
});

test("returns undefined for non-assistant and textless messages", async () => {
  const { extractAssistantText } = await import("../packages/notify/index.ts");
  assert.equal(extractAssistantText({ role: "user", content: "hello" }), undefined);
  assert.equal(
    extractAssistantText(assistantMessage([{ type: "toolCall" }])),
    undefined,
  );
});

test("notifies at most once per run and falls back for empty text", async () => {
  const { createNotifyRunState } = await import("../packages/notify/index.ts");
  const state = createNotifyRunState();
  state.start();
  assert.equal(state.takeIfSettled(false), undefined);
  assert.equal(state.takeIfSettled(true), "当前回合已结束");
  assert.equal(state.takeIfSettled(true), undefined);
  state.start();
  state.remember(assistantMessage([{ type: "text", text: " 完成\n 回复 " }]));
  assert.equal(state.takeIfSettled(true), "完成 回复");
});

test("registers Pi lifecycle handlers and sends once when settled", async () => {
  const { registerNotifyExtension } = await import("../packages/notify/index.ts");
  const pi = fakePi();
  const requests = [];
  registerNotifyExtension(pi.api, async (notification) => {
    requests.push(notification);
    return { ok: true, provider: "terminal-notifier" };
  });

  assert.deepEqual([...pi.handlers.keys()], [
    "agent_start",
    "message_end",
    "agent_settled",
  ]);
  assert.equal(pi.commands.has("notify-test"), true);

  await pi.handlers.get("agent_start")({}, {});
  await pi.handlers.get("message_end")(
    { message: assistantMessage([{ type: "text", text: " 完整\n回复内容 " }]) },
    {},
  );
  await pi.handlers.get("agent_settled")({}, { cwd: "/tmp/my-project", isIdle: () => false });
  assert.equal(requests.length, 0);
  await pi.handlers.get("agent_settled")({}, { cwd: "/tmp/my-project", isIdle: () => true });
  await pi.handlers.get("agent_settled")({}, { cwd: "/tmp/my-project", isIdle: () => true });

  assert.equal(requests.length, 1);
  assert.deepEqual(
    {
      title: requests[0].title,
      subtitle: requests[0].subtitle,
      message: requests[0].message,
      sound: requests[0].sound,
    },
    {
      title: "Pi · 回复完成",
      subtitle: "my-project",
      message: "完整 回复内容",
      sound: "Glass",
    },
  );
  assert.match(requests[0].group, /^pi-notify:[a-f0-9]{16}$/);
});

test("keeps automatic notification failures silent", async () => {
  const { registerNotifyExtension } = await import("../packages/notify/index.ts");
  const pi = fakePi();
  registerNotifyExtension(pi.api, async () => {
    throw new Error("secret failure detail");
  });
  await pi.handlers.get("agent_start")({}, {});
  await assert.doesNotReject(() =>
    pi.handlers.get("agent_settled")({}, { cwd: "/tmp/project", isIdle: () => true }),
  );
});

test("notify-test reports providers without consuming automatic state", async () => {
  const { registerNotifyExtension } = await import("../packages/notify/index.ts");
  const pi = fakePi();
  const results = [
    { ok: true, provider: "terminal-notifier" },
    { ok: true, provider: "osascript" },
    { ok: false, provider: "unsupported", reason: "Pi Notify 仅支持 macOS" },
    { ok: false, provider: "none", reason: "系统通知发送失败" },
  ];
  const requests = [];
  registerNotifyExtension(pi.api, async (notification) => {
    requests.push(notification);
    return results.shift();
  });
  const notices = [];
  const ctx = {
    cwd: "/tmp/project",
    ui: { notify: (...args) => notices.push(args) },
  };
  const command = pi.commands.get("notify-test");

  await pi.handlers.get("agent_start")({}, {});
  await command.handler("", ctx);
  await command.handler("", ctx);
  await command.handler("", ctx);
  await command.handler("", ctx);
  await pi.handlers.get("agent_settled")(
    {},
    { cwd: "/tmp/project", isIdle: () => true },
  );

  assert.deepEqual(notices, [
    ["测试通知已通过 terminal-notifier 发送", "info"],
    ["测试通知已通过 osascript 发送", "info"],
    ["当前平台不受支持，Pi Notify 仅支持 macOS", "warning"],
    ["通知发送失败：系统通知发送失败", "warning"],
  ]);
  assert.equal(requests.length, 5);
  assert.equal(requests[0].message, "Pi 通知扩展运行正常");
  assert.match(requests[0].group, /^pi-notify:[a-f0-9]{16}:test$/);
  assert.equal(requests[4].title, "Pi · 回复完成");
});

test("notify-test converts thrown errors to a safe message", async () => {
  const { registerNotifyExtension } = await import("../packages/notify/index.ts");
  const pi = fakePi();
  registerNotifyExtension(pi.api, async () => {
    throw new Error("secret stack detail");
  });
  const notices = [];
  await pi.commands.get("notify-test").handler("", {
    cwd: "/tmp/project",
    ui: { notify: (...args) => notices.push(args) },
  });
  assert.deepEqual(notices, [
    ["通知发送失败：系统通知发送失败", "warning"],
  ]);
});
