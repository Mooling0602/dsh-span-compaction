/** Small live-config bridge shared by the host entry and isolated preset engines. */
import { Context } from '@deepseek-ai/cordis'

export type LiveValue<T> = T | { get(): T }

/** Read both plain configuration (direct callers) and Cordis volatile references. */
export function readLive<T>(value: LiveValue<T>): T
export function readLive<T>(value: LiveValue<T> | undefined): T | undefined
export function readLive<T>(value: LiveValue<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  return value !== null && typeof value === 'object' && 'get' in value
    && typeof value.get === 'function' ? value.get() : value as T
}

const budgets = new WeakMap<Context, () => number>()

/** Publish the profile-level budget; presets read it on each compaction pass. */
export function installLiveBudget(ctx: Context, source: () => number): void {
  const root = ctx[Context.root] ?? ctx
  ctx.effect(() => {
    budgets.set(root, source)
    return () => {
      if (budgets.get(root) === source) budgets.delete(root)
    }
  }, 'span compaction live budget')
}

/** Root budget wins for all Span instances in this runtime, without remounting presets. */
export function effectiveBudget(ctx: Context, fallback: LiveValue<number>): number {
  return budgets.get(ctx[Context.root] ?? ctx)?.() ?? readLive(fallback)
}
