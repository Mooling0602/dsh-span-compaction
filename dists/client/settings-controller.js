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
import { SettingsFormModel, settingsNumberField, } from '@deepseek-ai/dsh-client-ui-primitives';
import { FIELDS, settingsBooleanField } from "./fields.js";
/** The specs this page edits, in the order `FIELDS` renders them. */
const SPECS = FIELDS.map(field => field.kind === 'switch'
    ? settingsBooleanField(field.field)
    : settingsNumberField(field.field));
/** Bridges this bundle's Host entry onto the page's staged form. */
export class SpanCardController {
    form;
    store;
    /** @param scope - the shared configuration form of this bundle's Host entry. */
    constructor(scope) {
        this.form = new SettingsFormModel(scope, SPECS);
        this.store = this.form.bind(() => this.projection());
    }
    /**
     * Project the form onto the page's state.
     *
     * Rebuilt from the scope and the local drafts together, so a Host write and a
     * staged edit both reach the page through one snapshot.
     * @returns the frame's state plus one state per control.
     */
    projection() {
        const states = {};
        for (const field of FIELDS)
            states[field.field] = this.form.field(field.field);
        return { ...this.form.shell(), ...states };
    }
    /**
     * Build the face the page's slot registration injects.
     * @returns the page's snapshot and the form's own actions.
     */
    inject() {
        return { hooks: { spanCard: this.store }, ...this.form.actions() };
    }
    /** Release the form's accepted-value subscription. */
    dispose() {
        this.form.dispose();
    }
}
