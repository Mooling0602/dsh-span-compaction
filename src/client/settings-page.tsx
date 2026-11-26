/**
 * The bundle's settings page.
 *
 * It is built from the primitives every official settings page uses, the way
 * `dsh-better-plugin-updater` builds its page: `SettingsForm` draws the frame,
 * `SettingsValueField` draws each text or number row, and a boolean gets a row
 * that copies the official field frame so the form reads as one piece. The
 * Plugins page draws the bundle's title and one-liner itself, and asks this
 * page for the form (`view: 'page'`).
 *
 * Nothing writes per keystroke: every control stages a draft and the frame's
 * save performs one revision-fenced mutation, so what is on screen is exactly
 * what a save stores, and leaving the page drops what was not saved.
 *
 * @module dsh-span-compaction/client/settings-page
 */

import {
  SettingsForm,
  SettingsValueField,
  Switch,
  type SettingsFieldState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleKey } from './locales.ts'
import { formLabels } from './locales.ts'
import { FIELDS, type Field } from './fields.ts'
import type { SpanCardFace, SpanCardState } from './settings-controller.ts'

/** Frame tokens of one official field row, for the row the shared field cannot draw. */
const STYLE = {
  field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l2)' },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  labelGroup: { display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  label: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
  badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  reset: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  tag: { padding: '0 6px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm)', fontSize: 12, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
} as const

/** Props the renderer binds for this page: the injected face, the copy, and the surface asked for. */
export interface SpanSettingsProps extends SpanCardFace {
  /** Copy bound to this bundle's dictionary. */
  readonly t: (key: LocaleKey) => string
  /** Which surface the Plugins page asks for. */
  readonly view?: 'summary' | 'page'
  /** Bound page snapshot, supplied by the renderer from the injected hook. */
  readonly useSpanCard: <S>(select: (state: SpanCardState) => S) => S
}

/**
 * Render one boolean as a labelled switch.
 *
 * The shared value field edits text, so a boolean carries its own row. The frame
 * copies the official field: same gap, padding, label typography, overridden
 * badge, reset control and hint, and the same bottom border the next field would
 * otherwise draw above itself.
 * @param props - the field's copy, its staged state, and the staging actions.
 * @returns the labelled switch.
 */
function SwitchField(props: {
  readonly label: string
  readonly hint: string
  readonly state: SettingsFieldState
  readonly disabled: boolean
  readonly overriddenLabel: string
  readonly resetLabel: string
  readonly onChange: (next: boolean) => void
  readonly onReset: () => void
}) {
  return (
    <div style={STYLE.field}>
      <div style={STYLE.head}>
        <div style={STYLE.labelGroup}>
          <span style={STYLE.label}>{props.label}</span>
        </div>
        {props.state.overridden
          ? (
            <span style={STYLE.badges}>
              <span style={STYLE.tag}>{props.overriddenLabel}</span>
              <button type="button" style={STYLE.reset} disabled={props.disabled} onClick={props.onReset}>
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
        <Switch
          checked={props.state.text === 'on'}
          label={props.label}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </div>
      <p style={STYLE.hint}>{props.hint}</p>
    </div>
  )
}

/**
 * Render this bundle's options as a staged form.
 * @param props - the bound snapshot, the page's copy, and the form actions.
 * @returns the form, or the one-line description while the summary is asked for.
 */
export function SpanSettingsPage(props: SpanSettingsProps) {
  const state = props.useSpanCard(snapshot => snapshot)
  const { t } = props
  if (props.view === 'summary') return <>{t('summary')}</>
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {FIELDS.map(field => field.kind === 'switch'
        ? (
          <SwitchField
            key={field.field}
            label={t(field.label)}
            hint={t(field.hint)}
            state={state[field.field]}
            disabled={disabled}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            onChange={next => { props.edit(field.field, next ? 'on' : 'off') }}
            onReset={() => { props.resetField(field.field) }}
          />
        )
        : (
          <ValueField
            key={field.field}
            field={field}
            state={state[field.field]}
            t={t}
            disabled={disabled}
            onEdit={text => { props.edit(field.field, text) }}
            onReset={() => { props.resetField(field.field) }}
          />
        ))}
    </SettingsForm>
  )
}

/**
 * Render one text or number row through the shared value field.
 * @param props - the control's declaration, its staged state, and the staging actions.
 * @returns the labelled control.
 */
function ValueField(props: {
  readonly field: Field
  readonly state: SettingsFieldState
  readonly t: (key: LocaleKey) => string
  readonly disabled: boolean
  readonly onEdit: (text: string) => void
  readonly onReset: () => void
}) {
  const { t, field } = props
  return (
    <SettingsValueField
      id={`plugin-config-span-${field.field}`}
      label={t(field.label)}
      hint={t(field.hint)}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t('invalid')}
      disabled={props.disabled}
      numeric={field.kind === 'number'}
      {...props.state}
      onEdit={props.onEdit}
      onReset={props.onReset}
    />
  )
}
