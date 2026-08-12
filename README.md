# Pi Extensions

用于维护和发布 [Pi](https://pi.dev/) 扩展的 npm Workspaces monorepo。你可以安装包含全部扩展的聚合包，也可以只安装单个扩展。

## 安装

整体安装（当前包含 Notify）：

```bash
pi install npm:@misterzhouzhou/pi-extensions
```

仅安装 Notify：

```bash
pi install npm:@misterzhouzhou/pi-notify
```

> 不要同时安装 `@misterzhouzhou/pi-extensions` 和 `@misterzhouzhou/pi-notify`，否则 Notify 可能被重复加载。切换安装方式前请先用 `pi uninstall npm:<包名>` 卸载原包。

## Packages

| Package | 目录 | 用途 |
|---|---|---|
| `@misterzhouzhou/pi-extensions` | 仓库根目录 | 聚合安装仓库内全部扩展 |
| `@misterzhouzhou/pi-notify` | [`packages/notify`](packages/notify) | macOS 回复完成通知 |

## 本地开发与验证

需要 Node.js 22.19.0 或更高版本：

```bash
npm install
npm run check
npm pack --dry-run --json
npm pack --workspace @misterzhouzhou/pi-notify --dry-run --json
```

临时加载 Notify，不写入 Pi 安装配置：

```bash
pi -e ./packages/notify
```

## 发布流程

正式发布仅允许通过 GitHub Actions 和 npm Trusted Publishing/OIDC 完成，不使用长期 `NPM_TOKEN`：

1. 为 `@misterzhouzhou/pi-extensions`、`@misterzhouzhou/pi-notify` 配置 Trusted Publisher：仓库 `MisterZhouZhou/pi-extensions`，工作流 `publish.yml`，environment `npm-release`。
2. 执行 `npm run prepare-release -- vX.Y.Z` 预览，再执行 `npm run prepare-release -- vX.Y.Z --write` 写入版本和发布文档。
3. 运行 `npm run check` 和两种 `npm pack --dry-run --json`，审核并提交改动。
4. 创建并推送 `vX.Y.Z` tag，以 `docs/github-release-vX.Y.Z.md` 作为 GitHub Release 正文。
5. 在 `main` 分支手动触发 **Publish npm release**，两项输入都填写相同的 `vX.Y.Z`，并审批 `npm-release` environment。

本机只允许：

```bash
npm run publish-release -- vX.Y.Z --dry-run
```

脚本会检查 tag、`origin/main`、GitHub Release 正文和 tarball；缺少任一发布前置条件都会安全失败。本机禁止真实 `npm publish`。

## 新增 Package

每个 `packages/*` 子目录必须独立可发布：拥有自己的 `package.json#pi`、README 和 `files` 白名单；Pi 核心运行时依赖以 `"*"` 放在 `peerDependencies`。新增资源时还要显式加入根 `package.json#pi` 和根 `files`。

## 安全说明

Pi Package 与 Pi 进程拥有相同系统权限。安装第三方 Package 前，请审查源码、依赖、生命周期脚本和声明资源。
