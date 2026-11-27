import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoverDshVersions } from '../.github/scripts/discover-dsh-versions.ts'

const manifest = { engines: { dsh: '>=0.2.3-alpha.2 <0.3.0-0' } }

const packument = (...versions: string[]) => ({ versions: Object.fromEntries(versions.map(version => [version, {}])) })

test('CI selects and sorts only DSH versions admitted by the runtime range', () => {
  assert.deepEqual(discoverDshVersions(manifest, packument(
    '0.2.4-rc.1', '0.2.3-alpha.2', '0.3.0-alpha.1', '0.2.3', '0.2.2-rc.5', '0.2.3-alpha.1',
  )), ['0.2.3-alpha.2', '0.2.3', '0.2.4-rc.1'])
})

test('CI rejects invalid registry data and an empty compatibility matrix', () => {
  assert.throws(() => discoverDshVersions(manifest, {}), /versions object/)
  assert.throws(() => discoverDshVersions(manifest, packument('v0.2.3')), /invalid DSH version/)
  assert.throws(() => discoverDshVersions(manifest, packument('0.2.3-alpha.1')), /No published DSH version/)
})

test('CI requires the top-level DSH range and enforces the matrix limit', () => {
  assert.throws(() => discoverDshVersions({ dsh: manifest }, packument('0.2.3')), /engines.dsh/)
  assert.throws(() => discoverDshVersions(manifest, packument(
    ...Array.from({ length: 257 }, (_, index) => `0.2.${index + 3}`),
  )), /limit of 256/)
})
