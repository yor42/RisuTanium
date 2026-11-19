// @vitest-environment node

// An access id grants its capabilities only while its own run is in progress. The Python
// branch of runScripted has no catch of its own, so a rejected python() call or a result that
// fails JSON.parse must still revoke the id before the error leaves the run.
//
// Python is not reachable in production today, on four counts: no caller passes type 'py';
// PyodideContext.python() settles only on a worker message of type 'python' or 'error', but
// pyworker.ts posts only 'pythonResult', so the real call never settles; init()/python() replace
// the worker's onmessage, so a Python script's API calls are dropped; and the worker indexes
// the module by the whole call string, so the named function never runs. No real producer
// emits 'python' or 'error' today. The Worker boundary is therefore the only fake: it follows
// the consumer contract python() declares, and everything under test (runScripted, the access
// id sets, the Lua gates and the Lua engine) is real. These tests prove the revocation
// invariant, not a reachable exploit.
//
// Engines are cached per mode for the module's lifetime and keep the type they were created
// with, so every test here uses its own mode names, and this file stays apart from
// scriptings.test.ts.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

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

type PyReply = 'reject' | { json: string }

// What the fake worker answers to a 'python' message.
let pyReply: PyReply = 'reject'
// Every call string the fake worker received, in order.
let pyCalls: string[] = []

interface WorkerMessage {
  type: string
  id?: string
  call?: string
}

class FakePyWorker {
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null

  constructor(_url: URL, _options?: { type: string }) {}

  postMessage(message: WorkerMessage) {
    if (message.type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'init', id: message.id } }))
    }
    if (message.type === 'python') {
      pyCalls.push(message.call ?? '')
      const reply = pyReply
      queueMicrotask(() => {
        if (reply === 'reject') {
          this.onmessage?.({ data: { type: 'error', id: message.id, error: 'py boom' } })
        } else {
          this.onmessage?.({ data: { type: 'python', id: message.id, call: reply.json } })
        }
      })
    }
  }

  terminate() {}
}

let runScripted: typeof import('./scriptings').runScripted
let requestChatData: typeof import('./request/request').requestChatData
let alertInput: typeof import('../alert').alertInput

beforeAll(async () => {
  const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
  vi.stubGlobal('Worker', FakePyWorker)
  ;({ requestChatData } = await import('./request/request'))
  ;({ alertInput } = await import('../alert'))
  ;({ runScripted } = await import('./scriptings'))
})

beforeEach(() => {
  pyReply = 'reject'
  pyCalls = []
  vi.mocked(requestChatData).mockReset()
  vi.mocked(requestChatData).mockResolvedValue({ type: 'success', result: 'r' } as never)
  vi.mocked(alertInput).mockReset()
})

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

function runPy(code: string, arg: Record<string, unknown>) {
  return runScripted(code, {
    char: {} as never,
    chat: { message: [] } as never,
    ...arg,
    type: 'py',
  })
}

// The id the Python run was handed, read from the call string the fake worker recorded.
// Exactly one recorded call with a UUID rules out a vacuous pass, for example a Lua engine
// answering instead of the Python one.
function leakedId(): string {
  expect(pyCalls).toHaveLength(1)
  const found = UUID_PATTERN.exec(pyCalls[0])
  expect(found).not.toBeNull()
  return found![0]
}

// A Safe or editDisplay gate check: setChatVar accepts either kind of id. The positive control
// `own` proves the probe itself works.
async function safeWrites(leaked: string, mode = 'probeSafe'): Promise<string[]> {
  const keys: string[] = []
  await runScripted(
    `function ${mode}(id) setChatVar('${leaked}', 'leaked', 'x'); setChatVar(id, 'own', 'x') end`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: (key: string) => { keys.push(key) },
      getVar: () => 'null',
      mode,
    }
  )
  return keys
}

// A LowLevel gate check: simpleLLM reaches requestChatData synchronously once its gate passes.
async function lowLevelPrompts(leaked: string): Promise<string[]> {
  vi.mocked(requestChatData).mockClear()
  await runScripted(
    `function probeLow(id) simpleLLM('${leaked}', 'leaked'); simpleLLM(id, 'own') end`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: () => false,
      getVar: () => 'null',
      lowLevelAccess: true,
      mode: 'probeLow',
    }
  )
  return vi.mocked(requestChatData).mock.calls.map((call) => call[0].formated[0].content as string)
}

// T1-T4 are regression reproducers: they fail on the leak assertion before the try/finally.

test('T1 a rejected Python call still rejects and revokes its Safe and LowLevel ids', async () => {
  pyReply = 'reject'
  await expect(runPy('def onOutput(id): pass # t1', {
    mode: 'output',
    lowLevelAccess: true,
  })).rejects.toThrow('py boom')

  const leaked = leakedId()
  expect(await safeWrites(leaked)).toEqual(['own'])
  expect(await lowLevelPrompts(leaked)).toEqual(['own'])
})

test('T2 a Python result that fails to parse still rejects and revokes its Safe and LowLevel ids', async () => {
  pyReply = { json: 'not json' }
  await expect(runPy('def callListenMain(): pass # t2', {
    mode: 'editInput',
    lowLevelAccess: true,
    data: [],
  })).rejects.toThrow(SyntaxError)

  const leaked = leakedId()
  expect(await safeWrites(leaked)).toEqual(['own'])
  expect(await lowLevelPrompts(leaked)).toEqual(['own'])
})

test('T3 a rejected Python editDisplay call revokes its editDisplay id', async () => {
  pyReply = 'reject'
  await expect(runPy('def callListenMain(): pass # t3', {
    mode: 'editDisplay',
    data: 'shown',
  })).rejects.toThrow('py boom')

  expect(await safeWrites(leakedId())).toEqual(['own'])
})

test('T4 a Python editDisplay result that fails to parse revokes its editDisplay id', async () => {
  // Different code text from T3 forces a fresh Python context for the same mode.
  pyReply = { json: 'shown' }
  await expect(runPy('def callListenMain(): pass # t4', {
    mode: 'editDisplay',
    data: 'shown',
  })).rejects.toThrow(SyntaxError)

  expect(await safeWrites(leakedId())).toEqual(['own'])
})

// T5-T8 are compatibility guards: they pass before and after the try/finally.

test('T5 a Python run with a valid result returns it and revokes its ids', async () => {
  pyReply = { json: '"ok"' }
  const result = await runPy('def callListenMain(): pass # t5', {
    mode: 'editOutput',
    lowLevelAccess: true,
    data: [],
  })

  expect(result.res).toBe('ok')
  expect(result.stopSending).toBe(false)
  const leaked = leakedId()
  expect(await safeWrites(leaked)).toEqual(['own'])
  expect(await lowLevelPrompts(leaked)).toEqual(['own'])
})

test('T6 a Lua run keeps its id valid across an await inside the run', async () => {
  const keys: string[] = []
  await runScripted(
    `inrun = async(function(id)
       sleep(id, 0):await()
       setChatVar(id, 'after', 'x')
       simpleLLM(id, 'after')
     end)`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: (key: string) => { keys.push(key) },
      getVar: () => 'null',
      lowLevelAccess: true,
      mode: 'inrun',
    }
  )

  expect(keys).toEqual(['after'])
  expect(vi.mocked(requestChatData).mock.calls.map((call) => call[0].formated[0].content)).toEqual(['after'])
})

test('T7 a throwing run in another mode does not revoke a suspended run id', async () => {
  let release: (value: string) => void = () => undefined
  vi.mocked(alertInput).mockImplementation(() => new Promise<string>((done) => { release = done }))

  const keys: string[] = []
  const held = runScripted(
    `holdB = async(function(id)
       alertInput(id, 'q'):await()
       setChatVar(id, 'b', 'x')
     end)`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: (key: string) => { keys.push(key) },
      getVar: () => 'null',
      mode: 'holdB',
    }
  )
  await vi.waitFor(() => expect(vi.mocked(alertInput)).toHaveBeenCalled())
  // A two-argument script call leaves the prompt's default value unset.
  expect(vi.mocked(alertInput)).toHaveBeenCalledWith('q', undefined, undefined)

  pyReply = 'reject'
  await expect(runPy('def onInput(id): pass # t7', { mode: 'input' })).rejects.toThrow('py boom')

  release('answer')
  await held
  expect(keys).toEqual(['b'])
})

test('T7b a Lua alertInput third argument reaches the prompt as its default value', async () => {
  vi.mocked(alertInput).mockResolvedValue('typed')

  let answer = ''
  await runScripted(
    `promptDefault = async(function(id)
       local typed = alertInput(id, 'q', 'def'):await()
       setChatVar(id, 'answer', typed)
     end)`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: (_key: string, value: string) => { answer = value },
      getVar: () => 'null',
      mode: 'promptDefault',
    }
  )

  expect(vi.mocked(alertInput)).toHaveBeenCalledWith('q', undefined, 'def')
  expect(answer).toBe('typed')
})

test('T8 a Lua run that throws is swallowed and its id is revoked', async () => {
  let captured = ''
  const result = await runScripted(
    `function luathrow(id) setChatVar(id, 'captured', id); error('lua boom') end`,
    {
      char: {} as never,
      chat: { message: [] } as never,
      setVar: (_key: string, value: string) => { captured = value },
      getVar: () => 'null',
      mode: 'luathrow',
    }
  )

  expect(result.stopSending).toBe(false)
  expect(captured).toMatch(UUID_PATTERN)
  expect(await safeWrites(captured)).toEqual(['own'])
})
