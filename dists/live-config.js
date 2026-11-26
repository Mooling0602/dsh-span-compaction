/** Small live-config bridge shared by the host entry and isolated preset engines. */
import { Context } from '@deepseek-ai/cordis';
export function readLive(value) {
    if (value === undefined)
        return undefined;
    return value !== null && typeof value === 'object' && 'get' in value
        && typeof value.get === 'function' ? value.get() : value;
}
const budgets = new WeakMap();
/** Publish the profile-level budget; presets read it on each compaction pass. */
export function installLiveBudget(ctx, source) {
    const root = ctx[Context.root] ?? ctx;
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
    return budgets.get(ctx[Context.root] ?? ctx)?.() ?? readLive(fallback);
}
