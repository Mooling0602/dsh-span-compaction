/**
 * Load the built client bundle outside a browser and run `apply` against a
 * minimal fake runtime.
 *
 * Two things are checked that no screenshot can show: the bundle registers the
 * one entry the Plugins page dispatches a bundle's configuration under, and
 * applying it twice — which a reload does — neither throws nor loses the entry.
 * A page that throws looks exactly like one that was never registered, because
 * the slot renderer hides a crashing entry.
 *
 * The shared browser packages are stubbed: the loader resolves them, and they
 * import CSS, so they cannot be loaded in Node. Their absence is what makes this
 * a wiring test rather than a rendering one; `client-render.test.mjs` covers the
 * markup.
 *
 * Run with `node test/client-apply.test.mjs`.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Stub of the shared primitives: enough shape for the page to mount. */
const primitives = {
  SettingsForm: () => null,
  SettingsValueField: () => null,
  Switch: () => null,
  settingsNumberField: field => ({ field, format: () => '', parse: () => undefined }),
  settingsTextField: field => ({ field, format: () => '', parse: () => undefined }),
  SettingsFormModel: class {
    bind(project) {
      const read = () => project()
      return { getSnapshot: read, subscribe: () => () => {}, set: () => {} }
    }
    field() {
      return { text: '', overridden: false, invalid: false }
    }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    actions() {
      return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    }
    dispose() {}
  },
}

let captured
globalThis.window = { __ModuleLoader__: { load: def => { captured = def } } }
await import('../dist/client.js')
assert.ok(captured !== undefined, 'bundle did not register a factory')
assert.equal(captured.id, 'dsh-span-compaction')
const exports = captured.factory(id => {
  if (id === 'react') return require('react')
  if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require ${id}`)
})

let passed = 0
function test(name, body) {
  try {
    body()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stack}`)
    process.exitCode = 1
  }
}

/** One fake client runtime, recording what the bundle asks of it. */
function makeRuntime() {
  const registered = []
  const served = []
  const dicts = new Map()
  const declared = new Set()
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    inject(names, callback) {
      for (const name of names) declared.add(name)
      return callback(ctx)
    },
    get() {
      return undefined
    },
    locale: {
      getSnapshot: () => ({ active: 'zh' }),
      register(namespace, bundle) {
        const existing = dicts.get(namespace) ?? new Map()
        for (const language of Object.keys(bundle)) {
          if (existing.has(language)) throw new Error(`locale namespace "${namespace}" already has locale "${language}"`)
        }
        for (const [language, entries] of Object.entries(bundle)) existing.set(language, entries)
        dicts.set(namespace, existing)
        return () => { for (const language of Object.keys(bundle)) existing.delete(language) }
      },
      bind(namespace) {
        return key => dicts.get(namespace)?.get('zh')?.[key] ?? key
      },
    },
    configForms: {
      get() {
        return {
          getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true }),
          subscribe: () => () => {},
          mutate: async () => true,
        }
      },
      whileServed(namespaces, register) {
        served.push([...namespaces])
        return register(new Set(namespaces))
      },
    },
    slots: {
      inject(name, register) {
        return register()
      },
      register(options) {
        registered.push(options)
        return () => {}
      },
    },
  }
  // Reading an undeclared service must fail exactly as it does in the Cordis
  // runtime; that rule is what hid a broken `apply` once already.
  for (const name of ['locale', 'slots', 'configForms']) {
    const value = ctx[name]
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        if (!declared.has(name)) throw new Error(`cannot get property "${name}" without inject`)
        return value
      },
    })
  }
  return { ctx, registered, served }
}

const runtime = makeRuntime()
for (const label of ['first', 'second']) {
  let threw = false
  const warn = console.warn
  console.warn = () => {}
  try {
    exports.apply(runtime.ctx)
  } catch (error) {
    threw = true
    console.error(`${label} apply threw: ${error.message}`)
  } finally {
    console.warn = warn
  }
  assert.equal(threw, false, `${label} apply must not throw`)
  console.log(`ok   ${label} apply mounted`)
  passed += 1
}

test('it reads only services it injected', () => {
  assert.deepEqual([...new Set(runtime.served.flat())], ['span-compaction'])
})

test('the page is one bundle configuration, keyed by the package name', () => {
  const options = runtime.registered[0]
  assert.equal(runtime.registered.length, 2)
  assert.equal(options.name, 'plugins.bundle.config')
  assert.equal(options.key, 'dsh-span-compaction')
  assert.equal(options.locale, 'dsh-span-compaction')
  assert.equal(options.id, undefined)
})

test('the entry receives its copy and its form controller', () => {
  const face = runtime.registered[0].inject()
  assert.equal(face.t('budget'), '重放预算（token）')
  assert.equal(typeof face.hooks.spanCard.getSnapshot, 'function')
  assert.equal(face.hooks.spanCard.getSnapshot().available, true)
  assert.equal(typeof face.edit, 'function')
  assert.equal(typeof face.save, 'function')
})

test('the page renders from the official primitives, not a bundled copy', () => {
  assert.equal(typeof exports.SpanSettingsPage, 'function')
  assert.equal(exports.FIELDS.length, 7)
})

console.log(`\n${passed} checks passed`)
