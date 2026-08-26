import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, Spacer, Text, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface TokenTotals {
  input: number;
  output: number;
}

interface UsageRecord extends TokenTotals {
  key: string;
}

export const STATUS_CONFIG_ENTRY = "pi-status-line-config";

export interface StatusDisplayConfig {
  tokens: boolean;
  thinking: boolean;
  contextPercent: boolean;
  contextWindow: boolean;
  model: boolean;
  cwd: boolean;
  git: boolean;
  extensions: boolean;
}

export const DEFAULT_STATUS_DISPLAY_CONFIG: StatusDisplayConfig = {
  tokens: true,
  thinking: true,
  contextPercent: true,
  contextWindow: true,
  model: true,
  cwd: true,
  git: true,
  extensions: true,
};

const DISPLAY_OPTIONS: Array<{ key: keyof StatusDisplayConfig; label: string }> = [
  { key: "tokens", label: "Token 统计" },
  { key: "thinking", label: "思考模式" },
  { key: "contextPercent", label: "上下文占比" },
  { key: "contextWindow", label: "上下文窗口" },
  { key: "model", label: "模型信息" },
  { key: "cwd", label: "工作目录" },
  { key: "git", label: "Git 分支" },
  { key: "extensions", label: "扩展状态" },
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageFromMessage(message: unknown): UsageRecord | undefined {
  const record = asRecord(message);
  if (!record || record.role !== "assistant") return undefined;

  const usage = asRecord(record.usage);
  if (!usage) return undefined;

  const input = asTokenCount(usage.input);
  const output = asTokenCount(usage.output);
  const responseId = typeof record.responseId === "string" ? record.responseId : undefined;
  const fallbackKey = [record.timestamp, record.provider, record.model, input, output].join(":");
  return { input, output, key: responseId ?? fallbackKey };
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function formatThinkingLevel(level: ExtensionContext["thinkingLevel"]): string {
  const labels: Record<string, string> = {
    off: "关闭",
    minimal: "极低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最高",
  };
  return level ? (labels[level] ?? level) : "未设置";
}

export function formatContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  const windowLabel = contextWindow && contextWindow > 0 ? formatTokenCount(contextWindow) : "--";
  const percentLabel = usage?.percent === null || usage?.percent === undefined
    ? "--"
    : `${usage.percent.toFixed(1)}%`;
  return `${percentLabel}/${windowLabel}`;
}

function formatUserPath(cwd: string): string {
  const home = process.env.HOME;
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function isStatusDisplayConfig(value: unknown): value is StatusDisplayConfig {
  const record = asRecord(value);
  return DISPLAY_OPTIONS.every(({ key }) => typeof record?.[key] === "boolean");
}

export function normalizeStatusDisplayConfig(value: unknown): StatusDisplayConfig {
  const record = asRecord(value);
  return DISPLAY_OPTIONS.reduce((config, { key }) => {
    config[key] = typeof record?.[key] === "boolean"
      ? record[key] as boolean
      : DEFAULT_STATUS_DISPLAY_CONFIG[key];
    return config;
  }, { ...DEFAULT_STATUS_DISPLAY_CONFIG });
}

export function restoreStatusDisplayConfig(entries: Iterable<unknown>): StatusDisplayConfig {
  let config = { ...DEFAULT_STATUS_DISPLAY_CONFIG };
  for (const entry of entries) {
    const record = asRecord(entry);
    if (record?.type !== "custom" || record.customType !== STATUS_CONFIG_ENTRY) continue;
    const data = record.data;
    if (isStatusDisplayConfig(data)) config = normalizeStatusDisplayConfig(data);
  }
  return config;
}

export function statusDisplayLabel(key: keyof StatusDisplayConfig): string {
  return DISPLAY_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

export interface StatusLineState {
  reset(messages: Iterable<unknown>): void;
  add(message: unknown): boolean;
  totals(): TokenTotals;
}

export function createStatusLineState(): StatusLineState {
  let input = 0;
  let output = 0;
  let accounted = new Set<string>();

  const add = (message: unknown): boolean => {
    const usage = usageFromMessage(message);
    if (!usage || accounted.has(usage.key)) return false;
    accounted.add(usage.key);
    input += usage.input;
    output += usage.output;
    return true;
  };

  return {
    reset(messages) {
      input = 0;
      output = 0;
      accounted = new Set();
      for (const message of messages) add(message);
    },
    add,
    totals() {
      return { input, output };
    },
  };
}

function sessionMessages(ctx: ExtensionContext): unknown[] {
  return ctx.sessionManager.getBranch().flatMap((entry) => {
    const record = asRecord(entry);
    return record && record.type === "message" ? [record.message] : [];
  });
}

export function formatTokenSummary(totals: TokenTotals): string {
  return [
    `输入：${formatTokenCount(totals.input)}`,
    `输出：${formatTokenCount(totals.output)}`,
    `总计：${formatTokenCount(totals.input + totals.output)}`,
  ].join(" ");
}

function contextColor(percent: number | null | undefined): "success" | "warning" | "error" {
  if (percent === null || percent === undefined) return "success";
  if (percent >= 80) return "error";
  if (percent >= 60) return "warning";
  return "success";
}

const THINKING_COLOR_KEYS: Record<string, string> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

interface ThemeLike {
  fg(color: string, text: string): string;
}

interface TopLineOptions {
  state: StatusLineState;
  config: StatusDisplayConfig;
  ctx: ExtensionContext;
  theme: ThemeLike;
}

function topLine({ state, config, ctx, theme }: TopLineOptions): string {
  const totals = state.totals();
  const metrics: string[] = [];

  if (config.tokens) {
    metrics.push(formatTokenSummary(totals));
  }
  if (config.thinking) {
    const level = typeof ctx.thinkingLevel === "string" ? ctx.thinkingLevel : "";
    const colorKey = THINKING_COLOR_KEYS[level] ?? "muted";
    metrics.push(`思考：${theme.fg(colorKey, formatThinkingLevel(ctx.thinkingLevel))}`);
  }
  if (config.contextPercent && config.contextWindow) {
    const usage = ctx.getContextUsage();
    const percentLabel = usage?.percent === null || usage?.percent === undefined
      ? "--"
      : `${usage.percent.toFixed(1)}%`;
    const windowSize = usage?.contextWindow ?? ctx.model?.contextWindow;
    const windowLabel = windowSize && windowSize > 0 ? formatTokenCount(windowSize) : "--";
    const color = contextColor(usage?.percent);
    metrics.push(`上下文：${theme.fg(color, percentLabel)}${theme.fg("dim", "/")}${windowLabel}`);
  } else if (config.contextPercent) {
    const usage = ctx.getContextUsage();
    const percentLabel = usage?.percent === null || usage?.percent === undefined
      ? "--"
      : `${usage.percent.toFixed(1)}%`;
    const color = contextColor(usage?.percent);
    metrics.push(`上下文：${theme.fg(color, percentLabel)}`);
  } else if (config.contextWindow) {
    const contextWindow = ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow;
    metrics.push(`上下文窗口：${contextWindow && contextWindow > 0 ? formatTokenCount(contextWindow) : "--"}`);
  }
  return metrics.join(" | ");
}

const STATUS_KEY_ALIASES: Record<string, keyof StatusDisplayConfig> = {
  tokens: "tokens",
  token: "tokens",
  thinking: "thinking",
  context: "contextPercent",
  "context-percent": "contextPercent",
  "context-window": "contextWindow",
  window: "contextWindow",
  model: "model",
  cwd: "cwd",
  path: "cwd",
  git: "git",
  extensions: "extensions",
  extension: "extensions",
};

function parseStatusKey(value: string): keyof StatusDisplayConfig | undefined {
  return STATUS_KEY_ALIASES[value.trim().toLowerCase()];
}

function statusConfigSummary(config: StatusDisplayConfig): string {
  return DISPLAY_OPTIONS
    .map(({ key, label }) => `${label}${config[key] ? "开" : "关"}`)
    .join("，");
}

class StatusDisplayToggle extends Container {
  private selectedIndex = 0;
  private marked: StatusDisplayConfig;
  private readonly entries = DISPLAY_OPTIONS;
  private readonly list = new Container();
  private readonly footer: Text;
  private dirty = false;
  private readonly tui: { requestRender(): void };
  private readonly keybindings: { matches(data: string, id: string): boolean };
  private readonly theme: { fg(color: string, text: string): string; bold(text: string): string };
  private readonly done: (result: StatusDisplayConfig | null) => void;
  private readonly onSave: (config: StatusDisplayConfig) => void | Promise<void>;

  constructor(
    tui: { requestRender(): void },
    theme: StatusDisplayToggle["theme"],
    keybindings: StatusDisplayToggle["keybindings"],
    initial: StatusDisplayConfig,
    done: (result: StatusDisplayConfig | null) => void,
    onSave: (config: StatusDisplayConfig) => void | Promise<void>,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.marked = { ...initial };
    this.done = done;
    this.onSave = onSave;
    this.addChild(new Text(this.theme.fg("accent", this.theme.bold("状态栏显示内容")), 0, 0));
    this.addChild(new Text(this.theme.fg("muted", "↑↓ 移动 · Enter 切换 · Ctrl+S 保存 · Esc 取消"), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.footer = new Text("", 0, 0);
    this.addChild(this.footer);
    this.refresh();
  }

  private refresh(): void {
    this.list.clear();
    for (let i = 0; i < this.entries.length; i++) {
      const { key, label } = this.entries[i];
      const selected = i === this.selectedIndex;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const name = selected ? this.theme.fg("accent", label) : label;
      const mark = this.marked[key]
        ? this.theme.fg("success", " ✓")
        : this.theme.fg("dim", " ✗");
      this.list.addChild(new Text(`${prefix}${name}${mark}`, 0, 0));
    }
    const state = this.dirty ? "未保存" : "已保存";
    this.footer.setText(this.theme.fg("dim", `${state} · ${this.selectedIndex + 1}/${this.entries.length}`));
  }

  private save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    void Promise.resolve(this.onSave({ ...this.marked })).catch(() => {
      this.dirty = true;
      this.refresh();
      this.tui.requestRender();
    });
    this.refresh();
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? this.entries.length - 1 : this.selectedIndex - 1;
      this.refresh();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex === this.entries.length - 1 ? 0 : this.selectedIndex + 1;
      this.refresh();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const key = this.entries[this.selectedIndex].key;
      this.marked[key] = !this.marked[key];
      this.dirty = true;
      this.refresh();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "app.models.save")) {
      this.save();
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done(null);
    }
  }
}

export function registerStatusLineExtension(pi: ExtensionAPI): void {
  const state = createStatusLineState();
  let config = { ...DEFAULT_STATUS_DISPLAY_CONFIG };
  let requestFooterRender: (() => void) | undefined;
  let sessionActive = false;
  const saveConfig = (ctx: ExtensionContext, nextConfig: StatusDisplayConfig, notify = true): void => {
    config = normalizeStatusDisplayConfig(nextConfig);
    pi.appendEntry(STATUS_CONFIG_ENTRY, config);
    requestFooterRender?.();
    if (notify) ctx.ui.notify(`状态栏配置已更新：${statusConfigSummary(config)}`, "info");
  };

  pi.registerCommand("status", {
    description: "配置状态栏显示项目",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
          await ctx.ui.custom<StatusDisplayConfig | null>((tui, theme, keybindings, done) =>
            new StatusDisplayToggle(
              tui,
              theme,
              keybindings,
              config,
              done,
              async (nextConfig) => saveConfig(ctx, nextConfig),
            ),
          );
          return;
        }

        // 非 TUI 模式保留兼容路径；TUI 使用上面的持久多选组件，避免闪屏。
        while (true) {
          const selected = await ctx.ui.select(
            "状态栏显示项目",
            [
              ...DISPLAY_OPTIONS.map(({ key, label }) => `${config[key] ? "✅" : "⬜"} ${label}`),
              "完成",
            ],
          );
          if (!selected || selected === "完成") return;
          const index = DISPLAY_OPTIONS.findIndex(({ label }) => selected.endsWith(label));
          if (index >= 0) {
            const key = DISPLAY_OPTIONS[index].key;
            saveConfig(ctx, { ...config, [key]: !config[key] });
          }
        }
      }

      if (parts[0] === "reset" || parts[0] === "default") {
        return saveConfig(ctx, DEFAULT_STATUS_DISPLAY_CONFIG);
      }
      if (parts[0] === "show") {
        ctx.ui.notify(statusConfigSummary(config), "info");
        return;
      }

      const enabled = parts[0] === "on" || parts[0] === "enable";
      const disabled = parts[0] === "off" || parts[0] === "disable";
      if ((enabled || disabled) && parts[1]) {
        const key = parseStatusKey(parts[1]);
        if (key) return saveConfig(ctx, { ...config, [key]: enabled });
      }
      ctx.ui.notify("用法：/status，/status on|off <tokens|thinking|context|context-window|model|cwd|git|extensions>，/status reset，/status show", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    sessionActive = true;
    config = restoreStatusDisplayConfig(ctx.sessionManager.getBranch());
    state.reset(sessionMessages(ctx));

    ctx.ui.setFooter((tui, theme, footerData) => {
      const render = () => tui.requestRender();
      requestFooterRender = render;
      const unsubscribe = footerData.onBranchChange(render);

      return {
        dispose() {
          unsubscribe();
          if (requestFooterRender === render) requestFooterRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          if (!sessionActive) return [];

          const metrics = topLine({ state, config, ctx, theme });
          const provider = ctx.model?.provider;
          const model = ctx.model?.id ?? "";
          const modelLabel = config.model ? (provider ? `(${provider}) ${model}` : model) : "";
          const metricsWidth = visibleWidth(metrics);
          const modelWidth = visibleWidth(modelLabel);
          const firstLine = modelLabel && metricsWidth + modelWidth <= width
            ? `${metrics}${" ".repeat(width - metricsWidth - modelWidth)}${modelLabel}`
            : truncateToWidth(metrics, width);

          const branch = footerData.getGitBranch();
          const pathLabel = formatUserPath(ctx.cwd);
          const location = config.cwd
            ? (config.git && branch ? `${pathLabel} (${branch})` : pathLabel)
            : (config.git && branch ? branch : "");
          const locationStyled = !location ? ""
            : config.cwd && config.git && branch
              ? `${pathLabel} ${theme.fg("dim", "(")}${theme.fg("accent", branch)}${theme.fg("dim", ")")}`
              : location;
          const statuses = config.extensions ? Array.from(footerData.getExtensionStatuses().values()) : [];
          const secondLine = [locationStyled, ...statuses].filter(Boolean).join(` ${theme.fg("dim", "│")} `);

          return [truncateToWidth(firstLine, width), truncateToWidth(secondLine, width)];
        },
      };
    });
  });

  pi.on("message_end", (event) => {
    if (state.add(event.message)) requestFooterRender?.();
  });

  pi.on("thinking_level_select", () => {
    requestFooterRender?.();
  });

  pi.on("model_select", () => {
    requestFooterRender?.();
  });

  pi.on("session_shutdown", () => {
    sessionActive = false;
    requestFooterRender = undefined;
  });
}

export default function statusLineExtension(pi: ExtensionAPI): void {
  registerStatusLineExtension(pi);
}
