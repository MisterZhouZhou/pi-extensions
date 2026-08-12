# Pi Extensions Monorepo 与 Notify 扩展设计

- 日期：2026-08-12
- 仓库：`https://github.com/MisterZhouZhou/pi-extensions`
- 本地路径：`/Users/cheyipai/Desktop/ai/pi-extensions`
- 状态：已批准，待实施计划

## 1. 目标

建立一个用于集中开发、测试和维护多个独立 Pi Package 的 npm Workspaces monorepo，并以 `@misterzhouzhou/pi-notify` 作为首个正式扩展包。

每个 `packages/*` 子包应具备独立的包名、版本、Pi manifest、README 和发布清单。根目录只承担仓库治理职责，不作为 Pi Package 发布，也不提供一键安装全部扩展的聚合包。

Notify 扩展仅支持 macOS：当 Pi 完成自动执行并等待用户输入时，将最后一条助手回复内容发送为系统通知；同时提供 `/notify-test` 命令用于手动验证通知链路。

本阶段必须完成本地测试和打包验证，但不得发布 npm 包、创建 GitHub Release 或推送远端。

## 2. 范围

### 2.1 本期范围

- 使用 npm Workspaces 管理 `packages/*`。
- npm scope 统一为 `@misterzhouzhou`。
- 根包设置为 `private`。
- 创建首个可独立发布但暂不发布的 `@misterzhouzhou/pi-notify`。
- Extension 采用直接 TypeScript 入口，不生成 `dist/`。
- 建立统一 TypeScript 类型检查、包清单验证和 Node 测试。
- 建立 GitHub Actions CI，但不建立发布工作流。
- 完成本地路径临时加载、手动测试命令和自动完成通知的验收。
- 通过 `npm pack --dry-run` 检查未来发布内容。

### 2.2 明确不做

- 不创建 `example` 包。
- 不创建 `templates/` 或包生成脚本。
- 不迁移 `/Users/cheyipai/Desktop/ai/Pi` 中现有扩展。
- 不发布根级聚合包。
- 不执行 `npm publish`。
- 不创建 GitHub Release。
- 不配置 npm Token 或 Trusted Publishing。
- 不推送 Git 远端。
- 不支持 Linux 或 Windows 通知。
- 不检测终端是否位于前台，始终发送完成通知。
- 不创建空的 `skills/`、`prompts/`、`themes/` 目录；未来按真实子包需要增加。
- 不提供用户配置文件、自定义声音、自定义标题、自定义图标或通知内容长度限制。
- 不实现 macOS 通知权限诊断器或系统设置跳转。

## 3. 设计依据

Pi Package 可以通过 `package.json` 中的 `pi` manifest 声明 Extensions、Skills、Prompts 和 Themes。Pi 支持从 npm、Git 和本地路径安装包；本地路径目录按 Package 规则加载。

Pi Extension 可以直接以 `.ts` 文件作为入口。Pi 核心包由运行时提供；被扩展直接导入的核心包应声明为 `peerDependencies`，而不是打包进发布产物。

Pi 的 `agent_end` 后仍可能发生自动重试、自动压缩重试或排队消息处理。完成通知应监听 `agent_settled`，因为该事件用于 Pi 不会继续自动执行、准备进入空闲状态的集成场景。

`terminal-notifier` 的查找、参数调用和 AppleScript 回退策略参考：

`/Users/cheyipai/Desktop/ai/agent-plugins/plugins/agent-notify/bin/agent-notify`

参考只限于经过确认的行为边界，不复制该插件针对 Claude Code、Codex、OpenCode Hooks 的 Python 架构、权限提醒状态、图标资源或 doctor 命令。

## 4. 仓库结构

```text
pi-extensions/
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   └── planning/
│       └── specs/
│           └── 2026-08-12-pi-extensions-monorepo-notify-design.md
├── packages/
│   └── notify/
│       ├── index.ts
│       ├── notifier.ts
│       ├── package.json
│       └── README.md
├── scripts/
│   └── validate-packages.mjs
├── test/
│   ├── notify.test.mjs
│   └── package-manifests.test.mjs
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── LICENSE
└── .gitignore
```

### 4.1 根目录职责

根目录负责：

- npm Workspace 依赖安装；
- 全仓 TypeScript 类型检查；
- 子包结构和 manifest 校验；
- 单元测试；
- CI；
- 仓库级开发、安装和验证文档。

根目录不得声明 `pi` manifest。根 `package.json` 必须包含：

```json
{
  "name": "pi-extensions",
  "private": true,
  "workspaces": ["packages/*"]
}
```

根级脚本至少提供：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "validate": "node scripts/validate-packages.mjs",
    "test": "node --test test/*.test.mjs",
    "check": "npm run typecheck && npm run validate && npm test"
  }
}
```

实际 `tsc` 参数可以统一放入 `tsconfig.json`，但 `npm run typecheck` 必须执行无产物的严格检查。

### 4.2 子包资源扩展方式

首包只包含 Extension。未来某个独立 Pi Package 需要组合资源时，可以在自己的包目录增加真实资源目录，并显式扩展 manifest：

```json
{
  "pi": {
    "extensions": ["index.ts"],
    "skills": ["skills"],
    "prompts": ["prompts"],
    "themes": ["themes"]
  }
}
```

仓库不预建空目录，也不在根级 manifest 聚合子包资源。

## 5. Notify 包设计

### 5.1 包清单

`packages/notify/package.json` 按未来公开发布要求配置：

```json
{
  "name": "@misterzhouzhou/pi-notify",
  "version": "0.1.0",
  "description": "A macOS desktop notification extension for Pi.",
  "keywords": [
    "pi-package",
    "pi",
    "notification",
    "macos",
    "terminal"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/MisterZhouZhou/pi-extensions.git",
    "directory": "packages/notify"
  },
  "files": [
    "index.ts",
    "notifier.ts",
    "README.md"
  ],
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
    "node": ">=22"
  }
}
```

如果实现中直接导入其他 Pi 核心包或 `typebox`，必须将相应包以 `"*"` 加入该子包的 `peerDependencies`。仅用于仓库类型检查和测试的具体版本放入根级 `devDependencies`。

### 5.2 `index.ts` 职责

`packages/notify/index.ts` 只负责 Pi 集成：

- 默认导出 Pi Extension 注册函数；
- 监听 Agent 和消息事件；
- 提取本轮最后一条 assistant 文本；
- 维护单轮去重状态；
- 在 `agent_settled` 时请求发送完成通知；
- 注册 `/notify-test`；
- 自动通知失败时不抛异常、不打断会话；
- 手动测试时使用 Pi UI 明确展示发送通道或失败原因。

该文件不自行拼接或执行 shell 命令，所有平台通知行为委托给 `notifier.ts`。

### 5.3 `notifier.ts` 职责

`packages/notify/notifier.ts` 只负责 macOS 通知适配：

- 检查当前平台；
- 查找 `terminal-notifier`；
- 推断点击通知后应激活的终端 Bundle ID；
- 使用参数数组调用 `terminal-notifier`；
- `terminal-notifier` 缺失或发送失败时回退至 AppleScript；
- 为子进程设置超时并禁止继承交互式标准输入；
- 将错误转换为安全、简短的结构化结果；
- 不依赖 Pi UI，不直接显示 TUI 消息。

结果类型应表达成功通道或失败类型，例如：

```ts
type NotificationResult =
  | {
      ok: true;
      provider: "terminal-notifier" | "osascript";
    }
  | {
      ok: false;
      provider: "unsupported" | "none";
      reason: string;
    };
```

精确字段可以在实施时调整，但调用方必须能区分：

- `terminal-notifier` 成功；
- AppleScript 回退成功；
- 非 macOS；
- 所有发送方式失败。

## 6. 通知事件与状态

### 6.1 数据流

```text
agent_start
    ↓
标记新一轮可通知状态

message_end (assistant)
    ↓
提取并保存最新助手文本

agent_settled
    ↓
确认当前轮次尚未通知
    ↓
发送完成通知
    ↓
无论成功或失败，标记该轮已处理，避免事件重复造成通知风暴
```

`agent_settled` 触发时，如果另一扩展立即启动了新的运行，应结合 Pi 提供的空闲状态能力避免对仍在执行的 Agent 发送完成通知。

### 6.2 去重原则

- 同一低层运行的重复 settled 事件最多产生一次通知尝试。
- 新的 `agent_start` 重新开放通知。
- 自动通知发送失败后不在同一轮内不断重试。
- 手动 `/notify-test` 不受自动通知去重状态影响，也不修改自动通知状态。

### 6.3 助手文本提取

只处理 role 为 `assistant` 的最终消息：

- 提取所有可展示文本内容块；
- 按原始顺序合并；
- 将换行、制表符及连续空白压缩为单个空格；
- 忽略工具调用、工具结果和不可展示内容；
- 扩展自身不截断正文；
- 如果不存在有效文本，使用 `当前回合已结束`。

完整文本会传给通知发送器。macOS 可能根据系统 UI 自行折叠或截断，扩展不保证横幅完整展示。

## 7. 通知内容

### 7.1 自动完成通知

```text
标题：Pi · 回复完成
副标题：当前项目目录名
正文：本轮最后一条助手回复文本
声音：Glass
分组：pi-notify:<当前项目绝对路径的稳定哈希>
```

项目目录名来自 Pi 当前上下文工作目录的最后一级；若无法得到名称，则使用绝对路径或 `Pi` 作为安全回退。

### 7.2 手动测试通知

`/notify-test` 立即发送：

```text
标题：Pi · 通知测试
副标题：当前项目目录名
正文：Pi 通知扩展运行正常
声音：Glass
```

命令完成后通过 Pi UI 展示以下结果之一：

- `测试通知已通过 terminal-notifier 发送`；
- `测试通知已通过 osascript 发送`；
- `当前平台不受支持，Pi Notify 仅支持 macOS`；
- `通知发送失败：<安全且简短的原因>`。

## 8. 发送链路

### 8.1 `terminal-notifier` 查找顺序

```text
PI_NOTIFY_BIN
→ PATH 中的 terminal-notifier
→ /opt/homebrew/bin/terminal-notifier
→ /usr/local/bin/terminal-notifier
→ AppleScript 回退
```

`PI_NOTIFY_BIN` 仅是高级可执行文件覆盖入口，不引入独立配置文件。若该值不存在或不可执行，应继续查找其他位置，而不是终止整个发送链路。

### 8.2 `terminal-notifier` 参数

使用 Node 子进程 API 的可执行文件与参数数组，不通过 shell 字符串拼接：

```text
-title <标题>
-subtitle <项目名>
-message <正文>
-sound Glass
-group <分组键>
-activate <终端 Bundle ID，能识别时才添加>
```

正文即使包含引号、换行、反引号或 shell 元字符，也只能作为单个参数传递，不能产生命令注入。

### 8.3 点击激活映射

根据 `TERM_PROGRAM` 支持：

| TERM_PROGRAM | Bundle ID |
| --- | --- |
| `Apple_Terminal` | `com.apple.Terminal` |
| `iTerm.app` / `iTerm2` | `com.googlecode.iterm2` |
| `ghostty` | `com.mitchellh.ghostty` |
| `vscode` | `com.microsoft.VSCode` |
| `WarpTerminal` | `dev.warp.Warp-Stable` |
| `cursor` | `com.todesktop.230313mzl4w4u92` |

无法识别时省略 `-activate`，仍然发送通知。

### 8.4 AppleScript 回退

`terminal-notifier` 不存在或执行失败时，使用 `/usr/bin/osascript` 的 `display notification`：

- 包含正文、标题、副标题与 `Glass` 声音；
- 参数通过 `argv` 传入，而不是把正文插入 AppleScript 源码；
- 不提供点击后激活终端能力；
- `osascript` 也失败时返回结构化失败结果。

### 8.5 非阻塞原则

- 通知子进程必须设置有限超时；
- 禁止读取交互式 stdin；
- 自动通知不向 Agent 上下文注入错误消息；
- 自动通知失败不得导致 Pi 回合失败；
- `/notify-test` 可以在 Pi UI 中报告错误，但错误内容不得暴露环境变量值或无关系统信息。

## 9. 包校验与测试

### 9.1 `scripts/validate-packages.mjs`

校验每个 `packages/*/package.json`：

- 包名匹配 `@misterzhouzhou/pi-*`；
- 包含 `pi-package` keyword；
- 包含合法版本、描述、许可证和仓库信息；
- `repository.directory` 与实际子包路径一致；
- `pi` manifest 至少声明一种真实资源；
- manifest 中的路径存在且位于子包目录内；
- README 存在；
- `files` 白名单包含所有运行时资源与 README；
- Pi 核心依赖不得错误放入普通 `dependencies`；
- 根包保持 `private: true` 且不含根级 `pi` manifest。

### 9.2 `test/notify.test.mjs`

至少覆盖：

- assistant 单文本块提取；
- 多文本块按序合并；
- 换行和连续空白压缩；
- 工具调用和非文本块不进入正文；
- 长文本不被扩展截断；
- 空内容使用默认正文；
- `PI_NOTIFY_BIN`、PATH 与 Homebrew 路径的查找顺序；
- 无效 `PI_NOTIFY_BIN` 不阻止后续发现；
- 六类终端 Bundle ID 映射和未知终端行为；
- 参数以数组形式传递，特殊字符不进入 shell；
- `terminal-notifier` 成功时不调用 AppleScript；
- `terminal-notifier` 失败时回退 AppleScript；
- 两种方式都失败时返回安全失败结果；
- 非 macOS 返回 unsupported；
- 相同 Agent 轮次不会重复自动通知；
- `/notify-test` 不污染自动通知去重状态。

为了让这些测试不依赖真实弹窗，应通过小型依赖注入边界替换平台、环境、文件可执行性检查和子进程执行函数。生产默认值仍使用 Node 标准库。

### 9.3 `test/package-manifests.test.mjs`

对包发现和基本清单规则建立 Node 测试，与验证脚本保持单一规则来源，避免脚本与测试各自复制并逐渐漂移。可以让验证脚本导出纯函数，再由测试和 CLI 入口共同调用。

## 10. CI

`.github/workflows/ci.yml` 在 push 和 pull request 上运行：

```text
checkout
→ setup-node（Node 22）
→ npm ci
→ npm run check
→ npm pack --workspace @misterzhouzhou/pi-notify --dry-run
```

CI 不需要 npm 发布权限，不持有 npm Token，不创建 Release。

第三方 GitHub Actions 应固定到明确主版本；若仓库采用固定 commit SHA 的安全策略，实施时统一固定并保留版本注释。

## 11. 本地安装和验证

### 11.1 自动检查

```bash
npm install
npm run check
npm pack --workspace @misterzhouzhou/pi-notify --dry-run
```

`npm pack --dry-run` 必须证明 tarball 只包含清单允许的运行时文件和 README，不包含测试、仓库脚本或本地配置。

### 11.2 临时加载

从仓库根目录运行：

```bash
pi -e ./packages/notify
```

进入 Pi 后执行：

```text
/notify-test
```

验收可见系统通知及 Pi UI 中的实际 provider 结果。

随后让 Pi 正常完成一个包含可辨识文本的回复，验收 `agent_settled` 自动通知正文与最后一条助手回复一致。

### 11.3 项目级持久安装

需要验证项目设置写入时运行：

```bash
pi install -l ./packages/notify
```

之后检查目标项目 `.pi/settings.json` 中的 package source，并用 `pi list` 或实际加载确认安装状态。源码目录存在、settings 中出现、包已安装和当前 Pi 会话已加载是四个不同状态，必须分别核验。

持久安装验证完成后是否保留该项目设置，由执行时明确记录；不得静默修改无关项目配置。

## 12. 文档

根 `README.md` 应包含：

- 仓库定位；
- 当前 Packages 清单；
- 工作区开发命令；
- 创建新包时需遵守的结构约定；
- 本地临时加载、项目安装和未来 npm 安装的差异；
- 安全提醒：Pi Extensions 以用户权限运行任意代码，安装第三方包前应审查源码；
- 当前未发布状态，不给出误导性的可用 npm 安装命令。

`packages/notify/README.md` 应包含：

- 功能和 macOS-only 范围；
- `terminal-notifier` 推荐安装方式；
- AppleScript 回退及其缺少点击激活能力的差异；
- 本地路径测试命令；
- `/notify-test` 使用方式；
- 自动通知触发点；
- 完整助手内容可能被 macOS UI 折叠，以及可能在锁屏泄露回复内容的隐私提醒；
- `PI_NOTIFY_BIN` 覆盖方式；
- 当前尚未发布到 npm 的状态。

`AGENTS.md` 应记录仓库的长期开发约束：根包不发布、子包独立 manifest、Pi 核心依赖使用 peer dependency、禁止未经明确请求发布、修改子包后运行集中检查和 pack dry-run。

## 13. 错误处理与安全

- 第三方 Pi Package 具有用户级完整系统权限，README 必须明确提醒审查源码。
- 通知内容包含完整助手回复，可能包含敏感信息并显示在锁屏；必须在 Notify README 明示。
- 不通过 shell 执行正文。
- AppleScript 正文通过位置参数传入，避免脚本注入。
- 子进程设置超时，异常转为结果，不向上抛到 Pi 主流程。
- 自动通知不重试，避免通知风暴。
- 环境变量仅用于查找可执行文件，错误信息不回显潜在敏感值。
- 本期不探测私有 macOS 通知偏好数据，也不自动打开系统设置。

## 14. 验收标准

### 14.1 仓库

- [ ] 仓库由 npm Workspaces 管理，根包 `private: true`。
- [ ] 根包没有 `pi` manifest，不可作为聚合 Pi Package 发布。
- [ ] 只有 `packages/notify` 一个正式子包，不存在 `example` 和 `templates/`。
- [ ] `@misterzhouzhou/pi-notify` 清单可供未来独立公开发布。
- [ ] README、AGENTS.md、CI、类型检查、验证脚本和测试齐全。

### 14.2 Notify 功能

- [ ] macOS 上优先使用 `terminal-notifier`。
- [ ] 缺失或失败时回退 `osascript`。
- [ ] 非 macOS 明确返回 unsupported，且不影响 Pi。
- [ ] 自动通知由 `agent_settled` 触发。
- [ ] 通知正文来自最后一条 assistant 文本，不包含工具调用或工具结果。
- [ ] 正文空白被压缩，但扩展不主动截断。
- [ ] 通知使用 `Glass` 声音并始终发送，不做前台抑制。
- [ ] 已知终端可通过 `-activate` 激活，未知终端仍能发送。
- [ ] 同一轮不会重复自动通知。
- [ ] `/notify-test` 能显示实际 provider 或安全失败原因。

### 14.3 自动验证

- [ ] `npm install` 成功。
- [ ] `npm run check` 成功。
- [ ] `npm pack --workspace @misterzhouzhou/pi-notify --dry-run` 成功且内容正确。
- [ ] CI 运行与本地检查一致。

### 14.4 手动验证

- [ ] `pi -e ./packages/notify` 可以加载扩展。
- [ ] `/notify-test` 可以看到系统通知，并报告实际发送通道。
- [ ] 一次正常 Pi 回复完成后只出现一次自动通知。
- [ ] 自动通知正文与最后助手回复的文本一致。
- [ ] 点击 `terminal-notifier` 通知能激活受支持的当前终端；使用 AppleScript 回退时明确不要求该能力。

### 14.5 发布边界

- [ ] 本阶段未执行 `npm publish`。
- [ ] 本阶段未创建 GitHub Release。
- [ ] 本阶段未配置发布密钥或 Trusted Publishing。
- [ ] 本阶段未推送远端。

## 15. 实施结束时的证据

实施报告必须分别记录：

1. 修改文件列表；
2. `npm run check` 结果；
3. `npm pack --dry-run` 的文件清单摘要；
4. Pi 临时加载结果；
5. `/notify-test` 实际使用的 provider；
6. 自动完成通知是否可见、正文是否匹配；
7. 是否执行过项目级安装，以及写入了哪个 `.pi/settings.json`；
8. 明确声明 npm 发布、GitHub Release 和 Git push 均未执行。
