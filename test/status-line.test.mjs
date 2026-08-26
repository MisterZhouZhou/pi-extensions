import assert from "node:assert/strict";
import test from "node:test";

import {
  createStatusLineState,
  DEFAULT_STATUS_DISPLAY_CONFIG,
  STATUS_CONFIG_ENTRY,
  formatContextUsage,
  formatTokenCount,
  formatTokenSummary,
  normalizeStatusDisplayConfig,
  registerStatusLineExtension,
  restoreStatusDisplayConfig,
} from "../packages/status-line/index.ts";

function assistantMessage({ input, output, responseId = "response-1" }) {
  return {
    role: "assistant",
    responseId,
    usage: { input, output },
  };
}

test("status line accumulates token usage and ignores duplicate responses", () => {
  const state = createStatusLineState();
  const message = assistantMessage({ input: 1200, output: 800 });

  assert.equal(state.add(message), true);
  assert.equal(state.add(message), false);
  assert.deepEqual(state.totals(), { input: 1200, output: 800 });
});

test("status line rebuilds totals from session messages", () => {
  const state = createStatusLineState();
  state.reset([
    { role: "user", content: [{ type: "text", text: "hello" }] },
    assistantMessage({ input: 1000, output: 200 }),
    assistantMessage({ input: 300, output: 90, responseId: "response-2" }),
  ]);

  assert.deepEqual(state.totals(), { input: 1300, output: 290 });
});

test("status line formats token counts compactly", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1200), "1.2k");
  assert.equal(formatTokenCount(12000), "12k");
  assert.equal(formatTokenCount(1_200_000), "1.2M");
});

test("status line groups token totals without separators", () => {
  const summary = formatTokenSummary({ input: 1200, output: 800 });

  assert.equal(summary, "输入：1.2k 输出：800 总计：2.0k");
  assert.equal(summary.includes("|"), false);
});

test("status line shows context percentage and window size", () => {
  const ctx = {
    model: { contextWindow: 128000 },
    getContextUsage: () => ({ tokens: 16000, contextWindow: 128000, percent: 12.5 }),
  };

  assert.equal(formatContextUsage(ctx), "12.5%/128k");
});

test("status line falls back when context usage is unavailable", () => {
  const ctx = {
    model: { contextWindow: 200000 },
    getContextUsage: () => undefined,
  };

  assert.equal(formatContextUsage(ctx), "--/200k");
});

test("status display config normalizes and restores the latest session entry", () => {
  assert.deepEqual(normalizeStatusDisplayConfig({ tokens: false }), {
    ...DEFAULT_STATUS_DISPLAY_CONFIG,
    tokens: false,
  });
  assert.deepEqual(restoreStatusDisplayConfig([
    { type: "custom", customType: STATUS_CONFIG_ENTRY, data: { ...DEFAULT_STATUS_DISPLAY_CONFIG, model: false } },
    { type: "custom", customType: STATUS_CONFIG_ENTRY, data: { ...DEFAULT_STATUS_DISPLAY_CONFIG, cwd: false } },
  ]), {
    ...DEFAULT_STATUS_DISPLAY_CONFIG,
    cwd: false,
  });
});

test("status command updates and persists display config", async () => {
  const commands = new Map();
  const entries = [];
  const notices = [];
  const pi = {
    registerCommand(name, definition) { commands.set(name, definition); },
    appendEntry(type, data) { entries.push({ type, data }); },
    on() {},
  };
  registerStatusLineExtension(pi);
  const ctx = {
    ui: {
      notify(message, type) { notices.push({ message, type }); },
      select: async () => "完成",
    },
  };

  await commands.get("status").handler("off tokens", ctx);
  assert.equal(entries.at(-1).type, STATUS_CONFIG_ENTRY);
  assert.equal(entries.at(-1).data.tokens, false);
  assert.match(notices.at(-1).message, /Token 统计关/);

  await commands.get("status").handler("reset", ctx);
  assert.deepEqual(entries.at(-1).data, DEFAULT_STATUS_DISPLAY_CONFIG);
});

test("interactive status command toggles in one persistent menu and saves once", async () => {
  const commands = new Map();
  const entries = [];
  let component;
  let closed = false;
  const pi = {
    registerCommand(name, definition) { commands.set(name, definition); },
    appendEntry(type, data) { entries.push({ type, data }); },
    on() {},
  };
  registerStatusLineExtension(pi);
  await commands.get("status").handler("", {
    mode: "tui",
    ui: {
      custom: async (factory) => {
        component = factory(
          { requestRender() {} },
          { fg: (_color, text) => text, bold: (text) => text },
          {
            matches: (data, id) =>
              (id === "tui.select.confirm" && data === "enter") ||
              (id === "tui.select.down" && data === "down") ||
              (id === "app.models.save" && data === "ctrl+s"),
          },
          () => { closed = true; },
        );
        component.handleInput("enter");
        component.handleInput("down");
        component.handleInput("enter");
        assert.equal(entries.length, 0);
        component.handleInput("ctrl+s");
        await Promise.resolve();
        component.handleInput("\x1b");
      },
      notify() {},
    },
  });

  assert.equal(closed, true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.tokens, false);
  assert.equal(entries[0].data.thinking, false);
});
