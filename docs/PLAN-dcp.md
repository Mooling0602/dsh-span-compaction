# 模型自主压缩（DCP 路线）设计方案

## 目标

在 `dsh-span-compaction` 上增加 opencode-dcp 风格的能力：把「压缩」变成模型可自己调用的工具，模型按任务完成度选择范围、自撰摘要，压缩结果落盘为 DSH 原生压缩事务（surface 层），从而让 timeline / 子代理 / 所有 surface 消费方都看到压缩后的历史。

保留已修复的底座：host-plane `compaction-basic` 已被 `cordis.patch.yml` 禁用；preset 内的引擎行被 gate 改名接管；每次摘要 replay 受 160k `spanBudgetTokens` 约束。

## 决策（用户已确认）

- 摘要由模型在工具参数里写（不额外发摘要请求），复用原生 commit 路径。
- 走 **B 混合路线**：保留自动压缩作为兜底防 413，nudge 只引导、不强制。

## 关键架构发现（来自本机 0.2.3-alpha.2 源码）

1. `BasicCompactionEngine.summarize()` 是**唯一的子类定制钩子**（src/index.ts:115、288）。默认调 LLM。
2. `SummaryResult`（compaction-basic/src/summarizer.ts:90-110）明确支持 `llmStreamCall?: never` 的「模板 / 远程 / 其他 summarizer」分支，只需给 `{summary, provider, model}`。这意味着**模型在工具参数里写的摘要可以直接作为 SummaryResult 返回**，复用 `compactSurfaceRegion` 的完整 commit 路径（锁、balance 检查、shadow pricing、`compaction/summary` 事件、检查点消息、surface replace），不重造任何 plumbing。
3. `ctx.tools.register(definition)` 定义工具；`defineTool({name, description, parameters, output, execute})`；execute 的 `exec.agent` 是发起调用的 agent，`exec.signal` 必须转发。
4. `ctx.agentPresets.serviceFor(agent, 'compaction')` 可解析 agent 所在 preset scope 里的压缩引擎实例——工具在 agent scope，引擎在 isolated preset scope，靠它桥接。
5. `ctx.tokenMeter.measure(session).nodes` 给出 priced surface 节点（含 seq / tokens），可据此给模型列出可压缩范围与token估算。
6. `agent/pre-step` 是 waterfall；DSH 内置自动压缩就是在这里做压力检查。nudge 可挂在同一个 hook 上，在请求发出前向消息注入提醒文本。

## 设计

### 组件

- `src/compress-tool.ts`：定义并注册模型工具。
  - `compact_targets`：返回当前会话可压缩的 surface 区间列表（起点/终点 seq、近似 token、主题预览），不修改任何状态。
  - `compact`：参数 `start`、`end`（surface seq，来自 compact_targets）、`summary`（模型自撰的技术摘要文本）、可选 `topic`。执行时：
    1. 通过 `agentPresets.serviceFor(agent, 'compaction')` 取到 span 引擎；
    2. 把一个「一次性摘要提供者」按 agent/session 绑定（WeakMap），值为模型给的摘要；
    3. 调引擎的 `compactNow(agent, signal)` 或一个专门的 `compactRangeWithSummary(start, end, agent, signal)`；
    4. 引擎的 `summarize()` 被 override：若存在一次性提供者则消费它并返回 `SummaryResult`（`llmStreamCall: false`，`rawOutput` 为摘要文本块），否则 `super.summarize()`（自动压缩路径不变，仍受 span 预算约束）。
    5. `/compact` 与自动压缩完全不受影响。
  - `recall`（可选，二期）：读回某次压缩移除的原文——surface replace 后原文仍在事件日志里，可通过 seq 反查。
- `src/nudge.ts`：在 `agent/pre-step` 里估算上下文压力（复用 tokenMeter + 模型的 contextWindow），越过阈值时通过 `deferContext()` 注入 `<span-compaction-reminder>` 提醒文本，引导模型调用 `compact`。含频率控制（每 N 次 step 一次、token 低于下限静默）。不做自动压缩。
- `src/engine.ts`：增加 `summarize()` override 与一次性摘要提供者 WeakMap；`Config` 增加工具开关、nudge 阈值等键。
- `cordis.patch.yml`：把工具与 nudge 作为 preset 内的注入项挂载。注意 preset 深层行 patch 无法按 id 寻址，沿用 gate 的 `internal/config` 改写机制在加载期把工具条目插进各 preset 的 `inject` 列表；host-plane 只需一个全局工具注册（工具全局可见），nudge 用全局 `agent/pre-step` 监听即可，无需逐 preset 注入。
- `package.json`：新增 peer `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-agent`。

### 取舍

- **不自动压缩**：DCP 哲学——由模型判断何时压。自动压力/溢出压缩仍保留作兜底（防 413），但 nudge 只提醒不强制。
- **摘要由模型在工具参数里给**：省掉一次摘要 LLM 请求，也彻底避开「摘要请求带完整历史被 413」——因为摘要文本是模型在主回合里顺手写出的。
- **span 预算与模型指定范围的关系**：模型自己选范围时，`compactRegion` 的窄化仍生效（防止模型选了超大范围导致结构问题）；但摘要请求不再发 LLM，所以预算主要保护 commit 侧的稳定性。
- **不可安全落地的部分**：`recall` 依赖按压缩事务反查原文，放到二期；一期先交付 `compact_targets` + `compact` + nudge。

## 验收

- `npm run build`、`npm run typecheck`、`npm test` 通过；新增工具 schema / 摘要注入的纯函数测试。
- 重启后 `cordis_inspect` 能看到 `compact`/`compact_targets` 工具已注册、`span-compaction` 配置 schema 含新键。
- 手工验证：在一个会话里让模型调用 `compact`，确认 surface 出现原生压缩卡片、日志有 `compaction/summary` 事件、后续请求历史确实变短。
