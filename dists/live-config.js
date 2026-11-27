import { runtimeRoot } from "./runtime-root.js";
export function readLive(value) {
    if (value === undefined)
        return undefined;
    return value !== null && typeof value === 'object' && 'get' in value
        && typeof value.get === 'function' ? value.get() : value;
}
const budgets = new WeakMap();
/** Publish the profile-level budget; presets read it on each compaction pass. */
export function installLiveBudget(ctx, source) {
    const root = runtimeRoot(ctx);
    ctx.effect(() => {
        budgets.set(root, source);
        return () => {
            if (budgets.get(root) === source)
                budgets.delete(root);
        };
    }, 'span compaction live budget');
}
/** Root budget wins for all Span instances in this runtime, without remounting presets. */
export function effectiveBudget(ctx, fallback) {
    return budgets.get(runtimeRoot(ctx))?.() ?? readLive(fallback);
}
