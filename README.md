# Pi Extensions

用于维护和发布 [Pi](https://pi.dev/) 扩展的 npm Workspaces monorepo。你可以安装包含全部扩展的聚合包，也可以只安装单个扩展。

## 安装

整体安装（当前包含 Notify）：

```bash
pi install npm:@misterzhou/pi-extensions
```

仅安装 Notify：

```bash
pi install npm:@misterzhou/pi-notify
```

> 不要同时安装 `@misterzhou/pi-extensions` 和 `@misterzhou/pi-notify`，否则 Notify 可能被重复加载。切换安装方式前请先用 `pi uninstall npm:<包名>` 卸载原包。

## Packages

| Package | 目录 | 用途 |
|---|---|---|
| `@misterzhou/pi-extensions` | 仓库根目录 | 聚合安装仓库内全部扩展 |
| `@misterzhou/pi-notify` | [`packages/notify`](packages/notify) | macOS 回复完成通知 |

## 本地开发与验证

需要 Node.js 22.19.0 或更高版本：

```bash
npm install
npm run check
npm pack --dry-run --json
npm pack --workspace @misterzhou/pi-notify --dry-run --json
```

临时加载 Notify，不写入 Pi 安装配置：

```bash
pi -e ./packages/notify
```

## 发布流程

根聚合包 `@misterzhou/pi-extensions` 与独立包 `@misterzhou/pi-notify` 分别维护版本。发布相关命令分为四个职责明确的入口。

### 1. 检查当前发布状态：`release-check`

```bash
npm run release-check
```

该命令只读取所有 package 的当前版本并查询 npm，输出每个版本是 `published` 还是 `pending`。它不会修改 manifest、lockfile，不会打包、发布或操作 Git。

### 2. 本机直接发布 npm：`release-local`

```bash
# 交互选择发布包和版本更新类型
npm run release-local

# 指定包后交互选择版本更新类型
npm run release-local -- notify
npm run release-local -- root

# AI/脚本：指定单包和精确目标版本
npm run release-local -- notify 0.1.1
npm run release-local -- root 0.1.1
```

不带版本号时，命令会显示 `patch`、`minor`、`major` 和自定义版本号菜单，并根据当前版本显示前三项的目标版本。显式传入版本号会跳过版本菜单，但两种方式都要求交互式终端，并在发布摘要后输入 `y` 确认。每次只发布一个包，不支持 `all`。

`release-local` 会修改所选包版本、同步 lockfile、运行检查和打包、查询 npm，并使用本机已有的 `npm login` 身份发布。publish 开始前取消或失败会逐字节恢复版本文件；publish 开始后不会自动回滚。该命令不会 commit、tag 或 push。

若 npm 明确返回 `EOTP`，命令会提示输入 6 位 OTP 并自动重试。错误包含 `Two-factor authentication or granular access token with bypass 2fa enabled is required` 时不是 OTP 请求：需要先开启 npm 账号 2FA，或改用开启 `Bypass 2FA` 的 granular access token。若 publish 状态未知且 npm 确认版本不存在，先提交脚本保留的版本文件，再显式传入当前版本恢复发布，例如 `npm run release-local -- notify 0.1.1`；不要选择新的 patch 版本。

### 3. 通过 GitHub Actions 发布：`release-github`

```bash
# 只发布独立 Notify 包
npm run release-github -- notify

# 只发布根聚合包
npm run release-github -- root

# 同一 release commit 为两个包分别创建 tag
npm run release-github -- all
```

版本一律由脚本交互询问，因此不要附加版本号或 `--all`、`--notify-version` 等组合参数。脚本要求：当前分支为 `main`、整个工作区（包括 untracked）干净、存在 `origin`。它先 `fetch`；本地仅落后时执行 `pull --ff-only`，本地领先或与远端分叉时停止，不会 merge、rebase 或 force push。

确认后，脚本只提交目标 manifest 与根 `package-lock.json`，创建包级 tag，并用一次原子 Git push 推送 `main` 和 tag：

```bash
git push --atomic origin main pi-notify@0.1.1
git push --atomic origin main pi-notify@0.1.1 pi-extensions@0.1.1
```

Git refs 的 push 是原子的；但 `all` 触发的两个 Actions job 和两个 npm publish **不是原子事务**，仍可能一个成功、另一个失败。Notify 源码更新通常应选择 `all`，这样独立安装用户和聚合包用户都能获得新版本。

release commit 之前失败或取消会恢复脚本改动；commit 创建之后的 tag/push 失败不会 reset 或删除本地 commit/tag，脚本会输出可重试的 `git push --atomic ...` 命令。

### 4. Actions 内部执行器：`publish-release`

`publish-release` 不是维护者在本机使用的发布入口。`.github/workflows/publish.yml` 收到 package tag 或手动 dispatch 后，在受信任的 GitHub Actions/OIDC 环境中调用：

```bash
npm run publish-release -- notify --github-actions
npm run publish-release -- root --github-actions
```

它负责验证 Actions 仓库、workflow、environment、selector 与 tag/manifest 版本，随后运行 `npm run check`、打包、查询 registry 并执行真正的 `npm publish`。tag 只是触发信号，`publish-release` 才是 Actions 内实际发布 npm 包的程序。本机调用或 `--dry-run` 会被拒绝。

也可以从 GitHub Actions 的 **Publish npm package** 页面选择 `root` 或 `notify`，从 `main` 手动发布当前 manifest 版本。首次使用前，需分别为两个 npm 包配置 Trusted Publisher：仓库 `MisterZhouZhou/pi-extensions`、工作流 `publish.yml`、environment `npm-release`；无需长期 `NPM_TOKEN`。

## 新增 Package

每个 `packages/*` 子目录必须独立可发布：拥有自己的 `package.json#pi`、README 和 `files` 白名单；Pi 核心运行时依赖以 `"*"` 放在 `peerDependencies`。新增资源时还要显式加入根 `package.json#pi` 和根 `files`。

## 安全说明

Pi Package 与 Pi 进程拥有相同系统权限。安装第三方 Package 前，请审查源码、依赖、生命周期脚本和声明资源。
