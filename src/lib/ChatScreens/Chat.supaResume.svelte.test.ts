// @vitest-environment happy-dom

/**
 * Plain SupaMemory's resume pointer across the message-removal and branch controls of the REAL
 * `Chat.svelte`: trash (single and "this and every message after it"), shift-click "remove from here",
 * and branch.
 *
 * Invariants pinned here: `Chat.supaMemoryData` is `<resume chatId>\n<summary>`. A removal that takes
 * the message the pointer names leaves it on a surviving message with the summary unchanged (MC-714:
 * the next one in chat order; MC-715: nothing follows, so the last survivor plus a covered-ID field
 * naming it). A removal that empties the chat clears the data, plain or `hypa:`, and the covered-ID
 * field. A branch is a snapshot cut after the branch point: a pointer beyond it takes the MC-715 path
 * on the new chat, a pointer within the kept range is untouched, and the parent chat is untouched.
 *
 * Test kinds: "guard:" rows are compatibility guards that pass before and after (including the two
 * "cutting after the pointer" rows, branch (b) x2 and branch (d)); every other row is a regression
 * reproducer that fails without the repoint at its site. Prompt wording is never asserted.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getCurrentChat: vi.fn(() => null),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

interface PendingConfirm {
    message: string
    resolve: (answer: boolean) => void
}

interface PendingSelect {
    choices: string[]
    question: string | undefined
    resolve: (answer: string) => void
}

const prompts = vi.hoisted(() => ({
    confirms: [] as PendingConfirm[],
    selects: [] as PendingSelect[],
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn((message: string) => new Promise<boolean>((resolve) => {
        prompts.confirms.push({ message, resolve })
    })),
    alertSelect: vi.fn((choices: string[], question?: string) => new Promise<string>((resolve) => {
        prompts.selects.push({ choices, question, resolve })
    })),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

// Neither is exercised by the delete flow.
vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))


vi.mock(import('src/ts/tokenizer'), async (importOriginal) => ({
    ...(await importOriginal()),
    tokenize: async (text: string) => Math.ceil(text.length / 4),
}) as unknown as typeof import('src/ts/tokenizer'))
vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'success', result: 'SUMMARY' })),
}) as unknown as typeof import('src/ts/process/request/request'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        oaikey = ''
        vectors: unknown[] = []
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

//#endregion

import { DBState, popupStore, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import {
    installCharacterSaveMarks,
    resetCharacterSaveMarksForTest,
} from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { language } from 'src/lang'
import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'

//#region fixtures

interface FixtureMessage {
    role: string
    data: string
    chatId: string
}

interface FixtureChat {
    id: string
    message: FixtureMessage[]
    bookmarks: string[]
    bookmarkNames: Record<string, string>
}

interface FixtureCharacter {
    chaId: string
    type: string
    ttsMode: string
    chatPage: number
    chats: FixtureChat[]
}

function makeMessages(prefix: string, count: number): FixtureMessage[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'char',
        data: `${prefix}${i + 1}`,
        chatId: `id-${prefix}${i + 1}`,
    }))
}

function makeChat(id: string, message: FixtureMessage[], overrides: Partial<FixtureChat> = {}): FixtureChat {
    return { id, message, bookmarks: [], bookmarkNames: {}, ...overrides }
}

function makeCharacter(chaId: string, chats: FixtureChat[]): FixtureCharacter {
    return { chaId, type: 'character', ttsMode: 'none', chatPage: 0, chats }
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: true,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: '',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        ...overrides,
    }
}

/** The live (reactive) chat of the character at `charIndex`, read back through the database. */
function liveChat(charIndex = 0, chatIndex = 0): FixtureChat {
    return (DBState.db.characters as unknown as FixtureCharacter[])[charIndex].chats[chatIndex]
}

function dataOf(chat: FixtureChat): string[] {
    return chat.message.map((m) => m.data)
}

/** Installs the database: character `char-a` (selected) with five messages m1..m5, and optionally a second character `char-b` with b1..b5. */
function setupDb(options: { second?: boolean, db?: Record<string, unknown> } = {}): void {
    DBState.db = baseDb(options.db) as never
    const characters = [makeCharacter('char-a', [makeChat('chat-a', makeMessages('m', 5))])]
    if (options.second) {
        characters.push(makeCharacter('char-b', [makeChat('chat-b', makeMessages('b', 5))]))
    }
    DBState.db.characters = characters as never
    selIdState.selId = 0
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountChat(idx: number, message: string): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chat, { target, props: { idx, message, isLastMemory: false } }))
    flushSync()
    return target
}

function trashOf(root: HTMLElement): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>('.button-icon-remove')
    expect(button, 'the trash button').not.toBeNull()
    return button!
}

/** Lets every promise continuation that is ready run, then flushes the DOM. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    flushSync()
}

/** Clicks the trash of the message at `idx` and waits until the click has been handled. */
async function clickTrash(root: HTMLElement): Promise<void> {
    trashOf(root).click()
    await settle()
}

/** Answers the first confirm ("Remove this message?") and lets the removal run. */
async function answerFirstConfirm(answer: boolean): Promise<void> {
    expect(prompts.confirms.length, 'confirms asked').toBeGreaterThan(0)
    prompts.confirms.shift()!.resolve(answer)
    await settle()
}

/** What the user can choose on the question about the messages after the clicked one. */
type QuestionChoice = 'one' | 'fromHere' | 'cancel' | 'empty'

const QUESTION_ANSWER: Record<QuestionChoice, string> = {
    one: '0',
    cancel: '1',
    fromHere: '2',
    empty: '',
}

/** Asserts the question about the messages after the clicked one is up, answers it, and lets the removal run. */
async function answerQuestion(choice: QuestionChoice): Promise<void> {
    expect(prompts.selects.length, 'questions asked about the messages after the clicked one').toBe(1)
    prompts.selects.shift()!.resolve(QUESTION_ANSWER[choice])
    await settle()
}

/** Asserts the question about the messages after the clicked one is up, without answering it. */
async function expectQuestionUp(): Promise<void> {
    expect(prompts.selects.length, 'questions asked about the messages after the clicked one').toBe(1)
}

let tracker: toSaveType

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    prompts.confirms.length = 0
    prompts.selects.length = 0
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetCharacterSaveMarksForTest()
    vi.clearAllMocks()
})

//#endregion


//#region SupaMemory fixtures

const SUMMARY = 'old summary text'

interface SupaFields {
    supaMemoryData?: string
    supaMemoryCoveredId?: string
}

/** Installs one character with five messages (chatIds id-m1..id-m5) and the given SupaMemory fields. */
function setupSupa(fields: SupaFields, options: { count?: number, instantRemove?: boolean } = {}): void {
    setupDb({ db: { instantRemove: options.instantRemove ?? false } })
    const chat = liveChat() as FixtureChat & SupaFields
    chat.message = makeMessages('m', options.count ?? 5)
    Object.assign(chat, fields)
}

const supa = () => liveChat() as FixtureChat & SupaFields
const pointerOf = () => supa().supaMemoryData?.split('\n')[0]

/** Trash of the message at `idx`, confirm, and (when asked) the "this and following" choice. */
async function trashAndRemove(idx: number, choice?: QuestionChoice): Promise<void> {
    const root = mountChat(idx, `m${idx + 1}`)
    await clickTrash(root)
    await answerFirstConfirm(true)
    if (choice) {
        await answerQuestion(choice)
    }
}

async function shiftClickTrash(idx: number): Promise<void> {
    const root = mountChat(idx, `m${idx + 1}`)
    trashOf(root).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await settle()
}

//#endregion

describe('trash: removing the single message the pointer names', () => {
    test('with a message after it, the pointer moves to the next message and the summary is kept', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}` })
        await trashAndRemove(2)
        expect(dataOf(supa())).toEqual(['m1', 'm2', 'm4', 'm5'])
        expect(supa().supaMemoryData).toBe(`id-m4\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBeUndefined()
    })

    test('with none after it (MC-715), the last survivor becomes the pointer and the covered field names it', async () => {
        setupSupa({ supaMemoryData: `id-m5\n${SUMMARY}` })
        await trashAndRemove(4)
        expect(dataOf(supa())).toEqual(['m1', 'm2', 'm3', 'm4'])
        expect(supa().supaMemoryData).toBe(`id-m4\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBe('id-m4')
    })

    test('a removal that leaves the chat empty clears plain data and the covered field', async () => {
        setupSupa({ supaMemoryData: `id-m1\n${SUMMARY}`, supaMemoryCoveredId: 'id-m1' }, { count: 1 })
        await trashAndRemove(0)
        expect(supa().message.length).toBe(0)
        expect(supa().supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in supa()).toBe(false)
    })

    test('a removal that leaves the chat empty clears hypa: data', async () => {
        setupSupa({ supaMemoryData: `hypa:id-m1\n${SUMMARY}` }, { count: 1 })
        await trashAndRemove(0)
        expect(supa().supaMemoryData).toBe('')
    })

    test('guard: hypa: data in a non-empty chat is not repointed', async () => {
        setupSupa({ supaMemoryData: `hypa:id-m3\n${SUMMARY}` })
        await trashAndRemove(2)
        expect(supa().supaMemoryData).toBe(`hypa:id-m3\n${SUMMARY}`)
    })

    test('guard: empty data stays empty and gains no covered field', async () => {
        setupSupa({ supaMemoryData: '' })
        await trashAndRemove(2)
        expect(supa().supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in supa()).toBe(false)
    })

    test('guard: a surviving pointer is untouched', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}`, supaMemoryCoveredId: 'id-m3' })
        await trashAndRemove(3)
        expect(supa().supaMemoryData).toBe(`id-m3\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBe('id-m3')
    })
})

describe('trash: remove this message and every message after it', () => {
    test('cutting the pointer repoints at the last survivor (MC-715)', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}` }, { instantRemove: true })
        await trashAndRemove(2, 'fromHere')
        expect(dataOf(supa())).toEqual(['m1', 'm2'])
        expect(supa().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBe('id-m2')
    })

    test('guard: cutting after the pointer leaves the pointer untouched', async () => {
        setupSupa({ supaMemoryData: `id-m2\n${SUMMARY}` }, { instantRemove: true })
        await trashAndRemove(3, 'fromHere')
        expect(dataOf(supa())).toEqual(['m1', 'm2', 'm3'])
        expect(supa().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBeUndefined()
    })

    test('cutting the whole chat clears the data and the covered field', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}`, supaMemoryCoveredId: 'id-m3' }, { instantRemove: true })
        await trashAndRemove(0, 'fromHere')
        expect(supa().message.length).toBe(0)
        expect(supa().supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in supa()).toBe(false)
    })

    test('cutting the whole chat clears hypa: data', async () => {
        setupSupa({ supaMemoryData: `hypa:id-m3\n${SUMMARY}` }, { instantRemove: true })
        await trashAndRemove(0, 'fromHere')
        expect(supa().supaMemoryData).toBe('')
    })

    test('remove only this message through the question repoints like the single removal', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}` }, { instantRemove: true })
        await trashAndRemove(2, 'one')
        expect(supa().supaMemoryData).toBe(`id-m4\n${SUMMARY}`)
    })
})

describe('shift-click remove from here', () => {
    test('cutting the pointer repoints at the last survivor (MC-715)', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}` })
        await shiftClickTrash(2)
        expect(dataOf(supa())).toEqual(['m1', 'm2'])
        expect(supa().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
        expect(supa().supaMemoryCoveredId).toBe('id-m2')
    })

    test('guard: cutting after the pointer leaves it untouched', async () => {
        setupSupa({ supaMemoryData: `id-m2\n${SUMMARY}` })
        await shiftClickTrash(3)
        expect(dataOf(supa())).toEqual(['m1', 'm2', 'm3'])
        expect(supa().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
    })

    test('cutting the whole chat clears plain and hypa: data', async () => {
        setupSupa({ supaMemoryData: `id-m3\n${SUMMARY}`, supaMemoryCoveredId: 'id-m3' })
        await shiftClickTrash(0)
        expect(supa().message.length).toBe(0)
        expect(supa().supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in supa()).toBe(false)
        mountedTargets.splice(0).forEach((t) => t.remove())
        setupSupa({ supaMemoryData: `hypa:id-m3\n${SUMMARY}` })
        await shiftClickTrash(0)
        expect(supa().supaMemoryData).toBe('')
    })
})

describe('branch', () => {
    /** The branch button lives in the message's popup menu: open it, render the popup list, click the button. */
    async function branchAt(idx: number): Promise<void> {
        const root = mountChat(idx, `m${idx + 1}`)
        root.querySelector<HTMLButtonElement>('.button-icon-menu')!.click()
        await settle()
        expect(popupStore.children, 'the opened popup').not.toBeNull()
        const popupTarget = document.createElement('div')
        document.body.appendChild(popupTarget)
        mountedTargets.push(popupTarget)
        mountedInstances.push(mount(PopupList, { target: popupTarget, props: {} }))
        flushSync()
        const icon = popupTarget.querySelector('svg.lucide-split')
        expect(icon, 'the branch icon').not.toBeNull()
        icon!.closest('button')!.click()
        await settle()
    }

    const branched = () => (DBState.db.characters as unknown as FixtureCharacter[])[0].chats[0] as FixtureChat & SupaFields
    const parent = () => (DBState.db.characters as unknown as FixtureCharacter[])[0].chats[1] as FixtureChat & SupaFields

    test('(a) a pointer beyond the branch point becomes the branch point message with the covered field, overwriting an inherited value', async () => {
        setupSupa({ supaMemoryData: `id-m4\n${SUMMARY}`, supaMemoryCoveredId: 'id-m4' })
        await branchAt(1)
        expect(branched().message.length).toBe(3)
        expect(branched().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
        expect(branched().supaMemoryCoveredId).toBe('id-m2')
    })

    test('guard: (b) a pointer within the kept range is untouched and an inherited valid covered value stays valid', async () => {
        setupSupa({ supaMemoryData: `id-m1\n${SUMMARY}`, supaMemoryCoveredId: 'id-m1' })
        await branchAt(2)
        expect(branched().supaMemoryData).toBe(`id-m1\n${SUMMARY}`)
        expect(branched().supaMemoryCoveredId).toBe('id-m1')
    })

    test('guard: (b) a pointer at the branch point is untouched', async () => {
        setupSupa({ supaMemoryData: `id-m2\n${SUMMARY}` })
        await branchAt(1)
        expect(branched().supaMemoryData).toBe(`id-m2\n${SUMMARY}`)
        expect(branched().supaMemoryCoveredId).toBeUndefined()
    })

    test('(c) a send over the branched chat: no error, nothing re-summarised, the branch point is dropped from the prompt', async () => {
        const { supaMemory } = await import('src/ts/process/memory/supaMemory')
        const { writeSupaMemoryData } = await import('src/ts/process/memory/supaResume')
        setupSupa({ supaMemoryData: `id-m4\n${'S'.repeat(400)}` })
        await branchAt(1)
        const room = branched() as never
        expect(branched().message[2]).toMatchObject({ disabled: true, isComment: true })

        const sent = (id: string, tokens: number) => ({ role: 'user' as const, content: id.repeat(tokens), memo: id })
        const chats = [sent('id-m1', 60), sent('id-m2', 10)]
        const tokenizer = { tokenizeChat: async (chat: { content: string }) => chat.content.length } as never
        const { getDatabase } = await import('src/ts/storage/database.svelte')
        vi.mocked(getDatabase).mockImplementation(() => ({
            removePunctuationHypa: false,
            maxSupaChunkSize: 1200,
            supaModelType: 'subModel',
            supaMemoryPrompt: '',
            supaMemoryKey: '',
            hypaModel: 'MiniLM',
        }) as never)
        let result: Awaited<ReturnType<typeof supaMemory>>
        try {
            result = await supaMemory(chats, 70, 60, room, { name: 'C', type: 'character' } as never, tokenizer)
        } finally {
            vi.mocked(getDatabase).mockImplementation(() => {
                throw new Error('no live database in tests')
            })
        }

        expect(result.error).toBeUndefined()
        expect(result.chats.map((entry) => entry.memo)).toEqual(['supaMemory'])
        writeSupaMemoryData(room, result.memory)
        expect(pointerOfChat(branched())).toBe('id-m2')
        expect(branched().supaMemoryCoveredId).toBe('id-m2')
    })

    test('guard: (d) the parent chat is untouched', async () => {
        setupSupa({ supaMemoryData: `id-m4\n${SUMMARY}`, supaMemoryCoveredId: 'id-m4' })
        await branchAt(1)
        expect(parent().message.length).toBe(5)
        expect(parent().supaMemoryData).toBe(`id-m4\n${SUMMARY}`)
        expect(parent().supaMemoryCoveredId).toBe('id-m4')
    })

    test('guard: a chat without SupaMemory data branches without gaining any', async () => {
        setupSupa({ supaMemoryData: '' })
        await branchAt(1)
        expect(branched().supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in branched()).toBe(false)
    })
})

function pointerOfChat(chat: SupaFields): string | undefined {
    return chat.supaMemoryData?.split('\n')[0]
}
