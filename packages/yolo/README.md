# Pi YOLO

`@misterzhou/pi-yolo` 为 Pi 提供 SAFE/YOLO 两种确认模式。它是扩展层策略，不是操作系统 sandbox，也不会改变 Pi 本身的系统权限。

## 使用

```bash
pi install npm:@misterzhou/pi-yolo
pi --yolo
```

- `/yolo` 在 SAFE 与 YOLO 之间切换
- `/yolo on`、`/yolo off`、`/yolo status` 分别开启、关闭和查看状态
- `Alt+Y` 切换模式，并替换 Pi 默认的 yank-pop 快捷键
- 底部状态栏持续显示 `SAFE` 或 `YOLO`

SAFE 下，文件写入和有副作用的 Bash 会请求确认；没有可用 UI 时会拒绝。只读工具和只读 Bash 直接允许，灾难级 Bash 始终阻断。YOLO 只跳过本扩展及 Subagent 的普通确认，不会放行灾难级 Bash，不控制 `user_bash`，也不能替第三方扩展自动确认。

项目 `.pi` 资源的信任是另一层门禁。`--approve`（如其他 Pi 流程提供）只代表信任项目资源，不代表批准文件写入或 Bash。

## 独立加载

```bash
pi --no-extensions -e ./packages/yolo --no-session
```

不要同时安装 `@misterzhou/pi-extensions` 和本包，否则 YOLO 会被重复加载。
