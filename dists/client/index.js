/**
 * Browser entry: this bundle's settings page on its own card in the Plugins page.
 *
 * Placement follows `dsh-better-plugin-updater`: one `plugins.bundle.config`
 * entry keyed by the package name, which the Plugins page renders on the
 * bundle's own page between its description and its rows. That is the surface
 * for a bundle's configuration — it is outside the individual components, there
 * is no second copy in a component or a detail section, and the page needs no
 * drilling into a component to be reached.
 *
 * Registration is gated on the Host serving this entry's namespace, so a
 * deployment that failed to mount the engine half shows no form whose writes
 * would go nowhere.
 *
 * @module dsh-span-compaction/client
 */
import { LOCALE_NS, dictionaryFor, en, zh } from "./locales.js";
import { SpanCardController } from "./settings-controller.js";
import { SpanSettingsPage } from "./settings-page.js";
/** The bundle package name the Plugins page keys a bundle page by. */
export const BUNDLE_NAME = 'dsh-span-compaction';
/** The profile entry id this bundle's `cordis.patch.yml` row inserts. */
export const ENTRY_ID = 'span-compaction';
/**
 * Mount the settings page.
 * @param ctx - the Cordis client context.
 */
export function apply(ctx) {
    try {
        mountSettingsPage(ctx);
    }
    catch (error) {
        // A reload re-applies this bundle while the previous fiber is still being
        // torn down; a throw here would kill the plugin and leave its page gone.
        console.error('dsh-span-compaction: settings page failed to mount', error);
    }
}
/**
 * Mount the page from inside the services it reads.
 *
 * `ctx.inject` runs its callback only once every named service is composed, so a
 * front end without settings never sees a half-registered entry.
 * @param ctx - the Cordis client context.
 */
export function mountSettingsPage(ctx) {
    ctx.inject(['slots', 'configForms', 'locale'], inner => inner.effect(() => {
        // A front end that serves settings without a locale service still gets the
        // page, just in English: `resolveCopy` falls back to reading the snapshot.
        let releaseDicts;
        try {
            releaseDicts = inner.locale.register(LOCALE_NS, { en, zh });
        }
        catch (error) {
            console.warn('dsh-span-compaction: settings copy fell back to its own dictionaries', error);
        }
        const t = resolveCopy(inner);
        const disposePage = inner.configForms.whileServed([ENTRY_ID], () => {
            const controller = new SpanCardController(inner.configForms.get(ENTRY_ID));
            const disposeSlot = inner.slots.inject('plugins.bundle.config', () => inner.slots.register({
                name: 'plugins.bundle.config',
                key: BUNDLE_NAME,
                locale: LOCALE_NS,
                inject: () => ({ t, ...controller.inject() }),
            }, SpanSettingsPage));
            return () => {
                disposeSlot?.();
                controller.dispose();
            };
        });
        return () => {
            disposePage?.();
            releaseDicts?.();
        };
    }, 'dsh-span-compaction: settings page'));
}
/**
 * Resolve this bundle's copy for the active language.
 *
 * The registered namespace is the normal path. A reload can re-apply this bundle
 * before the previous fiber releases its dictionaries, so a failed registration
 * must not surface as raw keys: the resolver then reads this bundle's own copy
 * for the active language instead.
 * @param ctx - a context whose `locale` service is composed.
 * @returns the copy resolver.
 */
function resolveCopy(ctx) {
    try {
        const bound = ctx.locale.bind(LOCALE_NS);
        // A bound resolver over a namespace nothing registered returns the key.
        if (bound('title') !== 'title')
            return key => bound(key);
    }
    catch {
        // No locale service: the snapshot path below still yields real copy.
    }
    return key => {
        let language;
        try {
            language = ctx.locale.getSnapshot().active;
        }
        catch {
            // English is the fallback the dictionaries are written in.
        }
        return dictionaryFor(language)[key] ?? key;
    };
}
export { SpanCardController } from "./settings-controller.js";
export { FIELDS, settingsBooleanField } from "./fields.js";
export { SpanSettingsPage } from "./settings-page.js";
export { en, zh, dictionaryFor, formLabels, LOCALE_NS } from "./locales.js";
