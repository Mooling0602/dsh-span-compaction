/**
 * Checks `narrowRange` against a synthetic surface: the engine must cut a
 * selected range down to the largest balanced prefix that fits the budget, and
 * leave the range alone when it already fits.
 *
 * Run with `node test/engine.test.ts`; the host packages are resolved from the
 * installation, so this file is skipped when they are absent.
 */

import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Engine: any = null
try {
  Engine = (await import('../src/engine.ts')).default
} catch (error) {
  console.log(`skip engine checks: ${(error as Error).message}`)
  process.exit(0)
}

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

/** Build a session stub whose surface and tool pairing are fully determined. */
function makeSession(spec: Array<{ seq: number; tokens: number }>) {
  const events = new Map<number, unknown>()
  for (const node of spec) events.set(node.seq, node)
  return {
    surface: {
      nodes: spec.map(node => node.seq),
      replaceGeneration: 0,
    },
    eventAt: (seq: number) => events.get(seq),
  }
}

/** A turn of plain user/assistant messages: every cut is balanced. */
function messageNode(seq: number, tokens: number) {
  return { seq, tokens, type: 'user/message', data: { content: [{ type: 'text', text: 'x' }] } }
}

/** An assistant message that opens a tool call the next node answers. */
function callNode(seq: number, tokens: number) {
  return {
    seq,
    tokens,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'tool-call', id: `c${seq}`, name: 'read', arguments: '{}' }] } },
  }
}

/** The tool result closing the call opened by `callNode`. */
function resultNode(seq: number, tokens: number) {
  return { seq, tokens, type: 'tool/result', data: { turn: 1, step: 1, message: { content: [] } } }
}

function engineWith(budget: number) {
  const engine = Object.create(Engine.prototype)
  engine.spanBudgetTokens = budget
  engine.ctx = {
    tokenMeter: { measure: (session: ReturnType<typeof makeSession>) => ({ nodes: session.surface.nodes.map(seq => ({ seq, tokens: (session.eventAt(seq) as { tokens: number }).tokens })) }) },
    logger: { info: () => {} },
  }
  return engine
}

test('a range that fits the budget is left untouched', () => {
  const session = makeSession([messageNode(10, 10), messageNode(11, 10), messageNode(12, 10)])
  assert.equal(engineWith(1000).narrowRange(session, 10, 12), 12)
})

test('an oversized range is cut before the node that overflows', () => {
  const session = makeSession([messageNode(10, 10), messageNode(11, 10), messageNode(12, 300), messageNode(13, 10)])
  assert.equal(engineWith(100).narrowRange(session, 10, 13), 11)
})

test('a cut inside a tool call retreats to the pairing boundary', () => {
  // 10 opens a call answered by 11: budget stops after 11, which is balanced.
  const session = makeSession([callNode(10, 10), resultNode(11, 10), callNode(12, 10), resultNode(13, 10)])
  assert.equal(engineWith(25).narrowRange(session, 10, 13), 11)
})

test('a budget that only reaches an unanswered call retreats further', () => {
  // 12 opens a call answered by 13; a cut after 12 is unbalanced, so it lands after 11.
  const session = makeSession([callNode(10, 10), resultNode(11, 10), callNode(12, 10), resultNode(13, 10)])
  assert.equal(engineWith(35).narrowRange(session, 10, 13), 11)
})

test('an unknown boundary leaves the range alone', () => {
  const session = makeSession([messageNode(10, 10)])
  assert.equal(engineWith(1).narrowRange(session, 99, 10), 10)
})

console.log(`\n${passed} checks passed`)
