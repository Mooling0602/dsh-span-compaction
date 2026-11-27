/**
 * Model-facing compaction tools and the context-pressure reminder, plus the
 * configuration keys both read.
 *
 * These used to be a second Loader row of this package. A package may be the
 * source of only one client module row — `client-modules` refuses a package
 * that two active rows resolve to — so the hooks live in the engine entry and
 * register from there.
 *
 * The keys are flat, one per control on the settings page: the shared
 * `SettingsFormModel` addresses a field by its own name inside the section, so a
 * nested object would have no control that could edit it.
 *
 * @module dsh-span-compaction/hooks
 */
import { registerCompressTools } from "./compress-tool.js";
import { registerNudge } from "./nudge.js";
import { readLive } from "./live-config.js";
/**
 * Register the tools and the reminder.
 *
 * Values are read through their volatile references on every step, so a saved
 * setting applies to the next step without restarting the entry.
 * @param ctx - context carrying `tools`; `tokenMeter` and `llm` reach it through inheritance.
 * @param config - resolved plugin configuration.
 * @returns a disposer removing both registrations.
 */
export function mountHooks(ctx, config) {
    const toolsEnabled = () => readLive(config.toolsEnabled) !== false;
    const stopTools = registerCompressTools(ctx, toolsEnabled);
    // A reminder without the tools would point the model at two tools it cannot
    // call, so hiding the tools pauses the reminder instead of leaving it to fire.
    const stopNudge = registerNudge(ctx, () => ({
        enabled: toolsEnabled() && readLive(config.nudgeEnabled) !== false,
        ratio: readLive(config.nudgeRatio),
        strongRatio: readLive(config.nudgeStrongRatio),
        minTokens: readLive(config.nudgeMinTokens),
        everySteps: readLive(config.nudgeEverySteps),
    }));
    return () => {
        stopNudge();
        stopTools();
    };
}
