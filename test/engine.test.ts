/**
 * Check replay cuts and fallback retries through the native compaction transaction.
 * Run with `node test/engine.test.ts`.
 */

import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Engine, { DEFAULT_SPAN_BUDGET_TOKENS } from '../src/engine.ts'

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

test('the schema preserves zero, defaults an omitted budget, and rejects invalid budgets', () => {
  const parseConfig = Engine.Config as unknown as (input: { spanBudgetTokens?: number }) => {
    spanBudgetTokens: { get(): number }
  }
  assert.equal(parseConfig({ spanBudgetTokens: 0 }).spanBudgetTokens.get(), 0)
  assert.equal(parseConfig({}).spanBudgetTokens.get(), DEFAULT_SPAN_BUDGET_TOKENS)
  for (const spanBudgetTokens of [-1, 0.5]) {
    assert.throws(() => parseConfig({ spanBudgetTokens }), /spanBudgetTokens/)
  }
})

test('a zero budget preserves the selected range without measuring it', () => {
  const session = makeSession([messageNode(10, 10), messageNode(11, 300), messageNode(12, 10)])
  const engine = engineWith(0)
  engine.ctx.tokenMeter.measure = () => assert.fail('no plugin measurement is needed without a budget')
  assert.equal(engine.narrowRange(session, 10, 12), 12)
})

test('changing a live budget to zero and back takes effect on the next range', () => {
  const session = makeSession([messageNode(10, 10), messageNode(11, 300), messageNode(12, 10)])
  const engine = engineWith(100)
  let budget = 100
  engine.spanBudgetTokens = { get: () => budget }
  assert.equal(engine.narrowRange(session, 10, 12), 10)
  budget = 0
  assert.equal(engine.narrowRange(session, 10, 12), 12)
  budget = 100
  assert.equal(engine.narrowRange(session, 10, 12), 10)
})

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

function retryFixture(budget: number, fail: (attempt: number) => void) {
  const session = Session.create(SessionId('span-budget-retry'))
  session.append('turn/start', { turn: 1 })
  const costs = new Map<number, number>()
  const range = [50_000, 80_000, 90_000, 110_000].map((tokens, index) => {
    const { seq } = session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: `node ${index}` }],
    }), { surfaceOp: 'append' })
    costs.set(seq, tokens)
    return seq
  })
  const engine = engineWith(budget)
  const replayLengths: number[] = []
  engine.ctx.tokenMeter = {
    measure: () => ({ nodes: session.surface.nodes.map(seq => {
      const tokens = costs.get(seq) ?? 1
      return { seq, tokens, heuristicTokens: tokens }
    }) }),
    estimateMessage: () => 1,
  }
  engine.ctx.waterfall = () => false
  engine.summarize = async ({ messages }: { messages: readonly unknown[] }) => {
    replayLengths.push(messages.length)
    fail(replayLengths.length)
    return { summary: [{ type: 'text', text: 'summary' }], provider: 'test', model: 'test' }
  }
  return {
    engine, session, replayLengths, range,
    run: (signal?: AbortSignal) => engine.compactRegion(range[0]!, range.at(-1)!, { session }, signal),
  }
}

async function retryTest(name: string, body: () => Promise<void>) {
  try {
    await body()
    test(name, () => {})
  } catch (error) {
    test(name, () => { throw error })
  }
}

const requestError = new Error('summary request failed')

for (const [budget, initialReplay] of [[0, 4], [250_000, 3]] as const) {
  await retryTest(`budget ${budget} retries once with the default balanced prefix`, async () => {
    const f = retryFixture(budget, attempt => { if (attempt === 1) throw requestError })
    const result = await f.run()
    assert.deepEqual(f.replayLengths, [initialReplay, 2])
    assert.deepEqual(result.shadowedRange, { start: f.range[0], end: f.range[1] })
    const ends = f.session.snapshotEvents().filter(event => event.type === 'compaction/end')
    assert.deepEqual(ends.map(event => event.data.error !== undefined), [true, false])
    assert.equal(f.session.surface.replaceGeneration, 1)
    assert.equal(f.engine.spanBudgetTokens, budget)
  })
}

await retryTest('a successful unlimited attempt does not retry', async () => {
  const f = retryFixture(0, () => {})
  await f.run()
  assert.deepEqual(f.replayLengths, [4])
})

await retryTest('default and lower budgets preserve the first failure', async () => {
  for (const [budget, expected] of [[DEFAULT_SPAN_BUDGET_TOKENS, 2], [50_000, 1]]) {
    const f = retryFixture(budget!, () => { throw requestError })
    await assert.rejects(f.run(), error => error === requestError)
    assert.deepEqual(f.replayLengths, [expected])
  }
})

await retryTest('the second failure propagates and is not retried again', async () => {
  const retryError = new Error('retry failed')
  const f = retryFixture(0, attempt => { throw attempt === 1 ? requestError : retryError })
  await assert.rejects(f.run(), error => error === retryError)
  assert.deepEqual(f.replayLengths, [4, 2])
  assert.equal(f.session.surface.replaceGeneration, 0)
})

await retryTest('cancellation prevents the budget retry', async () => {
  const controller = new AbortController()
  const f = retryFixture(0, () => { controller.abort(); throw requestError })
  await assert.rejects(f.run(controller.signal), error => error === requestError)
  assert.deepEqual(f.replayLengths, [4])
})

for (const summarized of [true, false]) {
  await retryTest(`a close failure ${summarized ? 'after' : 'without'} replacement preserves the original error`, async () => {
    const f = retryFixture(0, () => { if (!summarized) throw requestError })
    const closeError = new Error('failed to record compaction end')
    f.session.append = new Proxy(f.session.append, {
      apply(append, receiver, args: unknown[]) {
        if (args[0] === 'compaction/end') throw closeError
        return Reflect.apply(append, receiver, args)
      },
    })
    await assert.rejects(f.run(), error => error === closeError)
    assert.deepEqual(f.replayLengths, [4])
    assert.equal(f.session.surface.replaceGeneration, summarized ? 1 : 0)
    assert.equal(f.session.snapshotEvents().filter(event => event.type === 'compaction/start').length, 1)
  })
}

console.log(`\n${passed} checks passed`)
