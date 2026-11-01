// @vitest-environment node
// Run: pnpm vitest run Agents/Tools/save-gen/make-c17-plugin.test.mjs   (name the file; never the whole save-gen folder)
// Env C17_GENERATOR: path of another copy of make-c17-plugin.mjs, for mutant runs.
import { describe, expect, test } from 'vitest'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const generator = await import(pathToFileURL(process.env.C17_GENERATOR ?? path.join(HERE, 'make-c17-plugin.mjs')).href)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// The three header rules of parsePluginHeader (pluginListMerge.ts), re-implemented: `//@name` takes line.slice(7).trim(),
// `//@display-name` takes line.slice(len + 1).trim(), `//@api` takes the first supported token of line.slice(6).trim().split(' '),
// and `//@risu-arg` / `//@arg` lines declare arguments.
function parseHeader(script) {
  const out = { name: '', displayName: undefined, api: '2.0', args: 0 }
  for (const line of script.replace(/^\uFEFF/, '').split('\n')) {
    if (line.startsWith('//@name')) out.name = line.slice(7).trim()
    if (line.startsWith('//@api')) {
      const found = line.slice(6).trim().split(' ').find((version) => ['2.0', '2.1', '3.0'].includes(version))
      if (found) out.api = found
    }
    if (line.startsWith('//@display-name')) out.displayName = line.slice('//@display-name'.length + 1).trim()
    if (line.startsWith('//@risu-arg') || line.startsWith('//@arg')) out.args++
  }
  return out
}

function makeHarness(characters, lineHeight = 1.25) {
  const state = { characters, lineHeight }
  const calls = []
  const logs = []
  const callbacks = {}
  const risuai = {
    registerButton: async (arg, callback) => { calls.push(['registerButton', arg.name]); callbacks[arg.name] = callback; return {} },
    registerSetting: async (name, callback) => { calls.push(['registerSetting', name]); callbacks[name] = callback; return {} },
    getDatabase: async (keys) => { calls.push(['getDatabase', keys]); return Object.fromEntries(keys.map((key) => [key, structuredClone(state[key])])) },
    setDatabase: async (db) => { calls.push(['setDatabase', Object.keys(db)]); Object.assign(state, structuredClone(db)) },
    setDatabaseLite: async (db) => { calls.push(['setDatabaseLite', Object.keys(db)]); Object.assign(state, structuredClone(db)) },
  }
  const console = { log: (...args) => logs.push(args) }
  return { state, calls, logs, callbacks, risuai, console }
}

async function load(trigger = 'button', characters = [{ chaId: 'a', name: 'Alpha', desc: 'x' }, { chaId: 'b', name: 'Beta' }]) {
  const source = generator.buildPluginSource(trigger)
  const h = makeHarness(characters)
  await new AsyncFunction('risuai', 'console', 'performance', source)(h.risuai, h.console, performance)
  return { source, ...h }
}
const markerNames = (logs) => logs.map((args) => args[0])

describe('make-c17-plugin', () => {
  test('header: name, display name, api 3.0 and no //@arg', async () => {
    const { source } = await load()
    expect(parseHeader(source)).toEqual({ name: 'c17_probe', displayName: 'c17-probe', api: '3.0', args: 0 })
  })

  test('loads, registers one entry per variant, and logs c17-ready', async () => {
    const h = await load()
    expect(h.calls.map((c) => c[0])).toEqual(['registerButton', 'registerButton', 'registerButton', 'registerButton'])
    expect(Object.keys(h.callbacks)).toEqual(['c17 FULL', 'c17 ONE', 'c17 NOCHARS', 'c17 LITE'])
    expect(h.logs).toEqual([['c17-ready']])
    const s = await load('setting')
    expect(s.calls.map((c) => c[0])).toEqual(['registerSetting', 'registerSetting', 'registerSetting', 'registerSetting'])
  })

  test('FULL: call sequence and exact markers, characters written back unchanged', async () => {
    const h = await load()
    const before = structuredClone(h.state.characters)
    h.calls.length = 0; h.logs.length = 0
    await h.callbacks['c17 FULL']()
    expect(h.calls).toEqual([['getDatabase', ['characters']], ['setDatabase', ['characters']]])
    expect(markerNames(h.logs)).toEqual(['c17-variant', 'c17-get-done', 'c17-set-start', 'c17-set-done'])
    expect(h.logs[0]).toEqual(['c17-variant', 'FULL'])
    expect(typeof h.logs[1][1]).toBe('number')
    expect(typeof h.logs[3][1]).toBe('number')
    expect(h.state.characters).toEqual(before)
  })

  test('ONE changes exactly one field and toggles back on the second run', async () => {
    const h = await load()
    const original = structuredClone(h.state.characters)
    await h.callbacks['c17 ONE']()
    expect(h.state.characters[0].name).toBe('Alpha [c17]')
    expect({ ...h.state.characters[0], name: 'Alpha' }).toEqual(original[0])
    expect(h.state.characters[1]).toEqual(original[1])
    await h.callbacks['c17 ONE']()
    expect(h.state.characters).toEqual(original)
  })

  test('NOCHARS writes the present lineHeight only; LITE uses setDatabaseLite only', async () => {
    const h = await load()
    h.calls.length = 0
    await h.callbacks['c17 NOCHARS']()
    expect(h.calls).toEqual([['getDatabase', ['lineHeight']], ['setDatabase', ['lineHeight']]])
    expect(h.state.lineHeight).toBe(1.25)
    h.calls.length = 0
    await h.callbacks['c17 LITE']()
    expect(h.calls).toEqual([['getDatabase', ['characters']], ['setDatabaseLite', ['characters']]])
  })

  test('a failing call logs only the error name and a second tap during a run is ignored', async () => {
    const h = await load()
    h.risuai.setDatabase = async () => { const e = new Error('secret database text'); e.name = 'PermissionError'; throw e }
    h.logs.length = 0
    await h.callbacks['c17 FULL']()
    expect(h.logs.at(-1)).toEqual(['c17-error', 'PermissionError'])
    expect(JSON.stringify(h.logs)).not.toContain('secret')
    let release
    h.risuai.getDatabase = () => new Promise((resolve) => { release = () => resolve({ characters: [] }) })
    h.risuai.setDatabase = async () => {}
    const first = h.callbacks['c17 FULL']()
    await h.callbacks['c17 FULL']()
    expect(markerNames(h.logs).filter((m) => m === 'c17-variant').length).toBe(2)
    release()
    await first
  })

  test('guard: no network, storage, eval or timer in the plugin source', async () => {
    const { source } = await load()
    for (const word of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'eval', 'setTimeout', 'setInterval']) {
      expect(new RegExp('\\b' + word + '\\b').test(source), word).toBe(false)
    }
  })
})
