/**
 * Runtime root lookup across the Cordis generations DSH ships.
 *
 * Cordis 4.2 exposes the root context on a symbol key (`Context.root`), while
 * 4.1 only exposes the `ctx.root` property. Reading the static through a
 * structural assertion keeps this module compilable against either generation,
 * and the property fallback keeps it working on a runtime that has no symbol.
 *
 * @module dsh-span-compaction/runtime-root
 */

import { Context } from '@deepseek-ai/cordis'

/** Static key Cordis 4.2 publishes for the runtime root; absent in 4.1. */
const ROOT_KEY = (Context as unknown as { root?: symbol }).root

/**
 * Resolve the root context of the runtime this context belongs to.
 *
 * @param ctx - any context of the runtime.
 * @returns the symbol-addressed root, the `root` property, or the context itself.
 */
export function runtimeRoot(ctx: Context): Context {
  const viaSymbol = ROOT_KEY === undefined
    ? undefined
    : (ctx as unknown as Record<symbol, Context | undefined>)[ROOT_KEY]
  return viaSymbol ?? (ctx as Context & { root?: Context }).root ?? ctx
}
