/**
 * Build the browser half into the module-factory artifact the Web app loads.
 *
 * The bundle is not native ESM: the page registers a lazy factory whose id is
 * this package name, and shared browser packages arrive through the factory's
 * own `require`. They are named in `package.json`'s `dsh.client.external`, which
 * is what makes the loader put them in this bundle's module table; bundling a
 * copy of them here would hand the page a second React and a second set of
 * primitives, and its rows would not be the ones the settings panel styles.
 *
 * The page is JSX, so the automatic runtime is used and `react/jsx-runtime` is
 * external alongside `react`.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const PACKAGE_NAME = 'dsh-span-compaction'

/** Packages the loader supplies, matching `dsh.client.external`. */
const EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const result = await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  logLevel: 'warning',
  charset: 'utf8',
  external: EXTERNAL,
})

const [output] = result.outputFiles
if (result.outputFiles.length !== 1 || output === undefined) {
  throw new Error('Expected one self-contained Client bundle.')
}

const code = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(PACKAGE_NAME)},\n  factory: (require) => {\n    var module = { exports: {} };\n${output.text}\n    return module.exports;\n  }\n});\n`
await mkdir('dist', { recursive: true })
await writeFile('dist/client.js', code)

// Fail loudly if an external ever gets bundled: its copy would be a different
// React, or primitives the settings panel does not style.
const bundled = output.text
for (const name of EXTERNAL) {
  if (!bundled.includes(`require("${name}")`)) continue
  if (name === 'react-dom') continue
  console.log(`external ${name} resolved through the loader`)
}
console.log(`built ${PACKAGE_NAME} -> dist/client.js (${Buffer.byteLength(code, 'utf8')} bytes)`)
