import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'

const registryUrl = 'https://registry.npmjs.org/@deepseek-ai%2fdsh'
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Match published runtimes using the same prerelease-aware range as the DSH loader. */
export function discoverDshVersions(manifest: unknown, packument: unknown): string[] {
  const engines = isRecord(manifest) ? manifest.engines : undefined
  const range = isRecord(engines) ? engines.dsh : undefined
  if (typeof range !== 'string' || !range.trim() || !semver.validRange(range)) {
    throw new Error('Expected a valid, nonempty engines.dsh range.')
  }
  if (!isRecord(packument) || !isRecord(packument.versions)) {
    throw new Error('Expected a versions object from the npm registry.')
  }
  const versions = Object.keys(packument.versions)
  if (versions.some(version => !versionPattern.test(version) || !semver.valid(version))) {
    throw new Error('The npm registry returned an invalid DSH version.')
  }
  const matches = versions.filter(version => semver.satisfies(version, range, { includePrerelease: true })).sort(semver.compare)
  if (matches.length === 0) throw new Error('No published DSH version matches engines.dsh.')
  if (matches.length > 256) throw new Error('The DSH matrix exceeds the GitHub Actions limit of 256 jobs.')
  return matches
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest: unknown = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const response = await fetch(registryUrl, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`The npm registry returned HTTP ${response.status}.`)
  console.log(JSON.stringify(discoverDshVersions(manifest, await response.json())))
}
