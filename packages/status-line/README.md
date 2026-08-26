# @misterzhou/pi-status-line

Pi 的中文状态栏扩展，基于 `token-stats` 的核心统计能力，显示当前会话的累计输入 Token、累计输出 Token、累计总 Token、思考模式、上下文占比和上下文窗口大小。

## 安装

```bash
pi install npm:@misterzhou/pi-status-line
```

本扩展已包含在 `@misterzhou/pi-extensions` 聚合包中。不要同时安装独立包和聚合包，否则扩展可能被重复加载。

## 状态栏内容

```text
输入：1.2k 输出：820 总计：2.0k | 思考：中 | 上下文：12.5%/128k
```

状态栏第二行继续显示当前工作目录、Git 分支以及其他扩展通过 Pi 注册的状态。

## `/status` 配置

在 Pi 中输入 `/status`，会打开与 `token-stats` 类似的持久多选菜单：方向键移动，Enter 勾选/取消，Ctrl+S 保存，Esc 取消。勾选过程中只刷新菜单本身，不会反复重建界面或刷新底部状态栏。也支持直接使用命令：

```text
/status on tokens
/status off context-window
/status on model
/status show
/status reset
```

可配置项目：

- `tokens`：输入、输出、总计 Token；
- `thinking`：思考模式；
- `context`：上下文占比；
- `context-window`：上下文窗口大小；
- `model`：第一行右侧的 provider 和模型名称；
- `cwd`：工作目录；
- `git`：Git 分支；
- `extensions`：其他扩展状态。

配置会写入当前会话，恢复该会话后自动保留。`/status reset` 恢复全部显示。

- 输入、输出和总计是当前会话分支中已完成助手消息的累计 Token；
- 思考显示当前会话的思考模式；
- 上下文显示 Pi 当前报告的上下文占比和窗口大小，格式为 `占比/窗口大小`；
- 会话切换、恢复、分支或重新加载后，累计数据会从当前会话历史重建；
- 上下文占比暂时不可用时显示 `--`，窗口大小仍会尽量从当前模型读取；
- 上下文占比和上下文窗口可通过 `/status` 独立控制。

## 本地验证

从仓库根目录临时加载：

```bash
pi --no-extensions -e ./packages/status-line --no-session
```

发送几轮消息后，底部状态栏应显示中文 Token 累计、思考模式和上下文占比。
