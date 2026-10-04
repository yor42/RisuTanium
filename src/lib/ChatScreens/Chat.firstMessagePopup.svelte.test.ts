// @vitest-environment happy-dom

/**
 * The "..." popup menu of the REAL `Chat.svelte` for the first message (idx -1)
 * and for an ordinary message (idx 0), opened through the REAL `PopupButton`
 * and `PopupList`, in the wide layout (the popup holds the minor items) and the
 * narrow layout (the popup holds the major and the minor items).
 *
 * Invariants pinned here:
 *  - at idx -1 the popup offers no Bookmark, Branch, Disable or Disable-above,
 *    because each of them acts on the stored message at the index, which the
 *    first message is not;
 *  - at idx 0 the popup keeps all four;
 *  - at idx -1 the "..." button exists only when at least one item inside the
 *    popup would render, in both layouts.
 *
 * `navigator.clipboard` and `fetch` are recording stubs. A passing test says
 * nothing about a real browser's layout, clipboard or touch handling.
 */

import { flushSync, mount, unmount, untrack, type ComponentProps } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    const popupStore = $state({
        children: null as null | import('svelte').Snippet,
        mouseX: 0,
        mouseY: 0,
        openId: 0,
    })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore,
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

// `sleep` really waits: `PopupButton` and `PopupList` order their listeners with it.
vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
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

import { DBState, popupStore, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'

//#region fixtures and helpers

type ChatProps = ComponentProps<typeof Chat>

const WIDE = 1024
const NARROW = 500

function setupDb(ttsMode = 'none'): void {
    DBState.db = {
        askRemoval: false,
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
        characters: [{
            chaId: 'char-a',
            type: 'character',
            name: 'Original',
            image: '',
            ttsMode,
            chatPage: 0,
            chats: [{
                id: 'chat-a',
                message: [{ role: 'char', data: 'hello', chatId: 'id-1' }],
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
        }],
    } as never
    selIdState.selId = 0
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: ReturnType<typeof mount>[] = []
let listApp: ReturnType<typeof mount> | null = null
let stopListHost: (() => void) | null = null

async function mountChat(overrides: Partial<ChatProps> = {}): Promise<HTMLElement> {
    const root = document.createElement('div')
    const listTarget = document.createElement('div')
    document.body.append(root, listTarget)
    mountedTargets.push(root, listTarget)

    stopListHost = $effect.root(() => {
        $effect(() => {
            const open = popupStore.children !== null
            untrack(() => {
                if (open && listApp === null) {
                    listApp = mount(PopupList, { target: listTarget })
                } else if (!open && listApp !== null) {
                    void unmount(listApp)
                    listApp = null
                }
            })
        })
    })

    const props: ChatProps = $state({
        idx: -1,
        firstMessage: true,
        message: 'Welcome',
        isLastMemory: false,
        name: 'Ann',
        role: 'char',
        ...overrides,
    })
    mountedInstances.push(mount(Chat, { target: root, props }))
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return root
}

function menuButton(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>('.button-icon-menu')
}

/** Opens the popup and returns the text of each button inside it (the buttons outside `root`). */
async function openPopup(root: HTMLElement): Promise<string[]> {
    const button = menuButton(root)
    expect(button, 'the "..." menu button').not.toBeNull()
    button!.click()
    await new Promise((resolve) => setTimeout(resolve, 60))
    flushSync()
    expect(popupStore.children, 'the popup is open').not.toBeNull()
    return Array.from(document.querySelectorAll<HTMLElement>('button'))
        .filter((b) => !root.contains(b))
        .map((b) => (b.textContent ?? '').trim())
}

function hasItem(items: string[], label: string): boolean {
    return items.some((text) => text.includes(label))
}

const STORED_MESSAGE_ACTIONS = () => [language.bookmark, language.branch, language.disableMessage, language.disableAbove]

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

beforeEach(() => {
    window.innerWidth = WIDE
    setupDb()
    selectedCharID.set(0)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}), write: vi.fn(async () => {}) }, configurable: true })
})

afterEach(async () => {
    stopListHost?.()
    stopListHost = null
    if (listApp !== null) {
        void unmount(listApp)
        listApp = null
    }
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    popupStore.children = null
    popupStore.openId = 0
    vi.unstubAllGlobals()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
    vi.clearAllMocks()
})

//#endregion

describe.each([['wide', WIDE], ['narrow', NARROW]])('the popup in the %s layout', (_layout, width) => {
    test('regression reproducer: the first message offers none of the actions that act on the stored message', async () => {
        window.innerWidth = width
        const root = await mountChat()

        const items = await openPopup(root)

        for (const label of STORED_MESSAGE_ACTIONS()) {
            expect(hasItem(items, label), `no "${label}" item at idx -1`).toBe(false)
        }
        expect(hasItem(items, language.copyAsCard), 'the Copy as card item stays').toBe(true)
    })

    test('guard: an ordinary message keeps Bookmark, Branch, Disable and Disable-above', async () => {
        window.innerWidth = width
        const root = await mountChat({ idx: 0, firstMessage: false, message: 'hello' })

        const items = await openPopup(root)

        for (const label of STORED_MESSAGE_ACTIONS()) {
            expect(hasItem(items, label), `"${label}" item at idx 0`).toBe(true)
        }
    })

    test('regression reproducer: with useChatCopy off and no voice, the first message has no "..." button', async () => {
        window.innerWidth = width
        DBState.db.useChatCopy = false
        const root = await mountChat()

        expect(menuButton(root)).toBeNull()
    })

    test('regression reproducer: a blank first message has no "..." button', async () => {
        window.innerWidth = width
        const root = await mountChat({ message: '' })

        expect(menuButton(root)).toBeNull()
    })
})

describe('the narrow popup of the first message with the card item unavailable', () => {
    test('regression reproducer: it holds the speaker item and none of the stored-message actions', async () => {
        window.innerWidth = NARROW
        setupDb('webspeech')
        DBState.db.useChatCopy = false
        const root = await mountChat()

        const items = await openPopup(root)

        expect(items.some((text) => text.includes('TTS'))).toBe(true)
        for (const label of STORED_MESSAGE_ACTIONS()) {
            expect(hasItem(items, label), `no "${label}" item at idx -1`).toBe(false)
        }
    })
})

describe('the wide popup of the first message with the card item unavailable', () => {
    test('regression reproducer: without ClipboardItem the first message has no "..." button', async () => {
        window.innerWidth = WIDE
        vi.stubGlobal('ClipboardItem', undefined)
        const root = await mountChat()

        expect(menuButton(root)).toBeNull()
    })

    test('regression reproducer: the speaker button is outside the popup and the popup button is absent', async () => {
        window.innerWidth = WIDE
        setupDb('webspeech')
        DBState.db.useChatCopy = false
        const root = await mountChat()

        expect(root.querySelector('.button-icon-tts'), 'the speaker button').not.toBeNull()
        expect(menuButton(root)).toBeNull()
    })
})
