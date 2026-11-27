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
 * Three cadences share that reminder. The interval cadence is the default:
 * `nudgeRatio`, `nudgeMinTokens`, `nudgeEverySteps` and a pressure delta. The
 * turn cadence fires on the first step of a new turn so the model can compact
 * before starting the task; when that step is already above `nudgeStrongRatio`
 * it uses the strong reminder. The strong cadence repeats on every step once
 * `nudgeStrongRatio` is reached. A user who declines a compaction approval stops
 * the strong cadence only for the rest of that turn: the next turn still opens
 * with its reminder, and the strong cadence resumes while pressure stays high.
 *
 * @module dsh-span-compaction/nudge
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { APPROVAL_TOOL } from "./approval.js";
/** Fraction of the model context window at which the nudge starts. */
export const DEFAULT_NUDGE_RATIO = 0.2;
/** Share of the window from which every step carries a reminder. */
export const DEFAULT_NUDGE_STRONG_RATIO = 0.25;
/** Absolute token floor below which no nudge is emitted. */
export const DEFAULT_NUDGE_MIN_TOKENS = 100_000;
/** Minimum steps between two interval nudges for one agent. */
export const DEFAULT_NUDGE_EVERY_STEPS = 10;
/** The reading sentence every reminder variant quotes. */
function pressureReading(facts) {
    const share = facts.window !== undefined && facts.window > 0
        ? Math.round(facts.tokens / facts.window * 100)
        : undefined;
    return share === undefined
        ? `${facts.tokens.toLocaleString('en-US')} priced tokens (model window unknown, floor is twice nudgeMinTokens)`
        : `${facts.tokens.toLocaleString('en-US')} priced tokens, about ${share}% of the ${facts.window.toLocaleString('en-US')}-token window (reminder ratio ${Math.round(facts.ratio * 100)}%)`;
}
/**
 * Build the interval reminder text for one pressure reading.
 *
 * The tool descriptions already explain the rules; the reminder repeats only
 * what decides this call: how much is priced, that one large completed block
 * beats many small nodes, and that a summary longer than its range is a loss.
 *
 * @param facts - priced tokens, window and ratio at the moment of the nudge.
 * @returns the user-visible reminder message.
 */
export function buildReminder(facts) {
    return [
        '<span-compaction-reminder>',
        `Context pressure: ${pressureReading(facts)}. Every later request pays this again.`,
        'Compact at a safe pause rather than waiting for the task to end: you write the summary, compact() replaces the range with it, and no auxiliary summarization request is sent.',
        '- A safe pause is a point where the next step does not depend on the finished history you would replace. If compacting now would interrupt the current work, defer.',
        '- If deferred, revisit at the next safe pause and before sending your final reply. Make one attempt with normal approval when older finished history holds a worthwhile range. Skip it if the user asked you not to retry; if declined, send the final reply without asking again.',
        '- compact_targets gives boundary seqs with token counts; it lists single candidate nodes, not the limit of what may be compacted.',
        '- Prefer ONE large, contiguous, completed block over many small pieces. Net saving is roughly shadowedTokens minus your summary; a span smaller than its summary is a loss.',
        '- Keep out: the current turn, unanswered user questions, pending decisions, and anything still needed verbatim. Older finished turns are fair game even while the task continues; checkpoints and injected reminders are already compressed.',
        '- Do not wait for a new reminder: check finished history at safe milestones so priced history stays near 10% of the window.',
        '</span-compaction-reminder>',
    ].join('\n');
}
/**
 * Build the reminder that repeats on every step above the strong threshold.
 * @param facts - priced tokens, window and ratio at the moment of the nudge.
 * @returns a short reminder that fits every step.
 */
export function buildStrongReminder(facts) {
    return [
        '<span-compaction-reminder>',
        `Context pressure is high: ${pressureReading(facts)}.`,
        'Each step, judge whether a safe cut point exists now. If the next step does not depend on older finished history, compact immediately: call compact_targets, then one compact on the largest finished block with your own summary. Do not wait for the task to end.',
        '- Never compact the current turn, unanswered questions, pending approvals or anything still needed verbatim.',
        '- If the user declined a compaction or asked you not to retry, ignore this and reply.',
        '</span-compaction-reminder>',
    ].join('\n');
}
/**
 * Build the reminder that opens a turn already above the threshold.
 * @param facts - priced tokens, window and ratio at the moment of the nudge.
 * @returns a reminder that asks for compaction before the task starts.
 */
export function buildTurnReminder(facts) {
    return [
        '<span-compaction-reminder>',
        `A new task starts while context is still large: ${pressureReading(facts)}.`,
        'Before you begin, if the previous turn finished work and older history holds a worthwhile block, compact first: call compact_targets, then one compact on the largest finished block with your own summary. Do not carry old history into the new task when it can be compacted now.',
        '- Never compact the current task or anything still in use. If the user declined a compaction or asked you not to retry, start the task normally.',
        '</span-compaction-reminder>',
    ].join('\n');
}
const nudgeConfig = z.object({
    enabled: z.boolean(),
    ratio: z.number(),
    strongRatio: z.number(),
    minTokens: z.number().step(1).min(0),
    everySteps: z.number().step(1).min(1),
});
/** Turn in which a session's user declined a compaction, when there is one. */
const rejectedTurns = new WeakMap();
/** Turn each session is currently in, so a rejection can name its turn. */
const sessionTurns = new WeakMap();
/** Approval requests for the compaction tool, paired with their session. */
const pendingCompactAsks = new Map();
const states = new WeakMap();
/**
 * Monotonic admitted-step counter per agent.
 *
 * `agent/pre-step` reports a step number that restarts at 1 on every turn, so
 * measuring the interval between two reminders with it makes the difference
 * negative as soon as a turn boundary falls between them, and the reminder stays
 * suppressed for the rest of the session. Counting admitted steps here keeps the
 * interval meaningful.
 */
const stepsSeen = new WeakMap();
/** Last turn each agent was seen in, so a new turn is recognized by its number. */
const lastTurns = new WeakMap();
/**
 * Advance the admitted-step counter.
 *
 * Exported because the turn-reset behaviour it compensates for is easy to
 * reintroduce: a caller that passes the event's own `step` suppresses every
 * reminder that would follow a turn boundary.
 * @param previous - counter value seen for this agent, if any.
 * @returns the next counter value.
 */
export function nextStepCounter(previous) {
    return (previous ?? 0) + 1;
}
/** Advance and read this agent's admitted-step counter. */
function nextStep(agent) {
    const step = nextStepCounter(stepsSeen.get(agent));
    stepsSeen.set(agent, step);
    return step;
}
/**
 * Pure nudge decision: given a priced session and the last nudge state, decide
 * whether to emit a reminder and compute the state to record. Kept separate
 * from context I/O so it can be tested without stubbing the host.
 *
 * @param totalTokens - priced token count of the session.
 * @param window - model context window, or undefined when unknown.
 * @param step - current step number (the monotonic counter, not the turn's own step).
 * @param state - state recorded at the previous nudge, if any.
 * @param config - resolved thresholds.
 * @param burst - turn-start request and whether the strong cadence remains allowed.
 *   A turn start above the strong threshold uses the strong reminder and still
 *   ignores the step interval.
 * @returns whether to nudge, the cadence that fired, and the state to store.
 */
export function nudgePressure(totalTokens, window, step, state, config, burst = {}) {
    const quiet = { nudge: false, reason: undefined, state, tokens: totalTokens, window };
    if (totalTokens < config.minTokens)
        return quiet;
    if (window !== undefined && window > 0 && totalTokens < window * config.ratio)
        return quiet;
    if (window === undefined || window <= 0) {
        if (totalTokens < config.minTokens * 2)
            return quiet;
    }
    const next = { lastStep: step, lastTokens: totalTokens };
    const strong = burst.strongEnabled !== false && config.strongRatio > 0
        && window !== undefined && window > 0 && totalTokens >= window * config.strongRatio;
    if (burst.turnStart === true) {
        return { nudge: true, reason: strong ? 'strong' : 'turn', state: next, tokens: totalTokens, window };
    }
    if (strong)
        return { nudge: true, reason: 'strong', state: next, tokens: totalTokens, window };
    if (state !== undefined && step - state.lastStep < config.everySteps)
        return quiet;
    if (state !== undefined && totalTokens < state.lastTokens * 1.02)
        return quiet;
    return { nudge: true, reason: 'interval', state: next, tokens: totalTokens, window };
}
/**
 * Resolve model info, price the session and apply the pure nudge decision.
 */
async function shouldNudge(ctx, agent, payload, config) {
    const measured = ctx.tokenMeter.measure(agent.session);
    const info = await ctx.llm.resolveModelInfo(payload.modelSelection.provider, payload.modelSelection.model, payload.signal);
    const turnStart = lastTurns.get(agent) !== payload.turn;
    lastTurns.set(agent, payload.turn);
    sessionTurns.set(agent.session, payload.turn);
    const decision = nudgePressure(measured.totalTokens, info.context?.contextWindow, nextStep(agent), states.get(agent), config, { strongEnabled: rejectedTurns.get(agent.session) !== payload.turn, turnStart });
    if (decision.state !== undefined)
        states.set(agent, decision.state);
    return { nudge: decision.nudge, reason: decision.reason, tokens: decision.tokens, window: decision.window };
}
/**
 * Register the pre-step nudge listener and the approval audit that pauses the
 * strong cadence for the rest of the turn in which a user declined a compaction.
 * @param ctx - plugin context.
 * @param raw - plugin-level nudge configuration.
 * @returns a disposer that removes both listeners.
 */
export function registerNudge(ctx, raw = {}) {
    const offApproval = ctx.on('session/event', (session, event) => {
        if (event.type === 'approval/asked') {
            if (event.data.toolName === APPROVAL_TOOL)
                pendingCompactAsks.set(event.data.id, session);
            return;
        }
        if (event.type !== 'approval/decided')
            return;
        const asked = pendingCompactAsks.get(event.data.id);
        if (asked === undefined)
            return;
        pendingCompactAsks.delete(event.data.id);
        if (event.data.outcome === 'rejected')
            rejectedTurns.set(asked, sessionTurns.get(asked) ?? -1);
    }, { global: true });
    const offStep = ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        const parsed = nudgeConfig(typeof raw === 'function' ? raw() : raw);
        const config = {
            enabled: parsed.enabled ?? true,
            ratio: parsed.ratio ?? DEFAULT_NUDGE_RATIO,
            strongRatio: parsed.strongRatio ?? DEFAULT_NUDGE_STRONG_RATIO,
            minTokens: parsed.minTokens ?? DEFAULT_NUDGE_MIN_TOKENS,
            everySteps: parsed.everySteps ?? DEFAULT_NUDGE_EVERY_STEPS,
        };
        if (!config.enabled || decision.kind !== 'enter' || payload.signal.aborted)
            return decision;
        let pressure;
        try {
            pressure = await shouldNudge(ctx, payload.agent, payload, config);
        }
        catch {
            // Never break a step because the nudge could not price the model.
            return decision;
        }
        if (!pressure.nudge)
            return decision;
        const facts = { tokens: pressure.tokens, window: pressure.window, ratio: config.ratio };
        const text = pressure.reason === 'strong'
            ? buildStrongReminder(facts)
            : pressure.reason === 'turn'
                ? buildTurnReminder(facts)
                : buildReminder(facts);
        const reminder = createUserMessage({
            content: [{ type: 'text', text }],
            source: {
                kind: 'dsh-span-compaction',
                form: 'nudge',
                summary: pressure.reason === 'strong'
                    ? 'context pressure: compact before finishing this turn'
                    : pressure.reason === 'turn'
                        ? 'context pressure: compact before starting this task'
                        : 'context pressure: compact at a safe pause or revisit before the final reply',
            },
        });
        return { ...decision, messages: [...decision.messages, reminder] };
    }, { global: true });
    return () => {
        offStep();
        offApproval();
    };
}
