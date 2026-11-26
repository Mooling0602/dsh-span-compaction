/**
 * Model-facing compaction tools for `dsh-span-compaction` (DCP-style).
 *
 * `compact_targets` lists the current surface spans the model may compress,
 * with a short preview and priced token counts. `compact` commits one chosen
 * span using a summary the model writes itself in the tool arguments, so no
 * auxiliary summarization request is issued and no oversized history is ever
 * sent to the model just to condense it.
 *
 * The actual commit reuses the session's own compaction engine via the native
 * `compactRangeWithSummary` transaction, so every surface consumer (timeline,
 * subagents, the next request) sees the same compacted history.
 *
 * @module dsh-span-compaction/compress-tool
 */
import { deriveEventMessage } from '@deepseek-ai/dsh-session';
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction';
import { ToolContextUnavailableError, defineTool } from '@deepseek-ai/dsh-tools';
/** Maximum characters of a node's text preview shown to the model. */
const PREVIEW_CHARS = 160;
/** Maximum number of single-node cut points returned in one call. */
const MAX_TARGETS = 40;
/** Maximum number of aggregated ranges returned in one call. */
const MAX_RANGES = 5;
/** Minimum priced tokens a span must cover before it is offered as a cut point. */
const MIN_TARGET_TOKENS = 500;
/** Smallest aggregated range worth offering on its own. */
const MIN_RANGE_TOKENS = 5_000;
/** Schema of one offered span, shared by cut points and ranges. */
const spanSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        start: { type: 'number', required: true },
        end: { type: 'number', required: true },
        tokens: { type: 'number', required: true },
        nodes: { type: 'number', required: true },
        preview: { type: 'string', required: true },
    },
};
const targetsOutput = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            targets: { type: 'array', items: spanSchema, required: true },
            ranges: { type: 'array', items: spanSchema, required: true },
            totalTokens: { type: 'number', required: true },
            compactableTokens: { type: 'number', required: true },
            note: { type: 'string', required: true },
        },
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};
const compactOutput = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            ok: { type: 'boolean', required: true },
            start: { type: 'number', required: true },
            end: { type: 'number', required: true },
            shadowedNodes: { type: 'number', required: true },
            shadowedTokens: { type: 'number', required: true },
            message: { type: 'string', required: true },
        },
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};
/**
 * Resolve the span-compaction engine owned by one agent.
 *
 * The engine lives in the agent's isolated preset group; prefer the agent's own
 * context, then fall back to the preset registry's `serviceFor` bridge.
 *
 * @param ctx - this plugin's context (holds `agentPresets` when available).
 * @param agent - the calling agent.
 * @returns the engine, or undefined when the session is not using this plugin.
 */
function engineFor(ctx, agent) {
    // `agent.ctx` belongs to the agent's preset realm, which is where the
    // compaction engine actually lives. Property access on that proxy is gated by
    // inject; `get(name, false)` is the supported non-strict read that bypasses
    // the requirement without triggering `cannot get property ... without inject`.
    const fromAgent = agent.ctx;
    let viaAgent;
    try {
        viaAgent = fromAgent?.get('compaction', false);
    }
    catch {
        viaAgent = undefined;
    }
    if (isSpanEngine(viaAgent))
        return viaAgent;
    // Fall back to this plugin's own realm (host-level engine, when not isolated).
    let viaHost;
    try {
        viaHost = ctx.get('compaction', false);
    }
    catch {
        viaHost = undefined;
    }
    return isSpanEngine(viaHost) ? viaHost : undefined;
}
/** Whether a resolved service is this plugin's engine (has the new method). */
function isSpanEngine(value) {
    return value !== null && typeof value === 'object'
        && typeof value.compactRangeWithSummary === 'function';
}
/**
 * Read a short text preview of one surface node.
 * @param session - owner of the node.
 * @param seq - surface seq to preview.
 * @returns up to PREVIEW_CHARS of the node's text, with whitespace collapsed.
 */
function previewNode(session, seq) {
    const event = session.eventAt(seq);
    if (event === undefined)
        return '';
    const message = deriveEventMessage(event);
    if (message === null)
        return '';
    const parts = [];
    for (const block of message.content) {
        if (block.type === 'text' && block.text.trim().length > 0)
            parts.push(block.text);
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 0)
        return text.slice(0, PREVIEW_CHARS);
    // Tool-bearing nodes often carry no text block; a role label still identifies them.
    return `⟨${message.role} message⟩`;
}
/**
 * Whether a cut immediately before `seq` is tool-pairing balanced.
 * @param session - owner of the node.
 * @param seq - surface seq to check.
 * @returns true when no tool call crosses the leading cut.
 */
function safeBalancedBefore(session, seq) {
    try {
        return toolPairingBalancedBefore(session, seq);
    }
    catch {
        return false;
    }
}
/**
 * Whether a cut immediately after `seq` is tool-pairing balanced.
 * @param session - owner of the node.
 * @param seq - surface seq to check.
 * @returns true when no tool call crosses the trailing cut.
 */
function safeBalancedAfter(session, seq) {
    try {
        return toolPairingBalancedAfter(session, seq);
    }
    catch {
        return false;
    }
}
/**
 * Find the log seq of the durable `turn/start` marker that opened the current turn.
 *
 * The marker is positional truth: every event appended during the turn has a
 * larger seq, so the turn's own content can be excluded without guessing from
 * message text (runtime reminders, checkpoint cards and tool-schema notices all
 * arrive as user-role messages too).
 *
 * @param session - session whose log is scanned.
 * @returns the seq of the newest `turn/start`, or undefined when the log has none.
 */
function currentTurnStart(session) {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
        const event = session.eventAt(seq);
        if (event !== undefined && event.type === 'turn/start')
            return seq;
    }
    return undefined;
}
/**
 * Priced tokens of one inclusive index range in the surface node list.
 * @param prefix - running totals, `prefix[i]` summing nodes `0..i`.
 * @param from - inclusive first node index.
 * @param to - inclusive last node index.
 * @returns the summed route price of the range.
 */
function spanTokens(prefix, from, to) {
    return prefix[to] - (from > 0 ? prefix[from - 1] : 0);
}
/**
 * Choose the ready-made range blocks over the finished surface.
 *
 * Block size is a suggestion: the model writes the summary and nothing is
 * replayed, so the replay budget does not apply here. The last slot absorbs the
 * remainder so the ranges cover the history.
 *
 * A compaction checkpoint keeps the seq of the event that wrote it, so a block
 * that begins at one carries a newer seq than the retained tail that follows.
 * Such a block cannot be expressed as one `start..end` interval — a seq range
 * would either exclude the checkpoint or swallow the tail — so it is left out of
 * `ranges`; `targets` still offers the checkpoint alone.
 *
 * @param nodes - surface nodes in head-to-tail order.
 * @param canStart - surface indices whose leading cut is balanced.
 * @param canEnd - one flag per surface index whose trailing cut is balanced.
 * @param lastIndex - last surface index that may end a block.
 * @param compactableTokens - priced tokens of the finished history.
 * @param mass - priced tokens between two surface indices, inclusive.
 * @param maxRanges - most blocks to emit.
 * @param minRangeTokens - smallest block worth offering.
 * @returns the blocks, in surface order.
 */
export function planRangeBlocks(nodes, canStart, canEnd, lastIndex, compactableTokens, mass, maxRanges = MAX_RANGES, minRangeTokens = MIN_RANGE_TOKENS) {
    const blocks = [];
    if (canStart.length < 2 || compactableTokens < minRangeTokens)
        return blocks;
    const lastBalancedEnd = (from) => {
        for (let index = lastIndex; index >= from; index -= 1) {
            if (canEnd[index] === 1)
                return index;
        }
        return -1;
    };
    const targetMass = Math.max(minRangeTokens, Math.round(compactableTokens / maxRanges));
    let cursor = 1;
    let startIndex = canStart[0];
    while (blocks.length < maxRanges && cursor <= canStart.length) {
        let endIndex = -1;
        if (blocks.length === maxRanges - 1) {
            endIndex = lastBalancedEnd(startIndex);
        }
        else {
            for (let index = startIndex; index <= lastIndex; index += 1) {
                if (canEnd[index] === 1 && mass(startIndex, index) >= targetMass) {
                    endIndex = index;
                    break;
                }
            }
            if (endIndex < 0)
                endIndex = lastBalancedEnd(startIndex);
        }
        if (endIndex < startIndex || nodes[startIndex].seq > nodes[endIndex].seq) {
            // A checkpoint head: start the next block at the next balanced point
            // instead of emitting an interval whose end seq is lower than its start.
            if (cursor >= canStart.length)
                break;
            startIndex = canStart[cursor];
            cursor += 1;
            continue;
        }
        blocks.push({ from: startIndex, to: endIndex });
        while (cursor < canStart.length && canStart[cursor] <= endIndex)
            cursor += 1;
        if (cursor >= canStart.length)
            break;
        startIndex = canStart[cursor];
        cursor += 1;
    }
    return blocks;
}
/**
 * Build the priced, compactable span offers for one session.
 *
 * Two complementary views are returned: `ranges` are ready-made contiguous
 * blocks that together cover the finished history (best net saving per call),
 * and `targets` are the largest single cut points, for reaching into history
 * the ranges do not already cover. The current turn is excluded from both.
 *
 * @param ctx - plugin context supplying the token meter.
 * @param session - session whose surface is inspected.
 * @returns the target value for the model.
 */
export function buildTargets(ctx, session) {
    const measurement = ctx.tokenMeter.measure(session);
    const nodes = measurement.nodes;
    const turnStart = currentTurnStart(session);
    // Everything before the current turn's `turn/start` marker is finished
    // history. Surface order is positional, not seq order (a compaction inserts a
    // fresh high-seq node where the replaced range used to be), so the boundary is
    // found by walking the tail back over the nodes the turn appended.
    let finished = 1;
    if (turnStart === undefined) {
        finished = nodes.length;
    }
    else {
        const marker = turnStart;
        for (let index = nodes.length - 1; index >= 1; index -= 1) {
            if (nodes[index].seq > marker)
                continue;
            finished = index + 1;
            break;
        }
    }
    const prefix = [];
    let running = 0;
    for (const node of nodes) {
        running += node.tokens;
        prefix.push(running);
    }
    // A range may START where the leading cut is balanced and END where the
    // trailing cut is balanced; a single-node target needs both. Requiring both
    // at once for every edge would hide most of a long history from the model.
    const canStart = [];
    const canEnd = new Uint8Array(nodes.length);
    let compactableTokens = 0;
    for (let index = 1; index < finished; index += 1) {
        const node = nodes[index];
        compactableTokens += node.tokens;
        if (safeBalancedBefore(session, node.seq))
            canStart.push(index);
        if (safeBalancedAfter(session, node.seq))
            canEnd[index] = 1;
    }
    const targets = canStart
        .filter(index => canEnd[index] === 1 && nodes[index].tokens >= MIN_TARGET_TOKENS)
        .sort((left, right) => nodes[right].tokens - nodes[left].tokens)
        .slice(0, MAX_TARGETS)
        .sort((left, right) => left - right)
        .map(index => ({
        start: nodes[index].seq,
        end: nodes[index].seq,
        tokens: nodes[index].tokens,
        nodes: 1,
        preview: previewNode(session, nodes[index].seq),
    }));
    const ranges = planRangeBlocks(nodes, canStart, canEnd, finished - 1, compactableTokens, (from, to) => spanTokens(prefix, from, to)).map(block => ({
        start: nodes[block.from].seq,
        end: nodes[block.to].seq,
        tokens: spanTokens(prefix, block.from, block.to),
        nodes: block.to - block.from + 1,
        preview: previewNode(session, nodes[block.from].seq),
    }));
    return {
        targets,
        ranges,
        totalTokens: measurement.totalTokens,
        compactableTokens,
        note: 'Ranges are ready-made contiguous blocks of finished history (the current turn is excluded): prefer the largest one whose details are no longer needed verbatim. Targets are single safe cut points, not the limit — compact accepts any balanced range, and one large block saves far more than many small nodes. Compact as soon as a block of work is finished, without waiting for a reminder.',
    };
}
/**
 * Register `compact_targets` and `compact` on the global tool registry.
 * @param ctx - plugin context.
 */
export function registerCompressTools(ctx, enabled = () => true) {
    // `tools` is declared in this plugin's static inject, so the property is the
    // live registry (the same access pattern the first-party tool plugins use).
    const tools = ctx.tools;
    const disposeTargets = tools.register(defineTool({
        name: 'compact_targets',
        description: [
            'List candidate spans for model-driven compaction, plus what this conversation actually costs.',
            'Proactive policy: compact as soon as a coherent block of work is finished and will not be needed verbatim — after a task, a review round or a debugging session, and before starting a new phase. Do not wait for the user to ask and do not wait for context pressure; raw history is paid for on every later request.',
            '`ranges` are ready-made contiguous blocks that together cover the finished history, each with its node count and priced tokens: compact the largest one whose details are no longer needed verbatim. `targets` are the largest single safe cut points, for reaching into history the ranges do not already cover. Neither list is the limit — compact() accepts any balanced start..end range.',
            'compactableTokens is the priced total of all finished history, so it is the honest upper bound of one call; the current turn is excluded from every offer. A healthy session keeps totalTokens near 10% of the model window.',
            'Never include in a range: the current task, unanswered user questions, pending approvals, or anything still needed verbatim.',
        ].join(' '),
        parameters: {},
        output: targetsOutput,
        execute: async (_args, exec) => {
            const agent = exec.agent;
            if (agent === undefined) {
                throw new ToolContextUnavailableError('compact_targets requires a calling agent');
            }
            return buildTargets(ctx, agent.session);
        },
    }), { when: () => enabled() });
    const disposeCompact = tools.register(defineTool({
        name: 'compact',
        description: [
            'Replace one conversation range with a durable technical summary you write yourself; no auxiliary summarization request is sent and the range is never replayed to the model.',
            'Use it proactively at every milestone: when a block of work is done (task complete, review finished, debugging closed) and its details will not be needed verbatim, fold it now. Do not wait for the user to ask and do not wait for a reminder.',
            'Choose the range to maximise net reduction: prefer one large, contiguous, completed block (an old task with its debugging, a finished review) over many small nodes. Net saving is roughly shadowedTokens minus the summary you write, so a span smaller than its own summary loses.',
            'start and end must be surface seqs that do not split a tool call/result pair; an unbalanced pair fails the call — read the error and adjust the edge.',
            'Keep out of the range: the current task, unanswered user questions, pending approvals, or anything still needed verbatim — carry those facts in the summary instead. Checkpoints and re-injected system reminders are already compressed, so skipping them costs little.',
            'Compaction is expected, not optional: a long session stays affordable only while finished work keeps being folded into summaries, and the checkpoint card preserves what a later turn needs.',
        ].join(' '),
        parameters: {
            start: {
                type: 'number',
                required: true,
                description: 'Inclusive first surface seq of the range. Any balanced seq works; compact_targets offers candidates.',
            },
            end: {
                type: 'number',
                required: true,
                description: 'Inclusive last surface seq of the range. May be far after start to cover one large completed block.',
            },
            summary: {
                type: 'string',
                required: true,
                description: 'The technical summary that replaces the range: objectives, decisions and why, constraints, progress, files and paths touched, verification results, and open work. Read like a handoff brief for someone continuing this task. Keep it far shorter than the range and leave out anything the session or the files still carry.',
            },
            topic: {
                type: 'string',
                description: 'Optional short label for the checkpoint card.',
            },
        },
        output: compactOutput,
        execute: async (args, exec) => {
            const agent = exec.agent;
            if (agent === undefined)
                throw new ToolContextUnavailableError('compact requires a calling agent');
            const engine = engineFor(ctx, agent);
            if (engine === undefined) {
                throw new ToolContextUnavailableError('compact requires the dsh-span-compaction engine on this session');
            }
            const start = args.start;
            const end = args.end;
            const summary = args.summary.trim();
            if (summary.length === 0)
                throw new Error('compact: summary must not be empty');
            try {
                const result = await engine.compactRangeWithSummary(start, end, agent, summary, exec.signal);
                return {
                    ok: true,
                    start,
                    end,
                    shadowedNodes: result.shadowedSeqs.length,
                    shadowedTokens: result.shadowedTokenCount,
                    message: `Compacted surface seqs ${start}-${end} into a model-authored summary (${result.shadowedTokenCount} priced tokens shadowed; net saving is that minus this summary).`,
                };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    ok: false,
                    start,
                    end,
                    shadowedNodes: 0,
                    shadowedTokens: 0,
                    message: `Compaction failed: ${message}`,
                };
            }
        },
    }), { when: () => enabled() });
    return () => {
        disposeCompact();
        disposeTargets();
    };
}
