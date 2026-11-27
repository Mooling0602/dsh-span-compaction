/**
 * Render the built settings page headlessly and assert what a reader sees.
 *
 * The page must look like an official settings page, so it renders through the
 * shared primitives rather than its own chrome. Those primitives import CSS and
 * cannot load in Node, so this file stubs them with the same prop contract and
 * checks the page's own wiring: every field is drawn with its copy and its value,
 * the booleans render as switches, and a namespace the Host does not serve says
 * so instead of drawing controls nothing would accept.
 *
 * Run with `node --test test/client-render.test.ts`.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createElement as h } from 'react'
import type { ChangeEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SettingsFieldSpec, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../src/client/contracts.ts'
import type { SpanCardState, SpanFieldStates } from '../src/client/settings-controller.ts'
import type { SpanSettingsProps } from '../src/client/settings-page.tsx'

type ClientExports = Pick<typeof import('../src/client/index.ts'), 'SpanSettingsPage' | 'zh'>
type ModuleDefinition = { id: string; factory: (resolve: (id: string) => unknown) => ClientExports }
type Primitives = typeof import('@deepseek-ai/dsh-client-ui-primitives')

const require = createRequire(import.meta.url)
const fieldSpec = (field: string): SettingsFieldSpec => ({ field, format: () => '', parse: () => undefined })

/** The prop contract of the shared primitives, rendered as plain markup. */
const controls = {
  SettingsForm: ({ labels, state, onSave, children }) => {
    if (!state.available) return h('p', { role: 'status' }, labels.unavailable)
    return h('div', null,
      state.writable ? null : h('p', { role: 'status' }, labels.readOnly),
      children,
      h('div', null,
        state.failed ? h('p', { role: 'status' }, labels.saveFailed) : null,
        h('button', { type: 'button', 'data-save': '', disabled: !state.dirty || state.invalid || state.saving, onClick: onSave },
          state.saving ? labels.saving : labels.save)))
  },
  SettingsValueField: props => h('div', { 'data-field': props.id },
    h('label', { htmlFor: props.id }, props.label),
    h('input', { id: props.id, value: props.text, readOnly: true, disabled: props.disabled }),
    h('p', null, props.invalid ? props.invalidLabel : props.hint),
    props.overridden ? h('button', { type: 'button', 'data-reset': props.id, onClick: props.onReset }, props.resetLabel) : null),
  Switch: ({ checked, label, disabled, onChange }) => h('input', {
    type: 'checkbox', 'aria-label': label, checked, readOnly: true, disabled,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.checked),
  }),
} satisfies Pick<Primitives, 'SettingsForm' | 'SettingsValueField' | 'Switch'>

const primitives = {
  ...controls,
  settingsNumberField: fieldSpec,
  settingsTextField: fieldSpec,
}

const loader: { definition?: ModuleDefinition; load(definition: ModuleDefinition): void } = {
  load(definition) { this.definition = definition },
}
Object.defineProperty(globalThis, 'window', { value: { __ModuleLoader__: loader }, configurable: true })
await import(new URL('../dist/client.js', import.meta.url).href)
assert.ok(loader.definition, 'bundle did not register a factory')
const client = loader.definition.factory(id => {
  if (id === 'react') return require('react')
  if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require ${id}`)
})

const t: Translate = key => client.zh[key] ?? key

/** Store values a saved page reports. */
const FIELDS: SpanFieldStates = {
  spanBudgetTokens: { text: '160000', overridden: false, invalid: false },
  thresholdRatio: { text: '0.8', overridden: false, invalid: false },
  toolsEnabled: { text: 'on', overridden: false, invalid: false },
  nudgeEnabled: { text: 'off', overridden: true, invalid: false },
  nudgeRatio: { text: '0.7', overridden: false, invalid: false },
  nudgeStrongRatio: { text: '0.25', overridden: false, invalid: false },
  nudgeMinTokens: { text: '50000', overridden: false, invalid: false },
  nudgeEverySteps: { text: '8', overridden: false, invalid: false },
  approveCompact: { text: 'on', overridden: false, invalid: false },
  exemptTargets: { text: 'on', overridden: false, invalid: false },
}

type Overrides = { shell?: Partial<SettingsFormShell>; fields?: Partial<SpanFieldStates> }

/** Props the renderer binds for this page, over fixed state. */
function propsFor(over: Overrides = {}): SpanSettingsProps {
  const state: SpanCardState = {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    ...FIELDS,
    ...over.fields,
    ...over.shell,
  }
  return {
    t,
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
    hooks: { spanCard: { getSnapshot: () => state, subscribe: () => () => {}, set: () => {}, update: () => {} } },
    useSpanCard: select => select(state),
  }
}

const render = (overrides?: Overrides) => renderToStaticMarkup(h(client.SpanSettingsPage, propsFor(overrides)))

test('the summary view renders the one-line description', () => {
  const markup = renderToStaticMarkup(h(client.SpanSettingsPage, { ...propsFor(), view: 'summary' }))
  assert.match(markup, /重放预算、模型压缩工具与上下文压力提醒/)
})

test('every field is drawn with its own copy', () => {
  const markup = render()
  assert.match(markup, /重放预算（token）/)
  assert.match(markup, /自动压缩阈值/)
  assert.match(markup, /压缩工具/)
  assert.match(markup, /上下文压力提醒/)
  assert.match(markup, /提醒上下文比例/)
  assert.match(markup, /触发提醒的最少 token/)
  assert.match(markup, /提醒间隔步数/)
  assert.match(markup, /压缩前请求确认/)
  assert.match(markup, /候选列表免审查/)
  assert.match(markup, /默认 160,000/)
})

test('numbers render as inputs holding the stored value', () => {
  const markup = render()
  for (const field of ['spanBudgetTokens', 'thresholdRatio', 'nudgeRatio', 'nudgeMinTokens', 'nudgeEverySteps']) {
    assert.match(markup, new RegExp(`id="plugin-config-span-${field}"`))
  }
  assert.match(markup, /value="160000"/)
  assert.match(markup, /value="0.7"/)
  assert.match(markup, /value="50000"/)
})

test('booleans render as switches reflecting the staged value', () => {
  const markup = render()
  assert.equal((markup.match(/type="checkbox"/g) ?? []).length, 4)
  assert.match(markup, /aria-label="压缩工具" readOnly="" checked=""/)
  assert.match(markup, /aria-label="上下文压力提醒" readOnly=""\/>/)
  assert.doesNotMatch(markup, /aria-label="上下文压力提醒" readOnly="" checked/)
})

test('an overridden switch offers the same badge and reset as a field', () => {
  const markup = render()
  assert.match(markup, /已覆盖/)
  assert.match(markup, />恢复继承值</)
})

test('the form draws the official save control and blocks a clean save', () => {
  const markup = render()
  assert.match(markup, /data-save=""/)
  assert.match(markup, /data-save="" disabled=""/)
  assert.match(markup, />保存</)
})

test('a staged edit enables the save', () => {
  const markup = render({ shell: { dirty: true } })
  assert.doesNotMatch(markup, /data-save="" disabled=""/)
})

test('an unavailable namespace says so instead of drawing controls', () => {
  const markup = render({ shell: { available: false, writable: false } })
  assert.match(markup, /此插件当前未加载，无法配置。/)
  assert.doesNotMatch(markup, /type="checkbox"/)
})

test('a read-only deployment still draws the fields and says why', () => {
  const markup = render({ shell: { writable: false } })
  assert.match(markup, /此部署的配置为只读。/)
  assert.match(markup, /type="checkbox"/)
})

test('the approval hint ends with the exact Full access exemption', () => {
  assert.match(render(), /“完全权限”档仍无需确认。<\/p>/)
})

test('a zero budget explains unlimited replay and one retry with the default', () => {
  const markup = render({ fields: { spanBudgetTokens: { text: '0', overridden: true, invalid: false } } })
  assert.match(markup, /value="0"/)
  assert.match(markup, /设为 0 时，自动压缩不限制重放长度/)
  assert.match(markup, /失败后用默认预算重试一次/)
})

test('an invalid draft shows the invalid copy', () => {
  const markup = render({ fields: { spanBudgetTokens: { text: 'abc', overridden: true, invalid: true } } })
  assert.match(markup, /请输入数字；留空表示使用默认值。/)
})
