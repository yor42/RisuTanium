// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LuaEngine } from 'wasmoon'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { character, triggerscript } from '../storage/database.svelte'

vi.mock('../parser/parser.svelte', () => ({
  hasher: vi.fn(),
  risuChatParser: vi.fn(),
}))

vi.mock('../alert', () => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
  alertSelect: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../util', () => ({
  asBuffer: vi.fn(),
  getPersonaPrompt: vi.fn(),
  getUserIcon: vi.fn(),
  getUserName: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(() => ({})),
  getCurrentChat: vi.fn(() => ({ message: [] })),
  getDatabase: vi.fn(() => ({ characters: [] })),
  setDatabase: vi.fn(),
}))

vi.mock('../stores.svelte', () => ({
  DBState: { db: {} },
  ReloadChatPointer: { update: vi.fn() },
  ReloadGUIPointer: { update: vi.fn() },
  selectedCharID: { subscribe: (run: (value: number) => void) => (run(0), () => undefined) },
}))

vi.mock('./modules', () => ({
  getModuleLorebooks: vi.fn(() => []),
  getModuleTriggers: vi.fn(() => []),
}))

vi.mock('./files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn() }))
vi.mock('./lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('./memory/hypamemory', () => ({ HypaProcesser: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('./stableDiff', () => ({ generateAIImage: vi.fn() }))

const createdEngines = vi.hoisted((): LuaEngine[] => [])
vi.mock('wasmoon', async (importOriginal) => {
  const wasmoon = await importOriginal<typeof import('wasmoon')>()
  class RecordingLuaFactory extends wasmoon.LuaFactory {
    async createEngine(...args: Parameters<InstanceType<typeof wasmoon.LuaFactory>['createEngine']>) {
      const engine = await super.createEngine(...args)
      createdEngines.push(engine)
      return engine
    }
  }
  return { ...wasmoon, LuaFactory: RecordingLuaFactory }
})

// The long budget covers only the module reload and wasm load of the hook; a test
// body that stalls (a lock that never releases) surfaces at the shorter test budget.
const RELOAD_HOOK_TIMEOUT = 60000
vi.setConfig({ testTimeout: 20000 })

let scriptings: typeof import('./scriptings')
let requestChatData: typeof import('./request/request').requestChatData
let jsonLua = ''

beforeEach(async () => {
  if (!jsonLua) {
    jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
  }
  vi.resetModules()
  createdEngines.length = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
  scriptings = await import('./scriptings')
  requestChatData = (await import('./request/request')).requestChatData
  vi.mocked(requestChatData).mockReset()
  // Silences the init log lines of each engine.
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
}, RELOAD_HOOK_TIMEOUT)

function floorValue(): number {
  const floor = scriptings.LUA_ENGINES_PER_MODE_FLOOR
  expect(Number.isInteger(floor) && floor >= 2 && floor % 2 === 0).toBe(true)
  return floor
}

// `n` counts the calls an engine's globals have seen; `tag k` makes the code
// distinct per test and per script.
function counter(mode: string, tag: string): string {
  return `function ${mode}(id) n = (n or 0) + 1 return n end -- ${tag}`
}

function run(mode: string, code: string, liveScripts?: number) {
  return scriptings.runScripted(code, {
    char: {} as never,
    chat: { message: [] } as never,
    setVar: () => false,
    getVar: () => 'null',
    mode,
    liveScripts,
  })
}

function openEngines(): LuaEngine[] {
  return createdEngines.filter((engine) => !engine.global.isClosed())
}

function closedIndexes(): number[] {
  return createdEngines.flatMap((engine, i) => (engine.global.isClosed() ? [i] : []))
}

function deferred<T>() {
  let resolveFn!: (value: T) => void
  const promise = new Promise<T>((res) => { resolveFn = res })
  return { promise, resolve: resolveFn }
}

describe('two scripts in one mode (A7)', () => {
  test('T4.1 each script keeps its own globals when the mode alternates', async () => {
    const mode = 'probe_persist_t41'
    const a = counter(mode, 'T4.1 A')
    const b = `function ${mode}(id) return -1 end -- T4.1 B`
    expect((await run(mode, a)).res).toBe(1)
    expect((await run(mode, b)).res).toBe(-1)
    expect((await run(mode, a)).res).toBe(2)
  })

  test('T4.2 alternating A and B creates one engine each', async () => {
    const mode = 'probe_persist_t42'
    const a = counter(mode, 'T4.2 A')
    const b = counter(mode, 'T4.2 B')
    await run(mode, a)
    await run(mode, b)
    await run(mode, a)
    await run(mode, b)
    expect(createdEngines.length).toBe(2)
  })

  test('T4.3 compat: a single script keeps one engine and a changed script runs the new code', async () => {
    const mode = 'probe_persist_t43'
    const a = counter(mode, 'T4.3 A')
    await run(mode, a)
    await run(mode, a)
    expect((await run(mode, a)).res).toBe(3)
    expect(createdEngines.length).toBe(1)
    const changed = `function ${mode}(id) return 'changed' end -- T4.3 A2`
    expect((await run(mode, changed)).res).toBe('changed')
    expect((await run(mode, changed)).res).toBe('changed')
    expect(createdEngines.length).toBe(2)
  })

  test('T4.4 compat: calls of one mode stay serialized across scripts', async () => {
    const hold = deferred<{ type: 'success'; result: string }>()
    vi.mocked(requestChatData).mockImplementationOnce(() => hold.promise as never)
    const heldCode = 'onStart = async(function(id) simpleLLM(id, "p"):await() return 1 end) -- T4.4 A'
    const otherCode = 'function onStart(id) return 2 end -- T4.4 B'
    const args = {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: () => false,
      getVar: () => 'null',
      lowLevelAccess: true,
      mode: 'start',
    }
    const first = scriptings.runScripted(heldCode, args)
    await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(1))
    const second = scriptings.runScripted(otherCode, args)
    await new Promise((res) => setTimeout(res, 50))
    // B waits for A: its engine is not even created while A is in flight.
    expect(createdEngines.length).toBe(1)
    hold.resolve({ type: 'success', result: 'r' })
    expect((await first).res).toBe(1)
    expect((await second).res).toBe(2)
    expect(createdEngines.length).toBe(2)
  })
})

describe('engine cap', () => {
  test('T4.5 past the floor with no hint the least recently used engine closes', async () => {
    const floor = floorValue()
    const mode = 'probe_cap_t45'
    for (let k = 0; k <= floor; k++) {
      await run(mode, counter(mode, `T4.5 ${k}`))
    }
    expect(createdEngines.length).toBe(floor + 1)
    expect(closedIndexes()).toEqual([0])
    await run(mode, counter(mode, 'T4.5 0'))
    expect(createdEngines.length).toBe(floor + 2)
    expect(createdEngines[floor + 1].global.get('n')).toBe(1)
  })

  test('T4.6 a touched engine survives the trim', async () => {
    const floor = floorValue()
    const mode = 'probe_cap_t46'
    for (let k = 0; k < floor; k++) {
      await run(mode, counter(mode, `T4.6 ${k}`))
    }
    await run(mode, counter(mode, 'T4.6 0'))
    await run(mode, counter(mode, `T4.6 ${floor}`))
    expect(closedIndexes()).toEqual([1])
    expect(createdEngines[0].global.isClosed()).toBe(false)
  })

  test('T4.7 compat: an engine with a call in flight is never closed by a later insert', async () => {
    const floor = floorValue()
    const hold = deferred<{ type: 'success'; result: string }>()
    vi.mocked(requestChatData).mockImplementationOnce(() => hold.promise as never)
    const args = {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: () => false,
      getVar: () => 'null',
      lowLevelAccess: true,
      mode: 'start',
    }
    const held = scriptings.runScripted(
      'onStart = async(function(id) simpleLLM(id, "p"):await() return 1 end) -- T4.7 X',
      args,
    )
    await vi.waitFor(() => expect(requestChatData).toHaveBeenCalledTimes(1))
    const others = Array.from({ length: floor }, (_, k) =>
      scriptings.runScripted(`function onStart(id) return ${k} end -- T4.7 ${k}`, args))
    await new Promise((res) => setTimeout(res, 50))
    expect(createdEngines[0].global.isClosed()).toBe(false)
    hold.resolve({ type: 'success', result: 'r' })
    expect((await held).res).toBe(1)
    await Promise.all(others)
  })

  test('T4.12a OL-1: two setups above the cap recreate engines on every rotation', async () => {
    const floor = floorValue()
    const h = floor / 2
    const mode = 'probe_cap_t412a'
    const live = h + 1
    const x = Array.from({ length: h + 1 }, (_, k) => counter(mode, `T4.12a X${k}`))
    const y = Array.from({ length: h + 1 }, (_, k) => counter(mode, `T4.12a Y${k}`))
    const rotation = async () => {
      for (const code of x) await run(mode, code, live)
      for (const code of y) await run(mode, code, live)
    }
    await rotation()
    for (let r = 0; r < 3; r++) {
      const before = createdEngines.length
      await rotation()
      expect(createdEngines.length - before).toBe(2 * (h + 1))
    }
  })

  test('T4.12b two setups that fit the cap together keep every engine', async () => {
    const floor = floorValue()
    const h = floor / 2
    const mode = 'probe_cap_t412b'
    const live = h + 1
    const x = Array.from({ length: h }, (_, k) => counter(mode, `T4.12b X${k}`))
    const y = Array.from({ length: h }, (_, k) => counter(mode, `T4.12b Y${k}`))
    const rotation = async () => {
      for (const code of x) await run(mode, code, live)
      for (const code of y) await run(mode, code, live)
    }
    await rotation()
    for (let r = 0; r < 3; r++) {
      const before = createdEngines.length
      await rotation()
      expect(createdEngines.length - before).toBe(0)
    }
  })

  test('T4.13 the cap follows the inserting call: raised by a hint, trimmed oldest first on insert only', async () => {
    const floor = floorValue()
    const mode = 'probe_cap_t413'
    const n = floor + 4
    for (let k = 0; k < n; k++) {
      await run(mode, counter(mode, `T4.13 ${k}`), n)
    }
    expect(closedIndexes()).toEqual([])
    // A hit never trims, even with a smaller hint.
    await run(mode, counter(mode, `T4.13 ${n - 1}`), 1)
    expect(closedIndexes()).toEqual([])
    expect(createdEngines.length).toBe(n)
    // An insert trims to max(floor, hint), oldest first.
    await run(mode, counter(mode, 'T4.13 new'), 1)
    expect(closedIndexes()).toEqual(Array.from({ length: n + 1 - floor }, (_, k) => k))
    expect(openEngines().length).toBe(floor)
  })
})

describe('production callers pass their own script count (A9)', () => {
  function luaTrigger(code: string): triggerscript {
    return {
      comment: 'c',
      type: 'manual',
      conditions: [],
      effect: [{ type: 'triggerlua', code }],
    } as unknown as triggerscript
  }

  function charWith(codes: string[]): character {
    return {
      type: 'character',
      lowLevelAccess: false,
      triggerscript: codes.map(luaTrigger),
    } as unknown as character
  }

  function expectEveryScriptPersisted(count: number, passes: number) {
    expect(createdEngines.length).toBe(count)
    for (const engine of openEngines()) {
      expect(engine.global.get('n')).toBe(passes)
    }
    expect(openEngines().length).toBe(count)
  }

  test('T4.9 button: floor+1 scripts keep their globals across passes', async () => {
    const floor = floorValue()
    const codes = Array.from({ length: floor + 1 }, (_, k) =>
      `function onButtonClick(id) n = (n or 0) + 1 end -- T4.9 ${k}`)
    const char = charWith(codes)
    for (let pass = 0; pass < 3; pass++) {
      await scriptings.runLuaInteractionTrigger('button', char, 'k')
    }
    expectEveryScriptPersisted(floor + 1, 3)
  })

  test('T4.10 edit: floor+1 scripts keep their globals across passes', async () => {
    const floor = floorValue()
    const codes = Array.from({ length: floor + 1 }, (_, k) =>
      `listenEdit('editInput', function(id, v) n = (n or 0) + 1 return v end) -- T4.10 ${k}`)
    const char = charWith(codes)
    for (let pass = 0; pass < 3; pass++) {
      await scriptings.runLuaEditTrigger(char, 'editinput', 'text')
    }
    expectEveryScriptPersisted(floor + 1, 3)
  })
})
