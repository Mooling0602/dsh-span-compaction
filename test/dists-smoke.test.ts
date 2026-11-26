/**
 * Check the built artifacts, not the sources.
 *
 * The shipped halves are `dists/*.js` (Host, from `tsc`) and `dist/client.js`
 * (browser, from esbuild). A unit test that imports `src/` cannot see a build
 * that was never rerun, a client bundle that forgot the loader externals, or a
 * page registered on the wrong slot — each of those ships a plugin that looks
 * fine in the repository and does nothing on the machine.
 *
 * Run with `node test/dists-smoke.test.ts`.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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

/** The configuration keys the settings page edits. */
const FLAT_KEYS = ['spanBudgetTokens', 'thresholdRatio', 'toolsEnabled', 'nudgeEnabled', 'nudgeRatio', 'nudgeMinTokens', 'nudgeEverySteps']

assert.ok(existsSync('dists/index.js'), 'the Host half is not built: run npm run build')
assert.ok(existsSync('dist/client.js'), 'the browser half is not built: run npm run build')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = (await import('../dists/index.js')).default as any
const clientBundle = readFileSync('dist/client.js', 'utf8')

test('the built entry is a Cordis plugin with the services the engine needs', () => {
  assert.equal(typeof entry, 'function')
  for (const name of ['llm', 'tokenMeter', 'sessions']) assert.ok(entry.inject.includes(name), `missing inject ${name}`)
})

test('the built schema serves the flat keys the page edits', () => {
  const dict = entry.Config.dict as Record<string, { meta?: { volatile?: boolean, description?: Record<string, string> } }>
  for (const key of FLAT_KEYS) assert.ok(key in dict, `schema has no ${key}`)
  assert.ok(!('tools' in dict) && !('nudge' in dict), 'the nested keys are back')
})

test('every page field is volatile and carries Chinese copy', () => {
  const dict = entry.Config.dict as Record<string, { meta?: { volatile?: boolean, description?: Record<string, string> } }>
  for (const key of FLAT_KEYS) {
    assert.equal(dict[key]?.meta?.volatile, true, `${key} is not volatile`)
    assert.ok((dict[key]?.meta?.description?.zh ?? '').length > 0, `${key} has no zh description`)
  }
})

test('the tools and the reminder are part of the built hooks module', async () => {
  const hooks = await import('../dists/hooks.js') as Record<string, unknown>
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

test('the plugin page resolves its document through the real DSH resolver', async () => {
  // `dsh-plugin-detail` is the package the Plugins page actually uses: it reads
  // `meta.detail` along the language chain, requires the named Markdown file to
  // exist inside the package, and only falls back to the README when no locale
  // declares one. Running it here means a bad path fails the build instead of
  // the plugin page.
  const detail = await import('@deepseek-ai/dsh-plugin-detail') as {
    localFiles: (root: string) => unknown
    languageChain: (language: string) => string[]
    readPackageDocument: (files: unknown, dir: string, languages: string[], maxBytes: number) => Promise<{ origin: string, path: string, markdown: string } | undefined>
  }
  const files = detail.localFiles(process.cwd())
  const read = async (language: string) => await detail.readPackageDocument(files, '', detail.languageChain(language), 1 << 20)

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

console.log(`\n${passed} checks passed`)
