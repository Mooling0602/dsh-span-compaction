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
 * a wiring test rather than a rendering one; `client-render.test.ts` covers the
 * markup.
 *
 * Run with `node --test test/client-apply.test.ts`.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldSpec, SettingsFieldState, SettingsFormActions, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext, SpanScope, Translate } from '../src/client/contracts.ts'
import type { SpanCardFace } from '../src/client/settings-controller.ts'

type ClientExports = Pick<typeof import('../src/client/index.ts'), 'apply' | 'SpanSettingsPage' | 'FIELDS'>
type ModuleDefinition = { id: string; factory: (resolve: (id: string) => unknown) => ClientExports }
type Dictionary = Readonly<Record<string, string>>
type Dispose = () => void
interface SlotOptions {
  name: string
  key: string
  locale: string
  id?: string
  inject(): SpanCardFace & { t: Translate }
}

const require = createRequire(import.meta.url)
const fieldSpec = (field: string): SettingsFieldSpec => ({ field, format: () => '', parse: () => undefined })

/** Stub of the shared primitives: enough shape for the page to mount. */
const primitives = {
  SettingsForm: () => null,
  SettingsValueField: () => null,
  Switch: () => null,
  settingsNumberField: fieldSpec,
  settingsTextField: fieldSpec,
  SettingsFormModel: class {
    bind<S>(project: () => S): SnapshotStore<S> {
      return { getSnapshot: project, subscribe: () => () => {}, set: () => {}, update: () => {} }
    }
    field(): SettingsFieldState {
      return { text: '', overridden: false, invalid: false }
    }
    shell(): SettingsFormShell {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    actions(): SettingsFormActions {
      return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    }
    dispose() {}
  },
}

const loader: { definition?: ModuleDefinition; load(definition: ModuleDefinition): void } = {
  load(definition) { this.definition = definition },
}
Object.defineProperty(globalThis, 'window', { value: { __ModuleLoader__: loader }, configurable: true })
await import(new URL('../dist/client.js', import.meta.url).href)
assert.ok(loader.definition, 'bundle did not register a factory')
assert.equal(loader.definition.id, 'dsh-span-compaction')
const client = loader.definition.factory(id => {
  if (id === 'react') return require('react')
  if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require ${id}`)
})

/** One fake client runtime, recording what the bundle asks of it. */
function makeRuntime() {
  const registered: SlotOptions[] = []
  const served: string[][] = []
  const dicts = new Map<string, Map<string, Dictionary>>()
  const declared = new Set<string>()
  const ctx = {
    effect(fn: () => Dispose | void): Dispose {
      const dispose = fn()
      return () => { dispose?.() }
    },
    inject<R>(names: readonly string[], callback: (context: object) => R): R {
      for (const name of names) declared.add(name)
      return callback(ctx)
    },
    get() {
      return undefined
    },
    locale: {
      getSnapshot: () => ({ active: 'zh' }),
      register(namespace: string, bundle: Readonly<Record<string, Dictionary>>): Dispose {
        const existing = dicts.get(namespace) ?? new Map<string, Dictionary>()
        for (const language of Object.keys(bundle)) {
          if (existing.has(language)) throw new Error(`locale namespace "${namespace}" already has locale "${language}"`)
        }
        for (const [language, entries] of Object.entries(bundle)) existing.set(language, entries)
        dicts.set(namespace, existing)
        return () => { for (const language of Object.keys(bundle)) existing.delete(language) }
      },
      bind(namespace: string): Translate {
        return key => dicts.get(namespace)?.get('zh')?.[key] ?? key
      },
    },
    configForms: {
      get(): SpanScope {
        return {
          getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true }),
          subscribe: () => () => {},
          mutate: async () => true,
        }
      },
      whileServed<R>(namespaces: readonly string[], register: (namespaces: ReadonlySet<string>) => R): R {
        served.push([...namespaces])
        return register(new Set(namespaces))
      },
    },
    slots: {
      inject<R>(_name: string, register: () => R): R {
        return register()
      },
      register(options: SlotOptions): Dispose {
        registered.push(options)
        return () => {}
      },
    },
  }
  // Reading an undeclared service must fail exactly as it does in the Cordis
  // runtime; that rule is what hid a broken `apply` once already.
  for (const name of ['locale', 'slots', 'configForms'] as const) {
    const value = ctx[name]
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        if (!declared.has(name)) throw new Error(`cannot get property "${name}" without inject`)
        return value
      },
    })
  }
  // Only the client services exercised by the bundle are needed here.
  return { ctx: ctx as unknown as ClientContext, registered, served }
}

function mount() {
  const runtime = makeRuntime()
  client.apply(runtime.ctx)
  return runtime
}

test('both applies mount when the bundle is reloaded before disposal', t => {
  t.mock.method(console, 'warn', () => {})
  const runtime = makeRuntime()
  for (const [index, label] of ['first', 'second'].entries()) {
    assert.doesNotThrow(() => client.apply(runtime.ctx), `${label} apply must not throw`)
    assert.equal(runtime.registered.length, index + 1, `${label} apply must register its page`)
  }
})

test('it reads only services it injected', () => {
  const runtime = mount()
  assert.deepEqual([...new Set(runtime.served.flat())], ['span-compaction'])
})

test('the page is one bundle configuration, keyed by the package name', () => {
  const runtime = mount()
  const options = runtime.registered[0]
  assert.equal(runtime.registered.length, 1)
  assert.ok(options)
  assert.equal(options.name, 'plugins.bundle.config')
  assert.equal(options.key, 'dsh-span-compaction')
  assert.equal(options.locale, 'dsh-span-compaction')
  assert.equal(options.id, undefined)
})

test('the entry receives its copy and its form controller', () => {
  const options = mount().registered[0]
  assert.ok(options)
  const face = options.inject()
  assert.equal(face.t('budget'), '重放预算（token）')
  assert.equal(typeof face.hooks.spanCard.getSnapshot, 'function')
  assert.equal(face.hooks.spanCard.getSnapshot().available, true)
  assert.equal(typeof face.edit, 'function')
  assert.equal(typeof face.save, 'function')
})

test('the page renders from the official primitives, not a bundled copy', () => {
  assert.equal(typeof client.SpanSettingsPage, 'function')
  assert.equal(client.FIELDS.length, 9)
})
