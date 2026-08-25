# Pi Subagent

`@misterzhou/pi-subagent` 注册一个名为 `subagent` 的工具。父模型可以依据自然语言请求调用它，支持 single、parallel 和 chain 三种模式。

内置 Agent：

| Agent | 用途 |
|---|---|
| `explore` | 搜索代码、配置和行为，不修改文件 |
| `planner` | 分析需求并输出实施计划，不修改文件 |
| `worker` | 实现限定范围内的修改并验证 |
| `reviewer` | 审查缺陷、回归和测试缺口 |

Agent 来源：内置 `packages/subagent/agents/*.md`、用户 `~/.pi/agent/agents/*.md`、项目最近的 `.pi/agents/*.md`。同名优先级是 `project > user > builtin`，可通过 `agentScope` 限定来源。

## 自然语言示例

```text
让 explore 找出这个项目的权限确认逻辑，并说明调用链。
先让 planner 制定修改方案，再让 worker 按方案实现。
并行让 explore 检查前端入口和后端接口，然后让 reviewer 汇总风险。
```

显式工具参数对应三种模式：`agent + task` 是 single，`tasks[]` 是 parallel，`chain[]` 是 chain；chain 会把前一步文本替换到后一步的 `{previous}`。

项目 Agent 在 SAFE 下需要父进程确认信任目录；没有 UI 时 fail closed，并尝试 user/builtin fallback。包含 `write` 或 `edit` 的任务在 SAFE 下每次调用只确认一次；YOLO 可跳过本扩展的普通确认。child guard 仍始终阻断灾难级 Bash。

子 Pi 继承父会话的 cwd 和当前 provider/model，使用无 session 的 JSON 模式，只加载包内 guard，不加载其他 extension，也不会递归注册 `subagent`。

## 独立加载

```bash
pi --no-extensions -e ./packages/subagent --no-session
```

不要同时安装 `@misterzhou/pi-extensions` 和本包，否则 Subagent 会被重复加载。
