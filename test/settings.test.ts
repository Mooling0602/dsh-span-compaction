/**
 * Checks the settings page's field declaration against the copy and the Host
 * schema.
 *
 * The page renders one control per declared field, so a field the Host schema
 * does not have would be a draft no write could land, and a copy key missing
 * from a dictionary would show up as a raw key on the phone. Both are cheap to
 * assert here and expensive to notice on the page.
 *
 * Run with `node test/settings.test.ts`.
 */

import assert from 'node:assert/strict'
import { FIELDS, settingsBooleanField } from '../src/client/fields.ts'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'

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

/** Flat field names the page edits. */
const NAMES = FIELDS.map(field => field.field)

test('the page declares one control per setting, flat and in order', () => {
  assert.deepEqual(NAMES, [
    'spanBudgetTokens',
    'thresholdRatio',
    'toolsEnabled',
    'nudgeEnabled',
    'nudgeRatio',
    'nudgeStrongRatio',
    'nudgeMinTokens',
    'nudgeEverySteps',
    'approveCompact',
    'exemptTargets',
  ])
  assert.equal(new Set(NAMES).size, NAMES.length)
})

test('every field has copy in both dictionaries', () => {
  const keys: LocaleKey[] = ['title', 'overridden', 'reset', 'invalid', 'unavailable', 'readOnly', 'saveFailed', 'save', 'saving']
  for (const field of FIELDS) keys.push(field.label as LocaleKey, field.hint as LocaleKey)
  for (const [language, dictionary] of Object.entries({ en, zh })) {
    for (const key of keys) assert.ok((dictionary[key] ?? '').length > 0, `${language} is missing ${key}`)
  }
})

test('both dictionaries carry exactly the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('the boolean spec keeps the Host type and stages both ways', () => {
  const spec = settingsBooleanField('toolsEnabled')
  assert.equal(spec.field, 'toolsEnabled')
  assert.equal(spec.format(true), 'on')
  assert.equal(spec.format(false), 'off')
  assert.equal(spec.format(undefined), '')
  assert.deepEqual(spec.parse('on'), { kind: 'set', value: true })
  assert.deepEqual(spec.parse('off'), { kind: 'set', value: false })
  assert.equal(spec.parse('yes'), undefined)
  assert.equal(spec.parse(''), undefined)
})

// The Host half needs the DSH packages; a bare checkout skips the cross-check
// instead of failing on an unrelated missing dependency.
const schemaKeys = await readSchemaKeys()

test('every page field is a Host schema key', () => {
  if (schemaKeys === undefined) {
    console.log('skip Host schema cross-check: DSH packages are absent')
    return
  }
  for (const name of NAMES) assert.ok(schemaKeys.includes(name), `Host schema has no ${name}`)
})

/**
 * Read the flat keys of the engine's configuration schema.
 * @returns the keys, or undefined when the host packages are absent.
 */
async function readSchemaKeys(): Promise<string[] | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Engine = (await import('../src/engine.ts')).default as any
    const dict = Engine.Config?.dict ?? Engine.Config?.meta?.dict
    if (dict === undefined || dict === null) return undefined
    return Object.keys(dict)
  } catch (error) {
    console.log(`note: ${(error as Error).message}`)
    return undefined
  }
}

console.log(`\n${passed} checks passed`)
