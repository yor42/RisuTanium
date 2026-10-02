// @vitest-environment node

/**
 * Reroll history suite: drives the REAL `composerActions.svelte.ts`
 * (`send`/`reroll`/`unReroll`/`sendContinue`/`runAutoMode`) and the real
 * `prereroll.ts` against the real `$state` database. Only generation is a
 * stand-in: `sendChat` runs one scripted step against the chat that the
 * origin it was handed names, never against the chat on screen, and mirrors
 * the real module's id fill and `doingChat` handling.
 *
 * Every assertion is on observable chat state (the messages of a chat, their
 * roles and data, and a message's own keys). Nothing here reads the reroll
 * history's internals, so the tests say what a user sees after each step.
 * Tests whose title starts with `guard:` pass before and after the history is
 * kept per chat; they pin behaviour that must be preserved.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, groupChat, Chat, Database, Message } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import type { Origin } from '../chatOrigin'
import { alertError } from '../../alert'
import { language } from '../../../lang'
import { coldStorageHeader } from '../coldstorageData'
import { addRerolls } from '../prereroll'

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

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
    sleep: (ms: number) => new Promise<void>((res) => setTimeout(res, Math.min(ms, 5))),
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

// `doingChatMock` is a hand-rolled store: `vi.hoisted` runs before this file's
// own imports are initialized, so its callback cannot call an imported function.
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

// `steps` is the script: each generation shifts one step off the front and
// runs it against the chat its own origin names. A generation with no step
// left appends nothing and completes. `find` is installed with the database.
const gen = vi.hoisted(() => ({
    steps: [] as Array<(chat: Chat, arg: SendChatArg) => boolean | Promise<boolean>>,
    find: (_origin: { chaId: string, chatId: string }): Chat | null => null,
    idSeq: 0,
}))

const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, arg: SendChatArg) => {
    if (get(doingChatMock)) {
        return false
    }
    doingChatMock.set(true)
    try {
        const chat = gen.find(arg.origin as { chaId: string, chatId: string })
        if (chat) {
            // Generation start gives every message that lacks an id one.
            for (const message of chat.message) {
                message.chatId ??= `start-${++gen.idSeq}`
            }
        }
        const step = gen.steps.shift()
        if (!step || !chat) {
            return true
        }
        return await step(chat, arg)
    } finally {
        doingChatMock.set(false)
    }
}))

vi.mock(import('../index.svelte'), () => ({
    doingChat: doingChatMock,
    sendChat: sendChatMock,
}) as unknown as typeof import('../index.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('../../translator/translator'))

//#endregion

let send: typeof import('../composerActions.svelte').send
let sendContinue: typeof import('../composerActions.svelte').sendContinue
let reroll: typeof import('../composerActions.svelte').reroll
let unReroll: typeof import('../composerActions.svelte').unReroll
let runAutoMode: typeof import('../composerActions.svelte').runAutoMode
let abortChat: typeof import('../composerActions.svelte').abortChat
let resetComposerActionsForTests: typeof import('../composerActions.svelte').resetComposerActionsForTests
type ComposerActionsSource = import('../composerActions.svelte').ComposerActionsSource
let composerDraftsWrite: typeof import('../composerDrafts.svelte').write
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let resetLocalDraftsForTest: typeof import('../../localDrafts').resetLocalDraftsForTest

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
    resetComposerActionsForTests = actions.resetComposerActionsForTests

    composerDraftsWrite = (await import('../composerDrafts.svelte')).write

    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as never

    resetLocalDraftsForTest = (await import('../../localDrafts')).resetLocalDraftsForTest
})

beforeEach(() => {
    gen.steps = []
    sendChatMock.mockClear()
    vi.mocked(alertError).mockClear()
    doingChatMock.set(false)
    resetLocalDraftsForTest()
})

afterEach(() => {
    resetComposerActionsForTests()
})

//#region fixtures

/**
 * The one place a composer instance is built. A source carries no state that a
 * test reads; calling this again stands for a remounted composer.
 */
function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

// Characters, chats and generations get ids that no other test reuses, so the
// state that outlives one test (the reroll histories and the candidate map)
// never meets a later test's chats.
let worldSeq = 0
const unique = (label: string) => `${label}-${++worldSeq}`

type Row = readonly [Message['role'], string, string?]

function chatOf(label: string, rows: Row[], withIds = true): Chat {
    const id = unique(label)
    return {
        id,
        name: id,
        message: rows.map(([role, data, saying]) => {
            const message: Record<string, unknown> = { role, data }
            if (saying !== undefined) message.saying = saying
            if (withIds) message.chatId = `${id}/${data}`
            return message
        }),
        scriptstate: {},
        note: '',
        localLore: [],
    } as unknown as Chat
}

function charOf(label: string, chats: Chat[], type: 'character' | 'group' = 'character'): character | groupChat {
    return {
        chaId: unique(label),
        name: label,
        type,
        chatPage: 0,
        chats,
        characters: type === 'group' ? ['A', 'B'] : undefined,
        triggerscript: [],
        customscript: [],
        globalLore: [],
        desc: '',
    } as unknown as character | groupChat
}

function installWorld(characters: Array<character | groupChat>, selected = 0): void {
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
    selectedCharID.set(selected)
    gen.find = (origin) => {
        const owner = DBState.db.characters.find((c) => c.chaId === origin.chaId)
        return owner?.chats.find((c) => c.id === origin.chatId) ?? null
    }
}

const chatAt = (charIndex: number, chatIndex: number): Chat => DBState.db.characters[charIndex].chats[chatIndex]
const dataOf = (charIndex: number, chatIndex: number): string[] => chatAt(charIndex, chatIndex).message.map((m) => m.data)
const rolesOf = (charIndex: number, chatIndex: number): string[] => chatAt(charIndex, chatIndex).message.map((m) => m.role)
const originAt = (charIndex: number, chatIndex: number): Origin => ({ chaId: DBState.db.characters[charIndex].chaId, chatId: chatAt(charIndex, chatIndex).id! })
const snapshotOf = (charIndex: number, chatIndex: number): string => JSON.stringify(chatAt(charIndex, chatIndex).message)

/** Puts a character's chat on screen, as a chat switch, a character switch or Home does. */
function show(charIndex: number, chatIndex = 0): void {
    selectedCharID.set(charIndex)
    DBState.db.characters[charIndex].chatPage = chatIndex
}

function typeInto(charIndex: number, chatIndex: number, text: string): void {
    composerDraftsWrite(originAt(charIndex, chatIndex), (record) => { record.messageInput = text })
}

type Step = (chat: Chat, arg: SendChatArg) => boolean | Promise<boolean>

let messageSeq = 0

/** A step that appends char messages; a part written `who:text` is said by `who`. */
function say(...parts: string[]): Step {
    return (chat) => {
        for (const part of parts) {
            const colon = part.indexOf(':')
            const message: Message = { role: 'char', data: colon > 0 ? part.slice(colon + 1) : part, chatId: `out-${++messageSeq}` }
            if (colon > 0) message.saying = part.slice(0, colon)
            chat.message.push(message)
        }
        return true
    }
}

/** A step that appends a reply with several candidates, registered under the generation's own origin. */
function sayCandidates(genId: string, values: string[], saying?: string, memberChaId?: string): Step {
    return (chat, arg) => {
        const message: Message = { role: 'char', data: values[0], chatId: `out-${++messageSeq}`, generationInfo: { generationId: genId } }
        if (saying !== undefined) message.saying = saying
        chat.message.push(message)
        addRerollsFor(genId, values, memberChaId ? { ...arg.origin!, memberChaId } : arg.origin!)
        return true
    }
}

/** `addRerolls` takes the origin of the generation that produced the candidates. */
const addRerollsFor = addRerolls as (genId: string, values: string[], origin: Origin) => void

const then = (first: Step, after: (chat: Chat, arg: SendChatArg) => void): Step => async (chat, arg) => {
    const result = await first(chat, arg)
    after(chat, arg)
    return result
}

/** A request that ends without appending anything. */
const failsWithNothing: Step = () => false
/** A reply stopped part-way: it is on screen when the generation reports false. */
const stopsAfter = (...parts: string[]): Step => async (chat, arg) => { await say(...parts)(chat, arg); return false }
/** A generation that throws after it has appended. */
const throwsAfter = (...parts: string[]): Step => async (chat, arg) => { await say(...parts)(chat, arg); throw new Error('generation threw') }
/** What the inline-error setting appends: a char message with no id. */
const appendsInlineError: Step = (chat) => { chat.message.push({ role: 'char', data: 'ERR', time: 1 }); return false }

//#endregion

describe('reroll history: edits survive stepping', () => {
    test('an edit to the original reply survives a reroll and a step back', async () => {
        installWorld([charOf('edit-original', [chatOf('c', [])])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [say('R0')]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R0'])

        chatAt(0, 0).message[1].data = 'R0-EDITED'
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R0-EDITED'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R1'])
    })

    test('an edit to a rerolled reply survives a step back and forward', async () => {
        installWorld([charOf('edit-rerolled', [chatOf('c', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])

        chatAt(0, 0).message[1].data = 'R1-EDITED'
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1-EDITED'])
    })

    test('an edit to a multi-candidate reply survives stepping to the next candidate and back', async () => {
        installWorld([charOf('edit-candidate', [chatOf('c', [])])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(unique('gen'), ['c0', 'c1', 'c2'])]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])

        chatAt(0, 0).message[1].data = 'c0-EDITED'
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0-EDITED'])
    })

    test('an edit made before leaving a chat survives the round trip', async () => {
        installWorld([charOf('round-trip', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-last']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)
        chatAt(0, 0).message[1].data = 'A-R1-EDITED'

        show(0, 1)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last'])
        show(0, 0)

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1-EDITED'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
    })
})

describe('reroll history: a history belongs to its chat', () => {
    test('a step back in another chat of the same character changes nothing there, and still works in the rerolled chat', async () => {
        installWorld([charOf('same-character', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-last']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1'])

        show(0, 1)
        await unReroll(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last'])
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1'])

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
    })

    test('a reroll in a second chat of the same character keeps both chats\' histories apart', async () => {
        installWorld([charOf('two-histories', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-R0']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)
        show(0, 1)
        gen.steps = [say('B-R1')]
        await reroll(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-R1'])

        await unReroll(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-R0'])
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1'])

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-R0'])
    })

    test('a switch to another chat during generation leaves that chat untouched, and the generating chat keeps its history', async () => {
        installWorld([charOf('switch-during', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-last']]),
        ])])
        const source = makeSource()
        gen.steps = [then(say('A-R1'), () => show(0, 1))]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1'])
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last'])

        await unReroll(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last'])
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R1'])

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last'])
    })

    test('deleting a lower-index character does not hand its history to the character that moved into its index', async () => {
        installWorld([
            charOf('x', [chatOf('x1', [['user', 'x-u'], ['char', 'X-R0']])]),
            charOf('y', [chatOf('y1', [['user', 'y-u'], ['char', 'Y-R0']])]),
            charOf('z', [chatOf('z1', [['user', 'z-u'], ['char', 'Z-last']])]),
        ], 1)
        const source = makeSource()
        gen.steps = [say('Y-R1')]
        await reroll(source)
        expect(dataOf(1, 0)).toEqual(['y-u', 'Y-R1'])

        DBState.db.characters.splice(1, 1)
        selectedCharID.set(-1)
        selectedCharID.set(1)
        expect(dataOf(1, 0)).toEqual(['z-u', 'Z-last'])

        await unReroll(source)
        expect(dataOf(1, 0)).toEqual(['z-u', 'Z-last'])
        expect(rolesOf(1, 0)).toEqual(['user', 'char'])
    })

    test('a step back in a copy of a rerolled chat that carries the same message ids writes nothing into the copy', async () => {
        installWorld([charOf('same-ids', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        const copy = chatOf('b', [])
        copy.message = JSON.parse(JSON.stringify(chatAt(0, 0).message))
        DBState.db.characters[0].chats.push(copy)
        show(0, 1)
        const before = snapshotOf(0, 1)

        await unReroll(source)
        expect(snapshotOf(0, 1)).toBe(before)

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })

    test('a step back in an empty chat leaves the empty chat with no properties beyond its indices', async () => {
        installWorld([charOf('empty-target', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', []),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)

        show(0, 1)
        await unReroll(source)
        expect(dataOf(0, 1)).toEqual([])
        expect(Object.keys(chatAt(0, 1).message)).toEqual([])
        expect(chatAt(0, 1).message.length).toBe(0)
    })

    test('a history survives a remount of the composer', async () => {
        installWorld([charOf('remount', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        gen.steps = [say('R1')]
        await reroll(makeSource())
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])

        await unReroll(makeSource())
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])

        await reroll(makeSource())
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])
    })

    test('histories of five recent chats of one character coexist, and each steps back in its own chat', async () => {
        installWorld([charOf('five-chats', [1, 2, 3, 4, 5].map((i) => chatOf(`chat${i}`, [['user', `u${i}`], ['char', `R${i}`]])))])
        const source = makeSource()
        for (const i of [1, 2, 3, 4, 5]) {
            show(0, i - 1)
            gen.steps = [say(`X${i}`)]
            await reroll(source)
            expect(dataOf(0, i - 1)).toEqual([`u${i}`, `X${i}`])
        }
        for (const i of [5, 4, 3, 2, 1]) {
            show(0, i - 1)
            await unReroll(source)
            expect(dataOf(0, i - 1)).toEqual([`u${i}`, `R${i}`])
        }
    })

    test('a sixth chat drops the least recently used history, and a step back there writes nothing', async () => {
        installWorld([charOf('six-chats', [1, 2, 3, 4, 5, 6].map((i) => chatOf(`chat${i}`, [['user', `u${i}`], ['char', `R${i}`]])))])
        const source = makeSource()
        for (const i of [1, 2, 3, 4, 5, 6]) {
            show(0, i - 1)
            gen.steps = [say(`X${i}`)]
            await reroll(source)
            expect(dataOf(0, i - 1)).toEqual([`u${i}`, `X${i}`])
        }
        for (const i of [6, 5, 4, 3, 2]) {
            show(0, i - 1)
            await unReroll(source)
            expect(dataOf(0, i - 1)).toEqual([`u${i}`, `R${i}`])
        }
        show(0, 0)
        const before = snapshotOf(0, 0)
        await unReroll(source)
        expect(snapshotOf(0, 0)).toBe(before)
        expect(dataOf(0, 0)).toEqual(['u1', 'X1'])
    })

    test('the history dropped for a sixth chat is the least recently used one, not the oldest', async () => {
        installWorld([charOf('lru', [1, 2, 3, 4, 5, 6].map((i) => chatOf(`chat${i}`, [['user', `u${i}`], ['char', `R${i}`]])))])
        const source = makeSource()
        for (const i of [1, 2, 3, 4, 5]) {
            show(0, i - 1)
            gen.steps = [say(`X${i}`)]
            await reroll(source)
        }
        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u1', 'R1'])

        show(0, 5)
        gen.steps = [say('X6')]
        await reroll(source)
        expect(dataOf(0, 5)).toEqual(['u6', 'X6'])

        show(0, 1)
        const before = snapshotOf(0, 1)
        await unReroll(source)
        expect(snapshotOf(0, 1)).toBe(before)

        show(0, 0)
        gen.steps = []
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u1', 'X1'])

        show(0, 2)
        await unReroll(source)
        expect(dataOf(0, 2)).toEqual(['u3', 'R3'])
    })

    test('deleting a chat that has a history leaves every other chat\'s history working and gives no chat the deleted one', async () => {
        installWorld([charOf('delete-chat', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-R0']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)
        show(0, 1)
        gen.steps = [say('B-R1')]
        await reroll(source)

        DBState.db.characters[0].chats.splice(0, 1)
        show(0, 0)
        expect(dataOf(0, 0)).toEqual(['b-u0', 'B-R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['b-u0', 'B-R0'])

        DBState.db.characters[0].chats.push(chatOf('c', [['user', 'c-u0'], ['char', 'C-last']]))
        show(0, 1)
        await unReroll(source)
        expect(dataOf(0, 1)).toEqual(['c-u0', 'C-last'])
    })

    test('a Send in another chat leaves the history of the chat rerolled earlier working', async () => {
        installWorld([charOf('send-elsewhere', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-last']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)

        show(0, 1)
        typeInto(0, 1, 'hello')
        gen.steps = [say('B-S1')]
        await send(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last', 'hello', 'B-S1'])

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-last', 'hello', 'B-S1'])
    })

    test('a reroll in another chat leaves the history of the chat rerolled earlier working', async () => {
        installWorld([charOf('reroll-elsewhere', [
            chatOf('a', [['user', 'a-u0'], ['char', 'A-R0']]),
            chatOf('b', [['user', 'b-u0'], ['char', 'B-R0']]),
        ])])
        const source = makeSource()
        gen.steps = [say('A-R1')]
        await reroll(source)

        show(0, 1)
        gen.steps = [say('B-R1')]
        await reroll(source)
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-R1'])

        show(0, 0)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['a-u0', 'A-R0'])
        expect(dataOf(0, 1)).toEqual(['b-u0', 'B-R1'])
    })

    test('guard: a step back after a Send in the same chat restores nothing from before the Send', async () => {
        installWorld([charOf('send-clears', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])

        typeInto(0, 0, 'hello')
        gen.steps = [say('S1')]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1', 'hello', 'S1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1', 'hello', 'S1'])
    })

    test('guard: a Continue clears the history, so a step back after it writes nothing', async () => {
        installWorld([charOf('continue-clears', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])

        gen.steps = [(chat) => { chat.message[chat.message.length - 1].data = 'R1 and more'; return true }]
        await sendContinue(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1 and more'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1 and more'])
    })
})

describe('reroll history: the chat is checked before every move', () => {
    test('deleting the shown reply and then stepping back leaves the chat as it is', async () => {
        installWorld([charOf('delete-shown', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])

        chatAt(0, 0).message.splice(1, 1)
        expect(dataOf(0, 0)).toEqual(['u0'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0'])
        expect(rolesOf(0, 0)).toEqual(['user'])

        gen.steps = [say('R2')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R2'])
    })

    test('a /del of the shown reply and then a step back writes nothing', async () => {
        installWorld([charOf('del-command', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)

        chatAt(0, 0).message = chatAt(0, 0).message.slice(0, -1)
        expect(dataOf(0, 0)).toEqual(['u0'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0'])
        expect(rolesOf(0, 0)).toEqual(['user'])
    })

    test('auto mode ticks are never swapped for one another by a step back', async () => {
        installWorld([charOf('auto-ticks', [chatOf('a', [['user', 'u0'], ['char', 'c0']])])])
        const source = makeSource()
        gen.steps = [say('T1'), say('T2'), then(say('T3'), () => abortChat())]
        await runAutoMode(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'T1', 'T2', 'T3'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'T1', 'T2', 'T3'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'T1', 'T2', 'T3'])
    })

    test('a step back after an error message was removed and a user message added writes nothing', async () => {
        installWorld([charOf('error-then-send', [chatOf('a', [['user', 'u0'], ['char', 'R0', 'a']])])])
        const source = makeSource()
        gen.steps = [appendsInlineError]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'ERR'])

        const messages = chatAt(0, 0).message
        messages.splice(messages.length - 1, 1)
        messages.push({ role: 'user', data: 'hi' })
        const before = snapshotOf(0, 0)
        expect(dataOf(0, 0)).toEqual(['u0', 'hi'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'hi'])
        expect(rolesOf(0, 0)).toEqual(['user', 'user'])
        expect(snapshotOf(0, 0)).toBe(before)
    })

    test('an anchor message held twice makes a step back write nothing', async () => {
        installWorld([charOf('anchor-twice', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        const duplicate = JSON.parse(JSON.stringify(chatAt(0, 0).message[0]))
        chatAt(0, 0).message.splice(0, 0, duplicate)
        const before = snapshotOf(0, 0)

        await unReroll(source)
        expect(snapshotOf(0, 0)).toBe(before)
    })

    test('guard: a trim of the first message between rerolls leaves the step back working', async () => {
        installWorld([charOf('trim', [chatOf('a', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'R1'])

        chatAt(0, 0).message = chatAt(0, 0).message.slice(1)
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'c1'])
    })

    test('guard: an insert above the reply between rerolls leaves the step back working', async () => {
        installWorld([charOf('insert', [chatOf('a', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'R1'])

        chatAt(0, 0).message.splice(0, 0, { role: 'char', data: 'ins' })
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['ins', 'u0', 'c0', 'u1', 'c1'])
    })
})

describe('reroll history: a group chat regenerates more than one message', () => {
    test('each step back shows exactly one generation\'s messages after the unchanged start', async () => {
        installWorld([charOf('group', [chatOf('g', [['user', 'u'], ['char', 'A1', 'A'], ['char', 'B1', 'B'], ['char', 'A2', 'A']])], 'group')])
        const source = makeSource()
        gen.steps = [say('B:B1x', 'A:A2x')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'B1x', 'A2x'])

        gen.steps = [say('A:A1y')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'A1y'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'B1x', 'A2x'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'B1', 'A2'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'B1x', 'A2x'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u', 'A1', 'A1y'])
    })

    test('guard: a reply with several candidates in a group chat still steps through them', async () => {
        installWorld([charOf('group-candidates', [chatOf('g', [])], 'group')])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(unique('gen'), ['A1', 'A1b', 'A1c'], 'A', 'A')]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'A1'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'A1b'])
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'A1c'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'A1b'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'A1'])
    })
})

describe('reroll history: a delete while the reply is generated', () => {
    const fourMessages = () => installWorld([charOf('delete-during', [chatOf('d', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']])])])

    test('deleting an earlier message before the reply lands still records the reply, and a step back restores the old one', async () => {
        fourMessages()
        const source = makeSource()
        gen.steps = [(chat, arg) => { chat.message.splice(0, 1); return say('R1')(chat, arg) }]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'c1'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'R1'])
    })

    test('deleting an earlier message while two replies land records both of them', async () => {
        fourMessages()
        const source = makeSource()
        gen.steps = [(chat, arg) => { chat.message.splice(0, 1); return say('X1', 'X2')(chat, arg) }]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'X1', 'X2'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'c1'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['c0', 'u1', 'X1', 'X2'])
    })

    test('guard: deleting the message the reply answers before the reply lands makes a step back write nothing', async () => {
        fourMessages()
        const source = makeSource()
        gen.steps = [(chat, arg) => { chat.message.splice(chat.message.length - 1, 1); return say('R1')(chat, arg) }]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'R1'])

        const before = snapshotOf(0, 0)
        await unReroll(source)
        expect(snapshotOf(0, 0)).toBe(before)
    })

    test('guard: deleting the message the reply answers after the reply landed makes a step back write nothing', async () => {
        fourMessages()
        const source = makeSource()
        gen.steps = [then(say('R1'), (chat) => { chat.message.splice(2, 1) })]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'R1'])

        const before = snapshotOf(0, 0)
        await unReroll(source)
        expect(snapshotOf(0, 0)).toBe(before)
    })
})

describe('reroll history: a generation that does not complete', () => {
    test('guard: a reroll stopped mid-stream can be stepped back to the original reply', async () => {
        installWorld([charOf('stopped', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [stopsAfter('R1-partial')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1-partial'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })

    test('a reroll whose generation throws after appending can be stepped back to the original reply', async () => {
        installWorld([charOf('throws', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            gen.steps = [throwsAfter('R1-partial')]
            await reroll(source)
            expect(dataOf(0, 0)).toEqual(['u0', 'R1-partial'])

            await unReroll(source)
            expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
        } finally {
            errors.mockRestore()
        }
    })

    test('a reroll that appended nothing can be stepped back to the original reply', async () => {
        installWorld([charOf('nothing', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [failsWithNothing]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })

    test('guard: a failed reroll followed by a successful retry can be stepped back to the original reply', async () => {
        installWorld([charOf('retry', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [failsWithNothing, say('R2')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R2'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })

    test('guard: an inline error appended without an id can be stepped back to the original reply', async () => {
        installWorld([charOf('inline-error', [chatOf('a', [['user', 'u0'], ['char', 'R0', 'a']])])])
        const source = makeSource()
        gen.steps = [appendsInlineError]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'ERR'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })
})

describe('reroll history: messages without ids, as in an imported chat', () => {
    const importedFour = (): Chat => chatOf('imported', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']], false)

    test('guard: the first reroll of a chat without ids can be stepped back to the original reply', async () => {
        installWorld([charOf('no-ids-first', [importedFour()])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'c1'])
    })

    test('guard: a Send and a reroll in a chat without ids can be stepped back to the Send\'s reply', async () => {
        installWorld([charOf('no-ids-send', [chatOf('imported', [['user', 'u0'], ['char', 'c0']], false)])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [say('S1')]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'hello', 'S1'])

        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'hello', 'R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'hello', 'S1'])
    })

    test('guard: a refused step back writes no ids onto the messages of a chat that has none', async () => {
        installWorld([charOf('no-ids-refused', [importedFour()])])
        const source = makeSource()
        const before = snapshotOf(0, 0)
        await unReroll(source)
        expect(snapshotOf(0, 0)).toBe(before)
        expect(chatAt(0, 0).message.every((m) => !('chatId' in m))).toBe(true)
    })
})

describe('reroll history: candidates of a reply belong to the chat that generated them', () => {
    const gid = (label: string) => unique(`gen-${label}`)

    /** Chat A holds a generated multi-candidate reply; chat B of the same character holds a copy of it. */
    async function copiedChats(genId: string, source: ComposerActionsSource): Promise<void> {
        installWorld([charOf('copied', [chatOf('a', []), chatOf('b', [['user', 'hello'], ['char', 'c0']])])])
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(genId, ['c0', 'c1', 'c2'])]
        await send(source)
        chatAt(0, 1).message[1].generationInfo = { generationId: genId }
    }

    test('a reroll in a copy of the chat regenerates instead of stepping the original\'s candidates', async () => {
        const source = makeSource()
        await copiedChats(gid('copy'), source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])

        show(0, 1)
        gen.steps = [say('B-R1')]
        await reroll(source)
        expect(dataOf(0, 1)).toEqual(['hello', 'B-R1'])
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])

        show(0, 0)
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c2'])
    })

    test('an edit made in a copy of the chat never reaches the original\'s candidates', async () => {
        const source = makeSource()
        await copiedChats(gid('copy-edit'), source)

        show(0, 1)
        chatAt(0, 1).message[1].data = 'c0-IN-COPY'
        gen.steps = [say('B-R1')]
        await reroll(source)
        expect(dataOf(0, 1)).toEqual(['hello', 'B-R1'])
        await unReroll(source)
        expect(dataOf(0, 1)).toEqual(['hello', 'c0-IN-COPY'])

        show(0, 0)
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])
    })

    test('stepping past the last candidate and then back lands on the candidate before it', async () => {
        const genId = gid('past-end')
        installWorld([charOf('past-end', [chatOf('a', [['user', 'hello'], ['char', 'c0']])])])
        const source = makeSource()
        chatAt(0, 0).message[1].generationInfo = { generationId: genId }
        addRerollsFor(genId, ['c0', 'c1'], originAt(0, 0))
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])

        gen.steps = [say('R2')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R2'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])
    })

    test('guard: a step back at the first candidate and then a step forward shows the second candidate', async () => {
        installWorld([charOf('first-candidate', [chatOf('a', [])])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(gid('first-candidate'), ['c0', 'c1', 'c2'])]
        await send(source)

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
    })

    test('a step back from a single-candidate reply never overwrites the text now shown', async () => {
        installWorld([charOf('single', [chatOf('a', [])])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(gid('single'), ['c0'])]
        await send(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])

        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'R1'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])

        chatAt(0, 0).message[1].data = 'c0-EDITED'
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0-EDITED'])
    })

    test('guard: a multi-candidate reply steps forward and back through its candidates', async () => {
        installWorld([charOf('walk', [chatOf('a', [])])])
        const source = makeSource()
        typeInto(0, 0, 'hello')
        gen.steps = [sayCandidates(gid('walk'), ['c0', 'c1', 'c2'])]
        await send(source)

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c2'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c1'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['hello', 'c0'])
        expect(sendChatMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a chat with no stopping point still steps through the candidates of its last reply', async () => {
        const genId = gid('no-stop')
        installWorld([charOf('no-stop', [chatOf('a', [['char', 'c0']])])])
        const source = makeSource()
        chatAt(0, 0).message[0].generationInfo = { generationId: genId }
        addRerollsFor(genId, ['c0', 'c1'], originAt(0, 0))

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['c1'])
        expect(sendChatMock).not.toHaveBeenCalled()
    })
})

describe('reroll: refusals', () => {
    test('a reroll on a chat still loading from cold storage refuses with the Send message and does not throw', async () => {
        installWorld([charOf('cold-reroll', [chatOf('a', [['char', `${coldStorageHeader}pointer`]], false)])])
        const source = makeSource()
        const before = snapshotOf(0, 0)

        await expect(reroll(source)).resolves.toBeUndefined()
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageChatStillLoading)
        expect(sendChatMock).not.toHaveBeenCalled()
        expect(snapshotOf(0, 0)).toBe(before)
    })

    test('a step back on a chat still loading from cold storage refuses with the Send message and writes nothing', async () => {
        installWorld([charOf('cold-back', [chatOf('a', [['char', `${coldStorageHeader}pointer`]], false)])])
        const source = makeSource()
        const before = snapshotOf(0, 0)

        await expect(unReroll(source)).resolves.toBeUndefined()
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageChatStillLoading)
        expect(snapshotOf(0, 0)).toBe(before)
    })

    test('guard: a reroll on an empty chat does nothing and does not throw', async () => {
        installWorld([charOf('empty-reroll', [chatOf('a', [])])])
        const source = makeSource()

        await expect(reroll(source)).resolves.toBeUndefined()
        expect(dataOf(0, 0)).toEqual([])
        expect(sendChatMock).not.toHaveBeenCalled()
    })

    test('a reroll on a chat whose only message is a char message does nothing and does not throw', async () => {
        installWorld([charOf('lone-char', [chatOf('a', [['char', 'c0', 'a']])])])
        const source = makeSource()

        await expect(reroll(source)).resolves.toBeUndefined()
        expect(dataOf(0, 0)).toEqual(['c0'])
        expect(sendChatMock).not.toHaveBeenCalled()
    })

    test('a reroll on a group chat of distinct speakers and no user message does nothing and does not throw', async () => {
        installWorld([charOf('group-no-user', [chatOf('g', [['char', 'A1', 'A'], ['char', 'B1', 'B']])], 'group')])
        const source = makeSource()

        await expect(reroll(source)).resolves.toBeUndefined()
        expect(dataOf(0, 0)).toEqual(['A1', 'B1'])
        expect(sendChatMock).not.toHaveBeenCalled()
    })
})

describe('reroll: behaviour that stays', () => {
    test('guard: the first reroll of a chat can be stepped back and forward again', async () => {
        installWorld([charOf('first-reroll', [chatOf('a', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']])])])
        const source = makeSource()
        gen.steps = [say('R1')]
        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'R1'])

        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'c1'])

        await reroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'c0', 'u1', 'R1'])
    })

    test('guard: a reroll hands generation the chat cut back to the last user message', async () => {
        installWorld([charOf('pop-single', [chatOf('a', [['user', 'u0'], ['char', 'c0'], ['user', 'u1'], ['char', 'c1']])])])
        const source = makeSource()
        let seen: string[] = []
        gen.steps = [(chat, arg) => { seen = chat.message.map((m) => m.data); return say('R1')(chat, arg) }]
        await reroll(source)

        expect(seen).toEqual(['u0', 'c0', 'u1'])
    })

    test('guard: a reroll in a group chat hands generation the chat cut back to the previous turn of the last speaker', async () => {
        installWorld([charOf('pop-group', [chatOf('g', [['user', 'u'], ['char', 'A1', 'A'], ['char', 'B1', 'B'], ['char', 'A2', 'A']])], 'group')])
        const source = makeSource()
        let seen: string[] = []
        gen.steps = [(chat, arg) => { seen = chat.message.map((m) => m.data); return say('B:B1x', 'A:A2x')(chat, arg) }]
        await reroll(source)

        expect(seen).toEqual(['u', 'A1'])
    })

    test('guard: a reroll and a step back are refused while a reroll is generating', async () => {
        installWorld([charOf('window', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const source = makeSource()
        gen.steps = [async (chat, arg) => {
            await reroll(source)
            await unReroll(source)
            return say('R1')(chat, arg)
        }]
        await reroll(source)

        expect(sendChatMock).toHaveBeenCalledTimes(1)
        expect(dataOf(0, 0)).toEqual(['u0', 'R1'])
        await unReroll(source)
        expect(dataOf(0, 0)).toEqual(['u0', 'R0'])
    })

    test('guard: a menu close that throws leaves the chat and its reply in place', async () => {
        installWorld([charOf('menu-throws', [chatOf('a', [['user', 'u0'], ['char', 'R0']])])])
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        let threw = false
        try {
            await reroll({ closeMenu: () => { throw new Error('menu') } })
        } catch {
            threw = true
        } finally {
            errors.mockRestore()
        }

        expect({ threw, data: dataOf(0, 0), calls: sendChatMock.mock.calls.length }).toEqual({ threw: true, data: ['u0', 'R0'], calls: 0 })
    })
})
