# Repository Guidelines

- 所有响应使用中文。
- 根包是可公开发布的 umbrella Pi Package，根 package.json#pi 必须显式列出聚合资源。
- 每个 packages/* 都是独立 Pi Package，资源必须显式写入自己的 package.json#pi。
- 根包和每个子包独立维护版本，禁止发布脚本强制同步版本。
- 不得同时安装 umbrella 包与其中已包含的独立包，避免同一扩展重复加载。
- Pi 核心运行时依赖使用 peerDependencies 的 "*"，测试版本只放根 devDependencies。
- 修改子包后运行 npm run check 和对应 workspace 的 npm pack --dry-run。
- 用户明确要求时允许通过 release-local 在本机发布单包；不得保存发布凭据，发布前必须人工确认，publish 开始后不得自动回滚版本文件。
- release-github 仅在干净且安全同步的 main 上创建精确 release commit、包级 tag，并通过一次原子 push 触发 Actions；禁止 merge、rebase、reset、force push 或删除失败后的本地 commit/tag。
- publish-release 是 GitHub Actions 内部 npm 发布执行器，不得用作本机发布入口。
- 自动化验证不得执行真实 npm publish、真实 release commit、tag 或 push。
- Actions 发布必须使用受信任的 npm Trusted Publishing/OIDC；未经用户明确要求，禁止直接 npm publish、GitHub Release、git tag 和 git push。
- 不提交密钥、通知正文样本中的敏感信息、.pi/npm 或 .pi/git 安装缓存。
