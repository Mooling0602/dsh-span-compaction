import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { SettingsForm, SettingsValueField, Switch, } from '@deepseek-ai/dsh-client-ui-primitives';
import { formLabels } from "./locales.js";
import { FIELDS } from "./fields.js";
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
};
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
function SwitchField(props) {
    return (_jsxs("div", { style: STYLE.field, children: [_jsxs("div", { style: STYLE.head, children: [_jsx("div", { style: STYLE.labelGroup, children: _jsx("span", { style: STYLE.label, children: props.label }) }), props.state.overridden
                        ? (_jsxs("span", { style: STYLE.badges, children: [_jsx("span", { style: STYLE.tag, children: props.overriddenLabel }), _jsx("button", { type: "button", style: STYLE.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }))
                        : null, _jsx(Switch, { checked: props.state.text === 'on', label: props.label, disabled: props.disabled, onChange: props.onChange })] }), _jsx("p", { style: STYLE.hint, children: props.hint })] }));
}
/**
 * Render this bundle's options as a staged form.
 * @param props - the bound snapshot, the page's copy, and the form actions.
 * @returns the form, or the one-line description while the summary is asked for.
 */
export function SpanSettingsPage(props) {
    const state = props.useSpanCard(snapshot => snapshot);
    const { t } = props;
    if (props.view === 'summary')
        return _jsx(_Fragment, { children: t('summary') });
    const disabled = !state.writable || state.saving;
    return (_jsx(SettingsForm, { labels: formLabels(t), state: state, onSave: props.save, onDiscard: props.discard, children: FIELDS.map(field => field.kind === 'switch'
            ? (_jsx(SwitchField, { label: t(field.label), hint: t(field.hint), state: state[field.field], disabled: disabled, overriddenLabel: t('overridden'), resetLabel: t('reset'), onChange: next => { props.edit(field.field, next ? 'on' : 'off'); }, onReset: () => { props.resetField(field.field); } }, field.field))
            : (_jsx(ValueField, { field: field, state: state[field.field], t: t, disabled: disabled, onEdit: text => { props.edit(field.field, text); }, onReset: () => { props.resetField(field.field); } }, field.field))) }));
}
/**
 * Render one text or number row through the shared value field.
 * @param props - the control's declaration, its staged state, and the staging actions.
 * @returns the labelled control.
 */
function ValueField(props) {
    const { t, field } = props;
    return (_jsx(SettingsValueField, { id: `plugin-config-span-${field.field}`, label: t(field.label), hint: t(field.hint), overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalid'), disabled: props.disabled, numeric: field.kind === 'number', ...props.state, onEdit: props.onEdit, onReset: props.onReset }));
}
