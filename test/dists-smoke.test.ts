/**
 * Check the built artifacts, not the sources.
 *
 * The shipped halves are `dists/*.js` (Host, from `tsc`) and `dist/client.js`
 * (browser, from esbuild). A unit test that imports `src/` cannot see a build
 * that was never rerun, a client bundle that forgot the loader externals, or a
 * page registered on the wrong slot — each of those ships a plugin that looks
 * fine in the repository and does nothing on the machine.
 *
 * Run with `npm run test:smoke` after building.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { localFiles, languageChain, readPackageDocument } from '@deepseek-ai/dsh-plugin-detail'

/** The configuration keys the settings page edits. */
const FLAT_KEYS = ['spanBudgetTokens', 'thresholdRatio', 'toolsEnabled', 'nudgeEnabled', 'nudgeRatio', 'nudgeMinTokens', 'nudgeEverySteps', 'approveCompact', 'exemptTargets']

assert.ok(existsSync('dists/index.js'), 'the Host half is not built: run npm run build')
assert.ok(existsSync('dist/client.js'), 'the browser half is not built: run npm run build')

type ConfigField = { meta?: { volatile?: boolean, description?: Record<string, string> } }
const { default: entry }: typeof import('../src/index.ts') = await import(new URL('../dists/index.js', import.meta.url).href)
const config = entry.Config as { dict: Record<string, ConfigField> }
const clientBundle = readFileSync('dist/client.js', 'utf8')

test('the built entry is a Cordis plugin with the services the engine needs', () => {
  assert.equal(typeof entry, 'function')
  for (const name of ['llm', 'tokenMeter', 'sessions']) assert.ok(entry.inject.includes(name), `missing inject ${name}`)
})

test('the built schema serves the flat keys the page edits', () => {
  const dict = config.dict
  for (const key of FLAT_KEYS) assert.ok(key in dict, `schema has no ${key}`)
  assert.ok(!('tools' in dict) && !('nudge' in dict), 'the nested keys are back')
})

test('every page field is volatile and carries Chinese copy', () => {
  const dict = config.dict
  for (const key of FLAT_KEYS) {
    assert.equal(dict[key]?.meta?.volatile, true, `${key} is not volatile`)
    assert.ok((dict[key]?.meta?.description?.zh ?? '').length > 0, `${key} has no zh description`)
  }
})

test('the tools and the reminder are part of the built hooks module', async () => {
  const hooks: typeof import('../src/hooks.ts') = await import(new URL('../dists/hooks.js', import.meta.url).href)
  assert.equal(typeof hooks.mountHooks, 'function')
})

test('the browser half registers one bundle configuration under the loader', () => {
  assert.match(clientBundle, /id: "dsh-span-compaction"/)
  assert.match(clientBundle, /plugins\.bundle\.config/)
  // esbuild keeps the const instead of inlining it, so check both halves.
  assert.match(clientBundle, /BUNDLE_NAME = "dsh-span-compaction"/)
  assert.match(clientBundle, /key: BUNDLE_NAME/)
  for (const other of ['plugins.row.config', 'plugins.detail.section', 'settings.section']) {
    assert.ok(!clientBundle.includes(other), `the browser half also registers ${other}`)
  }
})

test('the browser half takes the shared primitives from the loader', () => {
  assert.match(clientBundle, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/)
  assert.ok(!clientBundle.includes('var css$'), 'a copy of the primitives was bundled')
})

test('the listing copy exists in both languages', () => {
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(`locale/${language}.json`, 'utf8')).meta
    for (const key of ['title', 'description', 'detail']) {
      assert.ok(typeof meta[key] === 'string' && meta[key].length > 0, `locale/${language}.json is missing meta.${key}`)
    }
  }
})

test('the plugin page resolves its document through the real DSH resolver', async ({ signal }) => {
  // `dsh-plugin-detail` is the package the Plugins page actually uses: it reads
  // `meta.detail` along the language chain, requires the named Markdown file to
  // exist inside the package, and only falls back to the README when no locale
  // declares one. Running it here means a bad path fails the build instead of
  // the plugin page.
  const files = localFiles(process.cwd(), 'test')
  const read = (language: string) => readPackageDocument(files, '', languageChain(language), 1 << 20, signal)

  const chinese = await read('zh-CN')
  assert.equal(chinese?.origin, 'locale')
  assert.equal(chinese?.path, 'INTRODUCTION.zh.md')
  assert.match(chinese?.markdown ?? '', /[\u4e00-\u9fa5]/)

  const english = await read('en')
  assert.equal(english?.origin, 'locale')
  assert.equal(english?.path, 'INTRODUCTION.md')

  // An unsupported language still gets the English document rather than none.
  const other = await read('ja')
  assert.equal(other?.path, 'INTRODUCTION.md')
})

test('the shipped documents are not placeholders', () => {
  for (const path of ['INTRODUCTION.md', 'INTRODUCTION.zh.md']) {
    assert.ok(readFileSync(path, 'utf8').trim().length > 200, `${path} is too short to describe the plugin`)
  }
})
