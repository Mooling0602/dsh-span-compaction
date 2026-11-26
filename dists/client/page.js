/**
 * The bundle's settings page: one replay-budget section for the engine entry and
 * one tools/reminder section for the hooks entry.
 *
 * Both sections are staged drafts over the Host configuration mirror. A
 * namespace is saved on its own, so the page never claims a single atomic write
 * across two Host entries; each section can be saved or discarded separately and
 * leaving the page drops whatever was not saved.
 */
import { Component, createElement as h } from 'react';
import { FIELDS, StagedController } from "./staged.js";
import { en, zh } from "./locales.js";
/** Host entries this page edits; the settings namespace is the entry's patch id. */
export const NAMESPACE = 'span-compaction';
/** The single row this bundle inserts; its row page carries the same form. */
export const ROW_ID = 'span-compaction';
/** Bundle package name, the key the Plugins page dispatches this configuration under. */
export const BUNDLE_NAME = 'dsh-span-compaction';
/** Copy keys every field needs, resolved from the field's own key. */
const INVALID_KEY = {
    budget: 'invalidBudget',
    ratio: 'invalidRatio',
    minTokens: 'invalidMinTokens',
    everySteps: 'invalidEverySteps',
};
const STYLE = {
    section: { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0' },
    title: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
    hint: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
    field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
    head: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    label: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
    tag: { padding: '0 6px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 4, fontSize: 11, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    reset: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
    input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13 },
    invalid: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' },
    row: { display: 'flex', alignItems: 'center', gap: 8 },
    footer: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    primary: { padding: '5px 12px', border: 'none', borderRadius: 6, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-bg-base)', fontSize: 13, cursor: 'pointer' },
    secondary: { padding: '5px 12px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'none', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer' },
    disabled: { opacity: 0.5, cursor: 'default' },
    note: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
    error: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' },
    success: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-success-primary)' },
    separator: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '4px 0' },
};
function fieldCopy(t, spec) {
    return { label: t(spec.key), hint: t(`${spec.key}Hint`) };
}
/**
 * Render one staged field.
 * @param props - field state, copy, and the section's controller.
 * @returns the field row.
 */
function FieldRow(props) {
    const { t, state, disabled, controller } = props;
    const spec = state.spec;
    const copy = fieldCopy(t, spec);
    const overridden = state.overridden
        ? h('span', { style: STYLE.tag, key: 'override' }, t('overridden'))
        : null;
    const reset = overridden
        ? h('button', {
            type: 'button',
            style: STYLE.reset,
            disabled,
            title: t('resetHint'),
            onClick: () => { controller.reset(spec.key); },
        }, t('reset'))
        : null;
    const control = typeof spec.defaultValue === 'boolean'
        ? h('input', {
            type: 'checkbox',
            checked: state.value === true,
            disabled,
            onChange: (event) => { controller.edit(spec.key, event.target.checked); },
        })
        : h('input', {
            type: 'number',
            style: STYLE.input,
            value: String(state.value),
            disabled,
            step: spec.integer ? 1 : 'any',
            min: spec.min,
            max: spec.max,
            onChange: (event) => { controller.edit(spec.key, event.target.value); },
        });
    return h('div', { style: STYLE.field, key: spec.key }, h('div', { style: STYLE.head }, h('label', { style: STYLE.label }, copy.label), overridden, reset), h('div', { style: STYLE.row }, control), h('p', { style: STYLE.hint }, copy.hint), state.invalid ? h('p', { style: STYLE.invalid }, t(INVALID_KEY[spec.key] ?? 'failed')) : null);
}
/**
 * Render one namespace section.
 * @param props - section identity, its controller, and its fields.
 * @returns the section.
 */
function Section(props) {
    const { t, title, hint, controller, state } = props;
    const disabled = !state.writable || state.saving || state.status !== 'ready';
    const canSave = !disabled && state.dirty && !state.conflict
        && state.fields.every(field => !field.invalid);
    if (state.status === 'loading')
        return h('p', { style: STYLE.note }, t('loading'));
    if (state.status === 'unavailable') {
        return h('div', { style: STYLE.section }, h('h3', { style: STYLE.title }, title), h('p', { style: STYLE.note }, t('unavailable')));
    }
    return h('div', { style: STYLE.section }, h('h3', { style: STYLE.title }, title), hint.length > 0 ? h('p', { style: STYLE.hint }, hint) : null, ...state.fields.map(field => h(FieldRow, { key: field.spec.key, t, state: field, disabled, controller })), state.conflict ? h('p', { style: STYLE.error }, t('conflict')) : null, state.message === 'saved' ? h('p', { style: STYLE.success }, t('saved')) : null, state.message === 'failed' ? h('p', { style: STYLE.error }, t('failed')) : null, h('div', { style: STYLE.footer }, h('button', {
        type: 'button',
        style: { ...STYLE.primary, ...(canSave ? {} : STYLE.disabled) },
        disabled: !canSave,
        onClick: () => { void controller.save(); },
    }, state.saving ? t('saving') : t('save')), h('button', {
        type: 'button',
        style: { ...STYLE.secondary, ...(state.dirty && !state.saving ? {} : STYLE.disabled) },
        disabled: !state.dirty || state.saving,
        onClick: () => { controller.discard(); },
    }, t('discard')), state.dirty ? h('span', { style: STYLE.note }, t('dirty')) : null, !state.writable ? h('span', { style: STYLE.note }, t('readonly')) : null));
}
/**
 * The settings body.
 *
 * This is a class component on purpose: the body subscribes to two namespace
 * stores and starts their staging when it mounts, and doing that without hooks
 * keeps every failure inside one `try` in `render`, where it can be shown on the
 * page. The renderer's slot boundary renders an empty marker for a throwing
 * entry, which is indistinguishable from an entry that never registered.
 */
class SpanSettingsPage extends Component {
    unsubscribes = [];
    componentDidMount() {
        // Staging was started when this entry registered, so mounting only has to
        // follow changes. Nothing here can fail a first paint.
        try {
            this.unsubscribes.push(this.props.settings.subscribe(() => { this.forceUpdate(); }));
        }
        catch {
            // A controller without a working subscription still renders its values.
        }
    }
    componentWillUnmount() {
        for (const unsubscribe of this.unsubscribes.splice(0)) {
            try {
                unsubscribe();
            }
            catch { /* the controller already released it */ }
        }
    }
    render() {
        const { t } = this.props;
        try {
            return h(Section, { t, title: t('title'), hint: t('independent'), controller: this.props.settings, state: this.props.settings.getSnapshot() });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return h('p', { style: STYLE.invalid }, `${t('failed')} ${message}`);
        }
    }
}
/**
 * Whether a detail page belongs to this bundle.
 * @param subject - the page's subject.
 * @returns true for this bundle and the row it declares.
 */
function belongsToThisBundle(subject) {
    if (subject.kind === 'item')
        return false;
    if (subject.pkg?.name !== BUNDLE_NAME)
        return false;
    return subject.kind === 'bundle' || subject.row.rowId === ROW_ID;
}
/**
 * Render the Plugins page's one-liner or the full body.
 * @param props - the requested view, copy, and injected controllers.
 * @returns the one-liner, or the settings body.
 */
export function SpanSettingsCard(props) {
    const t = typeof props?.t === 'function' ? props.t : (key) => key;
    // The detail-section entry is invited by every plugin page; it contributes
    // only to this bundle and its own rows.
    if (props?.subject !== undefined && !belongsToThisBundle(props.subject))
        return null;
    // A detail section is invited with the subject alone, so its absence of a
    // `view` means "draw the body"; a configuration entry asks for both views.
    const section = props?.subject !== undefined;
    if (!section && props?.view !== 'page')
        return t('summary');
    if (props.settings === undefined) {
        return h('p', { style: STYLE.invalid }, t('notWired'));
    }
    return h(SpanSettingsPage, props);
}
/**
 * Copy for the active language.
 *
 * The page carries its own strings instead of registering a locale namespace:
 * a plugin reload can run while the previous fiber still owns the namespace,
 * and a second registration of the same locale throws, which would take the whole
 * page down. Reading the active language at registration time is what the other
 * third-party pages do.
 * @param locale - client locale service.
 * @returns the translate function for this registration.
 */
function translateFor(read) {
    let active = 'en';
    try {
        // Reading a service the entry did not inject throws; the accessor keeps that
        // inside the guard and falls back to English copy.
        active = String(read()?.getSnapshot?.().active ?? 'en');
    }
    catch {
        // A client without a readable locale keeps the English copy.
    }
    const dictionary = active.startsWith('zh') ? zh : en;
    return (key) => dictionary[key] ?? key;
}
/**
 * Mount the settings page on the bundle's own Plugins page.
 *
 * The entry is registered inside `slots.inject`, so it is born exactly while the
 * Plugins page declares this slot and is reinstalled when that declaration
 * returns. Registering outside it leaves an entry that the declaration lifecycle
 * can dispose without a replacement, which is invisible to the reader. The
 * registration does not wait for the settings namespaces: the page is served by
 * this bundle's own host rows, and each section reports its own availability.
 * @param ctx - client runtime supplying slots, forms, and locale.
 */
export function mountSpanSettings(ctx) {
    ctx.inject(['slots', 'configForms', 'locale'], inner => inner.effect(() => {
        const configForms = inner.configForms;
        const settings = new StagedController(configForms.get(NAMESPACE), FIELDS);
        const stops = [settings.start()];
        const register = (name, options) => {
            try {
                return inner.slots.inject(name, () => inner.slots.register({
                    name,
                    order: 41,
                    inject: () => ({ settings, t: translateFor(() => inner.locale) }),
                    ...options,
                }, SpanSettingsCard));
            }
            catch (error) {
                console.error(`dsh-span-compaction: cannot register ${name}`, error);
                return () => { };
            }
        };
        const disposals = [
            register('plugins.bundle.config', { key: BUNDLE_NAME }),
            register('plugins.row.config', { key: `${BUNDLE_NAME}#${ROW_ID}` }),
            // A detail section is drawn by every package and row page below its own
            // configuration, so the form stays reachable when a host renders one
            // surface and not the other.
            register('plugins.detail.section', { id: `${BUNDLE_NAME}.settings` }),
        ];
        return () => {
            for (const dispose of disposals)
                dispose();
            for (const stop of stops.reverse())
                stop();
            settings.dispose();
        };
    }, 'dsh-span-compaction: settings page'));
}
