// Synthetic V3 plugin for CHORE-17 measure A. Plain Node ESM, no src/ imports.
//
//   node Agents/Tools/save-gen/make-c17-plugin.mjs --out <file.js outside the repo> [--trigger button|setting] [--variants base|all]
//
// Writes a V3 plugin whose variants call the real plugin API on command, so the host cost of a full-array setDatabase can be
// measured on the real V3 path (v3.svelte.ts setDatabase/setDatabaseLite pass-through to plugins.svelte.ts):
//   FULL     getDatabase(['characters']), then setDatabase({ characters }) with the array unchanged
//   ONE      as FULL after toggling a fixed ASCII suffix on characters[0].name (the only intentional change; the suffix is
//            added on one run and removed on the next, so two runs leave the profile as it was)
//   NOCHARS  getDatabase(['lineHeight']), then setDatabase({ lineHeight }) with the value it already has. lineHeight is in
//            allowedDbKeys (plugins.svelte.ts), so the setter accepts it
//   LITE     as FULL with setDatabaseLite
// `--variants all` (default `base`: the four above, output unchanged) appends three more:
//   NOCHARS-LITE  as NOCHARS with setDatabaseLite, which skips the normaliser
//   GET           getDatabase(['characters']) only; no setter call (c17-skipped get-only)
//   CLONE         getDatabase(['characters']), then times structuredClone of the returned array inside the iframe; no setter call
// Trigger: `button` (default) registers one floating action button per variant with registerButton (location 'action');
// `setting` registers one registerSetting entry per variant instead, for a phone where the buttons are not reachable.
// Neither needs timers; a variant runs only when its entry is tapped, and a second tap during a run is ignored.
//
// Markers are exact strings so cdp-session.mjs `--console-filter '^c17-'` captures them: c17-ready, c17-variant <NAME>,
// c17-get-done <ms>, c17-set-start, c17-set-done <ms>, c17-clone-done <ms>, c17-skipped <reason> and c17-error <error name>.
// No marker holds database content. The plugin never logs, stores or sends database content and writes only what the
// variants above write.
//
// Header lines follow the rules of parsePluginHeader (pluginListMerge.ts): `//@name`, `//@display-name`, `//@api 3.0`, no
// `//@arg`. The default template of plugins.svelte.ts (createBlankPlugin) uses the same three lines.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const NAME_SUFFIX = ' [c17]'
export const VARIANTS = ['FULL', 'ONE', 'NOCHARS', 'LITE']
export const ALL_VARIANTS = [...VARIANTS, 'NOCHARS-LITE', 'GET', 'CLONE']

// The base plugin keeps the original readAndSet text so that the default output stays byte-identical; the `all` plugin adds a
// skip-reason parameter whose default is the original string.
const READ_AND_SET_BASE = `async function readAndSet(keys, change, setter) {
  const t0 = performance.now()
  const db = await risuai.getDatabase(keys)
  const t1 = performance.now()
  console.log('c17-get-done', t1 - t0)
  const payload = change(db)
  if (payload === null) {
    console.log('c17-skipped', 'nothing to write')
    return
  }
  console.log('c17-set-start')
  await setter(payload)
  console.log('c17-set-done', performance.now() - t1)
}`

const READ_AND_SET_ALL = `async function readAndSet(keys, change, setter, skipReason = 'nothing to write') {
  const t0 = performance.now()
  const db = await risuai.getDatabase(keys)
  const t1 = performance.now()
  console.log('c17-get-done', t1 - t0)
  const payload = change(db)
  if (payload === null) {
    console.log('c17-skipped', skipReason)
    return
  }
  console.log('c17-set-start')
  await setter(payload)
  console.log('c17-set-done', performance.now() - t1)
}`

const EXTRA_VARIANTS = `  'NOCHARS-LITE': () => readAndSet(['lineHeight'], (db) => (db.lineHeight === undefined ? null : { lineHeight: db.lineHeight }), (payload) => risuai.setDatabaseLite(payload)),
  GET: () => readAndSet(['characters'], () => null, null, 'get-only'),
  CLONE: async () => {
    const t0 = performance.now()
    const db = await risuai.getDatabase(['characters'])
    console.log('c17-get-done', performance.now() - t0)
    const t1 = performance.now()
    structuredClone(db.characters)
    console.log('c17-clone-done', performance.now() - t1)
  },
`

export function buildPluginSource(trigger = 'button', variants = 'base') {
  if (trigger !== 'button' && trigger !== 'setting') throw new Error('trigger must be button or setting')
  if (variants !== 'base' && variants !== 'all') throw new Error('variants must be base or all')
  const register = trigger === 'button'
    ? `await risuai.registerButton({ name: 'c17 ' + name, icon: 'c17', iconType: 'html', location: 'action', id: 'c17-' + name.toLowerCase() }, run)`
    : `await risuai.registerSetting('c17 ' + name, run, 'c17', 'html', 'c17-' + name.toLowerCase())`
  const readAndSet = variants === 'all' ? READ_AND_SET_ALL : READ_AND_SET_BASE
  const extra = variants === 'all' ? EXTRA_VARIANTS : ''
  return `//@name c17_probe
//@display-name c17-probe
//@api 3.0

const SUFFIX = ${JSON.stringify(NAME_SUFFIX)}
let running = false

${readAndSet}

const variants = {
  FULL: () => readAndSet(['characters'], (db) => ({ characters: db.characters }), (payload) => risuai.setDatabase(payload)),
  ONE: () => readAndSet(['characters'], (db) => {
    if (!db.characters || db.characters.length === 0) return null
    const first = db.characters[0]
    first.name = first.name.endsWith(SUFFIX) ? first.name.slice(0, first.name.length - SUFFIX.length) : first.name + SUFFIX
    return { characters: db.characters }
  }, (payload) => risuai.setDatabase(payload)),
  NOCHARS: () => readAndSet(['lineHeight'], (db) => (db.lineHeight === undefined ? null : { lineHeight: db.lineHeight }), (payload) => risuai.setDatabase(payload)),
  LITE: () => readAndSet(['characters'], (db) => ({ characters: db.characters }), (payload) => risuai.setDatabaseLite(payload)),
${extra}}

for (const name of Object.keys(variants)) {
  const run = async () => {
    if (running) return
    running = true
    try {
      console.log('c17-variant', name)
      await variants[name]()
    } catch (error) {
      console.log('c17-error', String(error && error.name))
    } finally {
      running = false
    }
  }
  ${register}
}
console.log('c17-ready')
`
}

function main() {
  const argv = process.argv.slice(2)
  let out = null
  let trigger = 'button'
  let variants = 'base'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]
    else if (argv[i] === '--trigger') trigger = argv[++i]
    else if (argv[i] === '--variants') variants = argv[++i]
    else throw new Error('unknown argument ' + argv[i])
  }
  if (!out) throw new Error('usage: node make-c17-plugin.mjs --out <file.js> [--trigger button|setting] [--variants base|all]')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const resolved = path.resolve(out)
  const relative = path.relative(repoRoot, resolved)
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('--out must be outside the repository')
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, buildPluginSource(trigger, variants))
  console.log(JSON.stringify({ out: resolved, bytes: fs.statSync(resolved).size, trigger, variants }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
