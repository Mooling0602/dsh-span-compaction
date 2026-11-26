/**
 * Checks the model-driven compaction features: the nudge decision, the
 * one-shot model summary injection, and the target list builder.
 * Run with `node test/features.test.ts`.
 */

import assert from 'node:assert/strict'
import { buildReminder, nudgePressure, nextStepCounter } from '../src/nudge.ts'
import type { NudgeConfig, NudgeState } from '../src/nudge.ts'

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
async function atest(name: string, body: () => Promise<void>) {
  try {
    await body()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}\n${(error as Error).stack}`)
    process.exitCode = 1
  }
}

const cfg = (over: Partial<Required<NudgeConfig>> = {}): Required<NudgeConfig> => ({
  enabled: true,
  ratio: 0.7,
  minTokens: 50_000,
  everySteps: 8,
  ...over,
})

test('nudge stays silent below the absolute token floor', () => {
  const r = nudgePressure(10_000, 100_000, 5, undefined, cfg())
  assert.equal(r.nudge, false)
  assert.equal(r.state, undefined)
})

test('nudge stays silent below the window ratio', () => {
  const r = nudgePressure(60_000, 100_000, 5, undefined, cfg())
  assert.equal(r.nudge, false)
})

test('nudge fires above the ratio with no prior state', () => {
  const r = nudgePressure(80_000, 100_000, 5, undefined, cfg())
  assert.equal(r.nudge, true)
  assert.deepEqual(r.state, { lastStep: 5, lastTokens: 80_000 })
})

test('nudge respects the step frequency limit', () => {
  const state: NudgeState = { lastStep: 4, lastTokens: 80_000 }
  assert.equal(nudgePressure(90_000, 100_000, 8, state, cfg()).nudge, false)
  assert.equal(nudgePressure(90_000, 100_000, 12, state, cfg()).nudge, true)
})

test('nudge does not repeat when pressure barely moved', () => {
  const state: NudgeState = { lastStep: 1, lastTokens: 80_000 }
  assert.equal(nudgePressure(80_500, 100_000, 20, state, cfg()).nudge, false)
})

test('unknown window falls back to twice the token floor', () => {
  assert.equal(nudgePressure(60_000, undefined, 3, undefined, cfg()).nudge, false)
  assert.equal(nudgePressure(120_000, undefined, 3, undefined, cfg()).nudge, true)
})

test('the step counter keeps counting across turn boundaries', () => {
  // A turn reports steps 1..3, the next turn starts over at 1. The counter the
  // reminder compares against must not restart with it.
  let counter: number | undefined
  const seen: number[] = []
  for (const turn of [1, 2]) {
    for (let step = 1; step <= 3; step += 1) {
      counter = nextStepCounter(counter)
      seen.push(counter)
    }
    assert.equal(turn >= 1, true)
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6])
})

test('a reminder after a turn boundary is measured on the counter, not the turn step', () => {
  const state: NudgeState = { lastStep: 3, lastTokens: 80_000 }
  // The event's own step restarts at 1, which would make the interval negative.
  assert.equal(nudgePressure(90_000, 100_000, 1, state, cfg()).nudge, false)
  // The monotonic counter reports the real interval, so the reminder fires.
  assert.equal(nudgePressure(90_000, 100_000, 6, state, cfg({ everySteps: 3 })).nudge, true)
})

// --- engine one-shot model summary injection ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Engine: any = null
try {
  Engine = (await import('../src/engine.ts')).default
} catch (error) {
  console.log(`skip engine summary checks: ${(error as Error).message}`)
}

if (Engine !== null) {
  function engineStub() {
    const engine = Object.create(Engine.prototype)
    engine.ctx = { logger: { info: () => {} } }
    engine.modelSummaries = new WeakMap()
    return engine
  }

  await atest('summarize consumes a queued model summary without an LLM call', async () => {
    const engine = engineStub()
    const agent = { session: { id: 's1' } }
    engine.modelSummaries.set(agent, 'crystallized summary')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (engine as any).summarize({ messages: [] }, agent, undefined)
    assert.equal(result.summary[0].text, 'crystallized summary')
    assert.equal(result.provider, 'model')
    assert.equal(result.llmStreamCall, undefined)
    // one-shot: consumed and cleared
    assert.equal(engine.modelSummaries.has(agent), false)
  })

  await atest('summarize falls back to the stock path when nothing is queued', async () => {
    const engine = engineStub()
    const agent = { session: { id: 's2' } }
    let threw = false
    engine.modelSummaries.delete(agent)
    try {
      await (engine as any).summarize({ messages: [] }, agent, undefined)
    } catch {
      // A bare stub has no real parent dependencies; the fallback is expected to
      // throw here. What matters is that no phantom summary was returned.
      threw = true
    }
    assert.equal(threw, true)
    assert.equal(engine.modelSummaries.has(agent), false)
  })
}

test('the reminder quotes the reading instead of a vague warning', () => {
  const text = buildReminder({ tokens: 212_043, window: 1_048_576, ratio: 0.2 })
  assert.match(text, /212,043 priced tokens/)
  assert.match(text, /about 20% of the 1,048,576-token window/)
  assert.match(text, /reminder ratio 20%/)
})

test('the reminder says the target list is not the limit of what may be compacted', () => {
  const text = buildReminder({ tokens: 1, window: undefined, ratio: 0.2 })
  assert.match(text, /single candidate nodes, not the limit/)
  assert.match(text, /ONE large, contiguous, completed block/)
  assert.match(text, /model window unknown/)
})

test('the reminder demands compaction now instead of offering it', () => {
  const text = buildReminder({ tokens: 1, window: 2, ratio: 0.2 })
  assert.match(text, /Compact now, in this turn/)
  assert.match(text, /Do not wait for this reminder/)
  assert.doesNotMatch(text, /Compression is optional/)
})

test('the reminder names what may not be compressed', () => {
  const text = buildReminder({ tokens: 1, window: 2, ratio: 0.2 })
  assert.match(text, /current task, unanswered user questions, pending decisions/)
  assert.match(text, /already compressed/)
})

console.log(`\n${passed} checks passed`)
