/**
 * The controls this settings page renders.
 *
 * Kept apart from the controller so the declaration stays importable without a
 * browser package: the controller builds the shared form model from these, and
 * a unit test can read them under a bare TypeScript runtime.
 *
 * A field name is the Host schema key itself — flat, one name per control,
 * because the shared form model addresses a control by its own field name
 * inside the section.
 *
 * @module dsh-span-compaction/client/fields
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/** One control: its Host field, its kind, and the dictionary keys for its copy. */
export const FIELDS = [
  { field: 'spanBudgetTokens', kind: 'number', label: 'budget', hint: 'budgetHint' },
  { field: 'thresholdRatio', kind: 'number', label: 'threshold', hint: 'thresholdHint' },
  { field: 'toolsEnabled', kind: 'switch', label: 'tools', hint: 'toolsHint' },
  { field: 'nudgeEnabled', kind: 'switch', label: 'nudge', hint: 'nudgeHint' },
  { field: 'nudgeRatio', kind: 'number', label: 'ratio', hint: 'ratioHint' },
  { field: 'nudgeMinTokens', kind: 'number', label: 'minTokens', hint: 'minTokensHint' },
  { field: 'nudgeEverySteps', kind: 'number', label: 'everySteps', hint: 'everyStepsHint' },
] as const

/** One control's declaration. */
export type Field = (typeof FIELDS)[number]

/**
 * Stage a boolean field as its two-way switch.
 *
 * The shared value field edits text, so a boolean needs its own conversion: it
 * keeps the real type instead of storing the string `on` where the Host schema
 * accepts only a boolean. An absent value writes nothing, which lets the field
 * fall back to the schema default rather than forcing it off.
 *
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => value === true ? 'on' : value === false ? 'off' : '',
    parse: text => {
      if (text === 'on') return { kind: 'set', value: true }
      if (text === 'off') return { kind: 'set', value: false }
      return undefined
    },
  }
}
