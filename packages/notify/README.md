# @misterzhou/pi-notify

Pi 的 macOS 桌面通知扩展，可独立安装，也包含在 `@misterzhou/pi-extensions` 聚合包中。

```bash
pi install npm:@misterzhou/pi-notify
```

不要同时安装本包和 `@misterzhou/pi-extensions`，否则 Notify 可能被重复加载。

## 行为

- 仅支持 macOS；
- 监听 Pi 的 `agent_settled` 事件，在一次 Agent 运行真正空闲后发送一次通知；
- 不检测终端是否在前台，始终尝试发送；
- 标题固定为 `Pi · 回复完成`；
- 副标题为当前工作目录名称；
- 正文是最后一条助手消息中的完整文本内容，不主动截断；
- 声音固定为 macOS 的 `Glass`；
- 使用 `terminal-notifier` 时显示 Pi 官网图标；
- `/notify-test` 可发送独立测试通知，不会消费当前自动通知状态。

## 通知发送方式

推荐通过 Homebrew 安装 `terminal-notifier`：

```bash
brew install terminal-notifier
```

扩展按以下顺序查找并尝试发送：

1. 环境变量 `PI_NOTIFY_BIN` 指定的可执行文件；
2. `PATH` 中的 `terminal-notifier`；
3. `/opt/homebrew/bin/terminal-notifier`；
4. `/usr/local/bin/terminal-notifier`；
5. `/usr/bin/osascript`。

`terminal-notifier` 失败时会回退到 AppleScript。AppleScript 可以显示通知，但不支持本扩展通过点击通知激活终端，也不能使用扩展自带的 Pi 图标。

## 本地验证

从仓库根目录临时加载：

```bash
pi -e ./packages/notify
```

进入 Pi 后先运行：

```text
/notify-test
```

预期出现标题为 `Pi · 通知测试`、正文为 `Pi 通知扩展运行正常` 的系统通知，Pi UI 同时显示实际发送 provider。随后发送一条普通提示，等待回复完成；应只出现一次 `Pi · 回复完成` 通知，正文包含完整助手回复。

## 隐私与显示限制

完整助手回复会交给 macOS 通知系统。长正文可能被通知中心折叠，但扩展本身不会截断。通知也可能在锁屏上显示并泄露回复中的源码、路径、凭据或其他敏感信息；请根据设备使用环境调整 macOS 的通知和锁屏预览设置。

## 故障排查

“发送命令返回成功”和“系统横幅实际可见”是两个层次：

- `/notify-test` 报告 `terminal-notifier` 或 `osascript` 发送成功，表示发送进程正常退出；
- 没有看到横幅时，请检查 macOS 系统设置中的通知权限、专注模式和通知样式；
- 若 `terminal-notifier` 路径非标准，可用 `PI_NOTIFY_BIN` 指向正确的可执行文件；
- 若两个 provider 均失败，Pi UI 只显示安全错误，不暴露子进程错误或堆栈。
