// @vitest-environment node

/**
 * A module script run that its caller abandoned (the `signal` argument of `runScripted`) can no longer
 * change the chat, and loses its access id at once. The real `scriptings.ts` and real wasmoon run here;
 * `requestChatData` is a deferred, so a run can be held mid-await.
 *
 * Test kinds: every row is a regression reproducer unless its title starts with "guard:". The reproducers
 * fail on the code where `runScripted` ignores the `signal` field.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Message } from '../../storage/database.svelte'

vi.mock('../../parser/parser.svelte', () => ({
    hasher: vi.fn(),
    risuChatParser: vi.fn(),
}))

vi.mock('../../alert', () => ({
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../../util', () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(),
    getUserIcon: vi.fn(),
    getUserName: vi.fn(),
}))

vi.mock('../../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({})),
    getCurrentChat: vi.fn(() => ({ message: [] })),
    getDatabase: vi.fn(() => ({ characters: [] })),
    setDatabase: vi.fn(),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    ReloadChatPointer: { update: vi.fn() },
    ReloadGUIPointer: { update: vi.fn() },
    selectedCharID: { subscribe: (run: (value: number) => void) => (run(0), () => undefined) },
}))

vi.mock('../modules', () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
}))

vi.mock('../files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn() }))
vi.mock('../lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: vi.fn() }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../stableDiff', () => ({ generateAIImage: vi.fn() }))

let runScripted: typeof import('../scriptings').runScripted
let requestChatData: typeof import('../request/request').requestChatData
let alertNormal: typeof import('../../alert').alertNormal

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    ;({ requestChatData } = await import('../request/request'))
    ;({ alertNormal } = await import('../../alert'))
    ;({ runScripted } = await import('../scriptings'))
})

beforeEach(() => {
    vi.mocked(requestChatData).mockReset()
    vi.mocked(alertNormal).mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

function chatOf(...data: string[]): Chat {
    const message: Message[] = data.map((text, index) => ({ role: index % 2 === 0 ? 'user' : 'char', data: text }))
    return { message, note: '', name: 'chat', localLore: [] } as Chat
}

/** The next `requestChatData` call parks until `release` is called. */
function holdNextRequest() {
    let release: () => void = () => undefined
    let reachedResolve: () => void = () => undefined
    const reached = new Promise<void>((res) => { reachedResolve = res })
    vi.mocked(requestChatData).mockImplementationOnce(() => {
        reachedResolve()
        return new Promise((res) => { release = () => res({ type: 'success', result: 'r' } as never) }) as never
    })
    return { reached, release: () => release() }
}

const noVars = { setVar: () => false, getVar: () => 'null' } as const

describe('an abandoned run writes nothing', () => {
    test('MS-1: setFullChat after an abort mid-LLM leaves a message pushed after the abort in place', async () => {
        const chat = chatOf()
        const hold = holdNextRequest()
        const controller = new AbortController()
        const run = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) setFullChat(id, {{role="char", data="late"}}) end) -- ms1',
            { char: {} as never, chat, ...noVars, lowLevelAccess: true, mode: 'output', signal: controller.signal },
        )
        await hold.reached
        controller.abort()
        chat.message.push({ role: 'user', data: 'pushed after stop' })
        hold.release()
        await run
        expect(chat.message.map((m) => m.data)).toEqual(['pushed after stop'])
    })

    const writes: Array<[string, string]> = [
        ['setChat', 'setChat(id, 0, "late")'],
        ['setChatRole', 'setChatRole(id, 0, "char")'],
        ['addChat', 'addChat(id, "char", "late")'],
        ['insertChat', 'insertChat(id, 0, "char", "late")'],
        ['removeChat', 'removeChat(id, 0)'],
        ['cutChat', 'cutChat(id, 0, 1)'],
        ['setChatVar', 'setChatVar(id, "k", "late")'],
        ['setChatVarChanged', 'setChatVarChanged(id, "k", "late")'],
        ['upsertLocalLoreBook', 'upsertLocalLoreBook(id, "n", "late", {})'],
    ]
    test.each(writes)('MS-2: %s after an abort mid-LLM changes nothing', async (name, call) => {
        const chat = chatOf('orig', 'second')
        const before = structuredClone(chat)
        const setVar = vi.fn(() => false)
        const hold = holdNextRequest()
        const controller = new AbortController()
        const run = runScripted(
            `onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) ${call} end) -- ms2 ${name}`,
            { char: { type: 'character' } as never, chat, setVar, getVar: () => 'null', lowLevelAccess: true, mode: 'output', signal: controller.signal },
        )
        await hold.reached
        controller.abort()
        hold.release()
        await run
        expect(chat).toEqual(before)
        expect(setVar).not.toHaveBeenCalled()
    })

    test('MS-3: a run queued on the mode mutex and abandoned never runs, not even its module code', async () => {
        const chat = chatOf()
        const hold = holdNextRequest()
        const runA = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) end) -- ms3 A',
            { char: {} as never, chat, ...noVars, lowLevelAccess: true, mode: 'output' },
        )
        await hold.reached
        const getVar = vi.fn(() => 'null')
        const controller = new AbortController()
        const runB = runScripted(
            'local top = getChatVar("", "top") function onOutput(id) addChat(id, "char", "B") end -- ms3 B',
            { char: {} as never, chat, setVar: () => false, getVar, mode: 'output', signal: controller.signal },
        )
        controller.abort()
        hold.release()
        await runA
        await runB
        expect(chat.message).toEqual([])
        expect(getVar).not.toHaveBeenCalledWith('top')
    })

    test('MS-3b: a run whose signal is aborted before the call runs no Lua and returns no result', async () => {
        const chat = chatOf()
        const getVar = vi.fn(() => 'null')
        const controller = new AbortController()
        controller.abort()
        const result = await runScripted(
            'local top = getChatVar("", "top") function onOutput(id) addChat(id, "char", "B2") end -- ms3b',
            { char: {} as never, chat, setVar: () => false, getVar, mode: 'output', signal: controller.signal },
        )
        expect(result.res).toBeUndefined()
        expect(chat.message).toEqual([])
        expect(getVar).not.toHaveBeenCalledWith('top')
    })

    test('MS-3c: an abort that lands while the engine is created never runs the handler', async () => {
        const chat = chatOf()
        const controller = new AbortController()
        const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            if (args[0] === 'Creating new Lua engine for mode:' && args[1] === 'output') {
                controller.abort()
            }
        })
        const result = await runScripted(
            'function onOutput(id) addChat(id, "char", "C") end -- ms3c',
            { char: {} as never, chat, ...noVars, mode: 'output', signal: controller.signal },
        )
        log.mockRestore()
        expect(chat.message).toEqual([])
        expect(result.res).toBeUndefined()
    })

    test('MS-3d: an abort that lands while the module code loads never runs the handler', async () => {
        const chat = chatOf()
        const controller = new AbortController()
        const getVar = vi.fn((key: string) => {
            if (key === 'top') {
                controller.abort()
            }
            return 'null'
        })
        await runScripted(
            'local top = getChatVar("", "top") function onOutput(id) addChat(id, "char", "D") end -- ms3d',
            { char: {} as never, chat, setVar: () => false, getVar, mode: 'output', signal: controller.signal },
        )
        expect(getVar).toHaveBeenCalledWith('top')
        expect(chat.message).toEqual([])
    })

    test('MS-5: after an abort mid-LLM the run raises no alert and starts no second request', async () => {
        const chat = chatOf()
        const hold = holdNextRequest()
        const controller = new AbortController()
        const run = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) alertNormal(id, "late") LLM(id, {{role="user",content="y"}}) end) -- ms5',
            { char: {} as never, chat, ...noVars, lowLevelAccess: true, mode: 'output', signal: controller.signal },
        )
        await hold.reached
        controller.abort()
        hold.release()
        await run
        expect(alertNormal).not.toHaveBeenCalled()
        expect(requestChatData).toHaveBeenCalledTimes(1)
    })
})

describe('guards', () => {
    test('guard: MS-4 with an unaborted signal every write lands, and an abort after the run changes nothing', async () => {
        const chat = chatOf()
        const controller = new AbortController()
        await runScripted(
            'function onOutput(id) addChat(id, "char", "kept") end -- ms4',
            { char: {} as never, chat, ...noVars, mode: 'output', signal: controller.signal },
        )
        controller.abort()
        expect(chat.message.map((m) => m.data)).toEqual(['kept'])
    })

    test('guard: MS-0 a run that is not abandoned writes after its LLM call returns (the write rows below can land)', async () => {
        const chat = chatOf()
        const hold = holdNextRequest()
        const controller = new AbortController()
        const run = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) addChat(id, "char", "kept") end) -- ms0',
            { char: {} as never, chat, ...noVars, lowLevelAccess: true, mode: 'output', signal: controller.signal },
        )
        await hold.reached
        hold.release()
        await run
        expect(chat.message.map((m) => m.data)).toEqual(['kept'])
    })

    test('guard: MS-6 aborting one run revokes only its own id, a concurrent run in another mode still writes', async () => {
        const chatB = chatOf()
        const holdB = holdNextRequest()
        const controllerB = new AbortController()
        const runB = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) end) -- ms6 concurrent B',
            { char: {} as never, chat: chatB, ...noVars, lowLevelAccess: true, mode: 'output', signal: controllerB.signal },
        )
        await holdB.reached
        const chatC = chatOf()
        const holdC = holdNextRequest()
        const runC = runScripted(
            'onStart = async(function(id) LLM(id, {{role="user",content="x"}}) addChat(id, "char", "C kept") end) -- ms6 concurrent C',
            { char: {} as never, chat: chatC, ...noVars, lowLevelAccess: true, mode: 'start' },
        )
        await holdC.reached
        controllerB.abort()
        holdB.release()
        await runB
        holdC.release()
        await runC
        expect(chatC.message.map((m) => m.data)).toEqual(['C kept'])
    })

    test('guard: MS-6b an abandoned run leaves no stale refusal, the next run in the same mode writes normally', async () => {
        const chatB = chatOf()
        const holdB = holdNextRequest()
        const controllerB = new AbortController()
        const runB = runScripted(
            'onOutput = async(function(id) LLM(id, {{role="user",content="x"}}) end) -- ms6 B',
            { char: {} as never, chat: chatB, ...noVars, lowLevelAccess: true, mode: 'output', signal: controllerB.signal },
        )
        await holdB.reached
        controllerB.abort()
        holdB.release()
        await runB
        const chatC = chatOf()
        await runScripted(
            'function onOutput(id) addChat(id, "char", "C kept") end -- ms6 C',
            { char: {} as never, chat: chatC, ...noVars, mode: 'output', signal: new AbortController().signal },
        )
        expect(chatC.message.map((m) => m.data)).toEqual(['C kept'])
    })
})
