# Pi Permissions

`@misterzhou/pi-permissions` 为 Pi 提供独立的工具权限策略，不包含 ask、plan、build 等工作流。

## 安装

```bash
pi install npm:@misterzhou/pi-permissions
```

独立隔离加载：

```bash
pi --no-extensions -e ./packages/permissions --no-session
```

## 权限模式

| 模式 | 行为 |
|---|---|
| `readonly` | 允许读取和只读 Bash；阻止写入、修改型 Bash 和其他工具 |
| `manual` | 允许完整工具；写入和有副作用的 Bash 需要用户确认 |
| `yolo` | 自动允许普通操作；灾难性 Bash 永远阻止 |

`manual`、`yolo` 在没有可用 UI 时，对需要确认的调用会失败闭合（阻止），不会静默放行。

## 使用

```text
/permissions
/permissions readonly
/permissions manual
/permissions yolo
/permissions status
```

`Shift+Tab` 按 `readonly -> manual -> yolo -> readonly` 循环切换，并替换 Pi 默认的思考级别切换快捷键。

也可以启动时指定：

```bash
pi --permissions readonly
pi --permissions manual
pi --permissions yolo
```

模式和当前 session branch 绑定，会在恢复 session 和切换树分支时恢复。

## 安全边界

这是 Pi Extension 层的 tool-call 策略，不是操作系统 sandbox。它只控制模型通过 Pi 工具发起的调用，不控制用户自己的 shell 命令、恶意进程或其他未接入该策略的扩展。

即使在 `yolo` 下，也会阻止明显的灾难性 Bash，例如根目录递归删除、磁盘格式化、向设备写入、关机、重启、强制 Git 操作等。安装或使用时仍应使用容器、虚拟机或其他 OS 级隔离保护不受信任的代码。

该插件是当前仓库唯一的权限控制包，提供 `readonly`、`manual` 和 `yolo` 三种模式。
