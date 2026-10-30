// @vitest-environment node

/**
 * The card Lua `request` API is an untrusted caller: it fetches through the untrusted wrapper, never
 * through `fetchNative` directly, and a refusal reaches the card as status 400.
 *
 * Drives the REAL `runScripted` and the real wasmoon Lua engine. MOCKED: the untrusted wrapper and
 * `fetchNative`; the policy that wrapper adds is asserted in the wrapper's own tests.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  untrusted: vi.fn(),
  native: vi.fn(),
}))

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

vi.mock('../globalApi.svelte', () => ({ fetchNative: h.native, readImage: vi.fn() }))
vi.mock('../network/untrustedFetch', () => ({ untrustedNativeFetch: h.untrusted }))
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

let runScripted: typeof import('./scriptings').runScripted

beforeAll(async () => {
  const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
  runScripted = (await import('./scriptings')).runScripted
})

beforeEach(() => {
  h.untrusted.mockReset()
  h.native.mockReset()
})

async function runRequest(url: string): Promise<{ status: number, data: string }> {
  const result = await runScripted(
    `
      onStart = async(function(id)
        return request(id, "${url}"):await()
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
  return JSON.parse(String(result.res))
}

test('T7 a card request goes through the untrusted wrapper and a refusal is status 400', async () => {
  h.untrusted.mockRejectedValue(new Error('Blocked: 192.168.1.10 is a private-network address.'))

  const reply = await runRequest('https://192.168.1.10/')

  expect(h.untrusted).toHaveBeenCalledTimes(1)
  expect(h.untrusted).toHaveBeenCalledWith('https://192.168.1.10/', { method: 'GET' })
  expect(h.native).not.toHaveBeenCalled()
  expect(reply.status).toBe(400)
})

test('guard: an allowed reply still returns its status and text', async () => {
  h.untrusted.mockResolvedValue(new Response('hello', { status: 200 }))

  const reply = await runRequest('https://api.example.invalid/x')

  expect(reply).toEqual({ status: 200, data: 'hello' })
  expect(h.native).not.toHaveBeenCalled()
})
