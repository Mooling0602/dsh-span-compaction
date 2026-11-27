/**
 * Checks for the two pure modules: span planning and config rewriting.
 * Run with `node test/pure.test.ts`. Imports the TypeScript sources directly;
 * Node v24+ strips types natively.
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { planSpanCut, spanTotal } from '../src/span.ts'
import { STOCK_ENGINE, PLUGIN_NAME, rewriteStockRows } from '../src/gate.ts'
import { runtimeRoot } from '../src/runtime-root.ts'

let passed = 0
function test(name: string, body: () => void) {
  try {
    body()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}\n${(error as Error).stack}`)
    process.exitCode = 1
  }
}

const alwaysBalanced = () => true

test('spanTotal sums every price', () => {
  assert.equal(spanTotal([10, 20, 30]), 60)
  assert.equal(spanTotal([]), 0)
})

test('a range shorter than two nodes never narrows', () => {
  assert.equal(planSpanCut([], 100, alwaysBalanced), null)
  assert.equal(planSpanCut([50], 100, alwaysBalanced), null)
})

test('a range that fits the budget keeps its last node', () => {
  assert.equal(planSpanCut([10, 20, 30], 100, alwaysBalanced), 2)
})

test('an oversized range stops before the node that overflows', () => {
  // 10 + 20 fits, adding 300 does not.
  assert.equal(planSpanCut([10, 20, 300, 5], 100, alwaysBalanced), 1)
})

test('the first node is always kept so a pass can make progress', () => {
  assert.equal(planSpanCut([500, 500], 10, alwaysBalanced), 0)
})

test('an unbalanced cut walks back to a tool-pairing boundary', () => {
  // Index 2 fits but splits a tool call from its result, so the cut retreats.
  assert.equal(planSpanCut([10, 10, 10], 100, (index) => index !== 2), 1)
})

test('no balanced cut at all means the range is left alone', () => {
  assert.equal(planSpanCut([10, 10, 10], 100, () => false), null)
})

test('a disabled row elsewhere is left for the host', () => {
  const rows = [{ id: 'compaction-basic', name: STOCK_ENGINE, disabled: true }]
  assert.equal(rewriteStockRows(rows), rows)
})

test('an enabled row elsewhere is renamed', () => {
  const rows = [{ id: 'compaction-basic', name: STOCK_ENGINE }]
  assert.deepEqual(rewriteStockRows(rows), [{ id: 'compaction-basic', name: PLUGIN_NAME }])
})

test('a disabled row inside an isolated compaction group is renamed and re-enabled', () => {
  const rows = [{
    id: 'compaction',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [{ id: 'compaction-basic', name: STOCK_ENGINE, disabled: true, config: { auto: false } }],
  }]
  assert.deepEqual(rewriteStockRows(rows), [{
    id: 'compaction',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [{ id: 'compaction-basic', name: PLUGIN_NAME, config: { auto: false } }],
  }])
})

test('nested plugins arrays are rewritten too', () => {
  const rows = [{ plugins: [{ name: STOCK_ENGINE }] }]
  assert.deepEqual(rewriteStockRows(rows), [{ plugins: [{ name: PLUGIN_NAME }] }])
})

test('an untouched tree keeps its identity', () => {
  const rows = [{ id: 'other', name: '@deepseek-ai/dsh-base' }]
  assert.equal(rewriteStockRows(rows), rows)
  const nested = [{ plugins: [{ id: 'other' }] }]
  assert.equal(rewriteStockRows(nested), nested)
})

const CORDIS_ROOT = (Context as unknown as { root?: symbol }).root

test('runtimeRoot prefers the symbol-addressed root of Cordis 4.2', () => {
  assert.notEqual(CORDIS_ROOT, undefined)
  const root = {}
  const ctx = { [CORDIS_ROOT!]: root }
  assert.equal(runtimeRoot(ctx as never), root)
})

test('runtimeRoot falls back to the root property Cordis 4.1 exposes', () => {
  const root = {}
  assert.equal(runtimeRoot({ root } as never), root)
})

test('runtimeRoot returns the context itself when no root is exposed', () => {
  const ctx = {}
  assert.equal(runtimeRoot(ctx as never), ctx)
})

console.log(`\n${passed} checks passed`)
