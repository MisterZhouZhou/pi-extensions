# Pi Extensions Monorepo 与 Notify 扩展 Implementation Plan

**Goal:** 在不发布、不推送的前提下，将当前初始化仓库搭建为 npm Workspaces monorepo，并实现可通过本地路径加载和验证的 `@misterzhouzhou/pi-notify` macOS Pi Extension。

**Architecture:** 根包只负责 Workspaces、类型检查、清单校验、测试和 CI；`packages/notify` 是可独立发布的 Pi Package。`index.ts` 只负责 Pi 事件、单轮状态和 `/notify-test`，`notifier.ts` 只负责 macOS `terminal-notifier → osascript` 发送链路，并通过可注入 runtime 实现无真实弹窗的自动测试。

**Tech Stack:** Node.js 22.19+、npm Workspaces、TypeScript 6、Pi Coding Agent Extension API 0.84.x、Node `node:test`、GitHub Actions。

## Global Constraints

- 设计来源：`docs/planning/specs/2026-08-12-pi-extensions-monorepo-notify-design.md`。
- 根 `package.json` 必须保持 `private: true`，不得出现根级 `pi` manifest，不发布聚合包。
- 首期只有 `packages/notify`，不得创建 `example/`、`templates/`、空的 Skills/Prompts/Themes 目录或生成器。
- Notify 仅支持 macOS；始终发送；声音固定为 `Glass`；正文不主动截断。
- 自动通知只在 `agent_settled` 且 `ctx.isIdle()` 为真时尝试，每次 Agent 运行最多一次。
- 正文只能通过子进程参数数组传递，禁止 shell 字符串拼接。
- 自动通知失败不得影响 Pi；只有 `/notify-test` 向 Pi UI 报告 provider 或安全错误。
- 本阶段不得执行 `npm publish`、创建 GitHub Release、配置发布凭据、执行 `git push` 或修改无关项目的 `.pi/settings.json`。
- 当前现场已核验 Pi `0.84.1`，其类型包含 `agent_settled`、`message_end` 和 `ctx.isIdle()`；本机已发现 `/usr/local/bin/terminal-notifier` 2.0.0，但自动测试不得依赖该真实程序。
- 每个任务完成后以 `git status --short`、相关测试和 `git diff --check` 形成检查点；除非用户另行要求，不创建提交。

---

### Task 1: 建立 Workspace 与 Notify 包清单骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/notify/package.json`
- Modify: `.gitignore`
- Generate: `package-lock.json`

**Interfaces:**
- Consumes: npm Workspaces 的 `packages/*` 发现规则；Pi Package 的 `package.json#pi` manifest。
- Produces: 根级 `npm run typecheck|validate|test|check` 命令；独立包名 `@misterzhouzhou/pi-notify`；Node 22.19+ 运行约束。

- [x] **Step 1: 创建根 Workspace 清单**

写入根 `package.json`：

```json
{
  "name": "pi-extensions",
  "version": "0.0.0",
  "private": true,
  "description": "Independent Pi extension packages maintained in one workspace.",
  "license": "MIT",
  "engines": {
    "node": ">=22.19.0"
  },
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "validate": "node scripts/validate-packages.mjs",
    "test": "node --test test/*.test.mjs",
    "check": "npm run typecheck && npm run validate && npm test"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.1",
    "@types/node": "^22.19.0",
    "typescript": "^6.0.0"
  }
}
```

根包不添加 `pi`、`files` 或 `publishConfig`。

- [x] **Step 2: 创建严格、无产物的 TypeScript 配置**

写入 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["packages/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [x] **Step 3: 创建未来可发布但本轮不发布的 Notify 清单**

创建 `packages/notify/package.json`，字段与批准设计一致，并将 Node 要求精确到当前 Pi 的最低要求：

```json
{
  "name": "@misterzhouzhou/pi-notify",
  "version": "0.1.0",
  "description": "A macOS desktop notification extension for Pi.",
  "keywords": ["pi-package", "pi", "notification", "macos", "terminal"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/MisterZhouZhou/pi-extensions.git",
    "directory": "packages/notify"
  },
  "files": ["index.ts", "notifier.ts", "README.md"],
  "type": "module",
  "publishConfig": {
    "access": "public"
  },
  "pi": {
    "extensions": ["index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "engines": {
    "node": ">=22.19.0"
  }
}
```

此时入口和 README 尚未创建是有意的中间状态，Task 3 和 Task 5 会补齐；在此之前不运行清单校验。

- [x] **Step 4: 将远端 Python 模板 `.gitignore` 收敛为 Node/Pi 仓库规则**

保留通用的 macOS/编辑器忽略项，至少包含：

```gitignore
.DS_Store
node_modules/
*.tgz
.env
.env.*
!.env.example
coverage/
.nyc_output/
.pi/npm/
.pi/git/
```

不得忽略 `package-lock.json`、`packages/`、`docs/` 或项目级 `.pi/settings.json` 的潜在示例文件；本任务本身不创建 `.pi/settings.json`。

- [x] **Step 5: 安装依赖并生成锁文件**

Run: `npm install`

Expected: 生成根 `package-lock.json`；Workspace 中能识别 `@misterzhouzhou/pi-notify`；没有执行包发布。

Run: `npm ls --workspaces --depth=0`

Expected: 输出包含 `@misterzhouzhou/pi-notify@0.1.0`，并且根包标记为 private workspace。

- [x] **Step 6: 建立检查点**

Run: `git status --short && git diff --check`

Expected: 仅出现本任务文件以及已经批准的设计/计划文档；`git diff --check` 无输出。

---

### Task 2: 以测试先行实现 macOS 通知适配器

**Files:**
- Create: `packages/notify/notifier.ts`
- Create: `test/notify.test.mjs`

**Interfaces:**
- Consumes: `process.platform`、`process.env`、可执行文件权限检查和 Node `child_process.spawn()`。
- Produces: `NotificationRequest`、`NotificationResult`、`NotificationRuntime`、`resolveActivationBundleId()`、`buildTerminalNotifierArgs()`、`findTerminalNotifier()`、`sendNotification()`。

接口固定为：

```ts
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
  isExecutable(path: string): Promise<boolean>;
  run(file: string, args: readonly string[]): Promise<boolean>;
}

export function resolveActivationBundleId(termProgram: string | undefined): string | undefined;
export function buildTerminalNotifierArgs(request: NotificationRequest, bundleId?: string): string[];
export function findTerminalNotifier(runtime: NotificationRuntime): Promise<string | undefined>;
export function sendNotification(
  request: NotificationRequest,
  runtime?: NotificationRuntime,
): Promise<NotificationResult>;
```

- [x] **Step 1: 添加适配器的聚焦失败测试**

在 `test/notify.test.mjs` 使用 `node:test` 和 `node:assert/strict`，直接导入 `../packages/notify/notifier.ts`，覆盖以下完整行为矩阵：

```js
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

function runtime({
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
    "-title", request.title,
    "-subtitle", request.subtitle,
    "-message", request.message,
    "-sound", "Glass",
    "-group", request.group,
    "-activate", "com.mitchellh.ghostty",
  ]);
});

test("uses PI_NOTIFY_BIN first and continues after an invalid override", async () => {
  const preferred = runtime({
    env: { PI_NOTIFY_BIN: "/custom/notifier", PATH: "/bin:/usr/local/bin" },
    executable: ["/custom/notifier", "/usr/local/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(preferred.value), "/custom/notifier");

  const fallback = runtime({
    env: { PI_NOTIFY_BIN: "/missing/notifier", PATH: "/bin:/usr/local/bin" },
    executable: ["/usr/local/bin/terminal-notifier"],
  });
  assert.equal(await findTerminalNotifier(fallback.value), "/usr/local/bin/terminal-notifier");
});

test("falls back from terminal-notifier to osascript", async () => {
  const fake = runtime({
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
  assert.equal(fake.calls[1][1].at(-5), request.message);
});

test("does not invoke any sender outside macOS", async () => {
  const fake = runtime({ platform: "linux" });
  assert.deepEqual(await sendNotification(request, fake.value), {
    ok: false,
    provider: "unsupported",
    reason: "Pi Notify 仅支持 macOS",
  });
  assert.deepEqual(fake.calls, []);
});
```

在同一文件补充：PATH 缺失时检查两个 Homebrew 路径、`terminal-notifier` 成功时不调用 AppleScript、两者失败返回 `provider: "none"`、未知终端不添加 `-activate`、AppleScript 参数通过 `argv` 传入。

Run: `node --test test/notify.test.mjs`

Expected: 失败于 `ERR_MODULE_NOT_FOUND`，因为 `packages/notify/notifier.ts` 尚不存在。

- [x] **Step 2: 实现纯参数构造与终端映射**

在 `packages/notify/notifier.ts` 实现：

- `TERMINAL_BUNDLE_IDS` 常量；
- `resolveActivationBundleId()`；
- `buildTerminalNotifierArgs()`；
- AppleScript 固定源码字符串，其正文、标题、副标题、声音均从 `argv` 读取；
- `buildOsascriptArgs()` 可保持模块内私有，但测试通过 `runtime.run()` 捕获参数验证。

未知 `TERM_PROGRAM` 时必须完全省略 `-activate` 及其值。

- [x] **Step 3: 实现 notifier 查找顺序**

`findTerminalNotifier()` 构造并去重候选路径：

1. `runtime.env.PI_NOTIFY_BIN`；
2. 将 `runtime.env.PATH` 按 `path.delimiter` 拆分并追加 `terminal-notifier`；
3. `/opt/homebrew/bin/terminal-notifier`；
4. `/usr/local/bin/terminal-notifier`。

依次调用 `runtime.isExecutable()`；无效显式路径只被跳过，不回显到用户消息。

- [x] **Step 4: 实现默认 runtime 与发送回退**

默认 runtime：

- `platform: process.platform`；
- `env: process.env`；
- `isExecutable()` 使用 `fs.promises.access(path, constants.X_OK)`；
- `run()` 使用 `spawn(file, args, { shell: false, stdio: "ignore", windowsHide: true })`；
- 5 秒计时器到期时 kill 子进程并返回 `false`；
- `error`、非零退出码和超时都返回 `false`，不抛到调用者。

`sendNotification()`：

1. 非 Darwin 立即返回 unsupported；
2. 找到 notifier 后尝试一次；
3. 成功即返回 `terminal-notifier`；
4. 缺失或失败后检查并调用 `/usr/bin/osascript`；
5. 成功返回 `osascript`，否则返回 `{ ok:false, provider:"none", reason:"系统通知发送失败" }`。

- [x] **Step 5: 验证适配器**

Run: `node --test test/notify.test.mjs`

Expected: 所有 notifier 发现、参数、安全回退和非 macOS测试通过，且不会弹出真实系统通知。

Run: `npm run typecheck`

Expected: `notifier.ts` 在 strict 模式下无错误，无构建产物。

- [x] **Step 6: 建立检查点**

Run: `git status --short && git diff --check`

Expected: `notifier.ts` 和聚焦测试可独立审查，格式检查无输出。

---

### Task 3: 以测试先行实现 Pi 事件、正文提取、去重与 `/notify-test`

**Files:**
- Create: `packages/notify/index.ts`
- Modify: `test/notify.test.mjs`

**Interfaces:**
- Consumes: `ExtensionAPI.on("agent_start"|"message_end"|"agent_settled")`、`ExtensionAPI.registerCommand()`、`ExtensionContext.cwd`、`ExtensionContext.isIdle()`、`ExtensionCommandContext.ui.notify()`、`sendNotification()`。
- Produces: `extractAssistantText()`、`createNotifyRunState()`、`registerNotifyExtension()`、默认 Extension 导出和 `/notify-test` 命令。

接口固定为：

```ts
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotificationRequest, NotificationResult } from "./notifier.ts";

export type NotificationSender = (
  request: NotificationRequest,
) => Promise<NotificationResult>;

export function extractAssistantText(message: AgentMessage): string | undefined;

export interface NotifyRunState {
  start(): void;
  remember(message: AgentMessage): void;
  takeIfSettled(isIdle: boolean): string | undefined;
}

export function createNotifyRunState(): NotifyRunState;
export function registerNotifyExtension(pi: ExtensionAPI, sender?: NotificationSender): void;
export default function notifyExtension(pi: ExtensionAPI): void;
```

因为 `index.ts` 的导出类型直接引用 `AgentMessage`，在 `packages/notify/package.json` 增加：

```json
"peerDependencies": {
  "@earendil-works/pi-agent-core": "*",
  "@earendil-works/pi-coding-agent": "*"
}
```

根 `devDependencies` 同时增加与 Pi `0.84.1` 匹配的 `@earendil-works/pi-agent-core` 具体版本；不得将这些核心包放入子包 `dependencies`。

- [x] **Step 1: 添加正文提取和状态机失败测试**

向 `test/notify.test.mjs` 增加动态导入 `../packages/notify/index.ts`，并覆盖：

```js
test("extracts only assistant text blocks and preserves full length", async () => {
  const { extractAssistantText } = await import("../packages/notify/index.ts");
  const longText = "x".repeat(1000);
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private" },
      { type: "text", text: "第一段\n\n" },
      { type: "toolCall", id: "1", name: "read", arguments: {} },
      { type: "text", text: `第二段\t${longText}` },
    ],
  };
  const result = extractAssistantText(message);
  assert.equal(result, `第一段 第二段 ${longText}`);
  assert.equal(result.length > 1000, true);
});

test("returns undefined for non-assistant and textless messages", async () => {
  const { extractAssistantText } = await import("../packages/notify/index.ts");
  assert.equal(extractAssistantText({ role: "user", content: "hello" }), undefined);
  assert.equal(
    extractAssistantText({ role: "assistant", content: [{ type: "toolCall" }] }),
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
  state.remember({
    role: "assistant",
    content: [{ type: "text", text: " 完成\n 回复 " }],
  });
  assert.equal(state.takeIfSettled(true), "完成 回复");
});
```

Run: `node --test test/notify.test.mjs`

Expected: 新增用例失败于 `ERR_MODULE_NOT_FOUND`，因为 `packages/notify/index.ts` 尚不存在。

- [x] **Step 2: 实现助手文本提取和轮次状态机**

`extractAssistantText()`：

- 首先检查 `message.role === "assistant"`；
- 过滤 `content` 中 `type === "text"` 且 `text` 为 string 的块；
- 按顺序 join；
- 使用 `/\s+/gu` 压缩全部连续空白为一个空格并 trim；
- 空结果返回 `undefined`；
- 不做 slice、substring 或最大长度限制。

`createNotifyRunState()` 使用闭包维护 `started`、`handled` 和 `lastAssistantText`：

- `start()` 设置 `started=true`、`handled=false`、清空正文；
- `remember()` 仅在有效 assistant 文本存在时更新正文；
- `takeIfSettled(false)` 不消费；
- 未 start 或已经 handled 时返回 `undefined`；
- 第一次 `takeIfSettled(true)` 先设置 handled，再返回正文或固定回退文案。

- [x] **Step 3: 添加 Extension 注册与发送行为失败测试**

构造不依赖 Pi 进程的 fake API：

```js
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
```

新增测试必须断言：

- 注册 `agent_start`、`message_end`、`agent_settled`；
- 注册 `notify-test`；
- `agent_settled` 在 `ctx.isIdle() === false` 时不调用 sender；
- 同一轮两个 settled 只调用 sender 一次；
- 自动 sender reject 不让 handler reject；
- 自动请求标题、项目目录名、完整正文、`Glass` 和稳定 group 正确；
- `/notify-test` 每次都调用 sender，不改变自动状态；
- 手动成功 provider 分别显示 `terminal-notifier` 或 `osascript`；
- unsupported 和 none 使用 warning 并显示批准文案；
- sender reject 被转换为 `通知发送失败：系统通知发送失败`，不暴露原始堆栈。

Run: `node --test test/notify.test.mjs`

Expected: 注册行为用例失败，因为 `registerNotifyExtension()` 尚未实现或尚未注册对应事件和命令。

- [x] **Step 4: 实现 Extension 注册**

`registerNotifyExtension(pi, sender = sendNotification)`：

- `agent_start` 调用 `state.start()`；
- `message_end` 调用 `state.remember(event.message)`；
- `agent_settled` 获取 `state.takeIfSettled(ctx.isIdle())`；有正文时构造自动请求并 `await sender()`；整个发送用 `try/catch` 吞掉错误；
- `notify-test` 使用固定正文 `Pi 通知扩展运行正常`，调用 sender 并通过 `ctx.ui.notify()` 返回批准文案；
- 项目副标题使用 `basename(resolve(ctx.cwd))`，为空时回退到 resolve 后的路径，再回退 `Pi`；
- group 使用 Node `createHash("sha256")` 对绝对 cwd 生成固定前缀，例如 `pi-notify:${hash.slice(0, 16)}`；
- 自动通知和测试通知可共用构造函数，但测试 group 加 `:test`，避免覆盖完成通知；
- default export 只调用 `registerNotifyExtension(pi)`。

- [x] **Step 5: 验证 Extension 行为和真实 Pi 类型**

Run: `node --test test/notify.test.mjs`

Expected: 正文、去重、事件注册、自动静默失败和 `/notify-test` 结果测试全部通过。

Run: `npm run typecheck`

Expected: Pi 0.84.x 的 `message_end`、`agent_settled`、`ctx.isIdle()` 和 `ui.notify()` 类型全部通过；没有 `any` 强制绕过 Extension API。

- [x] **Step 6: 建立检查点**

Run: `git status --short && git diff --check`

Expected: Notify 核心实现和测试可独立审查，格式检查无输出。

---

### Task 4: 以测试先行实现统一 Package 清单校验

**Files:**
- Create: `scripts/validate-packages.mjs`
- Create: `test/package-manifests.test.mjs`

**Interfaces:**
- Consumes: 根和 `packages/*/package.json`、每个包的 `pi`/`files`/`peerDependencies`/`repository` 字段及文件系统。
- Produces: `discoverPackageDirectories(root)`、`validateRepository(root)` 和 CLI 非零退出状态；测试与 CLI 共用同一规则实现。

- [x] **Step 1: 添加失败的仓库清单测试**

创建 `test/package-manifests.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateRepository } from "../scripts/validate-packages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository package manifests satisfy Pi package policy", async () => {
  const errors = await validateRepository(repoRoot);
  assert.deepEqual(errors, []);
});
```

另用 `mkdtemp()` 创建最小 fixtures，分别断言以下错误能被精确识别：

- 根包不是 private；
- 根包含 `pi` manifest；
- 子包名不匹配 `@misterzhouzhou/pi-*`；
- 缺少 `pi-package` keyword；
- `repository.directory` 错误；
- manifest 资源不存在或逃逸子包目录；
- `files` 未包含运行时资源或 README；
- Pi 核心包被放入 `dependencies` 而不是 `peerDependencies`；
- 子包缺少 README；
- `pi` 未声明任何资源。

Run: `node --test test/package-manifests.test.mjs`

Expected: 失败于 `ERR_MODULE_NOT_FOUND`，因为 `scripts/validate-packages.mjs` 尚不存在。

- [x] **Step 2: 实现可复用校验函数**

在 `scripts/validate-packages.mjs`：

- 只读取根 `workspaces` 匹配到的 `packages/*` 直接子目录；
- JSON 解析失败转换为带相对路径的错误；
- 返回排序后的 `string[] errors`，不在纯函数内部 `process.exit()`；
- 允许的 Pi 资源键为 `extensions`、`skills`、`prompts`、`themes`；
- 资源路径用 `resolve()` 后验证仍位于子包根内；
- `files` 允许目录覆盖其内部资源；
- 核心包集合至少包括：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`；若被代码依赖，必须在 `peerDependencies`，不得在普通 `dependencies`。

- [x] **Step 3: 实现 CLI 入口**

当当前模块是 `process.argv[1]` 对应入口时：

- 无错误输出 `Validated 1 Pi package(s).`；
- 有错误逐行输出到 stderr，并设置 `process.exitCode = 1`；
- 不在被测试 import 时执行 CLI。

- [x] **Step 4: 验证校验规则**

Run: `node --test test/package-manifests.test.mjs`

Expected: 真实仓库与所有错误 fixture 测试通过。

Run: `npm run validate`

Expected: 输出 `Validated 1 Pi package(s).`，退出码 0。

Run: `npm test`

Expected: `notify.test.mjs` 与 `package-manifests.test.mjs` 全部通过。

- [x] **Step 5: 建立检查点**

Run: `git status --short && git diff --check`

Expected: 校验 CLI 与测试使用同一规则源；格式检查无输出。

---

### Task 5: 完成仓库文档、包文档、协作约束和 CI

**Files:**
- Modify: `README.md`
- Create: `packages/notify/README.md`
- Create: `AGENTS.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 已实现的 npm scripts、Pi 本地加载命令、Notify 实际行为和发布边界。
- Produces: 开发者入口文档、macOS/隐私说明、仓库长期约束和无发布权限的 CI。

- [x] **Step 1: 重写根 README**

根 `README.md` 必须包含：

- 仓库是独立 Pi Package monorepo，不是聚合包；
- 当前包表仅列 `@misterzhouzhou/pi-notify`，状态标记“本地验证中，尚未发布 npm”；
- `npm install`、`npm run check`、pack dry-run；
- `pi -e ./packages/notify` 与 `pi install -l ./packages/notify` 的差异；
- 不给出当前不可用的 `pi install npm:@misterzhouzhou/pi-notify` 作为可执行安装指令；可放在“发布后”说明中并明确尚不可用；
- 新包需独立 `package.json#pi`、README、`files` 白名单和 peer dependencies；
- Pi Package 具有用户完整系统权限，安装第三方包前需审查源码。

- [x] **Step 2: 编写 Notify README**

`packages/notify/README.md` 必须包含：

- macOS-only；监听 `agent_settled`；始终发送；
- 通知标题、副标题、完整助手正文和 `Glass`；
- `brew install terminal-notifier` 为推荐安装方式；
- 查找顺序 `PI_NOTIFY_BIN → PATH → 两个 Homebrew 路径 → osascript`；
- AppleScript 回退不能点击激活终端；
- `pi -e ./packages/notify`、`/notify-test` 和正常回复验收步骤；
- 完整回复可能被 macOS UI 折叠，且可能在锁屏泄露敏感回复内容；
- 当前尚未发布 npm；
- 故障排查区分“发送命令返回成功”和“系统横幅实际可见”。

- [x] **Step 3: 创建项目 `AGENTS.md`**

记录长期约束：

```markdown
# Repository Guidelines

- 所有响应使用中文。
- 根包必须保持 private，禁止添加根级 pi manifest 或聚合发布。
- 每个 packages/* 都是独立 Pi Package，资源必须显式写入自己的 package.json#pi。
- Pi 核心运行时依赖使用 peerDependencies 的 "*"，测试版本只放根 devDependencies。
- 修改子包后运行 npm run check 和对应 workspace 的 npm pack --dry-run。
- 未经用户明确要求，禁止 npm publish、GitHub Release 和 git push。
- 不提交密钥、通知正文样本中的敏感信息、.pi/npm 或 .pi/git 安装缓存。
```

- [x] **Step 4: 创建只做验证的 CI**

`.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      - name: Set up Node.js
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 22.20.0
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Check repository
        run: npm run check
      - name: Inspect notify package
        run: npm pack --workspace @misterzhouzhou/pi-notify --dry-run --json
```

CI 不声明 `id-token: write`、`packages: write` 或 npm token。

- [x] **Step 5: 验证文档与 CI 引用真实命令**

Run: `rg -n "npm publish|pi install npm:|example|templates" README.md packages/notify/README.md AGENTS.md .github/workflows/ci.yml`

Expected: 不存在误导性的当前发布指令；若 README 提到 npm 安装，只能明确标注“发布后”。不存在 `example` 或 `templates` 目录操作。

Run: `npm run validate && git diff --check`

Expected: README 已进入包的 `files` 白名单且存在；清单验证通过；格式检查无输出。

- [x] **Step 6: 建立检查点**

Run: `git status --short`

Expected: 文档、CI 和代码范围与批准设计一致；没有发布配置或凭据文件。

---

### Task 6: 运行全量自动验证与 tarball 审计

**Files:**
- Modify only if checks expose a defect: Task 1–5 对应文件
- Do not create: npm publish configuration、GitHub Release files、发布 token

**Interfaces:**
- Consumes: 根 `check` 命令和 `@misterzhouzhou/pi-notify` Workspace。
- Produces: 可重复的自动验证证据和精确 tarball 文件清单。

- [x] **Step 1: 运行完整检查**

Run: `npm run check`

Expected: TypeScript、`Validated 1 Pi package(s).`、全部 Node 测试依次通过，退出码 0。

- [x] **Step 2: 审计 npm tarball**

Run: `npm pack --workspace @misterzhouzhou/pi-notify --dry-run --json > /tmp/pi-notify-pack.json`

Expected: JSON 显示包名 `@misterzhouzhou/pi-notify`、版本 `0.1.0`，文件仅包括 npm 自动加入的 `package.json` 和白名单中的 `index.ts`、`notifier.ts`、`README.md`；不包含 `test/`、`scripts/`、`docs/`、`.memory/`、本地配置或密钥。

Run:

```bash
node -e '
const [result] = require("/tmp/pi-notify-pack.json");
const files = result.files.map((entry) => entry.path).sort();
console.log(files.join("\n"));
if (files.some((file) => /^(test|scripts|docs|\.memory|\.pi)\//.test(file))) process.exit(1);
'
```

Expected: 只打印批准的包文件，退出码 0。

- [x] **Step 3: 检查未批准范围**

Run: `find . -maxdepth 3 -type d \( -name example -o -name templates -o -name dist \) -print`

Expected: 无输出。

Run: `git diff --check && git status --short --branch`

Expected: 无空白错误；分支仍为 `main...origin/main`，所有改动均为本地未推送状态。

- [x] **Step 4: 记录自动验证证据**

在最终实施报告中记录测试总数、typecheck/validate 结果和 tarball 文件摘要；不要把临时 `/tmp/pi-notify-pack.json` 加入仓库。

---

### Task 7: 在真实 Pi 0.84.1 中进行本地手动验收

**Files:**
- No repository files expected
- Do not modify: `.pi/settings.json`（除非用户另行明确要求项目级持久安装）

**Interfaces:**
- Consumes: 本地 `pi` 0.84.1、`/usr/local/bin/terminal-notifier` 2.0.0、`packages/notify` 本地 Package。
- Produces: 临时加载、`/notify-test`、自动 `agent_settled` 通知和点击激活的人工证据。

- [x] **Step 1: 确认运行时来源**

Run: `command -v pi && pi --version && command -v terminal-notifier && terminal-notifier -version`

Expected: 明确记录本次实际使用的 Pi 和 notifier 路径/版本；不能仅凭依赖已安装推断当前会话已加载扩展。

- [x] **Step 2: 临时加载本地 Package**

Run: `pi -e ./packages/notify`

Expected: Pi 进入交互模式且没有 Extension 加载错误；无需写入全局或项目 settings。

- [ ] **Step 3: 执行手动测试命令**

在 Pi 中运行：

```text
/notify-test
```

Expected:

- macOS 出现标题为 `Pi · 通知测试` 的通知；
- Pi UI 显示 `测试通知已通过 terminal-notifier 发送`；
- 通知声音为 `Glass`；
- 当前 `TERM_PROGRAM` 可识别时，点击通知激活对应终端。

如果命令显示成功但横幅不可见，记录为系统通知权限/展示层待人工确认，不将其误判为扩展加载失败。

- [x] **Step 4: 验证自动完成通知正文和去重**

向该 Pi 会话发送一个要求返回唯一标识文本的简单提示，例如：

```text
请只回复：PI_NOTIFY_AUTO_TEST_20260812
```

Expected:

- Agent 完成并 settled 后出现一次 `Pi · 回复完成` 通知；
- 副标题是当前工作目录名 `pi-extensions`；
- 正文包含完整唯一标识 `PI_NOTIFY_AUTO_TEST_20260812`；
- 同一轮只出现一次自动完成通知。

- [x] **Step 5: 退出并核对没有持久安装副作用**

退出 Pi 后运行：

```bash
git status --short --branch
```

Expected: 没有新增 `.pi/settings.json`、`.pi/npm/` 或 `.pi/git/`；源码改动仍未发布、未推送。

- [x] **Step 6: 最终实施报告**

报告必须包含：

1. 修改文件列表；
2. `npm run check` 的结果和测试数量；
3. tarball 文件清单摘要；
4. `pi -e ./packages/notify` 是否成功；
5. `/notify-test` 实际 provider；
6. 自动通知是否可见、正文是否匹配、是否仅一次；
7. 点击激活是否实际验证；
8. 明确声明没有执行项目级持久安装、`npm publish`、GitHub Release 或 `git push`；若某项人工可见性无法由终端证明，必须如实标为待人工确认。
