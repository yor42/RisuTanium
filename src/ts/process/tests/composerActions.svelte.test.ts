// @vitest-environment node

/**
 * S1 composer-actions suite: drives the REAL `composerActions.svelte.ts`
 * (`send`/`sendContinue`/`sendMain`/`reroll`/`unReroll`/`sendChatMain`/
 * `abortChat`/`runAutoMode`/`updateInputTransateMessage`) against an
 * in-memory `ComposerActionsSource`, the real `$state` database, the real
 * `runTrigger`/`processScript` chain (same pattern as
 * `sendCharacterMessage.svelte.test.ts`), and a slow step built from a
 * controllable gate rather than a real timer. `sendChat`/`doingChat`
 * (generation) are replaced with a spy that mirrors the real module's own
 * doingChat handling: refuse at once when already set, otherwise set it
 * synchronously and await a controllable gate. `./command` and
 * `../translator/translator` are mocked the same way, as controllable spies
 * rather than their real (network-facing) implementations.
 *
 * `isComposerBusy()` reports the one-action window (open from a Send's or
 * Continue's take until its generation hand-off returns); `isComposerLocked()`
 * reports the narrower span from that same take until the hand-off itself, or
 * a put-back. `resetComposerActionsForTests()` clears both, plus any in-flight
 * record, and runs in `afterEach` so a timed-out test cannot leave the window
 * or the lock open for the next one.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database, Message } from '../../storage/database.svelte'
import type { triggerscript, triggerEffect } from '../triggers'
import type { SendChatArg } from '../index.svelte'
import { alertError } from '../../alert'

//#region module mocks

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    isPlainHttpFileSrc: vi.fn(() => false),
    downloadFile: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
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

// `ms === 10` intercepts composerActions' own post-append `sleep(10)`; any
// other duration (the trigger engine's own `v2Wait`, etc.) falls through to
// a real timer. `interceptSleep` below registers a controllable gate for one
// duration and a signal for "that sleep call has been reached".
const interceptedSleeps = vi.hoisted(() => new Map<number, { gate: Promise<void>, markReached: () => void }>())
const sleepMock = vi.hoisted(() => vi.fn())
sleepMock.mockImplementation((ms: number) => {
    const intercepted = interceptedSleeps.get(ms)
    if (intercepted) {
        intercepted.markReached()
        return intercepted.gate
    }
    return new Promise<void>((res) => setTimeout(res, ms))
})

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    sleep: sleepMock,
}) as unknown as typeof import('../../util'))

// Controllable stand-in for `/` commands: a test configures its resolution
// (immediate, gated, or throwing) rather than driving the real command
// parser.
const processMultiCommandMock = vi.hoisted(() => vi.fn(async (_cmd: string): Promise<string | false> => false))

vi.mock(import('../command'), () => ({
    processMultiCommand: processMultiCommandMock,
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    snapshotSubject: vi.fn(),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

// Real (mutable) Sets so a test can register its OWN plugin hook -- the
// "slow input step" fixtures below need a genuine `pluginV2.editinput` await
// they control by hand, the same way a real plugin would.
const pluginV2Mock = {
    editinput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editoutput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editdisplay: new Set<(data: string) => Promise<string | null | undefined>>(),
    editprocess: new Set<(data: string) => Promise<string | null | undefined>>(),
}

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: pluginV2Mock,
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

// Generation is out of scope for this suite. This spy mirrors the real
// module's own `doingChat` handling: a call made while it is already set
// refuses at once; otherwise it sets `doingChat` synchronously (before any
// await, as the real `sendChat` does), awaits a controllable gate, and clears
// it when it settles.
// `doingChatMock` is a hand-rolled store (not svelte's `writable`) because
// `vi.hoisted` runs before this file's own imports are initialized, so its
// callback cannot call an imported function.
const doingChatMock = vi.hoisted(() => {
    let value = false
    const subscribers = new Set<(v: boolean) => void>()
    return {
        subscribe(run: (v: boolean) => void) {
            subscribers.add(run)
            run(value)
            return () => subscribers.delete(run)
        },
        set(v: boolean) {
            value = v
            subscribers.forEach((run) => run(value))
        },
    }
})
const generationGateBox = vi.hoisted(() => ({ current: Promise.resolve() as Promise<void> }))
const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, _arg: SendChatArg) => {
    if (get(doingChatMock)) {
        return false
    }
    doingChatMock.set(true)
    try {
        await generationGateBox.current
        return true
    } finally {
        doingChatMock.set(false)
    }
}))

vi.mock(import('../index.svelte'), () => ({
    doingChat: doingChatMock,
    sendChat: sendChatMock,
}) as unknown as typeof import('../index.svelte'))

const isExpTranslatorMock = vi.hoisted(() => vi.fn(() => false))
const translateMock = vi.hoisted(() => vi.fn(async (_text: string, _reverse: boolean): Promise<string> => ''))

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: isExpTranslatorMock,
    translate: translateMock,
}) as unknown as typeof import('../../translator/translator'))

//#endregion

let send: typeof import('../composerActions.svelte').send
let sendContinue: typeof import('../composerActions.svelte').sendContinue
let reroll: typeof import('../composerActions.svelte').reroll
let unReroll: typeof import('../composerActions.svelte').unReroll
let runAutoMode: typeof import('../composerActions.svelte').runAutoMode
let abortChat: typeof import('../composerActions.svelte').abortChat
let updateInputTransateMessage: typeof import('../composerActions.svelte').updateInputTransateMessage
let isComposerBusy: typeof import('../composerActions.svelte').isComposerBusy
let isComposerLocked: typeof import('../composerActions.svelte').isComposerLocked
let isAutoModeActive: typeof import('../composerActions.svelte').isAutoModeActive
let resetComposerActionsForTests: typeof import('../composerActions.svelte').resetComposerActionsForTests
type ComposerActionsSource = import('../composerActions.svelte').ComposerActionsSource
let composerDraftsPeek: typeof import('../composerDrafts.svelte').peek
let composerDraftsWrite: typeof import('../composerDrafts.svelte').write
type ComposerDraftKey = import('../composerDrafts.svelte').ComposerDraftKey
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let isWriting: typeof import('../chatOrigin').isWriting
let hasLocalDrafts: typeof import('../../localDrafts').hasLocalDrafts
let resetLocalDraftsForTest: typeof import('../../localDrafts').resetLocalDraftsForTest
let getMultiTabAction: typeof import('../../storage/multiTabReload').getMultiTabAction
let coldStorageHeader: string

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const actions = await import('../composerActions.svelte')
    send = actions.send
    sendContinue = actions.sendContinue
    reroll = actions.reroll
    unReroll = actions.unReroll
    runAutoMode = actions.runAutoMode
    abortChat = actions.abortChat
    updateInputTransateMessage = actions.updateInputTransateMessage
    isComposerBusy = actions.isComposerBusy
    isComposerLocked = actions.isComposerLocked
    isAutoModeActive = actions.isAutoModeActive
    resetComposerActionsForTests = actions.resetComposerActionsForTests

    const drafts2 = await import('../composerDrafts.svelte')
    composerDraftsPeek = drafts2.peek
    composerDraftsWrite = drafts2.write

    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never

    const origin = await import('../chatOrigin')
    isWriting = origin.isWriting

    const drafts = await import('../../localDrafts')
    hasLocalDrafts = drafts.hasLocalDrafts
    resetLocalDraftsForTest = drafts.resetLocalDraftsForTest

    const multiTab = await import('../../storage/multiTabReload')
    getMultiTabAction = multiTab.getMultiTabAction

    const cold = await import('../coldstorageData')
    coldStorageHeader = cold.coldStorageHeader
})

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

function makeChat(id: string, overrides: Record<string, unknown> = {}): Chat {
    return {
        id,
        message: [] as unknown[],
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as Chat
}

function makeCharacter(chaId: string, overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat-0`)],
        triggerscript: [] as unknown[],
        customscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        ...overrides,
    } as unknown as character
}

function makeGroup(chaId: string, overrides: Record<string, unknown> = {}): groupChat {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat-0`)],
        ...overrides,
    } as unknown as groupChat
}

function installDb(characters: (character | groupChat)[] = [], overrides: Record<string, unknown> = {}) {
    DBState.db = {
        characters,
        modules: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        ...overrides,
    } as unknown as Database
    selectedCharID.set(0)
}

interface SourceHandle {
    source: ComposerActionsSource
    closeMenuCalls: () => number
}

function makeSource(): SourceHandle {
    let closeMenuCalls = 0
    const source: ComposerActionsSource = {
        closeMenu: () => { closeMenuCalls++ },
    }
    return { source, closeMenuCalls: () => closeMenuCalls }
}

/** The per-chat draft key composerActions.svelte.ts keys records by -- every
 * fixture chat already carries both ids (`makeCharacter`/`makeChat`), so no
 * id fill is needed. `chat.id` is typed optional on `Chat` itself; every
 * caller here passes a fixture chat that was given one. */
function keyFor(owner: { chaId: string }, chat: { id?: string }): ComposerDraftKey {
    return { chaId: owner.chaId, chatId: chat.id! }
}

/** Seeds `owner`/`chat`'s draft record directly -- this suite's stand-in
 * for text already sitting in the composer before an action runs. */
function seedDraft(owner: { chaId: string }, chat: { id?: string }, fields: { messageInput?: string, messageInputTranslate?: string, fileInput?: string[] }): void {
    composerDraftsWrite(keyFor(owner, chat), (record) => {
        if (fields.messageInput !== undefined) record.messageInput = fields.messageInput
        if (fields.messageInputTranslate !== undefined) record.messageInputTranslate = fields.messageInputTranslate
        if (fields.fileInput !== undefined) record.fileInput = fields.fileInput
    })
}

/** Reads `owner`/`chat`'s current draft record (the empty view when none is stored). */
function draftFor(owner: { chaId: string }, chat: { id?: string }) {
    return composerDraftsPeek(keyFor(owner, chat))
}

/** A promise the test resolves by hand, standing in for a slow real step. */
function makeGate() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    return { gate, release: () => release() }
}

/**
 * Registers one `pluginV2.editinput` hook (a real plugin's own shape) whose
 * successive invocations, across every `sendCharacterMessage` call made
 * while it is installed, are gated one at a time via `nextGate()`. A call
 * for which no gate was queued passes its text through at once -- the same
 * as a real install with no hook at all.
 */
function installEditinputQueue() {
    let callIndex = 0
    const queue: Array<{ gate: Promise<void>, markReached: () => void } | undefined> = []
    pluginV2Mock.editinput.add(async (data: string) => {
        const entry = queue[callIndex]
        callIndex++
        if (!entry) {
            return data
        }
        entry.markReached()
        await entry.gate
        return data
    })
    return {
        nextGate() {
            let release: () => void = () => {}
            const gate = new Promise<void>((res) => { release = res })
            let markReached: () => void = () => {}
            const reached = new Promise<void>((res) => { markReached = res })
            queue.push({ gate, markReached })
            return { release, reached }
        },
    }
}

/** Configures `processMultiCommandMock` to stay pending until released. */
function gateNextCommand(resolveTo: string | false = false) {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    processMultiCommandMock.mockImplementationOnce(async () => {
        markReached()
        await gate
        return resolveTo
    })
    return { release, reached }
}

/** Holds `sendChat`'s own gate open, so a send that reaches generation stalls there. */
function gateGeneration() {
    const { gate, release } = makeGate()
    generationGateBox.current = gate
    return release
}

beforeEach(() => {
    pluginV2Mock.editinput.clear()
    pluginV2Mock.editoutput.clear()
    pluginV2Mock.editdisplay.clear()
    interceptedSleeps.clear()
    processMultiCommandMock.mockReset()
    processMultiCommandMock.mockImplementation(async () => false)
    sendChatMock.mockClear()
    doingChatMock.set(false)
    generationGateBox.current = Promise.resolve()
    isExpTranslatorMock.mockReset()
    isExpTranslatorMock.mockReturnValue(false)
    translateMock.mockReset()
    translateMock.mockResolvedValue('')
    resetLocalDraftsForTest()
})

afterEach(() => {
    // A test that times out or throws mid-send can otherwise leave the
    // module-level window or lock open, or a draft registered, for every
    // test that runs after it.
    resetComposerActionsForTests()
})

//#endregion

describe('a second composer action while a send is still taking its input', () => {
    test('a second Send during the first Send\'s wait does not start a second message or a second generation', async () => {
        const char = makeCharacter('c-double-send')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p1 = send(source)
        await first.reached

        const p2 = send(source)
        await p2
        first.release()
        await p1

        const chat = char.chats[0]
        expect(chat.message.filter((m) => m.data === 'hello').length).toBe(1)
        expect(chat.message.length).toBe(1)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('Continue during the first Send\'s wait does not start a second message or a second generation', async () => {
        const char = makeCharacter('c-double-continue')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p1 = send(source)
        await first.reached

        const p2 = sendContinue(source)
        await p2
        first.release()
        await p1

        const chat = char.chats[0]
        expect(chat.message.filter((m) => m.data === 'hello').length).toBe(1)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('a Send between the append and the hand-off to generation is refused', async () => {
        const char = makeCharacter('c-sleep-gap')
        installDb([char])
        // No editinput hook: the character branch resolves fast, so the
        // first send's own post-append `sleep(10)` is the only intercepted
        // wait -- this lands the second Send exactly between the append and
        // `sendChatMain`'s own hand-off to generation.
        const delay = interceptSleep(10)
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        const p1 = send(source)
        await delay.reached
        expect(get(doingChatMock)).toBe(false)

        const p2 = send(source)
        delay.release()
        await Promise.all([p1, p2])

        expect(char.chats[0].message.length).toBe(1)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a busy-button click after the append but before generation starts aborts that generation', async () => {
        const char = makeCharacter('c-abort-after-append')
        installDb([char])
        // Same post-append `sleep(10)` gap as the test above, but this one
        // clicks the busy button while parked there instead of sending
        // again.
        const delay = interceptSleep(10)
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        const p = send(source)
        await delay.reached

        abortChat()

        delay.release()
        await p

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        const passedArg = sendChatMock.mock.calls[0][1] as SendChatArg
        expect(passedArg.signal!.aborted).toBe(true)
    })

    test('reroll during another send\'s wait leaves the chat untouched and starts no generation', async () => {
        const char = makeCharacter('c-reroll-race')
        const chat = char.chats[0]
        chat.message = [
            { role: 'user', data: 'u0' } as unknown as Message,
            { role: 'char', data: 'c0' } as unknown as Message,
        ]
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        const before = char.chats[0].message
        await reroll(source)

        expect(char.chats[0].message).toBe(before)
        expect(char.chats[0].message.length).toBe(2)
        expect(sendChatMock).toHaveBeenCalledTimes(0)

        first.release()
        await p
    })

    test('unreroll during another send\'s wait leaves the last message untouched', async () => {
        const char = makeCharacter('c-unreroll-race')
        const chat = char.chats[0]
        chat.message = [
            { role: 'user', data: 'u0' } as unknown as Message,
            { role: 'char', data: 'old-reply' } as unknown as Message,
        ]
        installDb([char])
        // A completed reroll leaves a reply that a step back would restore.
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            char.chats[0].message.push({ role: 'char', data: 'current-reply' } as unknown as Message)
            doingChatMock.set(false)
            return true
        })
        const { source } = makeSource()
        await reroll(source)
        expect(char.chats[0].message.map((m) => m.data)).toEqual(['u0', 'current-reply'])

        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const p = send(source)
        await first.reached

        await unReroll(source)

        expect(char.chats[0].message[1]?.data).toBe('current-reply')

        first.release()
        await p
    })

    test('starting auto mode during another send\'s wait does not start a generation', async () => {
        const char = makeCharacter('c-automode-race')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        const autoP = runAutoMode(source)
        runAutoMode(source) // stops the loop after its own current tick
        await autoP

        expect(sendChatMock).toHaveBeenCalledTimes(0)

        first.release()
        await p

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(char.chats[0].message.length).toBe(1)
    })

    test('guard: a Send is refused while generation itself is already running', async () => {
        const char = makeCharacter('c-doingchat-guard')
        installDb([char])
        const releaseGeneration = gateGeneration()
        const delay = interceptSleep(10)
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        const p = send(source)
        await delay.reached
        delay.release()
        // One microtask turn is enough: from `sleep(10)` resolving to
        // `sendChat` setting `doingChat`, nothing in between awaits again.
        await Promise.resolve()
        expect(get(doingChatMock)).toBe(true)

        const p2 = send(source)
        await p2
        releaseGeneration()
        await p

        expect(char.chats[0].message.length).toBe(1)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('guard: toggling auto mode off stops it after its current tick', async () => {
        const char = makeCharacter('c-automode-stop')
        installDb([char])

        const { source } = makeSource()
        const p = runAutoMode(source)
        runAutoMode(source)
        await p

        expect(isAutoModeActive()).toBe(false)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('a generation that throws during an auto-mode tick leaves auto mode stopped', async () => {
        const char = makeCharacter('c-automode-throw')
        installDb([char])

        // sendChatMain's own catch already handles a thrown/rejected
        // sendChat call by itself; for that tick's error to reach
        // runAutoMode's loop, the catch's own recovery step (alertError)
        // has to fail too -- the same way a real alert failing to render
        // would leave the original error unhandled.
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            try {
                throw new Error('generation failed')
            } finally {
                doingChatMock.set(false)
            }
        })
        vi.mocked(alertError).mockImplementationOnce(() => {
            throw new Error('alert failed too')
        })

        const { source } = makeSource()
        let threw = false
        try {
            await runAutoMode(source)
        } catch {
            threw = true
        }

        expect(threw).toBe(true)
        expect(isAutoModeActive()).toBe(false)

        // Starting auto mode again is not refused: it runs one tick.
        const p = runAutoMode(source)
        runAutoMode(source) // stops it after its own current tick
        await p

        expect(sendChatMock).toHaveBeenCalledTimes(2)
        expect(isAutoModeActive()).toBe(false)
    })
})

describe('composerActions: a second source during another send\'s wait', () => {
    test('a Send through a different source (a remounted composer) is refused and takes nothing', async () => {
        const char = makeCharacter('c-second-source')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'from-a' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source: sourceA } = makeSource()
        const p1 = send(sourceA)
        await first.reached

        // A's take already emptied the chat's record; this stands in for a
        // second composer instance (a remount) with its own text typed into
        // the same chat while A's send is still in flight.
        seedDraft(char, char.chats[0], { messageInput: 'from-b' })
        const { source: sourceB } = makeSource()
        const p2 = send(sourceB)
        await p2
        first.release()
        await p1

        const dataList = char.chats[0].message.map((m) => m.data)
        expect(dataList).not.toContain('from-b')
        expect(dataList.length).toBe(1)
        // The refused second Send took nothing: 'from-b' is still there.
        expect(draftFor(char, char.chats[0]).messageInput).toBe('from-b')
    })
})

describe('composerActions: a throw before the message is appended', () => {
    test('an input trigger that throws puts the text back un-inlined and the staged files back', async () => {
        const char = makeCharacter('c-trigger-throw')
        char.triggerscript.push(trig('t', 'input', [
            v2('v2Command', { value: '/whatever', valueType: 'value' }),
        ]))
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello', fileInput: ['staged.png'] })
        processMultiCommandMock.mockRejectedValueOnce(new Error('input trigger command failed'))

        const { source } = makeSource()
        let threw = false
        try {
            await send(source)
        } catch {
            threw = true
        }

        expect(threw).toBe(true)
        expect(char.chats[0].message.length).toBe(0)
        expect(isWriting({ chaId: char.chaId, chatId: char.chats[0].id })).toBe(false)
        // A throw before the append puts back exactly what was taken: the
        // text as typed, with no `{{inlayed::}}` markers, and every staged
        // file, and neither the window nor the lock stays open past it.
        expect(draftFor(char, char.chats[0]).messageInput).toBe('hello')
        expect(draftFor(char, char.chats[0]).fileInput).toEqual(['staged.png'])
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('a plugin editinput hook that rejects puts the text back un-inlined and the staged files back', async () => {
        const char = makeCharacter('c-hook-throw')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hi', fileInput: ['staged2.png'] })
        pluginV2Mock.editinput.add(async () => {
            throw new Error('plugin refused the input')
        })

        const { source } = makeSource()
        let threw = false
        try {
            await send(source)
        } catch {
            threw = true
        }

        expect(threw).toBe(true)
        expect(char.chats[0].message.length).toBe(0)
        expect(isWriting({ chaId: char.chaId, chatId: char.chats[0].id })).toBe(false)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('hi')
        expect(draftFor(char, char.chats[0]).fileInput).toEqual(['staged2.png'])
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('guard: a slash command that throws leaves the text and the staged files exactly as typed', async () => {
        const char = makeCharacter('c-command-throw')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: '/dangerous', fileInput: ['staged3.png'] })
        processMultiCommandMock.mockRejectedValueOnce(new Error('command failed'))

        const { source } = makeSource()
        let threw = false
        try {
            await send(source)
        } catch {
            threw = true
        }

        expect(threw).toBe(true)
        expect(char.chats[0].message.length).toBe(0)
        expect(draftFor(char, char.chats[0]).fileInput).toEqual(['staged3.png'])
        expect(draftFor(char, char.chats[0]).messageInput).toBe('/dangerous')
    })
})

describe('composerActions: an origin that is gone by the time the append would run', () => {
    test('guard: a character send whose chat is gone appends nothing anywhere', async () => {
        const char = makeCharacter('c-gone-origin')
        const a2 = makeChat('a2')
        char.chats.push(a2)
        installDb([char])
        const originChat = char.chats[0]
        seedDraft(char, originChat, { messageInput: 'hello' })

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        char.chats.splice(0, 1) // the origin chat is gone during the wait

        first.release()
        await p

        expect(a2.message.length).toBe(0)
        expect(originChat.message.length).toBe(0)
        // The put-back writes to the origin's own record by key, which still
        // identifies it even after the chat has been removed from the array.
        expect(draftFor(char, originChat).messageInput).toBe('hello')
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('a character send whose chat is gone puts the staged files back', async () => {
        const char = makeCharacter('c-gone-origin-files')
        const a2 = makeChat('a2')
        char.chats.push(a2)
        installDb([char])
        const originChat = char.chats[0]
        seedDraft(char, originChat, { messageInput: 'hello', fileInput: ['keep.png'] })

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        char.chats.splice(0, 1) // the origin chat is gone during the wait

        first.release()
        await p

        expect(a2.message.length).toBe(0)
        expect(originChat.message.length).toBe(0)
        // A gone origin puts back exactly what was taken: the text as
        // typed, with no `{{inlayed::}}` markers, and every staged file.
        expect(draftFor(char, originChat).messageInput).toBe('hello')
        expect(draftFor(char, originChat).fileInput).toEqual(['keep.png'])
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('a group send whose chat is gone by the time an unhandled slash command resolves does not alias the surviving chat', async () => {
        const group = makeGroup('g-gone-origin')
        const chatA = group.chats[0]
        const chatB = makeChat('g-gone-origin-b', { message: [{ role: 'user', data: 'existing-b' }] })
        group.chats.push(chatB)
        installDb([group])
        seedDraft(group, chatA, { messageInput: '/slow text' })

        const command = gateNextCommand(false)
        const { source } = makeSource()
        const p = send(source)
        await command.reached

        group.chats.splice(0, 1) // the origin chat is gone; chatB shifts to index 0

        command.release()
        await p

        expect(group.chats[0]).toBe(chatB)
        expect(chatB.message.map((m) => m.data)).toEqual(['existing-b'])
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })
})

describe('composerActions: a handled slash command', () => {
    test('guard: a handled command consumes the text and leaves the staged files and translation untouched', async () => {
        const char = makeCharacter('c-handled-command')
        installDb([char])
        seedDraft(char, char.chats[0], {
            messageInput: '/known',
            fileInput: ['staged.png'],
            messageInputTranslate: 'translated-text',
        })
        processMultiCommandMock.mockResolvedValueOnce('ok')

        const { source } = makeSource()
        await send(source)

        expect(draftFor(char, char.chats[0]).messageInput).toBe('')
        expect(draftFor(char, char.chats[0]).fileInput).toEqual(['staged.png'])
        expect(draftFor(char, char.chats[0]).messageInputTranslate).toBe('translated-text')
        expect(char.chats[0].message.length).toBe(0)
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })
})

describe('composerActions: cancelling before generation', () => {
    test('the busy button cancels a stalled send before it appends, at once', async () => {
        const char = makeCharacter('c-cancel-noop')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'stuck-text' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        abortChat()

        // The cancel is synchronous: the window and the lock close, and the
        // composer holds the taken text back, before the stalled trigger has
        // even been released, let alone resolved.
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('stuck-text')

        first.release()
        await p

        expect(char.chats[0].message.some((m) => m.data === 'stuck-text')).toBe(false)
        expect(sendChatMock).toHaveBeenCalledTimes(0)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('stuck-text')
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('a new send after cancelling a stalled one is not disturbed once the old one later resolves', async () => {
        const char = makeCharacter('c-cancel-then-new')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'old-text' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p1 = send(source)
        await first.reached

        abortChat()

        const second = editinput.nextGate()
        seedDraft(char, char.chats[0], { messageInput: 'new-text' })
        const p2 = send(source)
        await second.reached
        second.release()
        await p2

        first.release()
        await p1

        const dataList = char.chats[0].message.map((m) => m.data)
        expect(dataList).toEqual(['new-text'])
    })

    test('cancelling A does not disturb B, even when A\'s stalled trigger settles while B is in flight; cancelling B is then just as immediate', async () => {
        const char = makeCharacter('c-cancel-a-then-b')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'text-a' })
        const editinput = installEditinputQueue()
        const gateA = editinput.nextGate()

        const { source } = makeSource()
        const pA = send(source)
        await gateA.reached

        abortChat() // cancels A
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)

        seedDraft(char, char.chats[0], { messageInput: 'text-b' })
        const gateB = editinput.nextGate()
        const pB = send(source)
        await gateB.reached

        // A's stalled trigger settles only now, after B has already taken
        // the composer -- A's own cleanup must recognise B, not A, as the
        // current in-flight record, and leave B's window and lock alone.
        gateA.release()
        await pA
        expect(isComposerBusy()).toBe(true)
        expect(isComposerLocked()).toBe(true)

        abortChat() // cancels B
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('text-b')

        gateB.release()
        await pB

        expect(char.chats[0].message.length).toBe(0)
    })
})

describe('composerActions: liveness while a send is taking the composer', () => {
    test('a draft is registered while a send is in flight, with the composer emptied for it', async () => {
        const char = makeCharacter('c-liveness')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        expect(hasLocalDrafts()).toBe(false)

        const p = send(source)
        await first.reached

        expect(hasLocalDrafts()).toBe(true)
        const action = getMultiTabAction({
            dirty: false,
            now: Date.now(),
            history: { lastAt: null, burst: 0 },
            lastPromptAt: null,
            hasLocalDraft: hasLocalDrafts(),
        })
        expect(action).toBe('stay')

        first.release()
        await p

        expect(hasLocalDrafts()).toBe(false)
    })
})

describe('composerActions: the write-back after an unhandled slash command\'s wait', () => {
    test('a group send does not alias another chat of the same owner switched to during the wait', async () => {
        const group = makeGroup('g-writeback')
        const chatA = group.chats[0]
        const chatB = makeChat('g-writeback-b', { message: [{ role: 'user', data: 'existing-b' }] })
        group.chats.push(chatB)
        installDb([group])
        seedDraft(group, chatA, { messageInput: '/slow text' })

        const command = gateNextCommand(false)
        const { source } = makeSource()
        const p = send(source)
        await command.reached

        group.chatPage = 1 // switch to chatB, same owner, during the wait

        command.release()
        await p

        expect(chatA.message === chatB.message).toBe(false)
        expect(chatB.message.map((m) => m.data)).toEqual(['existing-b'])
        expect(chatA.message.some((m) => m.data === '/slow text')).toBe(true)
    })

    test('a character send whose composer is emptied during the wait does not alias a chat switched to during it', async () => {
        const char = makeCharacter('c-writeback-empty')
        const chatA = char.chats[0]
        chatA.message = [{ role: 'char', data: 'greeting' } as unknown as Message]
        const chatB = makeChat('c-writeback-empty-b', { message: [{ role: 'user', data: 'existing-b' }] })
        char.chats.push(chatB)
        installDb([char], { useSayNothing: true })
        seedDraft(char, chatA, { messageInput: '/slow text' })

        const command = gateNextCommand(false)
        const { source } = makeSource()
        const p = send(source)
        await command.reached

        char.chatPage = 1 // switch to chatB, same owner, during the wait
        // The take already cleared the origin's record synchronously, so it
        // reads empty here without any further action.
        expect(draftFor(char, chatA).messageInput).toBe('')

        command.release()
        await p

        expect(chatA.message === chatB.message).toBe(false)
        expect(chatB.message.map((m) => m.data)).toEqual(['existing-b'])
    })
})

describe('composerActions: an ambiguous origin', () => {
    test('a group send with two chats sharing the origin\'s id appends to the chat held since the take, not the live chat at chatPage', async () => {
        const group = makeGroup('g-ambiguous')
        const originChat = group.chats[0]
        installDb([group])
        seedDraft(group, originChat, { messageInput: '/slow text' })

        const command = gateNextCommand(false)
        const { source } = makeSource()
        const p = send(source)
        await command.reached

        // A duplicate chat sharing the origin's id now occupies chatPage's
        // own slot, the way a plugin-installed clone would.
        group.chats.unshift(makeChat(originChat.id))

        command.release()
        await p

        expect(originChat.message.map((m) => m.data)).toEqual(['/slow text'])
        expect(group.chats[0]).not.toBe(originChat)
        expect(group.chats[0].message.length).toBe(0)
    })
})

describe('composerActions: a frozen character index across a slow command\'s wait', () => {
    test('a permanent deletion at a lower index does not misdirect the message to the wrong character', async () => {
        const charLow = makeCharacter('c-frozen-low')
        const charOrigin = makeCharacter('c-frozen-origin')
        const charOther = makeCharacter('c-frozen-other')
        installDb([charLow, charOrigin, charOther])
        selectedCharID.set(1) // charOrigin
        seedDraft(charOrigin, charOrigin.chats[0], { messageInput: '/slow frozen-index-text' })

        const command = gateNextCommand(false)
        const { source } = makeSource()
        const p = send(source)
        await command.reached

        DBState.db.characters.splice(0, 1) // charLow permanently removed; charOrigin shifts to index 0

        command.release()
        let threw = false
        try {
            await p
        } catch {
            threw = true
        }

        expect(threw).toBe(false)
        expect(charOrigin.chats[0].message.some((m) => m.data === 'frozen-index-text' || m.data === '/slow frozen-index-text')).toBe(true)
        expect(charOther.chats[0].message.length).toBe(0)
    })
})

describe('composerActions: reroll and auto mode must not clear a typed draft', () => {
    test('reroll leaves a typed draft in place', async () => {
        const char = makeCharacter('c-reroll-keeps-draft')
        char.chats[0].message = [
            { role: 'user', data: 'u0' } as unknown as Message,
            { role: 'char', data: 'c0' } as unknown as Message,
        ]
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'typed-draft' })

        const { source } = makeSource()
        await reroll(source)

        expect(draftFor(char, char.chats[0]).messageInput).toBe('typed-draft')
    })

    test('one auto-mode tick leaves a typed draft in place', async () => {
        const char = makeCharacter('c-automode-keeps-draft')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'typed-draft' })

        const { source } = makeSource()
        const p = runAutoMode(source)
        runAutoMode(source)
        await p

        expect(draftFor(char, char.chats[0]).messageInput).toBe('typed-draft')
    })
})

describe('composerActions: the busy and lock flags across a send\'s lifecycle', () => {
    test('the busy flag is set from the take until generation returns', async () => {
        const char = makeCharacter('c-busy-spec')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        expect(isComposerBusy()).toBe(false)

        const p = send(source)
        await first.reached
        expect(isComposerBusy()).toBe(true)

        first.release()
        await p
        expect(isComposerBusy()).toBe(false)
    })

    test('the lock flag is set from the take until the hand-off, module-wide', async () => {
        const char = makeCharacter('c-lock-spec')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source: sourceA } = makeSource()
        makeSource() // a second, unrelated source instance, standing in for a remount

        expect(isComposerLocked()).toBe(false)
        const p = send(sourceA)
        await first.reached
        expect(isComposerLocked()).toBe(true)

        first.release()
        await p
        expect(isComposerLocked()).toBe(false)
    })

    test('the lock ends at the hand-off while the busy state continues through generation', async () => {
        const char = makeCharacter('c-lock-vs-busy')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const releaseGeneration = gateGeneration()
        const delay = interceptSleep(10)

        const { source } = makeSource()
        const p = send(source)
        await delay.reached
        delay.release()
        // One microtask turn is enough: from `sleep(10)` resolving to
        // `sendChat` being called (and the lock being released just before
        // it), nothing in between awaits again.
        await Promise.resolve()

        expect(isComposerLocked()).toBe(false)
        expect(isComposerBusy()).toBe(true)

        releaseGeneration()
        await p

        expect(isComposerBusy()).toBe(false)
    })
})

describe('composerActions: results that arrive while a send is taking the composer', () => {
    test('a late text result from a file operation stays in the composer after a successful send', async () => {
        const char = makeCharacter('c-late-text')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        // Stands in for a late writer (a paste/Post File result) landing in
        // the origin's record, which the take already emptied.
        composerDraftsWrite(keyFor(char, char.chats[0]), (record) => { record.messageInput += '{{file::late.txt::data}}' })

        first.release()
        await p

        // A text result from an operation that started before Send lands in
        // the composer even when it resolves during the send's own wait.
        expect(draftFor(char, char.chats[0]).messageInput).toContain('{{file::late.txt::data}}')
    })

    test('guard: a cancelled send puts the taken text back in front of a late text result, never behind it', async () => {
        const char = makeCharacter('c-late-text-then-cancel')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'taken-text' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        composerDraftsWrite(keyFor(char, char.chats[0]), (record) => { record.messageInput += '-late-result' })
        abortChat()

        expect(draftFor(char, char.chats[0]).messageInput).toBe('taken-text-late-result')

        first.release()
        await p
    })

    test('guard: a late asset staged during the wait is still staged after the send', async () => {
        const char = makeCharacter('c-late-asset')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source } = makeSource()
        const p = send(source)
        await first.reached

        composerDraftsWrite(keyFor(char, char.chats[0]), (record) => { record.fileInput = [...record.fileInput, 'late-asset.png'] })

        first.release()
        await p

        expect(draftFor(char, char.chats[0]).fileInput).toContain('late-asset.png')
    })
})

describe('composerActions: the exp-translator debounce', () => {
    test('guard: a source change before the debounce elapses skips the translate request entirely', async () => {
        isExpTranslatorMock.mockReturnValue(true)
        const char = makeCharacter('c-translate-guard')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInputTranslate: 'draft-in-translate-field' })

        const delay = interceptSleep(1500)
        const key = keyFor(char, chat)

        const p = updateInputTransateMessage(key, true)
        await delay.reached

        // The source field changes before the debounce elapses.
        composerDraftsWrite(key, (record) => { record.messageInputTranslate = 'changed-before-debounce-elapsed' })
        delay.release()
        await p

        expect(translateMock).not.toHaveBeenCalled()
        expect(draftFor(char, chat).messageInput).toBe('')
    })
})

describe('composerActions: a translation in flight when Send takes the composer', () => {
    test('a non-exp translation resolving during the wait is discarded, so cancelling puts back exactly the taken values with no duplicate', async () => {
        const char = makeCharacter('c-translate-nonexp-cancel')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInput: 'hello', messageInputTranslate: 'old-tr' })

        const translateGate = makeGate()
        translateMock.mockImplementationOnce(() => translateGate.gate.then(() => 'fresh-tr'))

        const { source } = makeSource()
        await updateInputTransateMessage(keyFor(char, chat), true) // issues the translate() call; it does not resolve yet

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()
        const p = send(source)
        await first.reached

        translateGate.release()
        await new Promise((res) => setTimeout(res, 0))

        abortChat()

        expect(draftFor(char, chat).messageInput).toBe('hello')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        first.release()
        await p
    })

    test('guard: a non-exp translation resolving after the cancel writes the fresh translation, with no duplicate', async () => {
        const char = makeCharacter('c-translate-nonexp-after-cancel')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInput: 'hello', messageInputTranslate: 'old-tr' })

        const translateGate = makeGate()
        translateMock.mockImplementationOnce(() => translateGate.gate.then(() => 'fresh-tr'))

        const { source } = makeSource()
        await updateInputTransateMessage(keyFor(char, chat), true)

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()
        const p = send(source)
        await first.reached

        abortChat()
        expect(draftFor(char, chat).messageInput).toBe('hello')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        translateGate.release()
        await new Promise((res) => setTimeout(res, 0))

        expect(draftFor(char, chat).messageInput).toBe('fresh-tr')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        first.release()
        await p
    })

    test('an exp-translator translation resolving during the wait is discarded, so cancelling puts back exactly the taken values with no duplicate', async () => {
        isExpTranslatorMock.mockReturnValue(true)
        const char = makeCharacter('c-translate-exp-cancel')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInput: 'hello', messageInputTranslate: 'old-tr' })

        const delay = interceptSleep(1500)
        const translateGate = makeGate()
        translateMock.mockImplementationOnce(() => translateGate.gate.then(() => 'fresh-tr'))

        const { source } = makeSource()
        const translatePromise = updateInputTransateMessage(keyFor(char, chat), true)
        await delay.reached
        delay.release()
        await translatePromise // the debounce has now issued the translate() call

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()
        const p = send(source)
        await first.reached

        translateGate.release()
        await new Promise((res) => setTimeout(res, 0))

        abortChat()

        expect(draftFor(char, chat).messageInput).toBe('hello')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        first.release()
        await p
    })

    test('guard: an exp-translator translation resolving after the cancel writes the fresh translation, with no duplicate', async () => {
        isExpTranslatorMock.mockReturnValue(true)
        const char = makeCharacter('c-translate-exp-after-cancel')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInput: 'hello', messageInputTranslate: 'old-tr' })

        const delay = interceptSleep(1500)
        const translateGate = makeGate()
        translateMock.mockImplementationOnce(() => translateGate.gate.then(() => 'fresh-tr'))

        const { source } = makeSource()
        const translatePromise = updateInputTransateMessage(keyFor(char, chat), true)
        await delay.reached
        delay.release()
        await translatePromise

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()
        const p = send(source)
        await first.reached

        abortChat()
        expect(draftFor(char, chat).messageInput).toBe('hello')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        translateGate.release()
        await new Promise((res) => setTimeout(res, 0))

        expect(draftFor(char, chat).messageInput).toBe('fresh-tr')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        first.release()
        await p
    })

    test('a forward translation into the translate field resolving during the wait is discarded, so cancelling puts back exactly the taken values with no duplicate', async () => {
        const char = makeCharacter('c-translate-forward-cancel')
        installDb([char], { useAutoTranslateInput: true })
        const chat = char.chats[0]
        seedDraft(char, chat, { messageInput: 'hello', messageInputTranslate: 'old-tr' })

        const translateGate = makeGate()
        translateMock.mockImplementationOnce(() => translateGate.gate.then(() => 'fresh-tr'))

        const { source } = makeSource()
        // Forward: messageInput is the source field, deriving into
        // messageInputTranslate; issues the translate() call, not yet resolved.
        await updateInputTransateMessage(keyFor(char, chat), false)

        const editinput = installEditinputQueue()
        const first = editinput.nextGate()
        const p = send(source)
        await first.reached

        translateGate.release()
        await new Promise((res) => setTimeout(res, 0))

        abortChat()

        expect(draftFor(char, chat).messageInput).toBe('hello')
        expect(draftFor(char, chat).messageInputTranslate).toBe('old-tr')

        first.release()
        await p
    })
})

describe('composerActions: no switch, the ordinary path', () => {
    test('guard: the message is appended, the composer empties, and generation runs once', async () => {
        const char = makeCharacter('c-ordinary')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        await send(source)

        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello'])
        expect(draftFor(char, char.chats[0]).messageInput).toBe('')
        expect(draftFor(char, char.chats[0]).fileInput).toEqual([])
        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(get(doingChatMock)).toBe(false)
    })
})

describe('composerActions: refused actions change nothing', () => {
    test('guard: a cold chat refuses the send and keeps the typed text', async () => {
        const char = makeCharacter('c-cold-chat')
        char.chats[0].message = [{ role: 'user', data: `${coldStorageHeader}pointer` } as unknown as Message]
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        await send(source)

        expect(char.chats[0].message.length).toBe(1)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('hello')
        expect(sendChatMock).not.toHaveBeenCalled()
    })

    test('guard: doingChat already set refuses the send and keeps the typed text', async () => {
        const char = makeCharacter('c-doingchat-set')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        doingChatMock.set(true)

        const { source } = makeSource()
        await send(source)

        expect(char.chats[0].message.length).toBe(0)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('hello')
        expect(sendChatMock).not.toHaveBeenCalled()
    })

    test('an open window still refuses a second Send from another source without touching its own fields', async () => {
        const char = makeCharacter('c-open-window')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'from-a' })
        const editinput = installEditinputQueue()
        const first = editinput.nextGate()

        const { source: sourceA } = makeSource()
        const sourceBHandle = makeSource()

        const p1 = send(sourceA)
        await first.reached

        // A's take already emptied the chat's record; this stands in for a
        // second composer instance (a remount) with its own text and staged
        // file, typed into the same chat while A's send is still in flight.
        seedDraft(char, char.chats[0], { messageInput: 'from-b', fileInput: ['b.png'] })

        const p2 = send(sourceBHandle.source)
        await p2

        expect(sourceBHandle.closeMenuCalls()).toBe(0)
        expect(draftFor(char, char.chats[0]).messageInput).toBe('from-b')
        expect(draftFor(char, char.chats[0]).fileInput).toEqual(['b.png'])

        first.release()
        await p1
    })
})

describe('composerActions: what a Send records for the reroll and step-back buttons', () => {
    test('a completed send records only the messages generation appended, not the user\'s own', async () => {
        const char = makeCharacter('c-reroll-snapshot')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            char.chats[char.chatPage].message.push(
                { role: 'char', data: 'reply-1', saying: 'speaker-a', time: Date.now() } as unknown as Message,
                { role: 'char', data: 'reply-2', saying: 'speaker-b', time: Date.now() } as unknown as Message,
            )
            doingChatMock.set(false)
            return true
        })

        const { source } = makeSource()
        await send(source)

        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello', 'reply-1', 'reply-2'])

        // The reroll regenerates both replies; a step back restores exactly
        // those two and leaves the user's own message alone.
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            char.chats[char.chatPage].message.push({ role: 'char', data: 'again', saying: 'speaker-a', time: Date.now() } as unknown as Message)
            doingChatMock.set(false)
            return true
        })
        await reroll(source)
        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello', 'again'])

        await unReroll(source)
        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello', 'reply-1', 'reply-2'])
        expect(char.chats[0].message.map((m) => m.role)).toEqual(['user', 'char', 'char'])
    })

    test('the stored replies are copies, so an edit to the reply on screen never changes another stored reply', async () => {
        const char = makeCharacter('c-reroll-detached')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const appendsReply = (text: string) => async () => {
            doingChatMock.set(true)
            char.chats[char.chatPage].message.push({ role: 'char', data: text, saying: 'speaker-a', time: Date.now() } as unknown as Message)
            doingChatMock.set(false)
            return true
        }
        sendChatMock.mockImplementationOnce(appendsReply('original'))
        const { source } = makeSource()
        await send(source)
        sendChatMock.mockImplementationOnce(appendsReply('second'))
        await reroll(source)
        const data = () => char.chats[0].message.map((m) => m.data)
        expect(data()).toEqual(['hello', 'second'])

        await unReroll(source)
        expect(data()).toEqual(['hello', 'original'])
        char.chats[0].message[1].data = 'original-edited'

        await reroll(source)
        expect(data()).toEqual(['hello', 'second'])
        char.chats[0].message[1].data = 'second-edited'

        await unReroll(source)
        expect(data()).toEqual(['hello', 'original-edited'])
        await reroll(source)
        expect(data()).toEqual(['hello', 'second-edited'])
    })

    test('guard: a send whose generation appends nothing leaves no stored reply to step back to', async () => {
        const char = makeCharacter('c-reroll-no-append')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        await send(source)

        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello'])

        await unReroll(source)
        expect(char.chats[0].message.map((m) => m.data)).toEqual(['hello'])
    })
})

//#region the origin handed to generation

/** What `sendChat` receives from a caller that holds an origin. */
interface HandOffArg extends SendChatArg {
    origin?: { chaId: string, chatId: string, memberChaId?: string }
    originHint?: { owner: character | groupChat, chat: Chat }
}

function handOffOf(callIndex = 0): HandOffArg {
    return sendChatMock.mock.calls[callIndex][1] as HandOffArg
}

function textMessage(role: 'user' | 'char', data: string): Message {
    return { role, data, time: Date.now() } as unknown as Message
}

/**
 * The sending character has two chats and a second character has one; the
 * chats a switch can land on hold four messages, more than the sending chat
 * holds, so a length read from the wrong chat cannot coincide with the right one.
 */
function installSwitchWorld() {
    const four = () => [1, 2, 3, 4].map((i) => textMessage('user', `other-${i}`))
    const origin = makeCharacter('c-origin', {
        chats: [
            makeChat('c-origin-chat-a'),
            makeChat('c-origin-chat-b', { message: four() }),
        ],
    })
    const other = makeCharacter('c-other', { chats: [makeChat('c-other-chat', { message: four() })] })
    installDb([origin, other])
    return { origin, other }
}

const screenSwitches: Array<[string, () => void]> = [
    ['to another chat of the same character', () => { DBState.db.characters[0].chatPage = 1 }],
    ['to another character', () => { selectedCharID.set(1) }],
    ['to Home', () => { selectedCharID.set(-1) }],
]

type SwitchTiming = 'between the take and the hand-off' | 'during generation'

const switchTimings: SwitchTiming[] = ['between the take and the hand-off', 'during generation']

/**
 * Sends "hello" from the sending chat, with the screen switched either while
 * the send waits between the take and the hand-off, or inside the generation
 * itself. The stand-in generation appends two replies to the sending chat.
 */
async function sendWithSwitch(timing: SwitchTiming, doSwitch: () => void) {
    const { origin, other } = installSwitchWorld()
    vi.mocked(alertError).mockClear()
    seedDraft(origin, origin.chats[0], { messageInput: 'hello' })
    sendChatMock.mockImplementationOnce(async () => {
        doingChatMock.set(true)
        origin.chats[0].message.push(
            { ...textMessage('char', 'reply-1'), saying: 'speaker-a' },
            { ...textMessage('char', 'reply-2'), saying: 'speaker-b' },
        )
        if (timing === 'during generation') {
            doSwitch()
        }
        doingChatMock.set(false)
        return true
    })
    const { source } = makeSource()
    let error: Error | undefined
    const capture = (e: unknown) => { error = e instanceof Error ? e : new Error(String(e)) }
    if (timing === 'between the take and the hand-off') {
        const delay = interceptSleep(10)
        const running = send(source).catch(capture)
        await delay.reached
        doSwitch()
        delay.release()
        await running
    } else {
        await send(source).catch(capture)
    }
    return { origin, other, source, error }
}

/** Puts the sending chat back on screen, as a user returning to it does. */
function showOriginChat() {
    DBState.db.characters[0].chatPage = 0
    selectedCharID.set(0)
}

/** The chats a switch lands on still hold exactly the four messages they started with. */
function expectSwitchTargetsUntouched(origin: character, other: character) {
    const four = [1, 2, 3, 4].map((i) => `other-${i}`)
    expect(origin.chats[1].message.map((m) => m.data)).toEqual(four)
    expect(other.chats[0].message.map((m) => m.data)).toEqual(four)
}

describe('composerActions: the origin handed to generation', () => {
    // A stand-in generation queued by one test must not reach the next.
    beforeEach(() => { sendChatMock.mockReset() })

    test.each([
        ['Send', false],
        ['Continue', true],
    ] as const)('%s hands generation the chat it started from and the objects it read it through', async (_label, isContinue) => {
        const char = makeCharacter('c-handoff')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        await (isContinue ? sendContinue(source) : send(source))

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        const arg = handOffOf()
        expect(arg.origin).toEqual({ chaId: 'c-handoff', chatId: 'c-handoff-chat-0' })
        expect(arg.originHint?.chat).toBe(DBState.db.characters[0].chats[0])
        expect(arg.originHint?.owner).toBe(DBState.db.characters[0])
    })

    test.each([
        ['Send', false],
        ['Continue', true],
    ] as const)('guard: %s hands generation its abort signal and its continue flag', async (_label, isContinue) => {
        const char = makeCharacter('c-handoff-guard')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })

        const { source } = makeSource()
        await (isContinue ? sendContinue(source) : send(source))

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(sendChatMock.mock.calls[0][0]).toBe(-1)
        expect(handOffOf().continue).toBe(isContinue)
        expect(handOffOf().signal).toBeInstanceOf(AbortSignal)
    })

    test('a reroll hands generation the chat it started from and the objects it read it through', async () => {
        const char = makeCharacter('c-reroll-handoff')
        char.chats[0].message = [textMessage('user', 'q'), textMessage('char', 'old reply')]
        installDb([char])

        const { source } = makeSource()
        await reroll(source)

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        const arg = handOffOf()
        expect(arg.origin).toEqual({ chaId: 'c-reroll-handoff', chatId: 'c-reroll-handoff-chat-0' })
        expect(arg.originHint?.chat).toBe(DBState.db.characters[0].chats[0])
        expect(arg.originHint?.owner).toBe(DBState.db.characters[0])
    })

    test('auto mode hands every tick the chat it started from and the objects it read it through', async () => {
        const char = makeCharacter('c-auto-handoff')
        installDb([char])
        const { source } = makeSource()
        sendChatMock
            .mockImplementationOnce(async () => { doingChatMock.set(true); doingChatMock.set(false); return true })
            .mockImplementationOnce(async () => { doingChatMock.set(true); void runAutoMode(source); doingChatMock.set(false); return true })

        await runAutoMode(source)

        expect(sendChatMock).toHaveBeenCalledTimes(2)
        for (const tick of [0, 1]) {
            const arg = handOffOf(tick)
            expect(arg.origin).toEqual({ chaId: 'c-auto-handoff', chatId: 'c-auto-handoff-chat-0' })
            expect(arg.originHint?.chat).toBe(DBState.db.characters[0].chats[0])
            expect(arg.originHint?.owner).toBe(DBState.db.characters[0])
        }
    })
})

describe('composerActions: the origin is registered as being written to for the whole generation', () => {
    // A stand-in generation queued by one test must not reach the next.
    beforeEach(() => { sendChatMock.mockReset() })

    test('guard: Send keeps its origin registered during generation and releases it afterwards', async () => {
        const char = makeCharacter('c-reg-send')
        installDb([char])
        seedDraft(char, char.chats[0], { messageInput: 'hello' })
        const target = { chaId: 'c-reg-send', chatId: 'c-reg-send-chat-0' }
        let during: boolean | undefined
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            during = isWriting(target)
            doingChatMock.set(false)
            return true
        })

        const { source } = makeSource()
        await send(source)

        expect(during).toBe(true)
        expect(isWriting(target)).toBe(false)
    })

    test('a reroll keeps its origin registered during generation and releases it afterwards', async () => {
        const char = makeCharacter('c-reg-reroll')
        char.chats[0].message = [textMessage('user', 'q'), textMessage('char', 'old reply')]
        installDb([char])
        const target = { chaId: 'c-reg-reroll', chatId: 'c-reg-reroll-chat-0' }
        let during: boolean | undefined
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            during = isWriting(target)
            doingChatMock.set(false)
            return true
        })

        const { source } = makeSource()
        await reroll(source)

        expect(during).toBe(true)
        expect(isWriting(target)).toBe(false)
    })

    test('auto mode keeps its origin registered during generation and releases it when it stops', async () => {
        const char = makeCharacter('c-reg-auto')
        installDb([char])
        const target = { chaId: 'c-reg-auto', chatId: 'c-reg-auto-chat-0' }
        const { source } = makeSource()
        let during: boolean | undefined
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            during = isWriting(target)
            void runAutoMode(source)
            doingChatMock.set(false)
            return true
        })

        await runAutoMode(source)

        expect(during).toBe(true)
        expect(isWriting(target)).toBe(false)
    })
})

describe('composerActions: a switch around a Send', () => {
    // A stand-in generation queued by one test must not reach the next.
    beforeEach(() => { sendChatMock.mockReset() })

    describe.each(switchTimings)('%s', (timing) => {
        test.each(screenSwitches)('generation is handed the chat the Send started from (a switch %s)', async (_label, doSwitch) => {
            const { origin } = await sendWithSwitch(timing, doSwitch)

            expect(sendChatMock).toHaveBeenCalledTimes(1)
            const arg = handOffOf()
            expect(arg.origin).toEqual({ chaId: 'c-origin', chatId: 'c-origin-chat-a' })
            expect(arg.originHint?.chat).toBe(origin.chats[0])
            expect(arg.originHint?.owner).toBe(origin)
        })

        test.each(screenSwitches)('no error is raised and a step back in the origin chat restores the origin chat\'s new messages, leaving the other chats alone (a switch %s)', async (_label, doSwitch) => {
            const { origin, other, source, error } = await sendWithSwitch(timing, doSwitch)

            expect(error).toBeUndefined()
            expect(alertError).not.toHaveBeenCalled()
            expect(origin.chats[0].message.map((m) => m.data)).toEqual(['hello', 'reply-1', 'reply-2'])
            expectSwitchTargetsUntouched(origin, other)

            // Back in the origin chat, a reroll replaces both replies and a
            // step back restores the ones the Send generated.
            showOriginChat()
            sendChatMock.mockImplementationOnce(async () => {
                doingChatMock.set(true)
                origin.chats[0].message.push({ ...textMessage('char', 'regenerated'), saying: 'speaker-a' })
                doingChatMock.set(false)
                return true
            })
            await reroll(source)
            expect(origin.chats[0].message.map((m) => m.data)).toEqual(['hello', 'regenerated'])

            await unReroll(source)
            expect(origin.chats[0].message.map((m) => m.data)).toEqual(['hello', 'reply-1', 'reply-2'])
            expectSwitchTargetsUntouched(origin, other)
        })
    })
})

describe('composerActions: a switch around a reroll and around auto mode', () => {
    // A stand-in generation queued by one test must not reach the next.
    beforeEach(() => { sendChatMock.mockReset() })

    test.each(screenSwitches)('a reroll followed by a switch %s keeps the new reply in the reroll\'s chat, where a step back restores the old reply, and raises no error', async (_label, doSwitch) => {
        const { origin, other } = installSwitchWorld()
        origin.chats[0].message = [textMessage('user', 'q'), textMessage('char', 'old reply')]
        vi.mocked(alertError).mockClear()
        sendChatMock.mockImplementationOnce(async () => {
            doingChatMock.set(true)
            origin.chats[0].message.push(textMessage('char', 'new reply'))
            doSwitch()
            doingChatMock.set(false)
            return true
        })

        const { source } = makeSource()
        let error: Error | undefined
        await reroll(source).catch((e: unknown) => { error = e instanceof Error ? e : new Error(String(e)) })

        expect(error).toBeUndefined()
        expect(alertError).not.toHaveBeenCalled()
        expect(origin.chats[0].message.map((m) => m.data)).toEqual(['q', 'new reply'])
        expectSwitchTargetsUntouched(origin, other)

        showOriginChat()
        await unReroll(source)
        expect(origin.chats[0].message.map((m) => m.data)).toEqual(['q', 'old reply'])
        expectSwitchTargetsUntouched(origin, other)
    })

    test('auto mode stops after a switch to another chat of the same character', async () => {
        const { origin } = installSwitchWorld()
        const { source } = makeSource()
        sendChatMock
            .mockImplementationOnce(async () => { doingChatMock.set(true); origin.chatPage = 1; doingChatMock.set(false); return true })
            .mockImplementationOnce(async () => { doingChatMock.set(true); doingChatMock.set(false); return true })
            .mockImplementationOnce(async () => { doingChatMock.set(true); void runAutoMode(source); doingChatMock.set(false); return true })

        await runAutoMode(source)

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(isAutoModeActive()).toBe(false)
        expect(isComposerBusy()).toBe(false)
    })

    test.each([
        ['to another character', () => { selectedCharID.set(1) }],
        ['to Home', () => { selectedCharID.set(-1) }],
    ] as const)('guard: auto mode stops after a switch %s', async (_label, doSwitch) => {
        installSwitchWorld()
        const { source } = makeSource()
        sendChatMock
            .mockImplementationOnce(async () => { doingChatMock.set(true); doSwitch(); doingChatMock.set(false); return true })
            .mockImplementationOnce(async () => { doingChatMock.set(true); doingChatMock.set(false); return true })
            .mockImplementationOnce(async () => { doingChatMock.set(true); void runAutoMode(source); doingChatMock.set(false); return true })

        await runAutoMode(source)

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(isAutoModeActive()).toBe(false)
    })
})

//#endregion

//#region helpers that must be declared after the mocked gate infrastructure above

function interceptSleep(ms: number) {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    interceptedSleeps.set(ms, { gate, markReached })
    return { release, reached }
}

//#endregion
