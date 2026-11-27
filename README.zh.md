# dsh-span-compaction

简体中文 | [English](README.md)

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

一个把单次摘要请求限制在重放预算内的 DSH 压缩引擎。

原生引擎（`@deepseek-ai/dsh-compaction-basic`）选择会话表面开头到保留尾部之间的全部内容，再把这一整段作为摘要请求重放出去。会话一长，这个请求就携带了全部未压缩历史，任何拒绝超大旁路请求的通道都会在转发前把它打回：压缩失败，一分钟后重试循环拿着更长的历史再来一次，会话永远压不掉。

默认情况下，本插件按 `spanBudgetTokens` 重放预算把每次自动压缩缩短到所选区间的平衡前缀。每次只提交一次正常的持久化压缩，因此多轮压缩会逐步收敛。预算设为 `0` 时，使用原生引擎选中的完整区间。

它还提供两个面向模型的工具（`compact_targets`、`compact`），让模型用自己撰写的摘要压缩选中的区间——不会额外发出摘要请求。上下文变大时，一条压力提醒会提示模型主动压缩。自动压缩继续保留，作为溢出兜底。

## 它改了什么

只改一次压缩允许重放的那一段。区间选择、保留策略、稳定性检查、影子定价、检查点消息和提交路径全部沿用原生实现——这是 `BasicCompactionEngine` 的子类而不是重写，所以 `/compact`、压力压缩和溢出恢复都照常工作。

## 安装

```bash
dsh plugin --profile web add github:Mooling0602/dsh-span-compaction
```

把 `web` 换成你使用的 profile。仓库自带编译好的 JavaScript——宿主半的 `dists/index.js` 和浏览器半的 `dist/client.js`——所以安装过程不运行构建步骤，本机也不需要 Node 工具链。提交里的产物与 `npm run build` 的输出逐字节一致。

通过图形化界面安装时，只需要输入 `github:Mooling0602/dsh-span-compaction` 并确认即可。

卸载：

```bash
dsh plugin --profile web remove dsh-span-compaction
```

安装完成后重启服务。bundle patch 会插入一行 entry——注册模型工具和提醒的也是这一行——同时停用 profile 级的原生引擎：

```yaml
- insert:
    - id: span-compaction
      name: dsh-span-compaction
- id: compaction-basic
  disabled: true
```

插件挂载的一切都刻意放在这一行上：一个包只能作为一个 client module 行的来源，而 `client-modules` 会拒绝被两个活跃行同时解析的包，所以再加一行 hooks 会悄悄让这个 bundle 失去它的配置页。

必须禁用宿主层的原生引擎，才能由 Span Compaction 提供 `compaction` 服务。`auto: false` 只停用压力和溢出监听器，原生引擎仍会注册该服务。Profile 补丁不能直接修改 agent 预设内的引擎行；这些行由预设 gate 单独替换，并保留各自的 `auto` 设置。

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-compaction`、`@deepseek-ai/dsh-compaction-basic` 和 `@deepseek-ai/schemastery` 是 peer 依赖：运行时从安装作用域解析它们，插件因此跟随宿主版本，而不是固定自己的一份。支持 DSH `0.2.2-rc.1` 及后续 0.2.2 发行版，以及 `0.2.3-alpha.2` 及后续 0.2.x 发行版。插件同时兼容 Cordis 4.1（0.2.2 系列）与 4.2（0.2.3 系列），CI 会启动该范围内每个已发布的运行时。

## 接管预设引擎

profile patch 无法定位嵌在 agent 预设内部的 entry，而每个会话的引擎都活在隔离 `compaction` 服务的预设组里。插件因此监听 `internal/config` 瀑布，在 loader 挂载之前把原生引擎行重命名到自己。传 `takeoverPresets: false` 可以保留预设使用原生引擎，只在 profile 明确点名的地方挂载本 entry。

隔离压缩组内的行即使被宿主标记为 `disabled` 也会被重命名，因为那正是本插件要覆盖的标记。其他位置的行只在宿主保持启用时才重命名。

## 关于请求层代理

在出口折叠请求的代理（billion-context 的 `bili-native`）和表面引擎会在两个不同的地方压缩同一个会话。两者只能有一个负责这个决定：表面引擎改写的是会话自己派生出的内容，所以每个消费者——周期报告、子代理、重放——看到的都是压缩后的历史；而请求层的折叠对所有消费者不可见。要么挂载本插件并从 `dsh.profile.bundles` 移除竞争的代理压缩器；两者同时运行时插件会打一条警告。

## 模型驱动的压缩

最浅层的插件 entry 全局注册两个工具：

| 工具 | 用途 |
| --- | --- |
| `compact_targets` | 汇报会话总价，并给出已完成历史的两种视图：`ranges` 是现成的连续区间，合起来覆盖全部已完成历史（起止 seq、节点数、计费 token）；`targets` 是最大的 40 个安全单点切点。`compactableTokens` 是这段历史真实的计费总量；当前轮次不在两个列表里。两者都不是上限：`compact` 接受任何平衡区间。 |
| `compact` | 用模型在 `summary` 参数里写好的摘要，通过原生压缩事务提交任意选中的区间。一个大的完整区间胜过许多小节点；比自己的摘要还小的区间是净亏损。 |

模型撰写的摘要通过每 agent 一次性的队列交给 `BasicCompactionEngine.summarize()`，所以完整提交路径（平衡检查、收缩检查、检查点包装、表面替换）照常执行——但不会为了压缩历史而额外发一次 LLM 请求。这正是绕开「摘要请求过大」这一严格代理故障的做法。自动引擎和 `/compact` 行为不变；模型驱动路径只是增加了第二种、由模型掌控的入口。

工具结果里的 `shadowedTokens` 是被替换区间的**毛价**。摘要会写回表面，所以净减少量是这个价格减去摘要本身。用一段很长的摘要去压几千个计费 token，会话总量可能只动一个百分点；请挑明显大于你所写摘要的区间。

前置步骤提醒（`<span-compaction-reminder>`）在计费上下文同时达到模型窗口的 `nudgeRatio` **和** `nudgeMinTokens` 时，向模型报出读数。如果压缩会打断工作，或用户拒绝了这次请求，模型应先完成任务，再在最终回复前重新检查较早已完成的历史。有值得压缩的区间且用户未要求不要重试时，按正常审批流程再尝试一次。提醒本身不会执行压缩，仍受 `nudgeEverySteps` 与压力增量护栏限流；步骤跨轮次计数，不受每轮 step 编号从 1 开始的影响。

## 配置

所有设置都落在唯一的 `span-compaction` entry 上，因此只有一个命名空间、一个表单。配置页就是 **Plugins** 页里这个 bundle 自己卡片上的配置——一个按包名作键的 `plugins.bundle.config` entry，渲染在描述与组件列表之间，位于组件之外，不需要钻进去。它由官方设置原语构建：每个控件暂存草稿，一次保存把全部改动写进一个带 revision 栅栏的原子变更。离开页面会丢弃未保存的改动。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `spanBudgetTokens` | `160000` | 单次自动压缩的重放预算（计费 token）；设为 `0` 不限重放。 |
| `thresholdRatio` | `0.8` | 在步骤边界触发自动压缩时，占路由模型上下文窗口的比例。 |
| `toolsEnabled` | `true` | 注册 `compact_targets` / `compact` 工具。 |
| `nudgeEnabled` | `true` | 注入上下文压力提醒。 |
| `nudgeRatio` | `0.2` | 触发提醒所需的模型窗口占比。 |
| `nudgeMinTokens` | `100000` | 低于该绝对 token 底线时不发提醒。 |
| `nudgeEverySteps` | `10` | 同一 agent 两次提醒之间至少间隔的放行步数。 |
| `approveCompact` | `true` | 模型执行 `compact` 前请求确认；“完全权限”档仍无需确认。 |
| `exemptTargets` | `true` | `compact_targets` 跳过下游预执行策略（含自动审查）。 |

### 审批门槛

`compact` 会用摘要替换保留的历史，因此只要会话的审批策略是交互式的，模型就会先等你确认。这个门槛是 `tools/pre-execute` 最外层的监听器，只看会话的审批策略：“完全权限”（`never`）保持不弹窗的约定，其余 `ask` 档——包括 Auto——都会弹出审批卡。`compact_targets` 则相反地豁免：它只列候选，所以会跳过整条下游链，包括 Auto 审查——否则每次列候选都要把整段保留历史再发一遍。`approveCompact` 与 `exemptTargets` 可以分别关掉这两半。

自动压缩在计费上下文达到**路由模型声明窗口**的 `thresholdRatio` 时触发。这个窗口通常远大于真实会话：原生 DeepSeek 适配器为 `deepseek-flash` 声明 1,048,576 token，`0.8` 就接近 840,000 token。单个会话会先碰到提醒（窗口的 0.2，或 `nudgeMinTokens`），远早于自动压缩；如果希望普通会话也能触发自动压缩，就把 `thresholdRatio` 调低。

键之所以是扁平的，是因为共享表单模型按控件自己的字段名在该 section 内寻址；嵌套对象不会有能编辑它的控件。所有键都是易变值，保存后对下一步或下一次压缩生效，无需重启 entry。

原生引擎的配置键依然全部有效，可以在 `cordis.patch.yml` 中设置：

```yaml
- id: span-compaction
  name: dsh-span-compaction
  config:
    spanBudgetTokens: 120000
    thresholdRatio: 0.7
```

留空或未设置 `spanBudgetTokens` 时，使用默认值 `160000`。设为 `0` 时，首次尝试不限制重放长度。预算为 `0` 或大于默认值时，如果自动压缩失败且未取消、未替换历史，插件会用默认预算重试一次，不修改已保存的设置。预算在 `1` 至 `160000` 之间时不额外重试。模型和代理的请求上限仍然有效，自动压缩阈值、历史保留规则、手动 `/compact` 和模型调用的 `compact` 均不受影响。

### 保存设置后会发生什么

只有上面这些字段是实时的：保存会就地更新正在运行的插件。预算会送达运行时里的每个 Span 引擎，包括由预设接管安装的那些，因为 profile entry 会发布它，而每次压缩都读取它，而不是使用预设挂载时捕获的值。工具与提醒阈值每一步都会重新读取。

有三点限制值得知道：

- 预算限制的是**自动**压缩重放的区间，不是整个请求的上限（系统提示、工具 schema 和保留尾部都在它之外），也不限制手动 `/compact`——后者沿用原生的整段区间选择。
- 提醒只是给模型的建议。它从不执行压缩，并且在工具被停用时会被抑制，因为没有东西可让模型调用。
- 提醒需要同时满足窗口的 `nudgeRatio` 和 `nudgeMinTokens`；窗口未知时需要两倍的 `nudgeMinTokens`。它还要等满 `nudgeEverySteps` 个放行步骤，并且自上次提醒以来至少增长 2%。步骤跨轮次计数，所以轮边界不会压掉下一次提醒。

## 开发与 CI

使用 Node.js 24.22.3 在本地复现 CI 的测试阶段：

```sh
npm ci --ignore-scripts
npm run check
```

[CI 工作流](.github/workflows/ci.yml) 在推送到 `main`、打开或更新拉取请求以及手动触发时运行。它先构建宿主与客户端、检查类型并运行测试，再根据 `engines.dsh` 为每个匹配的已发布 DSH 版本启动无 Web 服务的临时 Profile，链接本地插件，验证插件激活和工具注册。全部通过后只在工作流内归档 npm 压缩包，不向 npm 发布，也不创建 Release。
