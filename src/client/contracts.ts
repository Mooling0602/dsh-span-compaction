/**
 * Local aliases over the DSH client services this bundle reads.
 *
 * The services are typed from the official packages rather than from
 * hand-written structural copies, so a DSH client API change fails this build
 * instead of the settings page at runtime. Every package below is a type-only
 * import: the Web app's module loader supplies the shared browser packages, so
 * nothing here is bundled or resolved at page load.
 *
 * @module dsh-span-compaction/client/contracts
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleKey } from './locales.ts'

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy this bundle's settings page renders. */
    'dsh-span-compaction': LocaleKey
  }
}

/** One Host entry's shared configuration form, as the page stages over it. */
export type SpanScope = SettingsFormScope<Record<string, unknown>>

/** Copy resolver bound to this bundle's dictionary. */
export type Translate = (key: LocaleKey) => string

/** The Cordis client context, composed with the services this bundle injects. */
export type ClientContext = Context
