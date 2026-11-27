/**
 * Per-call approval gate for the two compaction tools.
 *
 * `compact` replaces retained conversation history with a summary the model
 * wrote, so under every interactive approval policy the call waits for the
 * user's explicit consent. `compact_targets` only lists candidates and never
 * changes history, so it bypasses the whole downstream pre-execute chain —
 * notably the Auto review reviewer, which would otherwise resend the retained
 * history for every listing.
 *
 * The gate is the outermost `tools/pre-execute` listener: returning a decision
 * without calling `next()` vetoes the remaining chain. Whether `compact` asks
 * follows the session's approval policy, so Full access (`never`) keeps its
 * no-prompt contract while every interactive preset (`ask`, including Auto)
 * asks.
 *
 * @module dsh-span-compaction/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { readLive, type LiveValue } from './live-config.ts'
import { runtimeRoot } from './runtime-root.ts'

/** Tool that discards retained history and therefore needs explicit consent. */
export const APPROVAL_TOOL = 'compact'
/** Read-only listing tool that never needs a policy decision. */
export const EXEMPT_TOOL = 'compact_targets'

/** Approval policy values this gate distinguishes. */
export type ApprovalPolicy = 'ask' | 'never'

/** Configuration this module reads; both keys are volatile references. */
export interface ApprovalConfig {
  /** Ask for consent before `compact` runs. */
  approveCompact?: LiveValue<boolean>
  /** Let `compact_targets` bypass downstream pre-execute policy. */
  exemptTargets?: LiveValue<boolean>
}

/** What the gate does with one call. */
export type GateAction = 'allow' | 'ask' | 'pass'

/** Approval surface the gate reads; the host service provides it. */
interface ApprovalLike {
  overrideOf(session: Session): ApprovalPolicy | undefined
  config?: { policy?: ApprovalPolicy | null }
}

/** Audited English reason attached to the approval request. */
export const ASK_REASON = 'compaction replaces retained conversation history with a model-written summary'

/** Approval-card copy by locale; the request keeps the raw reason alongside it. */
export const ASK_DISPLAY_REASON: { readonly en: string; readonly [locale: string]: string } = {
  en: 'Span compaction replaces this range with a summary. Approve this one call to run it.',
  zh: '分段压缩会用摘要替换这段历史，是否允许本次压缩？',
  ja: 'スパン圧縮はこの範囲を要約で置き換えます。今回の実行を許可しますか？',
}

/**
 * Decide one call from the tool name, the session's approval policy and the
 * configured switches.
 *
 * `pass` delegates to the rest of the pre-execute chain, so another policy (or
 * the built-in guards that run after an allow) still sees the call.
 *
 * @param tool - model-facing tool name.
 * @param policy - the session's effective approval policy.
 * @param config - resolved plugin configuration.
 * @returns the veto, the approval request, or a delegation.
 */
export function gateAction(
  tool: string,
  policy: ApprovalPolicy | undefined,
  config: ApprovalConfig = {},
): GateAction {
  if (tool === EXEMPT_TOOL) return readLive(config.exemptTargets) === false ? 'pass' : 'allow'
  if (tool !== APPROVAL_TOOL) return 'pass'
  if (readLive(config.approveCompact) === false) return 'pass'
  return policy === 'never' ? 'pass' : 'ask'
}

/** Runtime roots whose gate already runs; one gate per runtime is enough. */
const installed = new WeakSet<Context>()

/**
 * Read the approval service without making it a hard dependency: a host that
 * composes no approval capability simply keeps the pipeline's own decision.
 * @param ctx - any context of the runtime.
 * @returns the approval surface, when the host provides one.
 */
function approvalOf(ctx: Context): ApprovalLike | undefined {
  const get = (ctx as unknown as { get(key: string): unknown }).get
  const service = get.call(ctx, 'approval')
  return service === null || typeof service !== 'object' ? undefined : service as ApprovalLike
}

/**
 * Install the gate for the lifetime of this context.
 *
 * Only the profile-level entry installs it, so the listener sits on the runtime
 * root and covers every preset's agents; a nested entry must not shadow it.
 *
 * @param ctx - context of the profile-level plugin entry.
 * @param config - resolved plugin configuration.
 */
export function installToolGate(ctx: Context, config: ApprovalConfig = {}): void {
  const root: Context = runtimeRoot(ctx)
  if (installed.has(root)) return
  installed.add(root)
  ctx.effect(() => () => {
    if (installed.has(root)) installed.delete(root)
  }, 'span compaction tool gate')
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const session = exec.agent?.session
    if (session === undefined) return next()
    const approval = approvalOf(ctx)
    if (approval === undefined) return next()
    const policy = approval.overrideOf(session) ?? approval.config?.policy ?? 'ask'
    switch (gateAction(exec.name, policy, config)) {
      case 'allow':
        return { kind: 'allow' }
      case 'ask':
        return { kind: 'ask', reason: ASK_REASON, displayReason: ASK_DISPLAY_REASON }
      default:
        return next()
    }
  }, { prepend: true })
}
