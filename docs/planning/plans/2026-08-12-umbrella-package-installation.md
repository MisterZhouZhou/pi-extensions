# Umbrella Package Installation Implementation Plan

**Goal:** 将根包改为可公开发布的 `@misterzhouzhou/pi-extensions` 聚合 Pi Package，同时保留 `@misterzhouzhou/pi-notify` 的独立安装与发布能力。

**Architecture:** 根包直接通过 `package.json#pi.extensions` 声明 `./packages/notify/index.ts`，并把 `packages/notify` 纳入根 tarball；子包继续保留自己的 manifest 和 tarball。根包不代理或依赖已发布子包，避免安装顺序和 `node_modules` 布局耦合。

**Tech Stack:** npm Workspaces、Pi Package manifest、TypeScript、Node.js test runner、npm pack。

## Global Constraints

- 根包和子包均使用独立名称与版本 `0.1.0`，分别可发布。
- 根包只聚合本仓库扩展，不新增代理入口文件。
- 不允许同时安装聚合包与其已包含的独立包，README 必须说明重复加载风险。
- Pi 核心运行时依赖只放 `peerDependencies` 且版本为 `"*"`。
- 本任务不执行 `npm publish`、GitHub Release、Git Tag 或 `git push`。
- 本机只允许发布 dry-run；真实发布必须通过 GitHub Actions + npm Trusted Publishing/OIDC。

---

### Task 1: 将仓库校验规则改为支持公开聚合根包

**Files:**
- Modify: `test/package-manifests.test.mjs`
- Modify: `scripts/validate-packages.mjs`

**Interfaces:**
- Consumes: `validateRepository(root): Promise<string[]>`、根 `package.json`、`packages/*/package.json`
- Produces: 对根聚合 manifest、根 Pi 资源、根 files 白名单及子包 manifest 的统一校验

- [ ] **Step 1: 添加聚合根包失败测试**

将“根包必须 private 且不得声明 pi”的测试替换为以下约束：根包名称必须为 scoped package、不得为 private、必须含 `pi.extensions`、每个根资源必须存在且被根 `files` 覆盖；保留 `workspaces` 必须包含 `packages/*` 的断言。

Run: `node --test test/package-manifests.test.mjs`
Expected: 失败，错误仍显示根包必须 private 或不得声明 `pi`。

- [ ] **Step 2: 实现根聚合 manifest 校验**

重构 `validateRepository()`：保留 workspace 发现和子包 `validatePackage()`；新增根包公开性、名称、关键词、README、`pi` 资源存在性/包内路径/`files` 覆盖、核心 peer dependency 的检查。不要把根目录递归当作普通子包扫描。

- [ ] **Step 3: 验证校验器测试**

Run: `node --test test/package-manifests.test.mjs`
Expected: 所有 manifest policy 测试通过。

---

### Task 2: 把根清单改为 umbrella Pi Package

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 根 npm workspace manifest、子扩展入口 `packages/notify/index.ts`
- Produces: `@misterzhouzhou/pi-extensions@0.1.0`，其 `pi.extensions` 包含 `./packages/notify/index.ts`

- [ ] **Step 1: 修改根 package.json**

精确设置：

```json
{
  "name": "@misterzhouzhou/pi-extensions",
  "version": "0.1.0",
  "description": "A collection of Pi extensions maintained by MisterZhouZhou.",
  "keywords": ["pi-package", "pi", "terminal", "agent"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/MisterZhouZhou/pi-extensions.git"
  },
  "files": ["packages/notify", "README.md", "LICENSE"],
  "workspaces": ["packages/*"],
  "publishConfig": { "access": "public" },
  "peerDependencies": {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "pi": {
    "extensions": ["./packages/notify/index.ts"]
  }
}
```

保留现有 scripts、devDependencies 和 engines；删除 `private`。

- [ ] **Step 2: 同步 lockfile**

Run: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`
Expected: 根 lock entry 名称/版本更新为 `@misterzhouzhou/pi-extensions@0.1.0`，workspace 子包保持 `@misterzhouzhou/pi-notify@0.1.0`。

- [ ] **Step 3: 更新仓库规则**

将 `AGENTS.md` 的“根包必须保持 private”改为：根包是可发布 umbrella package；根 `pi.extensions` 必须显式列出聚合资源；每个子包仍须独立可发布；禁止同时安装聚合包与重复子包。

- [ ] **Step 4: 验证 manifest**

Run: `npm run validate && npm run typecheck`
Expected: 校验通过并输出 `Validated 1 standalone Pi package(s) plus umbrella package.` 或语义等价结果；TypeScript 无错误。

---

### Task 3: 文档化整体安装与单独安装

**Files:**
- Modify: `README.md`
- Modify: `packages/notify/README.md`

**Interfaces:**
- Consumes: npm 包名 `@misterzhouzhou/pi-extensions`、`@misterzhouzhou/pi-notify`
- Produces: 两种安装命令、包含关系和卸载/避免重复安装说明

- [ ] **Step 1: 更新根 README**

把“根包仅开发工具、不会发布”改为 umbrella 说明，并加入：

```bash
pi install npm:@misterzhouzhou/pi-extensions
pi install npm:@misterzhouzhou/pi-notify
```

明确当前聚合包包含 notify；两者二选一，不能同时安装；本地整体加载使用 `pi -e .`，单包加载使用 `pi -e ./packages/notify`。

- [ ] **Step 2: 更新 Notify README**

说明 notify 可独立安装，也包含在聚合包中；如果已安装聚合包，不再安装独立 notify。

- [ ] **Step 3: 静态核对文案**

Run: `rg -n 'private: true|不会作为聚合|@misterzhouzhou/pi-extensions|@misterzhouzhou/pi-notify|不能同时' README.md packages/notify/README.md AGENTS.md`
Expected: 不再存在旧 private 根包描述；两种安装方式与重复加载警告均存在。

---

### Task 4: 审计两种发布产物

**Files:**
- Test: `test/package-manifests.test.mjs`
- Verify: root and `packages/notify` npm tarballs

**Interfaces:**
- Consumes: 根和 notify 的 `files` 白名单、Pi manifest
- Produces: 可整体安装的根 tarball 和可单独安装的 notify tarball

- [ ] **Step 1: 运行全量检查**

Run: `npm run check`
Expected: typecheck、manifest validation 和全部 Node 测试通过。

- [ ] **Step 2: 审计聚合包 tarball**

Run: `npm pack --dry-run --json > /tmp/pi-extensions-pack.json`
Expected: 包名为 `@misterzhouzhou/pi-extensions@0.1.0`；包含根 `package.json`、README、LICENSE 及 `packages/notify/{package.json,index.ts,notifier.ts,README.md,assets/pi.png}`；不包含 `test/`、`docs/`、`.memory/`、`.pi/`、`scripts/` 或密钥。

- [ ] **Step 3: 审计独立 notify tarball**

Run: `npm pack --workspace @misterzhouzhou/pi-notify --dry-run --json > /tmp/pi-notify-pack.json`
Expected: 包名为 `@misterzhouzhou/pi-notify@0.1.0`；仅包含 `package.json`、README、`index.ts`、`notifier.ts` 和 `assets/pi.png`。

- [ ] **Step 4: 最终一致性检查**

Run: `git diff --check && git status --short`
Expected: 无空白错误；只出现本计划允许的 manifest、lockfile、规则、README、校验器和测试改动，不产生 tgz 文件。

- [ ] **Step 5: 人工发布前检查点**

记录两个 tarball 文件清单和测试数量，等待用户明确授权后才执行任何发布动作。

---

### Task 5: 增加可复现的发布准备脚本

**Files:**
- Create: `scripts/prepare-release.mjs`
- Modify: `package.json`
- Test: `test/prepare-release.test.mjs`

**Interfaces:**
- Consumes: `--input <json>`、可选 `--write`，输入中的 `releaseVersion` 与 `versions` 精确版本映射
- Produces: dry-run 发布计划；`--write` 时更新选中包版本、根/子包 lockfile 条目及 `docs/release-*` 文档骨架

- [ ] **Step 1: 添加 prepare-release 失败测试**

覆盖：缺少 `--input`；未知包；变化包缺目标版本；目标版本已存在；默认 dry-run 不改文件；`--write` 同步 manifest/lockfile/四份发布文档；失败时恢复快照；独立 notify 与 umbrella 根包按子包优先、根包最后排序。

Run: `node --test test/prepare-release.test.mjs`
Expected: 因 `scripts/prepare-release.mjs` 不存在而失败。

- [ ] **Step 2: 实现准备脚本**

实现并导出 `prepareRelease()` 与 `defaultRun()`；使用 `npm pack --dry-run --json --ignore-scripts` 比较本地 tarball 和官方 registry 同版本内容；只对发生变化的公开包要求目标版本；生成 `release-notes-vX.Y.Z.md`、`github-release-vX.Y.Z.md`、`announcement-vX.Y.Z.md`、`publish-checklist-vX.Y.Z.md`，并嵌入精确包版本证据。根包虽是 workspace root，也作为 umbrella 发布包参与，但始终排在独立包之后。

- [ ] **Step 3: 增加 npm 命令**

在根 scripts 增加：

```json
"prepare-release": "node scripts/prepare-release.mjs"
```

- [ ] **Step 4: 验证 prepare-release**

Run: `node --test test/prepare-release.test.mjs && npm run prepare-release -- --input <fixture-path>`
Expected: 测试通过；真实仓库 dry-run 输出 JSON 计划且不修改版本和发布文档。

---

### Task 6: 增加本机只读、Actions 才可正式执行的发布脚本

**Files:**
- Create: `scripts/publish-release.mjs`
- Test: `test/publish-release.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `publish-release <vX.Y.Z> --dry-run` 或受信任 Actions 中的 `--github-actions`
- Produces: 包发布/跳过计划；仅受信任 Actions 模式执行 `npm publish <tgz>`

- [ ] **Step 1: 添加 publish-release 失败测试**

覆盖：版本必须带 `v`；本机未加 `--dry-run` 必须拒绝；预发布版本拒绝使用 `latest`；缺本地/远程 tag、tag 不在 `origin/main`、缺 GitHub Release、release body 不一致、checkout 与 tag tarball 不一致、publishable path 不干净均拒绝；已发布且内容一致时 skip；未发布时 dry-run 仅计划 publish；Actions 环境不可信或存在传统 npm token/.npmrc 时拒绝。

Run: `node --test test/publish-release.test.mjs`
Expected: 因 `scripts/publish-release.mjs` 不存在而失败。

- [ ] **Step 2: 实现发布核验与 dry-run**

硬编码可信边界：仓库 `MisterZhouZhou/pi-extensions`、工作流 `.github/workflows/publish.yml`、environment `npm-release`、分支 `main`、registry `https://registry.npmjs.org`。从 release tag 生成快照，对当前 checkout 与 tag 分别 `npm pack` 并比较文件内容、shasum/integrity/size；解析 `docs/github-release-vX.Y.Z.md` 的包版本证据，逐包判断 `publish` 或 `skip`。

- [ ] **Step 3: 实现 Actions-only 真实发布**

只有同时满足 `--github-actions`、可信 workflow 上下文、GitHub OIDC 可用、HEAD/GITHUB_SHA/origin/main 一致时，才执行：

```bash
npm publish <artifact.tgz> --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org
```

发布后轮询 registry 并验证发布内容与 tag tarball 一致。本机执行未带 `--dry-run` 时必须在任何 npm publish 前失败。

- [ ] **Step 4: 增加 npm 命令并验证**

在根 scripts 增加：

```json
"publish-release": "node scripts/publish-release.mjs"
```

Run: `node --test test/publish-release.test.mjs && npm run publish-release -- v0.1.0 --dry-run`
Expected: 单元测试通过；若尚未创建远程 tag/GitHub Release，真实仓库演练应在对应前置条件处安全失败，且绝不调用 npm publish。

---

### Task 7: 配置 GitHub OIDC 正式发布工作流

**Files:**
- Create: `.github/workflows/publish.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `workflow_dispatch` 输入 `release_tag` 与 `confirmation`、GitHub environment `npm-release`、npm Trusted Publisher 配置
- Produces: 经审批的 Actions-only npm 发布流程

- [ ] **Step 1: 创建 publish.yml**

仅允许从 `main` 手动触发；要求两份输入完全等于 `vX.Y.Z`；权限最小化为 `contents: read` 和 `id-token: write`；environment 固定 `npm-release`；checkout 与 setup-node action 使用完整 commit SHA；运行 `npm ci --ignore-scripts`、`npm run check`、`npm run publish-release -- "$RELEASE_TAG" --github-actions`。工作流不读取 `NPM_TOKEN`。

- [ ] **Step 2: 扩展 CI tarball 审计**

CI 同时运行根 umbrella 与 notify workspace 的 `npm pack --dry-run --json`，确保两种安装产物持续可构建。

- [ ] **Step 3: 更新发布文档和规则**

README 写明人工流程：`prepare-release --write` → 完成文档与检查 → commit/tag/push → 创建匹配正文的 GitHub Release → 从 main dispatch `publish.yml` → 审批 `npm-release` environment。说明 npm 侧必须为两个包配置 Trusted Publisher；本机只允许 `publish-release --dry-run`。AGENTS.md 禁止绕过工作流直接 npm publish。

- [ ] **Step 4: 静态安全审计**

Run: `rg -n 'NPM_TOKEN|npm publish|id-token|npm-release|workflow_dispatch|publish-release' .github README.md AGENTS.md package.json scripts test`
Expected: 工作流存在 `id-token: write`，不存在 token secret 引用；真实 `npm publish` 仅位于受运行时守卫保护的 `publish-release.mjs`。

- [ ] **Step 5: 最终全量验证**

Run: `npm run check && npm pack --dry-run --json && npm pack --workspace @misterzhouzhou/pi-notify --dry-run --json && git diff --check`
Expected: 全部测试通过；两份 tarball 内容正确；无 npm publish、GitHub Release、tag 或 push 被实际执行。
