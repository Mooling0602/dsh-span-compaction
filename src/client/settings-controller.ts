/**
 * The settings page's staged form over this bundle's Host entry.
 *
 * Structure follows `dsh-better-plugin-updater`, which follows the official
 * shell executor's page: a controller owns one `SettingsFormModel` over the
 * entry's shared configuration form, and the page's slot entry injects a
 * snapshot store plus the model's actions. That is what lets the page stage a
 * draft per control and write them all in one fenced save instead of one write
 * per keystroke.
 *
 * @module dsh-span-compaction/client/settings-controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  settingsNumberField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { FIELDS, settingsBooleanField, type Field } from './fields.ts'

/** The configuration section this page edits, a subset of the served schema by design. */
export interface SpanSettings {
  spanBudgetTokens?: number
  toolsEnabled?: boolean
  nudgeEnabled?: boolean
  nudgeRatio?: number
  nudgeMinTokens?: number
  nudgeEverySteps?: number
}

/** One control's staged state, keyed by its field name. */
export type SpanFieldStates = { readonly [K in Field['field']]: SettingsFieldState }

/** What the page renders: the form frame's state plus one state per control. */
export type SpanCardState = SettingsFormShell & SpanFieldStates

/** The registration-side face the page's slot entry injects. */
export interface SpanCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useSpanCard. */
    spanCard: SnapshotStore<SpanCardState>
  }
}

/** The specs this page edits, in the order `FIELDS` renders them. */
const SPECS = FIELDS.map(field => field.kind === 'switch'
  ? settingsBooleanField(field.field)
  : settingsNumberField(field.field))

/** Bridges this bundle's Host entry onto the page's staged form. */
export class SpanCardController {
  private readonly form: SettingsFormModel<SpanSettings>
  private readonly store: SnapshotStore<SpanCardState>

  /** @param scope - the shared configuration form of this bundle's Host entry. */
  constructor(scope: SettingsFormScope<Record<string, unknown>>) {
    this.form = new SettingsFormModel<SpanSettings>(scope as unknown as SettingsFormScope<SpanSettings>, SPECS)
    this.store = this.form.bind(() => this.projection())
  }

  /**
   * Project the form onto the page's state.
   *
   * Rebuilt from the scope and the local drafts together, so a Host write and a
   * staged edit both reach the page through one snapshot.
   * @returns the frame's state plus one state per control.
   */
  private projection(): SpanCardState {
    const states: Record<string, SettingsFieldState> = {}
    for (const field of FIELDS) states[field.field] = this.form.field(field.field)
    return { ...this.form.shell(), ...states } as SpanCardState
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and the form's own actions.
   */
  inject(): SpanCardFace {
    return { hooks: { spanCard: this.store }, ...this.form.actions() }
  }

  /** Release the form's accepted-value subscription. */
  dispose(): void {
    this.form.dispose()
  }
}
