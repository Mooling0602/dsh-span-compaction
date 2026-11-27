/**
 * Entry of `dsh-span-compaction`.
 *
 * The loader evaluates this module even when the engine cannot import, so every
 * dependency is loaded lazily and the entry keeps working (with a loud reason)
 * on a host that lacks one of them.
 *
 * @module dsh-span-compaction
 */
import { Context } from '@deepseek-ai/cordis';
import { installPresetGate, isProfileEntry } from "./gate.js";
import { mountHooks } from "./hooks.js";
import { installLiveBudget, readLive } from "./live-config.js";
import { installToolGate } from "./approval.js";
import { conflictError, incompatiblePlugins } from "./conflicts.js";
const CORDIS_INIT = Symbol.for('cordis.init');
let Engine = null;
let Stock = null;
let Schema = null;
let loadError = null;
let DEFAULT_SPAN_BUDGET_TOKENS = 160_000;
try {
    Stock = await import('@deepseek-ai/dsh-compaction-basic');
}
catch (error) {
    loadError ??= error;
}
try {
    Schema = (await import('@deepseek-ai/schemastery')).default;
}
catch (error) {
    loadError ??= error;
}
try {
    const engine = await import("./engine.js");
    Engine = engine.default;
    DEFAULT_SPAN_BUDGET_TOKENS = engine.DEFAULT_SPAN_BUDGET_TOKENS;
}
catch (error) {
    loadError ??= error;
}
/**
 * Reason this package cannot swap in its engine, when one applies.
 * @returns the failure to report at activation, or `undefined`.
 */
function unavailable() {
    if (Engine !== null && Stock !== null && Schema !== null)
        return undefined;
    const reason = loadError instanceof Error ? loadError.message : String(loadError ?? 'unknown');
    return new Error(`dsh-span-compaction: a required dependency is missing (${reason})`);
}
export default class SpanCompaction {
    static inject = Stock?.BasicCompactionEngine?.inject ?? ['llm', 'tokenMeter', 'sessions', 'sessionProjections'];
    static Config = Engine?.Config ?? Stock?.BasicCompactionEngine?.Config ?? Schema?.object({});
    constructor(ctx, config = {}) {
        const failure = unavailable() ?? conflictError(incompatiblePlugins(ctx));
        if (failure !== undefined) {
            // Report the failure from activation so the loader attributes it to this
            // entry instead of leaving a half-mounted composition. A constructor may
            // return an object, so this replaces the half-built plugin with a fiber
            // that throws on init.
            return { [CORDIS_INIT]: async () => { throw failure; } };
        }
        // Only the profile-level row publishes the shared budget; preset instances
        // read it through `effectiveBudget` without remounting.
        if (isProfileEntry(ctx)) {
            ctx.on('plugin-manager/changed', () => {
                try {
                    if (incompatiblePlugins(ctx).length === 0)
                        return;
                    const fibers = [...(ctx.fiber.runtime?.fibers ?? [ctx.fiber])]
                        .filter(fiber => fiber.state === 1 || fiber.state === 2);
                    for (const fiber of fibers)
                        void fiber.restart().catch(error => ctx.logger.warn(error));
                }
                catch (error) {
                    ctx.logger.warn(error);
                }
            }, { global: true });
            installLiveBudget(ctx, () => readLive(config.spanBudgetTokens)
                ?? DEFAULT_SPAN_BUDGET_TOKENS);
            // The tools and the reminder are this bundle's only runtime hooks and they
            // are global, so exactly one entry may mount them. `tools` is optional in
            // this composition: without it the engine still compacts.
            const hooks = config;
            // The gate is global like the tools: `compact` waits for consent and
            // `compact_targets` bypasses downstream policy (such as Auto review) from
            // whichever preset's engine would otherwise handle the call.
            installToolGate(ctx, config);
            ctx.inject(['tools'], inner => inner.effect(() => mountHooks(inner, hooks), 'dsh-span-compaction: tools and reminder'));
        }
        installPresetGate(ctx, config);
        // `unavailable()` returned undefined, so all three imports resolved.
        return new Engine(ctx, config);
    }
}
export { SpanCompaction, DEFAULT_SPAN_BUDGET_TOKENS };
