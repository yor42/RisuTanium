// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

// The modules `sendChat` reaches, mocked so it runs without providers, tokenizers or memory engines.
vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) { }
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))
/** The live characters `findCharacterbyId` searches; bound to DBState.db once the modules are imported. */
const liveCharacters = vi.hoisted(() => ({ get: (): Array<{ chaId?: string, type?: string }> => [] }))
vi.mock(import('src/ts/util'), async (importOriginal) => {
    return {
        ...await importOriginal(),
        // Faithful to production: the live non-group character holding the id, or a blank one with a fresh id.
        findCharacterbyId: (id: string) => liveCharacters.get().find(candidate => candidate.type !== 'group' && candidate.chaId === id) ?? {
            name: 'Unknown Character',
            chaId: globalThis.crypto.randomUUID(),
            type: 'character',
            bias: [],
            desc: '',
            chats: [],
            utilityBot: false,
            inlayViewScreen: false,
            additionalAssets: [],
            emotionImages: [],
            reloadKeys: 0,
        },
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        isLastCharPunctuation: vi.fn(() => true),
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
    } as unknown as typeof import('src/ts/util')
})
const requestChatDataMock = vi.hoisted(() => vi.fn())
vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('src/ts/process/request/request'))
vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('src/ts/process/stableDiff'))
vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))
vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))
vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))
vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))
vi.mock(import('src/ts/process/group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('src/ts/process/group'))
vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/triggers'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class { },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))
vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))
vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('src/ts/process/inlayScreen'))
vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('src/ts/process/prereroll'))
vi.mock(import('src/ts/process/transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))
vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))
vi.mock(import('src/ts/process/memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav2'))
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('src/ts/process/scriptings'))
vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))
vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

import type { Database } from 'src/ts/storage/database.svelte'
import { setFastForwardHostForTest, type FastForwardHost } from 'src/ts/storage/store2/fastForward'
import * as chatOrigin from 'src/ts/process/chatOrigin'
import { doingChat, sendChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { chaIdOf, chars, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, resolver, signal, takenBy, type MergeWorld } from './ffFixtures'

/**
 * Stage 3C rows R-SEND2b, P12 and P12b over the REAL `sendChat` (process/index.svelte.ts) with a stepped provider stream.
 * The page is dispatch-booted over a line-seeded store, its fast-forward host reads the page's real send registrations
 * (`writingTargets`), and the peer commits while the reply is mid-stream. The provider and every non-storage module
 * `sendChat` reaches are mocked: this proves the merge against the real writer registrations, not a native provider.
 */

liveCharacters.get = () => (DBState.db as unknown as { characters: Array<{ chaId?: string, type?: string }> }).characters ?? []

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
    doingChat.set(false)
})

afterEach(() => {
    ffTeardown()
    registered.clear()
    selectedCharID.set(-1)
    DBState.db = {} as unknown as Database
    vi.useRealTimers()
})

interface Gate {
    promise: Promise<void>
    open: () => void
}

function gate(): Gate {
    let open: () => void = () => { }
    const promise = new Promise<void>((resolve) => { open = resolve })
    return { promise, open }
}

/** A provider stream that yields the cumulative `chunks` one by one, each after the test opens its gate. */
function steppedStream(chunks: string[]): { stream: ReadableStream<{ data: string }>, gates: Gate[] } {
    const gates = chunks.map(() => gate())
    let next = 0
    const stream = new ReadableStream<{ data: string }>({
        async pull(controller) {
            const index = next++
            if (index >= chunks.length) {
                controller.close()
                return
            }
            await gates[index].promise
            controller.enqueue({ data: chunks[index] })
        },
    })
    return { stream, gates }
}

/** What the page's live database needs for `sendChat` besides the seeded profile. */
function prepareForSend(db: Database): void {
    Object.assign(db, {
        aiModel: 'gpt-3.5-turbo',
        maxContext: 999999,
        maxResponse: 500,
        bias: [],
        mainPrompt: '',
        globalNote: '',
        jailbreakToggle: false,
        chainOfThought: false,
        personaPrompt: false,
        promptPreprocess: false,
        additionalPrompt: '',
        descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptInfoInsideChat: false,
        autoContinueMinTokens: 0,
        autoContinueChat: false,
        igpPrompt: '',
        notification: false,
        removeIncompleteResponse: false,
        streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false,
        presetChain: '',
        outputImageModal: false,
        rememberToolUsage: false,
        supaModelType: 'none',
        hypav2: false,
        hypaV3: false,
        hanuraiEnable: false,
        inlayErrorResponse: false,
    })
}

/**
 * The characters a running send registered, kept by the test as the real host's put-back keep set keeps them: the
 * owner and, for a group, its members. It is what the page lists as in use and as written, whatever the build.
 */
const registered = new Set<string>()

/**
 * The page's host: the in-use and writing sets are the registered characters, and the per-chat writing targets are
 * read from the real send registrations (`writingTargets`) where the build has them.
 */
function realWritingHost(): FastForwardHost {
    const base = hostHandle.host.host
    return {
        ...base,
        inUse: () => registered,
        writing: chaId => registered.has(chaId),
        writingTargets: () => typeof chatOrigin.writingTargets === 'function' ? chatOrigin.writingTargets() : { chars: registered, chats: new Map<string, Set<string>>() },
        sending: () => doingChatNow(),
    }
}
let sendingNow = false
const doingChatNow = (): boolean => sendingNow

interface Send {
    done: Promise<boolean>
    gates: Gate[]
    /** Opens chunk `index` and waits until the reply text reached the chat. */
    step: (index: number, text: string, messages: () => Array<Record<string, unknown>>) => Promise<void>
}

/** Starts the real `sendChat` on the selected character, whose last message is a user turn. */
function startSend(chunks: string[], owners: string[]): Send {
    const { stream, gates } = steppedStream(chunks)
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: stream })
    sendingNow = true
    for (const chaId of owners) {
        registered.add(chaId)
    }
    const done = sendChat().finally(() => {
        sendingNow = false
        registered.clear()
    })
    return {
        done,
        gates,
        step: async (index, text, messages) => {
            gates[index].open()
            await until(() => messages().at(-1)?.data === text, `chunk ${index} in the chat (last: ${JSON.stringify(messages().slice(-2).map(m => [m.role, String(m.data).slice(0, 30)]))}, count ${messages().length})`, 8000).catch((error: unknown) => {
                throw new Error(`${String(error)} / last now: ${JSON.stringify(messages().slice(-2).map(m => [m.role, String(m.data).slice(0, 30)]))}`)
            })
        },
    }
}

async function sendWorld(options: Parameters<typeof mergeWorld>[0] = {}): Promise<MergeWorld> {
    const w = await mergeWorld(options)
    prepareForSend(w.b.db)
    DBState.db = w.b.db
    setFastForwardHostForTest(realWritingHost())
    return w
}

/** Makes chat X of character `index` end on a user turn, so a send answers it, and returns its message list. */
function endOnUser(db: Database, index: number, chatIndex = 0): () => Array<Record<string, unknown>> {
    const chat = chatsAt(db, index)[chatIndex]
    const list = (): Array<Record<string, unknown>> => chat.message as Array<Record<string, unknown>>
    if (list().at(-1)?.role !== 'user') {
        list().push({ role: 'user', data: 'question', time: 99 })
    }
    return list
}


describe('the dialog and a running send (R-SEND2b, P12, P12b)', () => {
    test('R-SEND2b the peer edits the written chat X: the dialog is not asked while X is written (every step and after 30 s); after the reply it lists X with keep both preselected, and keep both gives X the peer\'s version plus a copy with the reply', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const w = await sendWorld()
        const { b } = w
        const messages = endOnUser(b.db, 3)
        selectedCharID.set(3)
        const chaId = chaIdOf(b.db, 3)
        const cid = String(chatsAt(b.db, 3)[0].id)
        const asked = resolver(w)
        const send = startSend(['Hello', 'Hello World!'], [chaId])
        await send.step(0, 'Hello', messages)
        expect(asked.calls).toEqual([])
        const run = w.run.mock.calls.length
        await w.page.commitEdit((db) => { chatsAt(db, 3)[0].note = 'peer edit of x' })
        signal(w.world)
        await until(() => w.run.mock.calls.length > run, 'the fast-forward run', 8000)
        expect((await w.run.mock.results[run].value as { kind: string }).kind).toBe('deferred')
        expect(asked.calls).toEqual([])
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => w.world.peerWaitingLog.includes(true), 'the waiting line after 30 s', 8000)
        expect(asked.calls).toEqual([])
        await send.step(1, 'Hello World!', messages)
        expect(asked.calls).toEqual([])
        expect(await send.done).toBe(true)
        await until(() => asked.calls.length === 1, 'the dialog after the reply', 8000)
        expect(asked.calls[0]).toHaveLength(1)
        expect(asked.calls[0][0]).toMatchObject({ id: `char:${chaId}:chat:${cid}`, preselect: 'both', keepBoth: 'copy' })
        await takenBy(b, w.memory)
        const chats = chatsAt(b.db, 3)
        expect(chats.find(chat => chat.id === cid)?.note).toBe('peer edit of x')
        const copy = chats.find(chat => String(chat.name).endsWith('(Copy)'))
        expect((copy?.message as Array<Record<string, unknown>> | undefined)?.at(-1)?.data).toBe('Hello World!')
    })

    test('R-SEND2b (keep mine) the peer edits the written chat X: nothing is asked while X is written; after the reply the dialog is asked once, and keep mine keeps the reply in X, makes no copy, and the commit that follows writes it over the peer\'s edit', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const w = await sendWorld()
        const { b } = w
        const messages = endOnUser(b.db, 3)
        selectedCharID.set(3)
        const chaId = chaIdOf(b.db, 3)
        const x = chatsAt(b.db, 3)[0]
        const cid = String(x.id)
        const chatCount = chatsAt(b.db, 3).length
        const asked = resolver(w, () => 'mine')
        const send = startSend(['Hello', 'Hello World!'], [chaId])
        await send.step(0, 'Hello', messages)
        expect(asked.calls).toEqual([])
        const run = w.run.mock.calls.length
        await w.page.commitEdit((db) => { chatsAt(db, 3)[0].note = 'peer edit of x' })
        signal(w.world)
        await until(() => w.run.mock.calls.length > run, 'the fast-forward run', 8000)
        expect((await w.run.mock.results[run].value as { kind: string }).kind).toBe('deferred')
        vi.setSystemTime(Date.now() + 31_000)
        await until(() => w.world.peerWaitingLog.includes(true), 'the waiting line after 30 s', 8000)
        expect(asked.calls).toEqual([])
        await send.step(1, 'Hello World!', messages)
        expect(asked.calls).toEqual([])
        expect(await send.done).toBe(true)
        await until(() => asked.calls.length === 1, 'the dialog after the reply', 8000)
        expect(asked.calls[0]).toHaveLength(1)
        expect(asked.calls[0][0]).toMatchObject({ id: `char:${chaId}:chat:${cid}`, preselect: 'both', keepBoth: 'copy' })
        await takenBy(b, w.memory)
        expect(chatsAt(b.db, 3)).toHaveLength(chatCount)
        expect(chatsAt(b.db, 3)[0]).toBe(x)
        expect(x.note).not.toBe('peer edit of x')
        expect((x.message as Array<Record<string, unknown>>).at(-1)?.data).toBe('Hello World!')
        const lastInStore = async (): Promise<unknown> => {
            const stored = chatsAt((await w.page.freeze()).db, 3).find(chat => chat.id === cid)
            return (stored?.message as Array<Record<string, unknown>> | undefined)?.at(-1)?.data
        }
        await until(async () => await lastInStore() === 'Hello World!', 'the own commit holding the reply', 8000)
        expect(chatsAt((await w.page.freeze()).db, 3).find(chat => chat.id === cid)?.note).not.toBe('peer edit of x')
        expect(asked.calls).toHaveLength(1)
    })
    test('R-SEND2c a conflict on another character is not asked while a record of the written character waits: the whole pass waits until the reply ends', async () => {
        const w = await sendWorld()
        const { b } = w
        const messages = endOnUser(b.db, 3)
        selectedCharID.set(3)
        const asked = resolver(w)
        const send = startSend(['Hello', 'Hello World!'], [chaIdOf(b.db, 3)])
        await send.step(0, 'Hello', messages)
        chars(b.db)[0].personality = 'mine card'
        const run = w.run.mock.calls.length
        await w.page.commitEdit((db) => {
            chars(db)[0].personality = 'peer card'
            chatsAt(db, 3)[0].note = 'peer edit of x'
        })
        signal(w.world)
        await until(() => w.run.mock.calls.length > run, 'the fast-forward run', 8000)
        expect((await w.run.mock.results[run].value as { kind: string }).kind).toBe('deferred')
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        expect(asked.calls).toEqual([])
        await send.step(1, 'Hello World!', messages)
        expect(await send.done).toBe(true)
        await until(() => asked.calls.length === 1, 'the dialog after the reply', 8000)
        expect(asked.calls[0].map(record => record.id).sort()).toEqual([`char:${chaIdOf(b.db, 0)}:core`, `char:${chaIdOf(b.db, 3)}:chat:${String(chatsAt(b.db, 3)[0].id)}`].sort())
    })
    test('P12 keep both is answered for X, a send starts into X before the pass: the pass waits, the reply lands in X\'s own object, and after the end X is asked again', async () => {
        const w = await sendWorld()
        const { b } = w
        const messages = endOnUser(b.db, 3)
        selectedCharID.set(3)
        const chaId = chaIdOf(b.db, 3)
        const x = chatsAt(b.db, 3)[0]
        let send: Send | null = null
        const calls: string[][] = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push(conflicts.map(record => record.id))
            if (calls.length === 1) {
                // The answer is given, and in the same step a send starts into X: the pass that applies it must wait.
                send = startSend(['Hello', 'Hello World!'], [chaId])
                await send.step(0, 'Hello', messages)
            }
            return Object.fromEntries(conflicts.map(record => [record.id, 'both' as const]))
        }
        x.note = 'mine note'
        await w.page.commitEdit((db) => { chatsAt(db, 3)[0].note = 'peer note' })
        signal(w.world)
        await until(() => calls.length === 1, 'the first dialog', 8000)
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        expect(calls).toHaveLength(1)
        expect(chatsAt(b.db, 3)[0]).toBe(x)
        expect(x.note).toBe('mine note')
        const running = send as Send | null
        if (running === null) {
            throw new Error('The send did not start.')
        }
        await running.step(1, 'Hello World!', messages)
        expect(await running.done).toBe(true)
        expect((x.message as Array<Record<string, unknown>>).at(-1)?.data).toBe('Hello World!')
        await until(() => calls.length === 2, 'the second dialog', 8000)
        expect(calls[1]).toEqual([`char:${chaId}:chat:${String(x.id)}`])
    })

    test('P12b keep mine is answered for X, then a send starts into X: nothing is asked until the reply has ended', async () => {
        const w = await sendWorld()
        const { b } = w
        const messages = endOnUser(b.db, 3)
        selectedCharID.set(3)
        const chaId = chaIdOf(b.db, 3)
        const x = chatsAt(b.db, 3)[0]
        let send: Send | null = null
        let calls = 0
        let asksWhileWriting = 0
        b.peer.resolve = async ({ conflicts }) => {
            calls += 1
            if (calls === 1) {
                send = startSend(['Hello', 'Hello World!'], [chaId])
                await send.step(0, 'Hello', messages)
            } else if (sendingNow) {
                asksWhileWriting += 1
            }
            return Object.fromEntries(conflicts.map(record => [record.id, 'mine' as const]))
        }
        x.note = 'mine note'
        await w.page.commitEdit((db) => { chatsAt(db, 3)[0].note = 'peer note' })
        signal(w.world)
        await until(() => calls === 1, 'the dialog', 8000)
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        expect(calls).toBe(1)
        const running = send as Send | null
        if (running === null) {
            throw new Error('The send did not start.')
        }
        await running.step(1, 'Hello World!', messages)
        expect(await running.done).toBe(true)
        await until(() => calls === 2, 'the dialog after the reply', 8000)
        expect(asksWhileWriting).toBe(0)
    })
})
