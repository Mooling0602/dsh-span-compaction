import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { COMPETING_COMPONENTS, competingCompressors } from './gate.ts'

interface ProfileLocation {
  dir: string
}

interface LoaderEntry {
  options: { id?: string; name?: string }
  disabled: boolean
}

/** Detect selected bundles unless all of their known components are disabled. */
export function selectedConflicts(profile: ProfileLocation, entries: readonly LoaderEntry[] = []): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(profile.dir, 'package.json'), 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid profile package manifest')
  const bundles = (manifest as { dsh?: { profile?: { bundles?: unknown } } }).dsh?.profile?.bundles
  if (bundles === undefined) return []
  if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string')) throw new Error('Invalid profile bundle selection')
  return [...new Set(bundles.filter((name: string) => {
    if (!Object.hasOwn(COMPETING_COMPONENTS, name)) return false
    const aliases = COMPETING_COMPONENTS[name]!
    const components = entries.filter(entry => aliases.includes(entry.options.name ?? '') || aliases.includes(entry.options.id ?? ''))
    return components.length === 0 || components.some(entry => !entry.disabled)
  }))]
}

/** Also detect competing plugin entries loaded outside the profile bundle list. */
export function incompatiblePlugins(ctx: Context): string[] {
  const profile = ctx.get('profileContext') as ProfileLocation | undefined
  const loader = ctx.get('loader') as { entries(): Iterable<LoaderEntry> } | undefined
  const entries = loader ? [...loader.entries()] : []
  return [...new Set([...(profile ? selectedConflicts(profile, entries) : []), ...competingCompressors(ctx)])]
}

export function conflictError(names: readonly string[]): Error | undefined {
  if (names.length === 0) return undefined
  return new Error(`检测到不兼容的同类插件 ${names.join('、')}，请停用或卸载后再重新加载此插件，或放弃使用此插件。`)
}
