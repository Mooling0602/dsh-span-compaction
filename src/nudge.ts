/**
 * Model-driven compaction nudge for `dsh-span-compaction`.
 *
 * When the conversation approaches the model's context window, inject a short
 * reminder into the step telling the model it may compact a chosen range with
 * its own summary via `compact_targets` / `compact`. The nudge never compacts
 * anything itself and never blocks a step: it only informs the model. This is
 * the DCP-style counterpart to the automatic engine, which stays enabled as an
 * overflow safety net.
 *
 * @module dsh-span-compaction/nudge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-span-compaction': {
      kind: 'dsh-span-compaction'
      form: 'nudge'
      summary: string
    }
  }
}

/** Fraction of the model context window at which the nudge starts. */
export const DEFAULT_NUDGE_RATIO = 0.2
/** Absolute token floor below which no nudge is emitted. */
export const DEFAULT_NUDGE_MIN_TOKENS = 100_000
/** Minimum steps between two nudges for one agent. */
export const DEFAULT_NUDGE_EVERY_STEPS = 10

export interface NudgeConfig {
  enabled?: boolean
  ratio?: number
  minTokens?: number
  everySteps?: number
}

/** Facts the reminder quotes, so the model decides from numbers instead of vibes. */
export interface ReminderFacts {
  /** Priced token count of the session. */
  tokens: number
  /** Model context window, when the adapter reports one. */
  window?: number | undefined
  /** Ratio of the window the reminder waits for. */
  ratio: number
}

/**
 * Build the reminder text for one pressure reading.
 *
 * The tool descriptions already explain the rules; the reminder repeats only
 * what decides this call: how much is priced, that one large completed block
 * beats many small nodes, and that a summary longer than its range is a loss.
 *
 * @param facts - priced tokens, window and ratio at the moment of the nudge.
 * @returns the user-visible reminder message.
 */
export function buildReminder(facts: ReminderFacts): string {
  const share = facts.window !== undefined && facts.window > 0
    ? Math.round(facts.tokens / facts.window * 100)
    : undefined
  const reading = share === undefined
    ? `${facts.tokens.toLocaleString('en-US')} priced tokens (model window unknown, floor is twice nudgeMinTokens)`
    : `${facts.tokens.toLocaleString('en-US')} priced tokens, about ${share}% of the ${facts.window!.toLocaleString('en-US')}-token window (reminder ratio ${Math.round(facts.ratio * 100)}%)`
  return [
    '<span-compaction-reminder>',
    `Context pressure: ${reading}. Every later request pays this again.`,
    'Compact at the next safe pause: you write the summary, compact() replaces the range with it, and no auxiliary summarization request is sent.',
    '- If compaction would interrupt ongoing work or the user declines this compaction request, finish the task first. Do not ask again mid-task.',
    '- If deferred, recheck compact_targets when the task is done, before sending your final reply. Make one attempt with normal approval if there is still a worthwhile range in older, finished history. Skip it if the user asked you not to retry; if declined again, send the final reply without asking again.',
    '- compact_targets gives boundary seqs with token counts; it lists single candidate nodes, not the limit of what may be compacted.',
    '- Prefer ONE large, contiguous, completed block over many small pieces. Net saving is roughly shadowedTokens minus your summary; a span smaller than its summary is a loss.',
    '- Keep out: the current task, unanswered user questions, pending decisions, and anything you still need verbatim. The current turn is not a candidate even at task completion. Checkpoints and re-injected reminders are already compressed.',
    '- Do not wait for a new reminder: check finished history at safe milestones so priced history stays near 10% of the window.',
    '</span-compaction-reminder>',
  ].join('\n')
}

const nudgeConfig = z.object({
  enabled: z.boolean(),
  ratio: z.number(),
  minTokens: z.number().step(1).min(0),
  everySteps: z.number().step(1).min(1),
})

/** Per-agent rate-limit state. */
export interface NudgeState {
  /** Admitted steps counted across the whole session, not per turn. */
  lastStep: number
  lastTokens: number
}
const states = new WeakMap<Agent, NudgeState>()
/**
 * Monotonic admitted-step counter per agent.
 *
 * `agent/pre-step` reports a step number that restarts at 1 on every turn, so
 * measuring the interval between two reminders with it makes the difference
 * negative as soon as a turn boundary falls between them, and the reminder stays
 * suppressed for the rest of the session. Counting admitted steps here keeps the
 * interval meaningful.
 */
const stepsSeen = new WeakMap<Agent, number>()

/**
 * Advance the admitted-step counter.
 *
 * Exported because the turn-reset behaviour it compensates for is easy to
 * reintroduce: a caller that passes the event's own `step` suppresses every
 * reminder that would follow a turn boundary.
 * @param previous - counter value seen for this agent, if any.
 * @returns the next counter value.
 */
export function nextStepCounter(previous: number | undefined): number {
  return (previous ?? 0) + 1
}

/** Advance and read this agent's admitted-step counter. */
function nextStep(agent: Agent): number {
  const step = nextStepCounter(stepsSeen.get(agent))
  stepsSeen.set(agent, step)
  return step
}

/**
 * Estimate whether the session is under context pressure.
 * @param ctx - plugin context supplying the token meter and LLM info.
 * @param agent - the agent about to take a step.
 * @param payload - pre-step payload with the model selection and signal.
 * @param config - resolved nudge thresholds.
 * @returns true when a nudge should be emitted.
 */
/**
 * Pure nudge decision: given a priced session and the last nudge state, decide
 * whether to emit a reminder and compute the state to record. Kept separate
 * from context I/O so it can be tested without stubbing the host.
 *
 * @param totalTokens - priced token count of the session.
 * @param window - model context window, or undefined when unknown.
 * @param step - current step number.
 * @param state - state recorded at the previous nudge, if any.
 * @param config - resolved thresholds.
 * @returns whether to nudge and the state to store.
 */
export function nudgePressure(
  totalTokens: number,
  window: number | undefined,
  step: number,
  state: NudgeState | undefined,
  config: Required<NudgeConfig>,
): { nudge: boolean; state: NudgeState | undefined; tokens: number; window: number | undefined } {
  const quiet = { nudge: false, state, tokens: totalTokens, window }
  if (totalTokens < config.minTokens) return quiet
  if (window !== undefined && window > 0 && totalTokens < window * config.ratio) return quiet
  if (window === undefined || window <= 0) {
    if (totalTokens < config.minTokens * 2) return quiet
  }
  if (state !== undefined && step - state.lastStep < config.everySteps) return quiet
  if (state !== undefined && totalTokens < state.lastTokens * 1.02) return quiet
  return { nudge: true, state: { lastStep: step, lastTokens: totalTokens }, tokens: totalTokens, window }
}

/**
 * Resolve model info, price the session and apply the pure nudge decision.
 */
async function shouldNudge(
  ctx: Context,
  agent: Agent,
  payload: { modelSelection: Readonly<{ provider: string; model: string }>; signal: AbortSignal; step: number },
  config: Required<NudgeConfig>,
): Promise<{ nudge: boolean; tokens: number; window: number | undefined }> {
  const measured = ctx.tokenMeter.measure(agent.session)
  const info = await ctx.llm.resolveModelInfo(
    payload.modelSelection.provider,
    payload.modelSelection.model,
    payload.signal,
  )
  const decision = nudgePressure(
    measured.totalTokens,
    info.context?.contextWindow,
    payload.step,
    states.get(agent),
    config,
  )
  if (decision.state !== undefined) states.set(agent, decision.state)
  return { nudge: decision.nudge, tokens: decision.tokens, window: decision.window }
}

/**
 * Register the pre-step nudge listener.
 * @param ctx - plugin context.
 * @param raw - plugin-level nudge configuration.
 * @returns a disposer that removes the listener.
 */
export function registerNudge(ctx: Context, raw: NudgeConfig | (() => NudgeConfig) = {}): () => void {
  const off = ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    const parsed = nudgeConfig(typeof raw === 'function' ? raw() : raw)
    const config: Required<NudgeConfig> = {
      enabled: parsed.enabled ?? true,
      ratio: parsed.ratio ?? DEFAULT_NUDGE_RATIO,
      minTokens: parsed.minTokens ?? DEFAULT_NUDGE_MIN_TOKENS,
      everySteps: parsed.everySteps ?? DEFAULT_NUDGE_EVERY_STEPS,
    }
    if (!config.enabled || decision.kind !== 'enter' || payload.signal.aborted) return decision
    let pressure: { nudge: boolean; tokens: number; window: number | undefined }
    try {
      // The event's own step restarts every turn; the counter does not.
      pressure = await shouldNudge(ctx, payload.agent, { ...payload, step: nextStep(payload.agent) }, config)
    } catch {
      // Never break a step because the nudge could not price the model.
      return decision
    }
    if (!pressure.nudge) return decision

    const reminder: UserMessage = createUserMessage({
      content: [{
        type: 'text',
        text: buildReminder({ tokens: pressure.tokens, window: pressure.window, ratio: config.ratio }),
      }],
      source: {
        kind: 'dsh-span-compaction',
        form: 'nudge',
        summary: 'context pressure: compact at a safe pause or revisit before the final reply',
      },
    })
    return { ...decision, messages: [...decision.messages, reminder] }
  }, { global: true })

  return () => off()
}
