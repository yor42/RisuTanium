// @vitest-environment jsdom

/**
 * UI-sound hooks of the composer (#246 S1b): the send cue of `sendMain` and the reply, failure and chime decision of
 * `sendChatMain`. The real composer, reply notice and facade run against the fake Web Audio of `uiSound.testKit.ts`, which
 * is installed before any of them is imported; every assertion counts what the fake was told to start.
 *
 * The module mocks below are the ones of `composerActions.svelte.test.ts`, which this suite shares its fixtures with.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import { installFakeAudio, warmUiSounds, type FakeAudio } from '../../uiSound/uiSound.testKit'

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
let sendChatMain: typeof import('../composerActions.svelte').sendChatMain
let resetComposerActionsForTests: typeof import('../composerActions.svelte').resetComposerActionsForTests
type ComposerActionsSource = import('../composerActions.svelte').ComposerActionsSource
let composerDraftsWrite: typeof import('../composerDrafts.svelte').write
let announceReply: typeof import('../replyNotice').announceReply
let toastHostModule: typeof import('../../toast/toastHost.svelte')
let ToastHostView: typeof import('../../../lib/Nexus/pattern/ToastHost.svelte').default
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let resetLocalDraftsForTest: typeof import('../../localDrafts').resetLocalDraftsForTest
let audio: FakeAudio

beforeAll(async () => {
    // The fake Web Audio is in place before the module under test, the reply notice and the facade are imported.
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    const actions = await import('../composerActions.svelte')
    send = actions.send
    sendContinue = actions.sendContinue
    sendChatMain = actions.sendChatMain
    resetComposerActionsForTests = actions.resetComposerActionsForTests
    composerDraftsWrite = (await import('../composerDrafts.svelte')).write
    announceReply = (await import('../replyNotice')).announceReply
    toastHostModule = await import('../../toast/toastHost.svelte')
    ToastHostView = (await import('../../../lib/Nexus/pattern/ToastHost.svelte')).default
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    resetLocalDraftsForTest = (await import('../../localDrafts')).resetLocalDraftsForTest
})

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

//#region fixtures

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

function makeGroup(chaId: string): groupChat {
    return { chaId, name: chaId, type: 'group', chatPage: 0, chats: [makeChat(`${chaId}-chat-0`)] } as unknown as groupChat
}

function installDb(characters: (character | groupChat)[], overrides: Record<string, unknown> = {}) {
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

function seedDraft(owner: { chaId: string }, chat: { id?: string }, messageInput: string): void {
    composerDraftsWrite({ chaId: owner.chaId, chatId: chat.id! }, (record) => { record.messageInput = messageInput })
}

function makeSource(refuses = false): ComposerActionsSource {
    return { closeMenu: () => {}, refuseGeneration: () => refuses }
}

function targetOf(char: character) {
    const chat = char.chats[0]
    return { origin: { chaId: char.chaId, chatId: chat.id! }, originHint: { owner: char, chat } }
}

const cueOf = (url: string): string => url.match(/\/(?:scifi|studio)\/([\w-]+)\.mp3$/)?.[1] ?? url
const cues = (): string[] => audio.startedUrls().map(cueOf)
const count = (cue: string): number => cues().filter((entry) => entry === cue).length

const plays = { count: 0 }

beforeEach(async () => {
    localStorage.clear()
    audio.endVoices()
    audio.started.length = 0
    // The player debounces the same cue by the clock; each test starts well past the last one.
    vi.advanceTimersByTime(10000)
    await warmUiSounds()
    processMultiCommandMock.mockReset()
    processMultiCommandMock.mockImplementation(async () => false)
    sendChatMock.mockReset()
    sendChatMock.mockImplementation(async () => true)
    doingChatMock.set(false)
    resetLocalDraftsForTest()
    plays.count = 0
    // The suite runs without Audio; the existing chime goes through it.
    Object.defineProperty(globalThis, 'Audio', {
        configurable: true,
        writable: true,
        value: class {
            play(): Promise<void> {
                plays.count += 1
                return Promise.resolve()
            }
        },
    })
})

afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Audio')
    resetComposerActionsForTests()
})

//#endregion

describe('T1 the send cue of sendMain', () => {
    test('reproducer (T1): a typed send plays one send cue', async () => {
        const char = makeCharacter('c-send-typed')
        installDb([char])
        seedDraft(char, char.chats[0], 'hello')

        await send(makeSource())

        expect(count('send')).toBe(1)
    })

    test('reproducer (T1): a say-nothing send that pushes plays one send cue', async () => {
        const char = makeCharacter('c-send-saynothing', {
            chats: [makeChat('c-send-saynothing-chat-0', { message: [{ role: 'user', data: 'hi', time: 1 }, { role: 'char', data: 'reply', time: 2 }] })],
        })
        installDb([char], { useSayNothing: true })

        await send(makeSource())

        expect(DBState.db.characters[0].chats[0].message.map((message: { data: string }) => message.data)).toEqual(['hi', 'reply', '*says nothing*'])
        expect(count('send')).toBe(1)
    })

    test('reproducer (T1): the send cue of a group message', async () => {
        const group = makeGroup('g-send-typed')
        installDb([group])
        seedDraft(group, group.chats[0], 'hello group')

        await send(makeSource())

        expect(count('send')).toBe(1)
    })
})

describe('T2 no send cue where no user message landed (guards)', () => {
    test('a handled slash command plays no send cue', async () => {
        const char = makeCharacter('c-send-command')
        installDb([char])
        seedDraft(char, char.chats[0], '/cut 0')
        processMultiCommandMock.mockImplementationOnce(async () => 'done')

        await send(makeSource())

        expect(count('send')).toBe(0)
    })

    test('a refused generation plays no send cue', async () => {
        const char = makeCharacter('c-send-refused')
        installDb([char])
        seedDraft(char, char.chats[0], 'hello')

        await send(makeSource(true))

        expect(count('send')).toBe(0)
    })

    test('an empty send with say-nothing off pushes nothing and plays no send cue, yet still gets its reply cue', async () => {
        const char = makeCharacter('c-send-empty-off')
        installDb([char], { useSayNothing: false })

        await send(makeSource())

        expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
        expect(count('send')).toBe(0)
        expect(count('receive')).toBe(1)
    })

    test('an empty send in a group chat pushes nothing and plays no send cue', async () => {
        const group = makeGroup('g-send-empty')
        installDb([group], { useSayNothing: true })

        await send(makeSource())

        expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
        expect(count('send')).toBe(0)
    })

    test('a say-nothing send whose last message is already the user\'s pushes nothing and plays no send cue', async () => {
        const char = makeCharacter('c-send-saynothing-dup', {
            chats: [makeChat('c-send-saynothing-dup-chat-0', { message: [{ role: 'user', data: 'earlier', time: 1 }] })],
        })
        installDb([char], { useSayNothing: true })

        await send(makeSource())

        expect(DBState.db.characters[0].chats[0].message).toHaveLength(1)
        expect(count('send')).toBe(0)
    })

    test('Continue appends nothing and plays no send cue', async () => {
        const char = makeCharacter('c-send-continue', {
            chats: [makeChat('c-send-continue-chat-0', { message: [{ role: 'user', data: 'hi', time: 1 }, { role: 'char', data: 'reply', time: 2 }] })],
        })
        installDb([char])

        await sendContinue(makeSource())

        expect(count('send')).toBe(0)
    })
})

describe('T3-T8 the reply cue of sendChatMain', () => {
    test('reproducer (T3): a completed reply with playMessage off plays one receive cue', async () => {
        const char = makeCharacter('c-reply-receive')
        installDb([char], { playMessage: false })

        await sendChatMain(targetOf(char))

        expect(cues()).toEqual(['receive'])
        expect(plays.count).toBe(0)
    })

    test('guard (T4): with playMessage on the chime sounds and no receive cue does', async () => {
        const char = makeCharacter('c-reply-chime')
        installDb([char], { playMessage: true })

        await sendChatMain(targetOf(char))

        expect(plays.count).toBe(1)
        expect(count('receive')).toBe(0)
    })

    test('guard (T5): a reply the notice already sounded adds neither a chime nor a receive cue', async () => {
        const char = makeCharacter('c-reply-announced')
        installDb([char], { playMessage: false })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'reply' }, arg.signal)
            return true
        })

        await sendChatMain(targetOf(char))

        expect(count('receive')).toBe(0)
        expect(plays.count).toBeLessThanOrEqual(1)
    })

    test('guard (T5): a reply native announced adds no chime and no receive cue', async () => {
        const char = makeCharacter('c-reply-native')
        installDb([char], { playMessage: true })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply(null, arg.signal, true)
            return true
        })

        await sendChatMain(targetOf(char))

        expect(count('receive')).toBe(0)
        expect(plays.count).toBe(0)
    })

    test('reproducer (T6): a failed reply plays one error cue, no chime and no receive cue', async () => {
        const char = makeCharacter('c-reply-failed')
        installDb([char], { playMessage: true })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'failed', dialogRaised: true }, arg.signal)
            return false
        })

        await sendChatMain(targetOf(char))

        expect(cues()).toEqual(['error'])
        expect(plays.count).toBe(0)
    })

    test('reproducer (T6): a send that threw plays one error cue, no chime and no receive cue', async () => {
        const char = makeCharacter('c-reply-threw')
        installDb([char], { playMessage: true })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        sendChatMock.mockImplementationOnce(async () => { throw new Error('the send broke') })

        await sendChatMain(targetOf(char))

        logged.mockRestore()
        expect(cues()).toEqual(['error'])
        expect(plays.count).toBe(0)
    })

    test('guard (T8, MC-1204): a stopped reply plays nothing', async () => {
        const char = makeCharacter('c-reply-stopped')
        installDb([char], { playMessage: true })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'stopped' }, arg.signal)
            return false
        })

        await sendChatMain(targetOf(char))

        expect(audio.started).toEqual([])
        expect(plays.count).toBe(0)
    })

    test('guard (T8, MC-1204): an aborted controller plays nothing', async () => {
        const char = makeCharacter('c-reply-aborted')
        installDb([char], { playMessage: false })
        sendChatMock.mockImplementationOnce(async () => false)
        const controller = new AbortController()
        controller.abort()

        await sendChatMain(targetOf(char), false, controller)

        expect(audio.started).toEqual([])
        expect(plays.count).toBe(0)
    })

    test('guard (MC-3790): a reply stopped by the notification Stop is silenced and plays no chime and no receive cue', async () => {
        const { registerWork } = await import('../chatOrigin')
        const { abortChat } = await import('../composerActions.svelte')
        const { hasSilencedFor, replySoundFor } = await import('../replyNotice')
        const char = makeCharacter('c-reply-stop-all')
        installDb([char], { playMessage: true })
        const origin = { chaId: char.chaId, chatId: char.chats[0].id! }
        let seenSignal: AbortSignal | undefined
        let markStarted: () => void = () => {}
        const started = new Promise<void>((res) => { markStarted = res })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            seenSignal = arg.signal
            let markStopped: () => void = () => {}
            const stopped = new Promise<void>((res) => { markStopped = res })
            const handle = registerWork(origin, () => { markStopped() }, 'reply')
            markStarted()
            await stopped
            handle.end()
            announceReply({ origin, outcome: 'stopped' }, arg.signal)
            return false
        })

        const running = sendChatMain(targetOf(char))
        await started
        abortChat()
        await running

        expect(hasSilencedFor(seenSignal)).toBe(true)
        expect(replySoundFor({
            completed: true, threw: false, aborted: false, failed: false, silenced: hasSilencedFor(seenSignal), chimed: false, playMessage: true,
        })).toBeNull()
        expect(audio.started).toEqual([])
        expect(plays.count).toBe(0)
    })

    test('a refused or unfinished send that is not a failure plays no receive cue', async () => {
        const char = makeCharacter('c-reply-none')
        installDb([char], { playMessage: false })
        sendChatMock.mockImplementationOnce(async () => false)

        await sendChatMain(targetOf(char))

        expect(audio.started).toEqual([])
    })
})

describe('T7 the notice toasts of an off-screen reply are silent', () => {
    // The app-wide view installs the toast sink, as it does in the app.
    let app: ReturnType<typeof mount> | null = null

    beforeEach(() => {
        toastHostModule.resetToastHostForTests()
        const target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ToastHostView, { target, props: {} })
        flushSync()
    })

    afterEach(() => {
        if (app) unmount(app)
        app = null
        toastHostModule.setToastSoundSink(null)
        toastHostModule.resetToastHostForTests()
    })

    test('reproducer (T7): an off-screen failure shows its error toast and sounds exactly one error cue', async () => {
        const char = makeCharacter('c-offscreen-failed')
        installDb([char], { playMessage: true })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'failed', dialogRaised: false }, arg.signal)
            return false
        })

        // The player drops a same cue repeated within its debounce, so the toast's own cue is watched at the sink as well.
        const toastCues: string[] = []
        toastHostModule.setToastSoundSink((cue) => { toastCues.push(cue) })

        await sendChatMain(targetOf(char))

        expect(toastHostModule.toastHost.visible.map((toast) => toast.kind)).toEqual(['error'])
        expect(toastCues).toEqual([])
        expect(cues()).toEqual(['error'])
    })

    test('guard (T5): an off-screen reply shows its info toast and sounds no cue of the toast', async () => {
        const char = makeCharacter('c-offscreen-reply')
        installDb([char], { playMessage: false })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'reply' }, arg.signal)
            return true
        })

        await sendChatMain(targetOf(char))

        expect(toastHostModule.toastHost.visible.map((toast) => toast.kind)).toEqual(['info'])
        expect(audio.started).toEqual([])
    })

    test('guard (T8): an off-screen stop shows its warning toast and sounds nothing', async () => {
        const char = makeCharacter('c-offscreen-stopped')
        installDb([char], { playMessage: false })
        sendChatMock.mockImplementationOnce(async (_index: number, arg: SendChatArg) => {
            announceReply({ origin: { chaId: char.chaId, chatId: char.chats[0].id! }, outcome: 'stopped' }, arg.signal)
            return false
        })

        await sendChatMain(targetOf(char))

        expect(toastHostModule.toastHost.visible.map((toast) => toast.kind)).toEqual(['warning'])
        expect(audio.started).toEqual([])
    })
})

describe('T17 the switch off silences every composer cue (guard, passes before and after)', () => {
    test('send and receive play nothing with the switch off', async () => {
        localStorage.setItem('risutanium.uiSounds', '0')
        const char = makeCharacter('c-switch-off')
        installDb([char])
        seedDraft(char, char.chats[0], 'hello')

        await send(makeSource())

        expect(audio.started).toEqual([])
    })
})
