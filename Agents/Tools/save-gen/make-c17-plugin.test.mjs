// @vitest-environment node
// Run: pnpm vitest run Agents/Tools/save-gen/make-c17-plugin.test.mjs   (name the file; never the whole save-gen folder)
// Env C17_GENERATOR: path of another copy of make-c17-plugin.mjs, for mutant runs.
import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const generator = await import(pathToFileURL(process.env.C17_GENERATOR ?? path.join(HERE, 'make-c17-plugin.mjs')).href)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// sha256 of the default output (variants 'base') as the generator produced it before the `all` variants were added
const BASE_BUTTON_SHA256 = '3fe14a2cf3becd384ecd00ec363993ba6a33ca4bcdbf79bcd5b5c3f98d44ad58'
const BASE_SETTING_SHA256 = 'ab44c4453a770c13c31a699ca48869647b452bc6d4a8f9a7777c9690329975bc'
const ALL_NAMES = ['FULL', 'ONE', 'NOCHARS', 'LITE', 'NOCHARS-LITE', 'GET', 'CLONE']
// every logged argument after the marker name is a finite number or one of these strings
const ALLOWED_STRINGS = new Set(['nothing to write', 'get-only', 'PermissionError', ...ALL_NAMES])

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
  // getDatabase uses the global structuredClone on purpose: the plugin gets its own (spied) one as an injected parameter
  const risuai = {
    registerButton: async (arg, callback) => { calls.push(['registerButton', arg.name]); callbacks[arg.name] = callback; return {} },
    registerSetting: async (name, callback) => { calls.push(['registerSetting', name]); callbacks[name] = callback; return {} },
    getDatabase: async (keys) => { calls.push(['getDatabase', keys]); return Object.fromEntries(keys.map((key) => [key, structuredClone(state[key])])) },
    setDatabase: async (db) => { calls.push(['setDatabase', Object.keys(db)]); Object.assign(state, structuredClone(db)) },
    setDatabaseLite: async (db) => { calls.push(['setDatabaseLite', Object.keys(db)]); Object.assign(state, structuredClone(db)) },
  }
  const console = { log: (...args) => logs.push(args) }
  const cloneCalls = []
  const cloneSpy = (value) => { cloneCalls.push(value); return structuredClone(value) }
  return { state, calls, logs, callbacks, risuai, console, cloneCalls, cloneSpy }
}

async function load(trigger = 'button', characters = [{ chaId: 'a', name: 'Alpha', desc: 'x' }, { chaId: 'b', name: 'Beta' }], variants = 'base') {
  const source = generator.buildPluginSource(trigger, variants)
  const h = makeHarness(characters)
  await new AsyncFunction('risuai', 'console', 'performance', 'structuredClone', source)(h.risuai, h.console, performance, h.cloneSpy)
  return { source, ...h }
}
const loadAll = (trigger = 'button') => load(trigger, undefined, 'all')
const markerNames = (logs) => logs.map((args) => args[0])
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

describe('make-c17-plugin', () => {
  test('header: name, display name, api 3.0 and no //@arg', async () => {
    const { source } = await load()
    expect(parseHeader(source)).toEqual({ name: 'c17_probe', displayName: 'c17-probe', api: '3.0', args: 0 })
    const all = await loadAll()
    expect(parseHeader(all.source)).toEqual({ name: 'c17_probe', displayName: 'c17-probe', api: '3.0', args: 0 })
  })

  test('loads, registers one entry per variant, and logs c17-ready', async () => {
    const h = await load()
    expect(h.calls.map((c) => c[0])).toEqual(['registerButton', 'registerButton', 'registerButton', 'registerButton'])
    expect(Object.keys(h.callbacks)).toEqual(['c17 FULL', 'c17 ONE', 'c17 NOCHARS', 'c17 LITE'])
    expect(h.logs).toEqual([['c17-ready']])
    const s = await load('setting')
    expect(s.calls.map((c) => c[0])).toEqual(['registerSetting', 'registerSetting', 'registerSetting', 'registerSetting'])
  })

  test('default output is byte-identical to the generator before the all variants existed', () => {
    expect(sha256(generator.buildPluginSource())).toBe(BASE_BUTTON_SHA256)
    expect(sha256(generator.buildPluginSource('button', 'base'))).toBe(BASE_BUTTON_SHA256)
    expect(sha256(generator.buildPluginSource('setting'))).toBe(BASE_SETTING_SHA256)
  })

  test('all registers seven entries in order, button and setting', async () => {
    const h = await loadAll()
    expect(h.calls.map((c) => c[0])).toEqual(Array(7).fill('registerButton'))
    expect(Object.keys(h.callbacks)).toEqual(ALL_NAMES.map((n) => 'c17 ' + n))
    expect(h.logs).toEqual([['c17-ready']])
    const s = await loadAll('setting')
    expect(s.calls.map((c) => c[0])).toEqual(Array(7).fill('registerSetting'))
  })

  test('an unknown variants value throws', () => {
    expect(() => generator.buildPluginSource('button', 'some')).toThrow()
    expect(() => generator.buildPluginSource('button', '')).toThrow()
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

  test('ONE: the suffix is appended on odd runs and stripped on even runs, so four runs end reverted', async () => {
    const h = await loadAll()
    const original = structuredClone(h.state.characters)
    const names = []
    for (let i = 0; i < 4; i++) {
      await h.callbacks['c17 ONE']()
      names.push(h.state.characters[0].name)
    }
    expect(names).toEqual(['Alpha [c17]', 'Alpha', 'Alpha [c17]', 'Alpha'])
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

  test('NOCHARS-LITE: getDatabase lineHeight, then setDatabaseLite lineHeight, value unchanged', async () => {
    const h = await loadAll()
    h.calls.length = 0; h.logs.length = 0
    await h.callbacks['c17 NOCHARS-LITE']()
    expect(h.calls).toEqual([['getDatabase', ['lineHeight']], ['setDatabaseLite', ['lineHeight']]])
    expect(h.state.lineHeight).toBe(1.25)
    expect(markerNames(h.logs)).toEqual(['c17-variant', 'c17-get-done', 'c17-set-start', 'c17-set-done'])
  })

  test('GET: getDatabase characters only, no setter, markers end in c17-skipped get-only', async () => {
    const h = await loadAll()
    h.calls.length = 0; h.logs.length = 0
    await h.callbacks['c17 GET']()
    expect(h.calls).toEqual([['getDatabase', ['characters']]])
    expect(h.calls.some((c) => c[0].startsWith('setDatabase'))).toBe(false)
    expect(markerNames(h.logs)).toEqual(['c17-variant', 'c17-get-done', 'c17-skipped'])
    expect(h.logs[0]).toEqual(['c17-variant', 'GET'])
    expect(typeof h.logs[1][1]).toBe('number')
    expect(h.logs[2]).toEqual(['c17-skipped', 'get-only'])
  })

  test('the default skip reason stays "nothing to write" under both modes', async () => {
    for (const variants of ['base', 'all']) {
      const h = await load('button', undefined, variants)
      h.state.lineHeight = undefined
      h.logs.length = 0
      await h.callbacks['c17 NOCHARS']()
      expect(h.logs.at(-1), variants).toEqual(['c17-skipped', 'nothing to write'])
    }
  })

  test('CLONE: getDatabase characters only, one structuredClone of that array, numeric c17-clone-done, no setter', async () => {
    const h = await loadAll()
    h.calls.length = 0; h.logs.length = 0
    await h.callbacks['c17 CLONE']()
    expect(h.calls).toEqual([['getDatabase', ['characters']]])
    expect(h.cloneCalls.length).toBe(1)
    expect(h.cloneCalls[0]).toEqual(h.state.characters)
    expect(markerNames(h.logs)).toEqual(['c17-variant', 'c17-get-done', 'c17-clone-done'])
    expect(typeof h.logs[2][1]).toBe('number')
    expect(Number.isFinite(h.logs[2][1])).toBe(true)
  })

  test('privacy: every logged argument is a finite number or a fixed reason, variant or error name', async () => {
    const h = await loadAll()
    for (const name of ALL_NAMES) await h.callbacks['c17 ' + name]()
    h.risuai.setDatabase = async () => { const e = new Error('secret database text'); e.name = 'PermissionError'; throw e }
    await h.callbacks['c17 FULL']()
    for (const args of h.logs) {
      expect(args[0].startsWith('c17-'), String(args[0])).toBe(true)
      for (const arg of args.slice(1)) {
        const ok = (typeof arg === 'number' && Number.isFinite(arg)) || (typeof arg === 'string' && ALLOWED_STRINGS.has(arg))
        expect(ok, JSON.stringify(args)).toBe(true)
      }
    }
    const text = JSON.stringify(h.logs)
    for (const word of ['Alpha', 'Beta', 'secret']) expect(text).not.toContain(word)
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
    for (const { source } of [await load(), await loadAll()]) {
      for (const word of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'eval', 'setTimeout', 'setInterval']) {
        expect(new RegExp('\\b' + word + '\\b').test(source), word).toBe(false)
      }
    }
  })
})
