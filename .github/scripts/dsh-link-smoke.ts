import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

interface LaunchEnvironment {
  createLaunchEnvironmentSnapshot(sources: { source: 'process'; values: NodeJS.ProcessEnv }[]): unknown
}

interface AppBoot {
  initProfile(dir: string, bundles: string[]): void
  resolveProfileDir(name: string, home: string): string
}

interface ProfileBoot {
  runProfile(options: {
    environment: unknown
    profile: string
    patchFiles: string[]
    args: string[]
  }): Promise<{
    ctx: { get<T>(key: string): T | undefined }
    shutdown: { shutdown(exitCode: number): Promise<void> }
  }>
}

const [mode, entry, workspace = process.cwd()] = process.argv.slice(2)
assert.ok(mode === 'prepare' || mode === 'verify', 'Expected prepare or verify mode.')
assert.ok(entry, 'Expected the installed DSH profile boot module path.')
assert.ok(process.env.DSH_HOME, 'Expected an isolated DSH_HOME.')

const runtimeRequire = createRequire(realpathSync(entry))
const profile = 'ci-smoke'

if (mode === 'prepare') {
  const appBoot = runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')
  const { initProfile, resolveProfileDir } = await import(pathToFileURL(appBoot).href) as AppBoot
  // The base bundle provides the host services without starting a Web server or a model turn.
  initProfile(resolveProfileDir(profile, process.env.DSH_HOME), ['@deepseek-ai/dsh-base'])
} else {
  const { runProfile } = await import(pathToFileURL(entry).href) as ProfileBoot
  const environmentModule = runtimeRequire.resolve('@deepseek-ai/dsh-launch-environment')
  const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(environmentModule).href) as LaunchEnvironment
  const { ctx, shutdown } = await runProfile({
    environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]),
    profile,
    patchFiles: [],
    args: [],
  })

  let exitCode = 1
  try {
    const profileContext = ctx.get<{ dir: string; startedBundles: string[] }>('profileContext')
    assert.ok(profileContext, 'DSH must expose the isolated profile context.')
    assert.ok(profileContext.startedBundles.includes('dsh-span-compaction'), 'DSH must compose the linked bundle.')
    const linkedPackage = join(profileContext.dir, 'node_modules', 'dsh-span-compaction')
    assert.equal(realpathSync(linkedPackage), realpathSync(workspace), 'The profile must use the local plugin build.')

    assert.equal(ctx.get<object>('compaction')?.constructor.name, 'SpanCompactionEngine', 'Span Compaction must own the host compaction service.')

    const tools = ctx.get<{ get(name: string): { name: string } | undefined }>('tools')
    for (const name of ['compact_targets', 'compact']) {
      assert.equal(tools?.get(name)?.name, name, `The activated plugin must register ${name}.`)
    }
    console.log('DSH started with the linked Span Compaction bundle and both model tools.')
    exitCode = 0
  } catch (error) {
    // DSH shutdown exits the process, so report assertion failures before it runs.
    console.error(error)
  } finally {
    await shutdown.shutdown(exitCode)
  }
}
