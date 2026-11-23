// @vitest-environment node

/**
 * Stop-all is the per-chat Stop for every chat that shows Stop (MC-3790): the
 * notification Stop (`abortChat`) stops, in each chat that holds a reply, a
 * preview or an open composer window, exactly what that chat's own Stop stops,
 * and then sweeps every reply and preview registration. It drives the REAL
 * `composerActions.svelte.ts`, the real work registry and the real
 * `messageActions.svelte.ts` button-trigger run; `sendChat` is a gated stand-in
 * (the generation itself is out of scope), and a reply or preview of another
 * chat is a real registration with a stop spy.
 *
 * Tests titled `guard:` pin behaviour that must be preserved on the pre-change
 * base too; every other test is a regression reproducer for the rule it names.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import type { WorkHandle } from '../chatOrigin'
import { clearRunningSends } from './activeUnits.test-helpers'

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
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
        selIdState: { selId: 0 },
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
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
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

// `ms === 10` is the composer's own wait after it appends the message; a test parks it. Any other duration is a real timer.
const interceptedSleeps = vi.hoisted(() => new Map<number, { gate: Promise<void>, markReached: () => void }>())

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    capitalize: (s: string) => s,
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    sleep: vi.fn((ms: number) => {
        const intercepted = interceptedSleeps.get(ms)
        if (intercepted) {
            intercepted.markReached()
            return intercepted.gate
        }
        return new Promise<void>((res) => setTimeout(res, ms))
    }),
}) as unknown as typeof import('../../util'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => false),
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
    const live = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats: unknown[] }> } }
    const getCurrentCharacter = () => {
        live.db.characters ??= []
        return live.db.characters[get(stores.selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => live.db),
        setDatabase: vi.fn((d: unknown) => { live.db = d as never }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

const generationGateBox = vi.hoisted(() => ({ current: Promise.resolve() as Promise<void> }))
const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, _arg: SendChatArg) => {
    await generationGateBox.current
    return true
}))

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: sendChatMock,
}) as unknown as typeof import('../index.svelte'))

// The trigger engine runs for real, except while a test holds one run: `heldTrigger.current` then answers instead.
const heldTrigger = vi.hoisted(() => ({
    current: null as null | ((arg: { signal?: AbortSignal }) => Promise<unknown>),
}))

vi.mock(import('../triggers'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        runTrigger: vi.fn(async (...args: Parameters<typeof actual.runTrigger>) => {
            const held = heldTrigger.current
            if (held) {
                return held(args[2] as { signal?: AbortSignal })
            }
            return actual.runTrigger(...args)
        }),
    } as typeof actual
})

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('../../translator/translator'))

//#endregion

let send: typeof import('../composerActions.svelte').send
let runAutoMode: typeof import('../composerActions.svelte').runAutoMode
let abortChat: typeof import('../composerActions.svelte').abortChat
let isComposerBusy: typeof import('../composerActions.svelte').isComposerBusy
let isComposerLocked: typeof import('../composerActions.svelte').isComposerLocked
let isAutoModeActive: typeof import('../composerActions.svelte').isAutoModeActive
let resetComposerActionsForTests: typeof import('../composerActions.svelte').resetComposerActionsForTests
type ComposerActionsSource = import('../composerActions.svelte').ComposerActionsSource
let composerDraftsPeek: typeof import('../composerDrafts.svelte').peek
let composerDraftsWrite: typeof import('../composerDrafts.svelte').write
type ComposerDraftKey = import('../composerDrafts.svelte').ComposerDraftKey
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let registerWork: typeof import('../chatOrigin').registerWork
let hasAnyWork: typeof import('../chatOrigin').hasAnyWork
let composerWindowFor: typeof import('../generationOwnership.svelte').composerWindowFor
let handleButtonTriggerWithin: typeof import('../messageActions.svelte').handleButtonTriggerWithin
let onDraftsChanged: typeof import('../../localDrafts').onDraftsChanged
let resetLocalDraftsForTest: typeof import('../../localDrafts').resetLocalDraftsForTest

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const actions = await import('../composerActions.svelte')
    send = actions.send
    runAutoMode = actions.runAutoMode
    abortChat = actions.abortChat
    isComposerBusy = actions.isComposerBusy
    isComposerLocked = actions.isComposerLocked
    isAutoModeActive = actions.isAutoModeActive
    resetComposerActionsForTests = actions.resetComposerActionsForTests

    composerWindowFor = (await import('../generationOwnership.svelte')).composerWindowFor
    const drafts = await import('../composerDrafts.svelte')
    composerDraftsPeek = drafts.peek
    composerDraftsWrite = drafts.write

    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as never

    const origin = await import('../chatOrigin')
    registerWork = origin.registerWork
    hasAnyWork = origin.hasAnyWork

    handleButtonTriggerWithin = (await import('../messageActions.svelte')).handleButtonTriggerWithin

    const localDrafts = await import('../../localDrafts')
    onDraftsChanged = localDrafts.onDraftsChanged
    resetLocalDraftsForTest = localDrafts.resetLocalDraftsForTest
}, 120_000)

//#region fixtures

function makeChat(id: string): Chat {
    return { id, message: [] as unknown[], scriptstate: {}, note: '', localLore: [] as unknown[] } as unknown as Chat
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
        desc: `${chaId}-desc`,
        ...overrides,
    } as unknown as character
}

function installDb(characters: character[]): void {
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
    } as unknown as Database
    selectedCharID.set(0)
}

function keyOf(char: character): ComposerDraftKey {
    return { chaId: char.chaId, chatId: char.chats[0].id! }
}

function seedDraft(char: character, text: string): void {
    composerDraftsWrite(keyOf(char), (record) => { record.messageInput = text })
}

function draftOf(char: character): string {
    return composerDraftsPeek(keyOf(char)).messageInput
}

const source: ComposerActionsSource = { closeMenu: () => {} }

function makeLatch() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    return { gate, release, reached, markReached }
}

/** One `pluginV2.editinput` hook whose successive calls are gated one at a time, so a Send stalls inside its take. */
function installEditinputQueue() {
    let callIndex = 0
    const queue: Array<{ gate: Promise<void>, markReached: () => void }> = []
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
            const { gate, release, reached, markReached } = makeLatch()
            queue.push({ gate, markReached })
            return { release, reached }
        },
    }
}

function interceptSleep(ms: number) {
    const { gate, release, reached, markReached } = makeLatch()
    interceptedSleeps.set(ms, { gate, markReached })
    return { release, reached }
}

const handles: WorkHandle[] = []

/** A registration with a stop spy that ends its own handle, like a real unit's stop that makes the body return. */
function register(char: character, kind: 'reply' | 'preview' | 'work') {
    const stop = vi.fn<() => void>()
    const handle = registerWork(keyOf(char), () => { stop(); handle.end() }, kind)
    handles.push(handle)
    return stop
}

beforeEach(() => {
    pluginV2Mock.editinput.clear()
    interceptedSleeps.clear()
    sendChatMock.mockClear()
    clearRunningSends()
    generationGateBox.current = Promise.resolve()
    heldTrigger.current = null
    resetLocalDraftsForTest()
})

afterEach(() => {
    for (const handle of handles.splice(0)) {
        handle.end()
    }
    heldTrigger.current = null
    resetComposerActionsForTests()
})

//#endregion

describe('stop-all stops what each chat\'s own Stop stops', () => {
    test('B2: a work registration beside a reply in the same chat is stopped by the notification Stop', () => {
        const a = makeCharacter('c-b2')
        installDb([a])
        const replyStop = register(a, 'reply')
        const workStop = register(a, 'work')

        abortChat()

        expect(replyStop, 'the reply is stopped').toHaveBeenCalledTimes(1)
        expect(workStop, 'the work beside it is stopped once').toHaveBeenCalledTimes(1)
    })

    test('B2b: a button-trigger run beside a running reply in its chat is cut by the notification Stop', async () => {
        const a = makeCharacter('c-b2b')
        installDb([a])
        const runStarted = makeLatch()
        const runEnds = makeLatch()
        let runSignal: AbortSignal | undefined
        heldTrigger.current = async (arg) => {
            runSignal = arg.signal
            runStarted.markReached()
            await runEnds.gate
            return undefined
        }
        const replyStop = register(a, 'reply')
        const button = { getAttribute: (name: string) => (name === 'risu-trigger' ? 't1' : null) }
        const event = { target: { closest: () => button } } as unknown as UIEvent

        const running = handleButtonTriggerWithin(event, () => 0)
        await runStarted.reached
        abortChat()
        const aborted = runSignal?.aborted
        runEnds.release()
        await running

        expect(replyStop, 'the reply beside it is stopped').toHaveBeenCalledTimes(1)
        expect(aborted, 'the run\'s own signal is aborted').toBe(true)
    })

    test('guard B3: a work registration alone in a chat that shows no Stop is not stopped', () => {
        const a = makeCharacter('c-b3a')
        const b = makeCharacter('c-b3b')
        installDb([a, b])
        const aloneStop = register(a, 'work')
        const replyStop = register(b, 'reply')

        abortChat()

        expect(replyStop, 'the reply in the other chat is stopped').toHaveBeenCalledTimes(1)
        expect(aloneStop, 'the lone work is left alone').not.toHaveBeenCalled()
    })

    test('guard B1: a Send between its push and the hand-off is cut: its controller is aborted', async () => {
        const a = makeCharacter('c-b1')
        installDb([a])
        seedDraft(a, 'hello')
        const gap = interceptSleep(10)

        const running = send(source)
        await gap.reached
        abortChat()
        gap.release()
        await running

        for (const call of sendChatMock.mock.calls) {
            expect(call[1].signal?.aborted, 'a hand-off that happened carries an aborted signal').toBe(true)
        }
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
    })

    test('guard B4: a reply, a preview, a take and an auto run in four chats are all stopped and released', async () => {
        const [a, b, c, d] = ['c-b4a', 'c-b4b', 'c-b4c', 'c-b4d'].map((id) => makeCharacter(id))
        installDb([a, b, c, d])
        const replyStop = register(b, 'reply')
        const previewStop = register(d, 'preview')

        // Auto run in A: its tick is held on the generation gate.
        const tick = makeLatch()
        generationGateBox.current = tick.gate
        const auto = runAutoMode(source)
        await vi.waitFor(() => expect(sendChatMock).toHaveBeenCalledTimes(1))
        expect(isAutoModeActive()).toBe(true)

        // Take in C, stalled in its input hook.
        selectedCharID.set(2)
        seedDraft(c, 'text-c')
        const editinput = installEditinputQueue()
        const gateC = editinput.nextGate()
        const taking = send(source)
        await gateC.reached
        expect(draftOf(c)).toBe('')

        abortChat()

        expect(replyStop).toHaveBeenCalledTimes(1)
        expect(previewStop).toHaveBeenCalledTimes(1)
        expect(isAutoModeActive(), 'auto mode is off at once').toBe(false)
        expect(draftOf(c), 'the take is cancelled and its draft is back').toBe('text-c')
        expect(composerWindowFor(keyOf(c))).toBe(false)

        tick.release()
        gateC.release()
        await Promise.all([auto, taking])

        expect(composerWindowFor(keyOf(a)), 'the auto run\'s window closed').toBe(false)
        expect(isComposerBusy()).toBe(false)
        expect(isComposerLocked()).toBe(false)
        expect(hasAnyWork(), 'nothing is registered any more').toBe(false)
    })

    test('B5: a throw while one chat\'s take is cancelled does not keep the notification Stop from cancelling the other chat\'s take', async () => {
        const a = makeCharacter('c-b5a')
        const b = makeCharacter('c-b5b')
        installDb([a, b])
        seedDraft(a, 'text-a')
        seedDraft(b, 'text-b')
        const editinput = installEditinputQueue()
        const gateA = editinput.nextGate()
        const gateB = editinput.nextGate()
        selectedCharID.set(0)
        const takingA = send(source)
        await gateA.reached
        selectedCharID.set(1)
        const takingB = send(source)
        await gateB.reached
        expect(draftOf(b)).toBe('')
        vi.spyOn(console, 'error').mockImplementation(() => {})
        let armed = true
        onDraftsChanged(() => {
            if (armed) {
                armed = false
                throw new Error('listener throws once')
            }
        })

        let thrown: unknown = null
        try {
            abortChat()
        } catch (error) {
            thrown = error
        }
        const bDraft = draftOf(b)
        const bWindow = composerWindowFor(keyOf(b))
        gateA.release()
        gateB.release()
        await Promise.all([takingA, takingB])

        expect(thrown, 'abortChat does not throw').toBeNull()
        expect(bDraft, 'B\'s draft is back').toBe('text-b')
        expect(bWindow, 'B\'s window is closed').toBe(false)
    })
})
