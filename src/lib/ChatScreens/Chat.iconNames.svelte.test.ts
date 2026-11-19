// @vitest-environment jsdom

/**
 * Accessible names of the icon-only controls of the REAL `Chat.svelte` row: copy, speaker, remove,
 * translate, edit, the "..." popup button, the sibling arrows, the end control, the first-message
 * reroll controls, the comment-row trash and the playground role swap.
 *
 * Invariants pinned here: every `button` in the row has a name that is not a bare count or empty
 * (the end control's visible count is not a name); each control carries the name of the action it
 * performs, with the forward arrow naming the new-reply action exactly when pressing it generates.
 *
 * Name rule used here: a non-empty `aria-label`, else visible text that is not digits only.
 */

import { flushSync, mount, unmount, type ComponentProps } from 'svelte'
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

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => ''),
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

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { treeView } from 'src/ts/process/chatTreeView'
import { changeLanguage, language } from 'src/lang'
import Chat from './Chat.svelte'

//#region fixtures

interface FixtureMessage {
    role: 'user' | 'char'
    data: string
    chatId: string
    time: number
}

interface FixtureAlt {
    m: FixtureMessage
    p: string | null
    a: number
}

interface FixtureChat {
    id: string
    message: FixtureMessage[]
    alt?: FixtureAlt[]
    bookmarks: string[]
    bookmarkNames: Record<string, string>
}

const message = (id: string, role: 'user' | 'char', time: number): FixtureMessage => ({ role, data: `data-${id}`, chatId: id, time })
const record = (id: string, role: 'user' | 'char', time: number, p: string | null, a = 1): FixtureAlt => ({ m: message(id, role, time), p, a })

function setup(path: FixtureMessage[], alt: FixtureAlt[] | undefined, db: Record<string, unknown> = {}, chaId = 'char-a'): FixtureChat {
    DBState.db = {
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
        useChatCopy: true,
        translator: 'google',
        swipe: true,
        showFirstMessagePages: true,
        enableBookmark: true,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        ...db,
    } as never
    const chat: FixtureChat = { id: 'chat-a', message: path, bookmarks: [], bookmarkNames: {} }
    if (alt) {
        chat.alt = alt
    }
    DBState.db.characters = [{ chaId, type: 'character', name: 'Original', image: '', ttsMode: 'webspeech', chatPage: 0, chats: [chat] }] as never
    selIdState.selId = 0
    return chat
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRow(chat: FixtureChat, idx: number, extra: Partial<ComponentProps<typeof Chat>> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chat, {
        target,
        props: {
            idx,
            message: chat.message[idx].data,
            isLastMemory: false,
            rerollIcon: 'dynamic',
            expectedId: chat.message[idx].chatId,
            onStep: vi.fn(),
            getTreeView: () => treeView(chat as never),
            ...extra,
        },
    }))
    flushSync()
    return target
}

/** The first button matching `selector`, and fails the test when none renders. */
function button(root: HTMLElement, selector: string): HTMLButtonElement {
    const found = root.querySelector<HTMLButtonElement>(selector)
    expect(found, `a button matching ${selector}`).not.toBeNull()
    return found!
}

/** A name is a non-empty `aria-label`, else visible text that is not a bare count. */
function nameOf(element: HTMLElement): string {
    const label = element.getAttribute('aria-label')?.trim() ?? ''
    if (label !== '') {
        return label
    }
    const text = element.textContent?.trim() ?? ''
    return /^\d*$/.test(text) ? '' : text
}

function expectEveryButtonNamed(root: HTMLElement): void {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.length).toBeGreaterThan(0)
    for (const candidate of buttons) {
        expect(nameOf(candidate), `the name of <button class="${candidate.className}">`).not.toBe('')
    }
}

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    changeLanguage('en')
    vi.clearAllMocks()
})

//#endregion

describe('the wide row', () => {
    test('copy, speaker, remove, translate, edit and the popup button are named', () => {
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined)
        const root = mountRow(chat, 1)
        expect(nameOf(button(root, '.button-icon-copy'))).toBe(language.copy)
        expect(nameOf(button(root, '.button-icon-tts'))).toBe(language.chatShellReadAloud)
        expect(nameOf(button(root, '.button-icon-remove'))).toBe(language.remove)
        expect(nameOf(button(root, '.button-icon-translate'))).toBe(language.translate)
        expect(nameOf(button(root, '.button-icon-edit'))).toBe(language.edit)
        expect(nameOf(button(root, '.button-icon-menu'))).toBe(language.chatShellMoreActions)
        expectEveryButtonNamed(root)
    })
})

describe('the narrow row', () => {
    test('the popup button, translate and edit are named', () => {
        window.innerWidth = 500
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined)
        const root = mountRow(chat, 1)
        expect(nameOf(button(root, '.button-icon-menu'))).toBe(language.chatShellMoreActions)
        expect(nameOf(button(root, '.button-icon-translate'))).toBe(language.translate)
        expect(nameOf(button(root, '.button-icon-edit'))).toBe(language.edit)
        expectEveryButtonNamed(root)
    })
})

describe('the tree controls', () => {
    /** u1, c2 (shown) with the earlier sibling c1 and two continuations x3 and x5 set aside after c2. */
    function endingChat(db: Record<string, unknown> = {}): FixtureChat {
        return setup(
            [message('u1', 'user', 1), message('c2', 'char', 3)],
            [record('c1', 'char', 2, 'u1'), record('x3', 'user', 4, 'c2'), record('x5', 'user', 5, 'c2', 2)],
            db,
        )
    }

    test('Swipe on, last row: back is the previous reply, forward is a new reply and the end control names its count', () => {
        const root = mountRow(endingChat(), 1)
        expect(nameOf(button(root, '.button-icon-unreroll'))).toBe(language.chatShellPreviousReply)
        const forward = button(root, '.button-icon-reroll')
        expect(forward.getAttribute('data-generates')).toBe('true')
        expect(nameOf(forward)).toBe(language.chatShellNewReply)
        const end = button(root, '.button-icon-end-control')
        expect(end.textContent?.trim()).toBe('2')
        expect(end.getAttribute('aria-label')).toBe(language.chatShellEndControl(2))
        expectEveryButtonNamed(root)
    })

    test('Swipe off, last row: back, the refresh forward arrow and the end control are named', () => {
        const root = mountRow(endingChat({ swipe: false }), 1)
        expect(nameOf(button(root, '.button-icon-unreroll'))).toBe(language.chatShellPreviousReply)
        expect(nameOf(button(root, '.button-icon-reroll'))).toBe(language.chatShellNewReply)
        const end = button(root, '.button-icon-end-control')
        expect(end.textContent?.trim()).toBe('')
        expect(end.getAttribute('aria-label')).toBe(language.chatShellEndControl(2))
        expectEveryButtonNamed(root)
    })

    test.each([[true], [false]])('Swipe %s, an earlier row with siblings: back is the previous reply and forward the next reply', (swipe) => {
        const chat = setup(
            [message('u1', 'user', 1), message('c2', 'char', 3), message('u3', 'user', 6)],
            [record('c1', 'char', 2, 'u1')],
            { swipe },
        )
        const root = mountRow(chat, 1)
        expect(nameOf(button(root, '.button-icon-unreroll'))).toBe(language.chatShellPreviousReply)
        expect(nameOf(button(root, '.button-icon-reroll'))).toBe(language.chatShellNextReply)
        expectEveryButtonNamed(root)
    })
})

describe('the first-message and legacy reroll controls', () => {
    const legacyProps = (): Partial<ComponentProps<typeof Chat>> => ({
        onStep: undefined,
        getTreeView: undefined,
        rerollIcon: true,
        onReroll: vi.fn(),
        unReroll: vi.fn(),
    })

    test('Swipe on: previous and next reply', () => {
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined)
        const root = mountRow(chat, 1, legacyProps())
        expect(nameOf(button(root, '.button-icon-unreroll'))).toBe(language.chatShellPreviousReply)
        expect(nameOf(button(root, '.button-icon-reroll'))).toBe(language.chatShellNextReply)
        expectEveryButtonNamed(root)
    })

    test('Swipe off: the single refresh button is Regenerate', () => {
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined, { swipe: false })
        const root = mountRow(chat, 1, legacyProps())
        expect(root.querySelector('.button-icon-unreroll')).toBeNull()
        expect(nameOf(button(root, '.button-icon-reroll'))).toBe(language.reroll)
        expectEveryButtonNamed(root)
    })
})

describe('the comment row and the playground', () => {
    test('the comment-row trash is named Remove', () => {
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined)
        const root = mountRow(chat, 1, { isComment: true })
        expect(nameOf(button(root, '.button-icon-remove'))).toBe(language.remove)
        expectEveryButtonNamed(root)
    })

    test('the playground role swap is named', () => {
        const chat = setup([message('u1', 'user', 1), message('c2', 'char', 3)], undefined, {}, '§playground')
        const root = mountRow(chat, 1)
        const swap = button(root, 'button:has(svg.lucide-arrow-left-right)')
        expect(nameOf(swap)).toBe('Switch between user and assistant')
        expectEveryButtonNamed(root)
    })
})
