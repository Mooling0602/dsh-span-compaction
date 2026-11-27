/**
 * Preset takeover: make every agent preset load this plugin's engine instead of
 * the stock one.
 *
 * A profile patch cannot address entries nested inside an agent preset, and the
 * session's engine lives inside a preset group that isolates `compaction`. The
 * supported seam is the `internal/config` waterfall, which sees each resolved
 * configuration before the loader mounts it; renaming the row there swaps the
 * implementation for that group only.
 *
 * Two rules keep this compatible with a host that also ships its own gate: a row
 * inside an isolated compaction group is renamed even when disabled, because
 * that row is the session engine this plugin exists to replace; a row anywhere
 * else is renamed only when the host left it enabled.
 *
 * @module dsh-span-compaction/gate
 */
import { runtimeRoot } from "./runtime-root.js";
/** Package name of the stock engine this plugin replaces. */
export const STOCK_ENGINE = '@deepseek-ai/dsh-compaction-basic';
/** Specifier the loader resolves to this plugin's entry. */
export const PLUGIN_NAME = 'dsh-span-compaction';
/** Incompatible plugin IDs and their component identifiers; add future plugins here. */
export const COMPETING_COMPONENTS = {
    'billion-context': ['billion-context', 'bili-native'],
};
/** Cordis fiber states during which a plugin actually runs (LOADING, ACTIVE). */
const RUNNING = new Set([1, 2]);
/** Shallowest entry that already installed a gate, per runtime root. */
const installedGates = new WeakMap();
/**
 * Compressors currently mounted in this runtime.
 * @param ctx - any context of the runtime.
 * @returns names of the running competing compressors.
 */
export function competingCompressors(ctx) {
    const found = [];
    let registry;
    try {
        registry = ctx?.registry;
    }
    catch {
        return found;
    }
    if (registry === undefined || registry === null || typeof registry.values !== 'function')
        return found;
    try {
        for (const runtime of registry.values()) {
            const name = runtime?.name;
            if (name === undefined)
                continue;
            const plugin = Object.entries(COMPETING_COMPONENTS).find(([id, components]) => id === name || components.includes(name))?.[0];
            if (plugin === undefined)
                continue;
            const running = [...(runtime.fibers ?? [])].some(fiber => fiber !== undefined && RUNNING.has(fiber.state));
            if (running && !found.includes(plugin))
                found.push(plugin);
        }
    }
    catch {
        // A host that cannot enumerate its registry simply has no known competitor.
    }
    return found;
}
/**
 * Rename stock engine rows into this plugin.
 *
 * A row inside an isolated compaction group is the engine a session actually
 * uses, so a host that marked it `disabled` is overriding exactly the behaviour
 * this plugin exists to provide; that mark is dropped along with the rename.
 *
 * @param node - resolved configuration subtree.
 * @param isolated - whether the subtree sits inside an isolated compaction group.
 * @returns a rewritten subtree, or the same reference when nothing changed.
 */
export function rewriteStockRows(node, isolated = false) {
    if (Array.isArray(node)) {
        let changed = false;
        const next = node.map(item => {
            const rewritten = rewriteStockRows(item, isolated);
            if (rewritten !== item)
                changed = true;
            return rewritten;
        });
        return changed ? next : node;
    }
    if (node === null || typeof node !== 'object')
        return node;
    const record = node;
    const isolate = record.isolate;
    const inner = isolated || (record.group === true && isolate?.compaction === true);
    if (record.name === STOCK_ENGINE && (inner || record.disabled !== true)) {
        const { disabled: _disabled, ...rest } = record;
        void _disabled;
        return { ...rest, name: PLUGIN_NAME };
    }
    let next = record;
    if (Array.isArray(record.plugins)) {
        const plugins = rewriteStockRows(record.plugins, inner);
        if (plugins !== record.plugins)
            next = { ...next, plugins };
    }
    if (Array.isArray(record.config)) {
        const config = rewriteStockRows(record.config, inner);
        if (config !== record.config)
            next = { ...next, config };
    }
    else if (record.config !== null && typeof record.config === 'object') {
        const config = rewriteStockRows(record.config, inner);
        if (config !== record.config)
            next = { ...next, config };
    }
    return next;
}
/**
 * Counting depth of this context's entry; the root entry is the shallowest.
 * @param ctx - context of a plugin entry.
 * @returns the number of enclosing plugin entries.
 */
function entryDepth(ctx) {
    let depth = 0;
    let fiber;
    try {
        fiber = ctx?.fiber;
    }
    catch {
        return depth;
    }
    // `Fiber.parent` is a Context, not a Fiber: hop through it to stay on fibers,
    // and stop at the root, whose `runtime` is null.
    while (fiber !== undefined && fiber !== null && fiber.runtime !== null && fiber.runtime !== undefined) {
        depth += 1;
        try {
            fiber = fiber.parent?.fiber;
        }
        catch {
            break;
        }
    }
    return depth;
}
/**
 * Whether this context is the profile-level row of this bundle, the one the
 * settings page edits.
 *
 * The gate renames stock engine rows inside presets to this plugin, so several
 * entries of the same package coexist. Only the profile-level row may publish
 * the shared replay budget: a preset instance must never win that race merely
 * because the preset was mounted first.
 *
 * @param ctx - context of a plugin entry.
 * @returns true for the profile-level entry.
 */
export function isProfileEntry(ctx) {
    const id = entryId(ctx);
    // The bundle's own patch names this row; a preset row keeps the preset's id.
    if (id === 'span-compaction')
        return true;
    return entryDepth(ctx) === 0;
}
/** Loader row id of this context's entry, when the host exposes it. */
function entryId(ctx) {
    try {
        const fiber = ctx?.fiber;
        const id = fiber?.entry?.options?.id;
        return typeof id === 'string' ? id : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Whether this context is the shallowest entry of this plugin in the runtime.
 * Only that entry should install runtime-wide registrations (tools, nudge).
 *
 * @param ctx - context of a plugin entry.
 * @param config - resolved plugin configuration.
 * @returns true when this entry owns the runtime-wide hook layer.
 */
export function ownsRuntimeHooks(ctx, config = {}) {
    if (config.takeoverPresets === false)
        return true;
    const root = runtimeRoot(ctx);
    const depth = entryDepth(ctx);
    const previous = installedGates.get(root);
    return previous === undefined || depth <= previous.depth;
}
/**
 * Install the preset takeover for the lifetime of this context.
 *
 * One gate per runtime is enough, and a nested entry must not shadow it: the
 * loader also mounts this plugin inside each preset it rewrote, and those
 * entries are deeper than the profile-level one.
 *
 * @param ctx - context of this plugin's own entry.
 * @param config - resolved plugin configuration.
 */
export function installPresetGate(ctx, config = {}) {
    if (config.takeoverPresets === false)
        return;
    const root = runtimeRoot(ctx);
    const depth = entryDepth(ctx);
    const previous = installedGates.get(root);
    if (previous !== undefined && (previous.active || depth > previous.depth))
        return;
    const gate = { depth, active: true };
    installedGates.set(root, gate);
    ctx.effect(() => () => {
        if (installedGates.get(root) === gate)
            gate.active = false;
    }, 'span compaction preset gate');
    ctx.on('internal/config', (_fiber, next) => {
        const resolved = next();
        return gate.active ? rewriteStockRows(resolved) : resolved;
    }, { global: true });
}
