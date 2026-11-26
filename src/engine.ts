/**
 * Engine of `dsh-span-compaction`: the stock basic engine with a bounded
 * per-pass replay.
 *
 * The stock engine selects one range covering everything between the surface
 * head and the retained tail and replays that whole range as the
 * summarization request. On a long conversation that request carries hundreds
 * of thousands of tokens, so any lane that refuses oversized side requests
 * (proxy guards, periodic-report helpers) fails it outright and the retry loop
 * never converges. This engine narrows every pass to a balanced prefix of the
 * selected range that fits a budget, so each pass makes durable progress and
 * repeated passes converge.
 *
 * @module dsh-span-compaction/engine
 */

import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-token-meter'
import z from '@deepseek-ai/schemastery'
import { planSpanCut } from './span.ts'
import { effectiveBudget, readLive, type LiveValue } from './live-config.ts'
import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic'
import { type HooksConfig } from './hooks.ts'
import { DEFAULT_NUDGE_EVERY_STEPS, DEFAULT_NUDGE_MIN_TOKENS, DEFAULT_NUDGE_RATIO } from './nudge.ts'

/** Default per-pass replay budget, in route-priced tokens. */
export const DEFAULT_SPAN_BUDGET_TOKENS = 160_000

/**
 * Default share of the routed model's context window that triggers automatic
 * compaction. The stock engine resolves its policy once, so this plugin keeps
 * the value live instead: a saved setting applies at the next step boundary.
 */
export const DEFAULT_THRESHOLD_RATIO = 0.8

/** Model-policy overrides keep the stock plain number; the top-level key is live. */
const thresholdRatio = z.number()
const headroomTokens = z.number().step(1).min(0)
const retainRatio = z.number()
const retainTokens = z.number().step(1).min(0)
const summarizationProvider = z.string()
const summarizationModel = z.string()
const maxTokens = z.number().step(1).min(1)
const compactionRetries = z.number().step(1).min(0)
const maxOverflowRetries = z.number().step(1).min(0)
const modelPolicy = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio,
  headroomTokens,
  retainRatio,
  retainTokens,
  summarizationProvider,
  summarizationModel,
  maxTokens,
  compactionRetries,
  maxOverflowRetries,
})

/** Stock keys plus the keys this plugin owns. */
interface SpanCompactionConfig extends Omit<BasicCompactionConfig, 'thresholdRatio'>, HooksConfig {
  /** Live because the settings page edits it; the stock resolver takes a number. */
  thresholdRatio?: LiveValue<number>
  spanBudgetTokens?: LiveValue<number>
  takeoverPresets?: boolean
}

export default class SpanCompactionEngine extends BasicCompactionEngine {
  static override inject = BasicCompactionEngine.inject

  /**
   * The stock keys are re-declared because the host schema has no `extend`, and
   * `resolveConfig` rejects keys it does not know. `spanBudgetTokens` bounds one
   * pass and is deliberately independent of the model window: it is the payload
   * a summarization request may carry, not the capacity of the model running it.
   *
   * Every key this plugin adds is volatile and flat: volatile because a saved
   * setting must apply without restarting the entry, flat because the settings
   * page's shared form model addresses a control by its own field name.
   */
  static override Config = z.object({
    thresholdRatio: z.number().min(0.1).max(1).default(DEFAULT_THRESHOLD_RATIO)
      .description('Automatic compaction threshold (0.1–1): share of the routed model\'s context window at which a step-boundary compaction runs.')
      .i18n({ zh: '自动压缩阈值（0.1–1）：计费上下文达到所路由模型窗口的这个比例时，在步边界自动压缩。' })
      .volatile(),
    headroomTokens,
    retainRatio,
    retainTokens,
    summarizationProvider,
    summarizationModel,
    maxTokens,
    compactionRetries,
    maxOverflowRetries,
    modelPolicies: z.array(modelPolicy),
    auto: z.boolean(),
    spanBudgetTokens: z.number().step(1).min(1).default(DEFAULT_SPAN_BUDGET_TOKENS)
      .description('Replay span budget (tokens). Applies to automatic region compaction, not the whole request or manual /compact.')
      .i18n({ zh: '历史分段预算（token）：适用于自动区域压缩，不是整个请求上限，也不限制手动 /compact。' }).volatile(),
    takeoverPresets: z.boolean(),
    toolsEnabled: z.boolean().default(true)
      .description('Model compaction tools. Turning these off does not disable automatic compaction or /compact.')
      .i18n({ zh: '模型压缩工具：关闭后不影响自动压缩兜底或 /compact。' }).volatile(),
    nudgeEnabled: z.boolean().default(true)
      .description('Context-pressure reminder. Only reminds the model; never runs compaction by itself.')
      .i18n({ zh: '上下文压力提醒：只提醒模型，不会自行执行压缩；模型工具关闭时暂停提醒。' }).volatile(),
    nudgeRatio: z.number().min(0.01).max(1).default(DEFAULT_NUDGE_RATIO)
      .description('Context window ratio (0.01–1). Both this ratio and the token floor must be reached.')
      .i18n({ zh: '上下文窗口占比（0.01–1）：需同时达到此比例和最低 token 数。' }).volatile(),
    nudgeMinTokens: z.number().step(1).min(0).default(DEFAULT_NUDGE_MIN_TOKENS)
      .description('Minimum tokens for a reminder. With an unknown window, twice this count is required.')
      .i18n({ zh: '提醒最低 token 数；模型窗口未知时，需达到该数值的两倍。' }).volatile(),
    nudgeEverySteps: z.number().step(1).min(1).default(DEFAULT_NUDGE_EVERY_STEPS)
      .description('Minimum steps between reminders; context must also grow by at least 2%.')
      .i18n({ zh: '提醒至少间隔的步数；上下文还须增长至少 2%。' }).volatile(),
  // The live threshold is a volatile reference, which the stock static type
  // cannot express: `BasicCompactionEngine.Config` declares a plain number. The
  // runtime schema is what the loader and the settings page read.
  }) as unknown as typeof BasicCompactionEngine.Config

  spanBudgetTokens: LiveValue<number>

  /** Saved pressure threshold, read on every pressure check rather than once. */
  private readonly thresholdRatio: LiveValue<number> | undefined

  /** One-shot, model-written summaries keyed by the agent that requested them. */
  private readonly modelSummaries = new WeakMap<Agent, string>()

  constructor(ctx: Context, config: SpanCompactionConfig = {}) {
    // These keys belong to this plugin, not to the stock engine, and the stock
    // resolver rejects keys it does not know.
    const {
      spanBudgetTokens = DEFAULT_SPAN_BUDGET_TOKENS,
      thresholdRatio: thresholdRatioLive,
      takeoverPresets: _takeoverPresets,
      toolsEnabled: _toolsEnabled,
      nudgeEnabled: _nudgeEnabled,
      nudgeRatio: _nudgeRatio,
      nudgeMinTokens: _nudgeMinTokens,
      nudgeEverySteps: _nudgeEverySteps,
      ...stock
    } = config
    // The stock resolver compares numbers, so a volatile reference cannot ride
    // through it: the initial value is resolved once, and the live value is
    // applied on top of the resolved policy below.
    super(ctx, thresholdRatioLive === undefined
      ? stock
      : { ...stock, thresholdRatio: readLive(thresholdRatioLive) })
    this.spanBudgetTokens = spanBudgetTokens
    this.thresholdRatio = thresholdRatioLive
    const resolved = this.config
    // `compactPressure` reads `this.config.thresholdRatio` per check, so
    // replacing the resolved policy here is what makes a saved threshold apply
    // without remounting the entry.
    Object.defineProperty(this, 'config', {
      configurable: true,
      enumerable: true,
      get: () => withThreshold(resolved, this.thresholdRatio),
    })
  }

  /**
   * Use a model-authored summary when one has been queued for this agent by
   * `compactRangeWithSummary`; otherwise fall back to the stock LLM summarizer.
   * The model-written path still goes through `compactSurfaceRegion`'s full
   * commit, shrink check and checkpoint framing.
   */
  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const authored = this.modelSummaries.get(agent)
    if (authored !== undefined) {
      this.modelSummaries.delete(agent)
      this.ctx.logger.info(
        `span compaction: using model-authored summary (${authored.length} chars) for ${agent.session.id}`,
      )
      return {
        summary: [{ type: 'text', text: authored }],
        provider: 'model',
        model: 'model-authored',
        rawOutput: [{ type: 'text', text: authored }],
      }
    }
    return super.summarize(input, agent, signal)
  }

  /**
   * Compact an exact surface range with a summary written by the model itself.
   * Unlike `compactRegion`, this does not narrow the range: the authored summary
   * describes precisely the span the model selected.
   *
   * @param start - inclusive first surface-node seq chosen by the model.
   * @param end - inclusive last surface-node seq chosen by the model.
   * @param agent - owner of the target session.
   * @param summary - the model-written technical summary of the range.
   * @param signal - cancellation forwarded to the commit transaction.
   */
  async compactRangeWithSummary(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    summary: string,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    this.modelSummaries.set(agent, summary)
    try {
      // Call the grandparent implementation directly to skip span narrowing.
      // super.compactRegion would re-enter this class's narrowed override.
      return await BasicCompactionEngine.prototype.compactRegion.call(this, start, end, agent, signal)
    } finally {
      // Clear any summary left behind by a failed transaction so a later
      // automatic compaction never consumes a stale model-authored summary.
      this.modelSummaries.delete(agent)
    }
  }

  /**
   * Compact at most one budget-sized balanced prefix of the requested range.
   *
   * Narrowing here (rather than replacing the range selection) keeps the stock
   * retention policy, stability checks, pricing and commit path intact: every
   * pass still commits a normal durable compaction.
   *
   * @param start - inclusive first surface-node seq of the selected range.
   * @param end - inclusive last surface-node seq of the selected range.
   * @param agent - owner of the target session, used by the summarizer.
   * @param signal - optional summarization cancellation signal.
   * @returns the successful durable compaction result.
   */
  override async compactRegion(start: SessionSeq, end: SessionSeq, agent: Agent, signal?: AbortSignal): Promise<CompactionResult> {
    const narrowed = this.narrowRange(agent.session, start, end)
    if (narrowed !== end) {
      this.ctx.logger.info(
        `span compaction: replay budget ${effectiveBudget(this.ctx, this.spanBudgetTokens)} narrows seq ${start}-${end} to ${start}-${narrowed}`,
      )
    }
    return super.compactRegion(start, narrowed, agent, signal)
  }

  /**
   * Last seq of the largest balanced prefix of a range that fits the budget.
   * @param session - session owning the surface positions.
   * @param start - inclusive first surface-node seq of the selected range.
   * @param end - inclusive last surface-node seq of the selected range.
   * @returns the seq to compact up to; `end` when the whole range fits.
   */
  narrowRange(session: Session, start: SessionSeq, end: SessionSeq): SessionSeq {
    const { nodes } = this.ctx.tokenMeter.measure(session)
    const startIndex = nodes.findIndex(node => node.seq === start)
    const endIndex = nodes.findIndex(node => node.seq === end)
    if (startIndex < 0 || endIndex <= startIndex) return end
    const range = nodes.slice(startIndex, endIndex + 1)
    const cut = planSpanCut(
      range.map(node => node.tokens ?? 0),
      effectiveBudget(this.ctx, this.spanBudgetTokens),
      index => toolPairingBalancedAfter(session, range[index]!.seq),
    )
    return cut === null ? end : range[cut]!.seq
  }
}

/**
 * The resolved policy with the saved threshold applied.
 *
 * The stock contract requires the threshold above the retained share, so a
 * saved value below it is raised: otherwise every pressure pass would throw and
 * be logged per step instead of compacting.
 * @param resolved - policy resolved when the entry mounted.
 * @param live - saved threshold reference, when the field is live.
 * @returns the resolved policy, or a copy carrying the current threshold.
 */
export function withThreshold(resolved: ResolvedConfig, live: LiveValue<number> | undefined): ResolvedConfig {
  const value = readLive(live)
  if (typeof value !== 'number' || !Number.isFinite(value)) return resolved
  const floor = Math.min(0.99, (resolved.retainRatio ?? 0) + 0.01)
  const thresholdRatio = Math.min(1, Math.max(floor, value))
  return thresholdRatio === resolved.thresholdRatio ? resolved : { ...resolved, thresholdRatio }
}

export { SpanCompactionEngine }
