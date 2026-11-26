/**
 * Entry of `dsh-span-compaction`.
 *
 * The loader evaluates this module even when the engine cannot import, so every
 * dependency is loaded lazily and the entry keeps working (with a loud reason)
 * on a host that lacks one of them.
 *
 * @module dsh-span-compaction
 */

import { Context } from '@deepseek-ai/cordis'
import { installPresetGate, isProfileEntry } from './gate.ts'
import { mountHooks, type HooksConfig } from './hooks.ts'
import { installLiveBudget, readLive, type LiveValue } from './live-config.ts'
import { installToolGate, type ApprovalConfig } from './approval.ts'

const CORDIS_INIT = Symbol.for('cordis.init')

// The loader loads this entry before the host packages may be resolvable, so all
// three host imports are deliberately dynamic. Their concrete shapes are only
// needed at construction time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostModule = Record<string, any>
interface EngineConstructor {
  new (ctx: Context, config: Record<string, unknown>): SpanCompaction
  Config?: unknown
}

let Engine: EngineConstructor | null = null
let Stock: HostModule | null = null
let Schema: HostModule | null = null
let loadError: unknown = null
let DEFAULT_SPAN_BUDGET_TOKENS = 160_000

try {
  Stock = await import('@deepseek-ai/dsh-compaction-basic')
} catch (error) {
  loadError ??= error
}
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch (error) {
  loadError ??= error
}
try {
  const engine = await import('./engine.ts')
  Engine = engine.default as EngineConstructor
  DEFAULT_SPAN_BUDGET_TOKENS = engine.DEFAULT_SPAN_BUDGET_TOKENS
} catch (error) {
  loadError ??= error
}

/**
 * Reason this package cannot swap in its engine, when one applies.
 * @returns the failure to report at activation, or `undefined`.
 */
function unavailable(): Error | undefined {
  if (Engine !== null && Stock !== null && Schema !== null) return undefined
  const reason = loadError instanceof Error ? loadError.message : String(loadError ?? 'unknown')
  return new Error(`dsh-span-compaction: a required dependency is missing (${reason})`)
}

export default class SpanCompaction {
  static inject = Stock?.BasicCompactionEngine?.inject ?? ['llm', 'tokenMeter', 'sessions', 'sessionProjections']

  static Config = Engine?.Config ?? Stock?.BasicCompactionEngine?.Config ?? Schema?.object({})

  constructor(ctx: Context, config: Record<string, unknown> = {}) {
    const failure = unavailable()
    if (failure !== undefined) {
      // Report the failure from activation so the loader attributes it to this
      // entry instead of leaving a half-mounted composition. A constructor may
      // return an object, so this replaces the half-built plugin with a fiber
      // that throws on init.
      return { [CORDIS_INIT]: async () => { throw failure } } as unknown as SpanCompaction
    }
    // Only the profile-level row publishes the shared budget; preset instances
    // read it through `effectiveBudget` without remounting.
    if (isProfileEntry(ctx)) {
      installLiveBudget(ctx, () => readLive(config.spanBudgetTokens as LiveValue<number> | undefined)
        ?? DEFAULT_SPAN_BUDGET_TOKENS)
      // The tools and the reminder are this bundle's only runtime hooks and they
      // are global, so exactly one entry may mount them. `tools` is optional in
      // this composition: without it the engine still compacts.
      const hooks = config as HooksConfig
      // The gate is global like the tools: `compact` waits for consent and
      // `compact_targets` bypasses downstream policy (such as Auto review) from
      // whichever preset's engine would otherwise handle the call.
      installToolGate(ctx, config as ApprovalConfig)
      ctx.inject(['tools'], inner => inner.effect(
        () => mountHooks(inner, hooks),
        'dsh-span-compaction: tools and reminder',
      ))
    }
    installPresetGate(ctx, config as { takeoverPresets?: boolean })
    // `unavailable()` returned undefined, so all three imports resolved.
    return new Engine!(ctx, config)
  }
}

export { SpanCompaction, DEFAULT_SPAN_BUDGET_TOKENS }
