/**
 * Checks the compaction approval gate: which call waits for consent, which one
 * bypasses downstream policy, and which one is delegated untouched.
 *
 * Run with `node test/approval.test.ts`.
 */

import assert from 'node:assert/strict'
import { APPROVAL_TOOL, EXEMPT_TOOL, gateAction } from '../src/approval.ts'

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

const live = <T>(value: T) => ({ get: () => value })

test('the candidate list is allowed without asking, on every policy', () => {
  for (const policy of ['ask', 'never'] as const) {
    assert.equal(gateAction(EXEMPT_TOOL, policy), 'allow')
  }
})

test('the candidate list delegates when the exemption is switched off', () => {
  assert.equal(gateAction(EXEMPT_TOOL, 'ask', { exemptTargets: live(false) }), 'pass')
})

test('compact asks under an interactive policy', () => {
  assert.equal(gateAction(APPROVAL_TOOL, 'ask'), 'ask')
  assert.equal(gateAction(APPROVAL_TOOL, undefined), 'ask')
})

test('full access keeps its no-prompt contract', () => {
  assert.equal(gateAction(APPROVAL_TOOL, 'never'), 'pass')
})

test('switching the approval off delegates compact to the rest of the chain', () => {
  assert.equal(gateAction(APPROVAL_TOOL, 'ask', { approveCompact: live(false) }), 'pass')
})

test('other tools are never touched', () => {
  for (const tool of ['Bash', 'edit', 'compact_targets_extra']) {
    assert.equal(gateAction(tool, 'ask'), 'pass')
  }
})

test('the switches are read live, so a saved setting applies without remounting', () => {
  let exempt = true
  const config = { exemptTargets: { get: () => exempt } }
  assert.equal(gateAction(EXEMPT_TOOL, 'ask', config), 'allow')
  exempt = false
  assert.equal(gateAction(EXEMPT_TOOL, 'ask', config), 'pass')
})

console.log(`\n${passed} checks passed`)
