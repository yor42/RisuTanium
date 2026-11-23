// @vitest-environment node

/**
 * A script pass that its caller abandoned (the `signal` argument of `processScriptFull`) stops at the
 * next check after each await it can be parked in: the Lua edit trigger and every v2 plugin call.
 * The real `scripts.ts`, `scriptings.ts` and real wasmoon run here; plugin handlers and `tokenize` are
 * deferreds, so a pass can be held mid-await.
 *
 * Test kinds: every row is a regression reproducer unless its title starts with "guard:". The reproducers
 * fail on the code where the pass ignores the `signal` argument.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { character } from '../../storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    parserCalls: [] as string[],
    pluginSets: {
        editdisplay: new Set<(data: string) => unknown>(),
        editoutput: new Set<(data: string) => unknown>(),
        editprocess: new Set<(data: string) => unknown>(),
        editinput: new Set<(data: string) => unknown>(),
        chatOutput: new Set<(data: string) => unknown>(),
    },
    luaTriggers: [] as unknown[],
    measure: true,
    currentChat: { message: [] as unknown[] },
}))

vi.mock('../../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    hasher: vi.fn(),
    risuChatParser: (data: string) => {
        h.parserCalls.push(data)
        return data
    },
}))
vi.mock('../../alert', () => ({
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}))
vi.mock('../../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn(), downloadFile: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../../util', () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(),
    getUserIcon: vi.fn(),
    getUserName: vi.fn(),
    selectSingleFile: vi.fn(),
}))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/exportNotice', () => ({ downloadNotice: vi.fn() }))
vi.mock('../../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({ type: 'simple' })),
    getCurrentChat: vi.fn(() => h.currentChat),
    getDatabase: () => h.db,
    setDatabase: vi.fn(),
}))
vi.mock('../../stores.svelte', () => ({
    CharEmotion: writable({}),
    DBState: { db: {} },
    ReloadChatPointer: { update: vi.fn() },
    ReloadGUIPointer: { update: vi.fn() },
    selectedCharID: writable(0),
}))
vi.mock('../modules', () => ({
    getModuleAssets: () => [],
    getModuleLorebooks: () => [],
    getModuleRegexScripts: () => [],
    getModuleTriggers: () => h.luaTriggers,
}))
vi.mock('../../plugins/plugins.svelte', () => ({ pluginV2: h.pluginSets }))
vi.mock('../files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn() }))
vi.mock('../lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../stableDiff', () => ({ generateAIImage: vi.fn() }))
vi.mock('../triggers', () => ({ runTrigger: vi.fn() }))
// Both entry shapes of processScriptFull (the measuring build and the plain build) carry the signal.
vi.mock('../memory/measureFlag', async (importOriginal) => {
    const real = await importOriginal<typeof import('../memory/measureFlag')>()
    return Object.defineProperty({ ...real }, 'MEASURE', { get: () => h.measure, enumerable: true })
})

let processScriptFull: typeof import('../scripts').processScriptFull
let resetScriptCache: typeof import('../scripts').resetScriptCache
let tokenize: typeof import('../../tokenizer').tokenize

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    ;({ tokenize } = await import('../../tokenizer'))
    ;({ processScriptFull, resetScriptCache } = await import('../scripts'))
})

const messages = [
    { role: 'user', data: 'zz' },
    { role: 'char', data: 'current' },
]

function charWith(script: Record<string, unknown>): character {
    return {
        type: 'simple', chaId: 'c', customscript: [script], triggerscript: [],
        firstMessage: '', alternateGreetings: [],
    } as unknown as character
}

const injectScript = { comment: '', in: 'cur', out: '@@inject', type: 'editoutput' }

function deferred<T>() {
    let resolveValue: (value: T) => void = () => undefined
    const promise = new Promise<T>((res) => { resolveValue = res })
    return { promise, resolve: resolveValue }
}

beforeEach(() => {
    resetScriptCache()
    h.parserCalls.length = 0
    h.luaTriggers = []
    h.measure = true
    h.currentChat = { message: [] }
    for(const set of Object.values(h.pluginSets)){
        set.clear()
    }
    messages[0].data = 'zz'
    messages[1].data = 'current'
    h.db = {
        presetRegex: [],
        dynamicAssets: false,
        characters: [{ chatPage: 0, chats: [{ message: messages, fmIndex: -1 }], firstMessage: '', alternateGreetings: [] }],
    }
    vi.mocked(tokenize).mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('an abandoned script pass stops after the await it was parked in', () => {
    test.each([true, false])('SP-1: an abort during a v2 plugin call skips the later plugin, the parser and the @@inject write (measuring build %s)', async (measure) => {
        h.measure = measure
        const first = deferred<string>()
        const firstCalled = deferred<void>()
        const second = vi.fn(async (data: string) => data)
        h.pluginSets.editoutput.add(() => { firstCalled.resolve(); return first.promise })
        h.pluginSets.editoutput.add(second)
        const controller = new AbortController()
        const pass = processScriptFull(
            charWith(injectScript), 'current', 'editoutput', 1, {}, undefined, undefined, undefined, undefined, 'bypass', undefined, controller.signal,
        )
        await firstCalled.promise
        controller.abort()
        messages[1].data = 'user edit'
        first.resolve('current')
        const result = await pass
        expect(second).not.toHaveBeenCalled()
        expect(h.parserCalls).toEqual([])
        expect(messages[1].data).toBe('user edit')
        expect(result).toEqual({ data: 'current', emoChanged: false })
    })

    test.each([true, false])('SP-2: an abort during a Lua edit trigger that awaits getTokens skips the plugins and the parser (measuring build %s)', async (measure) => {
        h.measure = measure
        const tokens = deferred<number>()
        vi.mocked(tokenize).mockImplementationOnce(() => tokens.promise)
        const plugin = vi.fn(async (data: string) => data)
        h.pluginSets.editoutput.add(plugin)
        h.luaTriggers = [{
            comment: '', type: 'manual', conditions: [], lowLevelAccess: false,
            effect: [{ type: 'triggerlua', code: 'listenEdit("editOutput", function(id, data) getTokens(id, data):await() return data end) -- sp2' }],
        }]
        const controller = new AbortController()
        const pass = processScriptFull(
            charWith(injectScript), 'current', 'editoutput', 1, {}, undefined, undefined, undefined, undefined, 'bypass', undefined, controller.signal,
        )
        await vi.waitFor(() => expect(tokenize).toHaveBeenCalledTimes(1))
        controller.abort()
        tokens.resolve(1)
        await pass
        expect(plugin).not.toHaveBeenCalled()
        expect(h.parserCalls).toEqual([])
    })
})

describe('an abandoned Lua edit trigger loses its access id', () => {
    test('SP-3: a chat write the edit trigger makes after the abort is refused', async () => {
        const tokens = deferred<number>()
        vi.mocked(tokenize).mockImplementationOnce(() => tokens.promise)
        h.luaTriggers = [{
            comment: '', type: 'manual', conditions: [], lowLevelAccess: false,
            effect: [{ type: 'triggerlua', code: 'listenEdit("editOutput", function(id, data) getTokens(id, data):await() addChat(id, "char", "late") return data end) -- sp3' }],
        }]
        const controller = new AbortController()
        const pass = processScriptFull(
            charWith(injectScript), 'current', 'editoutput', 1, {}, undefined, undefined, undefined, undefined, 'bypass', undefined, controller.signal,
        )
        await vi.waitFor(() => expect(tokenize).toHaveBeenCalledTimes(1))
        controller.abort()
        tokens.resolve(1)
        await pass
        expect(h.currentChat.message).toEqual([])
    })
})

describe('guards', () => {
    test('guard: SP-4 without a signal the pass runs every plugin, the parser and the @@inject write', async () => {
        const first = deferred<string>()
        const second = vi.fn(async (data: string) => data)
        h.pluginSets.editoutput.add(() => first.promise)
        h.pluginSets.editoutput.add(second)
        messages[1].data = 'user edit'
        const pass = processScriptFull(charWith(injectScript), 'current', 'editoutput', 1, {}, undefined, undefined, undefined, undefined, 'bypass')
        first.resolve('current')
        await pass
        expect(second).toHaveBeenCalledTimes(1)
        expect(h.parserCalls.length).toBeGreaterThan(0)
        expect(messages[1].data).toBe('current')
    })

    test('guard: SP-4b an unaborted signal changes nothing about the pass', async () => {
        const second = vi.fn(async (data: string) => data)
        h.pluginSets.editoutput.add(second)
        const controller = new AbortController()
        await processScriptFull(
            charWith(injectScript), 'current', 'editoutput', 1, {}, undefined, undefined, undefined, undefined, 'bypass', undefined, controller.signal,
        )
        expect(second).toHaveBeenCalledTimes(1)
        expect(h.parserCalls.length).toBeGreaterThan(0)
    })
})
