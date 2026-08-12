# Repository Guidelines

- 所有响应使用中文。
- 根包是可公开发布的 umbrella Pi Package，根 package.json#pi 必须显式列出聚合资源。
- 每个 packages/* 都是独立 Pi Package，资源必须显式写入自己的 package.json#pi。
- 不得同时安装 umbrella 包与其中已包含的独立包，避免同一扩展重复加载。
- Pi 核心运行时依赖使用 peerDependencies 的 "*"，测试版本只放根 devDependencies。
- 修改子包后运行 npm run check 和对应 workspace 的 npm pack --dry-run。
- 本机禁止真实 npm publish；正式发布只能通过受信任的 GitHub Actions 工作流。未经用户明确要求，禁止 GitHub Release、git tag 和 git push。
- 不提交密钥、通知正文样本中的敏感信息、.pi/npm 或 .pi/git 安装缓存。
