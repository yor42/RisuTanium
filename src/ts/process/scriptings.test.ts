// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, expect, test, vi } from 'vitest'

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

const luaFactoryWasmUris = vi.hoisted((): (string | undefined)[] => [])
vi.mock('wasmoon', async (importOriginal) => {
  const wasmoon = await importOriginal<typeof import('wasmoon')>()
  class RecordingLuaFactory extends wasmoon.LuaFactory {
    constructor(customWasmUri?: string, environmentVariables?: Record<string, string>) {
      luaFactoryWasmUris.push(customWasmUri)
      super(customWasmUri, environmentVariables)
    }
  }
  return { ...wasmoon, LuaFactory: RecordingLuaFactory }
})

let runScripted: typeof import('./scriptings').runScripted

beforeAll(async () => {
  const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
  const scriptings = await import('./scriptings')
  runScripted = scriptings.runScripted
})

test('does not stop generation when setStateChanged is a no-op', async () => {
  const result = await runScripted(
    `
      function onStart(id)
        return setStateChanged(id, "unchanged", "value")
      end
    `,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: () => false,
      getVar: () => 'null',
      mode: 'start',
    }
  )

  expect(result.stopSending).toBe(false)
  expect(result.res).toBeNull()
})

test('keeps explicit false as the generation stop signal', async () => {
  const result = await runScripted('function onStart() return false end', {
    char: {} as never,
    chat: { message: [] } as never,
    mode: 'start',
  })

  expect(result.res).toBe(false)
  expect(result.stopSending).toBe(true)
})

test('a Lua script cannot write to a host prototype through an object an API returns', async () => {
  // simpleLLM hands Lua a plain object. Through wasmoon's proxy extension Lua
  // indexes the live object, so `__proto__` reaches the host's Object.prototype;
  // without it Lua gets a table copy of the enumerable keys.
  const { requestChatData } = await import('./request/request')
  vi.mocked(requestChatData).mockResolvedValue({ type: 'success', result: 'reply' } as never)
  try {
    const result = await runScripted(
      `
        onStart = async(function(id)
          local reply = simpleLLM(id, "prompt"):await()
          pcall(function()
            reply.__proto__.risuLuaPolluted = "yes"
          end)
          return tostring(reply.success) .. ":" .. reply.result
        end)
      `,
      {
        char: {} as never,
        chat: { message: [] } as never,
        setVar: () => false,
        getVar: () => 'null',
        lowLevelAccess: true,
        mode: 'start',
      }
    )

    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'risuLuaPolluted')).toBe(false)
    // guard: the returned fields still read in Lua
    expect(result.res).toBe('true:reply')
  } finally {
    delete (Object.prototype as Record<string, unknown>).risuLuaPolluted
    vi.mocked(requestChatData).mockReset()
  }
})

test('the Lua runtime loads its wasm from the app build, not a CDN', async () => {
  // Without a URI, wasmoon in a browser or WebView fetches glue.wasm from
  // unpkg.com, so Lua scripts fail offline and on a LAN.
  await runScripted('function onStart() return false end', {
    char: {} as never,
    chat: { message: [] } as never,
    mode: 'start',
  })

  const { default: bundledGlueWasm } = await import('wasmoon/dist/glue.wasm?url')
  expect(luaFactoryWasmUris.length).toBeGreaterThan(0)
  expect(luaFactoryWasmUris.every((uri) => uri === bundledGlueWasm)).toBe(true)
})

// An editDisplay run's access id grants setChatVar only while that run is in progress. A script that
// keeps the id in a global must not write chat variables with it from a later run.
const STALE_ID_DISPLAY_SCRIPT = `
  listenEdit("editDisplay", function(id, value, meta)
    if staleDisplayId ~= nil then
      setChatVar(staleDisplayId, "stale", "written")
    end
    setChatVar(id, "current", "written")
    staleDisplayId = id
    return value
  end)
`

test('CHORE-157 an editDisplay access id stops working once its run ends', async () => {
  const writes: string[] = []
  const run = () => runScripted(STALE_ID_DISPLAY_SCRIPT, {
    char: {} as never,
    chat: { message: [] } as never,
    data: 'shown',
    setVar: (key: string) => { writes.push(key) },
    getVar: () => 'null',
    mode: 'editDisplay',
  })

  const first = await run()
  const second = await run()

  // guard: the display text still passes through, and the run's own id still writes
  expect(first.res).toBe('shown')
  expect(second.res).toBe('shown')
  expect(writes).toEqual(['current', 'current'])
})

// Edit events run the Lua dispatcher only for code that subscribed to that event
// through listenEdit. Engines are cached per mode and per code, so every test
// below uses code no other test in this file runs.
const EDIT_MODES = ['editDisplay', 'editInput', 'editOutput', 'editRequest']

test.each(EDIT_MODES)('%s without a listener returns the input untouched and loads the code once', async (mode) => {
  const getVar = vi.fn(() => 'initialized')
  // Any dispatch through callListenMain would hit the replaced json codec and throw.
  const code = `
    getChatVar('', 'initialization')
    json.decode = function() error('Unexpected listener dispatch') end
    json.encode = function() error('Unexpected listener dispatch') end
    -- no listener: ${mode}
  `
  const data = mode === 'editRequest' ? [{ content: 'hello', role: 'user' as const }] : 'hello'

  for (let index = 0; index < 2; index++) {
    const result = await runScripted(code, {
      char: {} as never,
      chat: { message: [] } as never,
      data,
      getVar,
      meta: {},
      mode,
    })

    expect(result.res).toBe(data)
    expect(result.stopSending).toBe(false)
  }
  expect(getVar).toHaveBeenCalledExactlyOnceWith('initialization')
})

// Compatibility guard: passes with and without the listener gate.
test.each(EDIT_MODES)('a registered %s listener still runs', async (mode) => {
  const data = mode === 'editRequest' ? [{ content: 'hello', role: 'user' as const }] : 'hello'
  const result = await runScripted(`
    local event = '${mode}'
    listenEdit(event, function(id, value, meta)
      if event == 'editRequest' then
        value[1].content = value[1].content .. meta.suffix
        return value
      end
      return value .. meta.suffix
    end)
  `, {
    char: {} as never,
    chat: { message: [] } as never,
    data,
    meta: { suffix: ' world' },
    mode,
  })

  const expected = mode === 'editRequest' ? [{ content: 'hello world', role: 'user' }] : 'hello world'
  expect(result.res).toEqual(expected)
})

test('a listener for one edit event does not open the others', async () => {
  const code = `
    listenEdit('editOutput', function(id, value) return value .. ' edited' end)
    json.decode = function() error('Unexpected listener dispatch') end
  `
  const run = (mode: string) => runScripted(code, {
    char: {} as never,
    chat: { message: [] } as never,
    data: 'original',
    mode,
  })

  expect((await run('editInput')).res).toBe('original')
  expect((await run('editDisplay')).res).toBe('original')
})

test('new code in a mode starts with no listeners while the cached code keeps its own', async () => {
  const options = {
    char: {} as never,
    chat: { message: [] } as never,
    data: 'original',
    mode: 'editDisplay',
  }
  const registeredCode = `
    listenEdit('editDisplay', function() return 'edited' end)
  `
  const registered = await runScripted(registeredCode, options)
  expect(registered.res).toBe('edited')

  const unregistered = await runScripted(`
    json.decode = function() error('Stale listener registration') end
  `, options)
  expect(unregistered.res).toBe('original')

  // guard: the first code's cached engine still has its listener
  const again = await runScripted(registeredCode, options)
  expect(again.res).toBe('edited')
})

// Compatibility guard: passes with and without the listener gate.
test('a listener registered after the code loaded is seen by the next run', async () => {
  let register: () => void = () => { throw new Error('Missing registration callback') }
  const code = `
    getChatVar('', function()
      listenEdit('editDisplay', function(id, value) return value .. ' edited' end)
    end)
  `
  const options = {
    char: {} as never,
    chat: { message: [] } as never,
    data: 'original',
    getVar: vi.fn((callback: unknown) => {
      register = callback as () => void
      return ''
    }),
    mode: 'editDisplay',
  }

  const before = await runScripted(code, options)
  expect(before.res).toBe('original')
  register()
  const after = await runScripted(code, options)
  expect(after.res).toBe('original edited')
})
