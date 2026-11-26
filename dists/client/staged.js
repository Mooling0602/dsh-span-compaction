/** Every option this page edits, in render order. */
export const FIELDS = [
    { key: 'budget', path: ['spanBudgetTokens'], defaultValue: 160000, min: 1, integer: true },
    { key: 'tools', path: ['tools', 'enabled'], defaultValue: true },
    { key: 'nudge', path: ['nudge', 'enabled'], defaultValue: true },
    { key: 'ratio', path: ['nudge', 'ratio'], defaultValue: 0.7, positive: true, max: 1 },
    { key: 'minTokens', path: ['nudge', 'minTokens'], defaultValue: 50000, min: 0, integer: true },
    { key: 'everySteps', path: ['nudge', 'everySteps'], defaultValue: 8, min: 1, integer: true },
];
export function pathValue(value, path) {
    let node = value;
    for (const key of path) {
        if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key))
            return undefined;
        node = node[key];
    }
    return node;
}
export function parseInput(spec, input) {
    if (typeof spec.defaultValue === 'boolean')
        return typeof input === 'boolean' ? input : undefined;
    if (typeof input !== 'string' || input.trim() === '')
        return undefined;
    const number = Number(input);
    if (!Number.isFinite(number) || (spec.integer && !Number.isSafeInteger(number)))
        return undefined;
    if (spec.positive && number <= 0)
        return undefined;
    if (spec.min !== undefined && number < spec.min)
        return undefined;
    if (spec.max !== undefined && number > spec.max)
        return undefined;
    return number;
}
function acceptedInput(spec, section) {
    const value = pathValue(section, spec.path) ?? spec.defaultValue;
    return typeof spec.defaultValue === 'boolean' ? value === true : String(value);
}
export function stagedFields(specs, baseline, edits) {
    return specs.map(spec => {
        const edit = edits[spec.key];
        const value = edit?.kind === 'set' ? edit.value
            : acceptedInput(spec, edit?.kind === 'unset' ? baseline.base : baseline.value);
        return {
            spec, value,
            overridden: edit === undefined ? pathValue(baseline.user, spec.path) !== undefined : edit.kind === 'set',
            invalid: parseInput(spec, value) === undefined,
        };
    });
}
/** A reset is a real unset, even if its inherited value equals the override. */
export function stagedOperations(specs, edits) {
    const ops = [];
    for (const spec of specs) {
        const edit = edits[spec.key];
        if (edit === undefined)
            continue;
        if (edit.kind === 'unset')
            ops.push({ op: 'unset', path: [...spec.path] });
        else {
            const value = parseInput(spec, edit.value);
            if (value === undefined)
                return undefined;
            ops.push({ op: 'set', path: [...spec.path], value });
        }
    }
    return ops;
}
export class StagedController {
    latest;
    baseline;
    edits = {};
    conflict = false;
    saving = false;
    message;
    listeners = new Set();
    unsubscribe;
    generation = 0;
    state;
    form;
    specs;
    constructor(form, specs) {
        this.form = form;
        this.specs = specs;
        this.latest = this.baseline = form.getSnapshot();
        this.state = this.derive();
    }
    getSnapshot = () => this.state;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /** Owned by the mounted section, so leaving the page discards its draft. */
    start() {
        this.unsubscribe?.();
        const sync = () => {
            this.latest = this.form.getSnapshot();
            if (Object.keys(this.edits).length === 0)
                this.baseline = this.latest;
            else if (!this.saving && this.latest.revision !== this.baseline.revision)
                this.conflict = true;
            this.publish();
        };
        this.unsubscribe = this.form.subscribe(sync);
        sync();
        return () => {
            this.unsubscribe?.();
            this.unsubscribe = undefined;
            this.generation += 1;
            this.saving = false;
            this.clearDraft();
            // Reflect the dropped draft immediately; the page may be re-opened from
            // this same controller, and a stale snapshot would show the old edits.
            this.publish();
        };
    }
    edit(key, value) {
        if (!this.canEdit())
            return;
        const spec = this.specs.find(field => field.key === key);
        if (spec === undefined)
            return;
        if (Object.keys(this.edits).length === 0)
            this.baseline = this.latest;
        if (value === acceptedInput(spec, this.baseline.value))
            delete this.edits[key];
        else
            this.edits[key] = { kind: 'set', value };
        this.message = undefined;
        this.publish();
    }
    reset(key) {
        if (!this.canEdit())
            return;
        const spec = this.specs.find(field => field.key === key);
        if (spec === undefined)
            return;
        if (Object.keys(this.edits).length === 0)
            this.baseline = this.latest;
        if (pathValue(this.baseline.user, spec.path) === undefined)
            delete this.edits[key];
        else
            this.edits[key] = { kind: 'unset' };
        this.message = undefined;
        this.publish();
    }
    discard = () => {
        if (this.saving)
            return;
        this.clearDraft();
        this.publish();
    };
    save = async () => {
        // Check the source again in case publication beat the subscriber callback.
        this.latest = this.form.getSnapshot();
        if (this.latest.revision !== this.baseline.revision)
            this.conflict = true;
        const ops = stagedOperations(this.specs, this.edits);
        if (!this.canEdit() || this.conflict || !ops?.length || this.baseline.revision === undefined) {
            this.publish();
            return false;
        }
        const revision = this.baseline.revision;
        const generation = this.generation;
        this.saving = true;
        this.message = undefined;
        this.publish();
        let accepted = false;
        try {
            accepted = await this.form.mutate(ops, revision);
        }
        catch { /* Transport refusal retains the draft. */ }
        if (generation !== this.generation)
            return accepted;
        this.saving = false;
        this.latest = this.form.getSnapshot();
        if (accepted)
            this.clearDraft();
        else if (this.latest.revision !== revision)
            this.conflict = true;
        this.message = accepted ? 'saved' : 'failed';
        this.publish();
        return accepted;
    };
    /** Release accepted-value subscriptions and listeners when the page unmounts. */
    dispose() {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.generation += 1;
        this.saving = false;
        this.clearDraft();
        this.listeners.clear();
    }
    canEdit() {
        return !this.saving && this.latest.status === 'ready' && this.latest.writable;
    }
    clearDraft() {
        this.edits = {};
        this.baseline = this.latest;
        this.conflict = false;
        this.message = undefined;
    }
    derive() {
        const dirty = Object.keys(this.edits).length > 0;
        return {
            status: this.latest.status,
            fields: stagedFields(this.specs, dirty ? this.baseline : this.latest, this.edits),
            dirty, conflict: dirty && this.conflict, saving: this.saving,
            writable: this.latest.writable, message: this.message,
        };
    }
    publish() {
        if (Object.keys(this.edits).length === 0) {
            this.baseline = this.latest;
            this.conflict = false;
        }
        this.state = this.derive();
        for (const listener of this.listeners)
            listener();
    }
}
