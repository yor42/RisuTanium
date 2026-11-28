// @vitest-environment jsdom

/**
 * The classic chat markers and the composer height wiring of the real `DefaultChatScreen.svelte` (message list
 * stand-in, as in `DefaultChatScreen.legacyWindow.svelte.test.ts`). The sheet rules that act on the markers are
 * read in `src/ts/gui/classicChatLayout.test.ts`.
 *
 * Labels: R = reproducer (the marker is absent on the base), G = guard that passes before and after.
 */
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    chatsProps: null as null | { loadPages: number, windowResetToken: number, hasNewUnreadMessage?: boolean },
    // The real Chats mounts its rows when set; otherwise the stand-in only exposes its props.
    realChats: false,
    textareaScrollHeight: 0,
}))

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([])
    const additionalFloatingActionButtons = $state([])
    const chatPanelStore = $state([])
    const easyPanelStore = $state({ open: false })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        settingsOpen: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
        PlaygroundStore: writable(0),
        createSimpleCharacter: vi.fn(() => null),
        hypaV3ModalOpen: writable(false),
        ScrollToMessageStore: scrollToMessage,
        additionalChatMenu,
        additionalFloatingActionButtons,
        easyPanelStore,
        chatPanelStore,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
        aiLawApplies: vi.fn(() => false),
        chatFoldedState,
        chatFoldedStateMessageIndex,
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        getFileSrc: vi.fn(async () => ''),
        saveAsset: vi.fn(async () => ''),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('src/ts/tokenizer'))

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

vi.mock(import('src/ts/util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    selectMultipleFile: vi.fn(),
    replacePlaceholders: vi.fn((s: string) => s),
    parseKeyValue: () => [],
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
    getInlayDraftPreview: vi.fn(async () => ({ kind: 'media', type: 'image', url: '' })),
    forgetInlayRender: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/files/multisend'), () => ({
    postChatFile: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/process/files/multisend'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
    stopTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    snapshotSubject: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: {
        editinput: new Set(),
        editoutput: new Set(),
        editdisplay: new Set(),
        editprocess: new Set(),
    },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const liveState = stores.DBState as unknown as { db: { characters?: Array<{ chats: unknown[], chatPage: number }> } }
    const getCurrentCharacter = () => {
        liveState.db.characters ??= []
        return liveState.db.characters[get(stores.selectedCharID)]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => liveState.db),
        setDatabase: vi.fn(),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(() => {
            const char = getCurrentCharacter()
            return char?.chats?.[char.chatPage]
        }),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const cold = await import('src/ts/process/coldstorageData')
    return {
        coldStorageHeader: cold.coldStorageHeader,
        preLoadChat: vi.fn(async () => 'ok'),
        retryLegacyColdChatLoad: vi.fn(async () => 'ok'),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    chatProcessStage: writable(0),
    sendChat: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('./Chats.svelte', async () => {
    const actual = await vi.importActual<{ default: (anchor: unknown, props: unknown) => unknown }>('./Chats.svelte')
    return {
        default: (anchor: unknown, props: { loadPages: number, windowResetToken: number, hasNewUnreadMessage?: boolean }) => {
            h.chatsProps = props
            return h.realChats ? actual.default(anchor, props) : { destroy: () => {} }
        },
    }
})
vi.mock('./Chat.svelte', () => ({
    default: (anchor: unknown, props: { idx?: number }) => {
        // A marker per mounted row, removed with the row's container.
        if (h.realChats && typeof props?.idx === 'number') {
            const marker = document.createElement('span')
            marker.setAttribute('data-row-idx', String(props.idx))
            ;(anchor as ChildNode).before(marker)
        }
        return { destroy: () => {} }
    },
}))
vi.mock('./Suggestion.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/MainMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../Playground/PlaygroundMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

import { language } from 'src/lang'
import { DBState, ScrollToMessageStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
import { registerDraft, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'

//#endregion

function installDb(messageCount: number) {
    DBState.db = {
        characters: [{
            chaId: 'cha-1',
            name: 'cha-1',
            type: 'character',
            chatPage: 0,
            chats: [{
                id: 'chat-1',
                message: Array.from({ length: messageCount }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `id${i}` })),
                scriptstate: {}, note: '', localLore: [],
            }],
            triggerscript: [],
            customscript: [],
            globalLore: [],
            desc: '',
            firstMessage: 'first message',
            alternateGreetings: [],
            largePortrait: false,
            removedQuotes: true,
            creatorNotes: '',
            image: '',
            ttsMode: 'none',
            additionalAssets: [],
        }],
        modules: [],
        templateDefaultVariables: '',
        personas: [{ name: 'User', largePortrait: false, icon: '' }],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        translator: '',
        username: 'User',
        newMessageButtonStyle: 'bottom-center',
        fixedChatTextarea: false,
        useChatSticker: false,
        hypaV3: false,
        hypav2: false,
        sideMenuRerollButton: false,
        showMenuChatList: false,
        showMenuHypaMemoryModal: false,
        enableRisuaiProTools: false,
        sendWithEnter: true,
        useAutoSuggestions: false,
        subModel: '',
        supaModelType: 'none',
        autoSuggestClean: false,
        personaPrompt: '',
    } as never
    selectedCharID.set(0)
}

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

async function showScreen(messageCount: number, initialPages?: number, props: Record<string, unknown> = {}): Promise<HTMLElement> {
    installDb(messageCount)
    if (initialPages !== undefined) {
        DBState.db.chatLoadInitialPages = initialPages
    }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props })
    mounted.push({ instance, target })
    flushSync()
    await tick()
    flushSync()
    return target
}

beforeEach(() => {
    h.chatsProps = null
    h.realChats = false
    h.textareaScrollHeight = 0
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => h.textareaScrollHeight })
    ScrollToMessageStore.value = -1
    chatFoldedStateMessageIndex.index = -1
    settingsOpen.set(false)
    resetLocalDraftsForTest()
    resetChatSurfaceForTests()
    installChatSurface()
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    chatFoldedStateMessageIndex.index = -1
    settingsOpen.set(false)
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
})

function listOf(root: HTMLElement): HTMLElement {
    const list = root.querySelector<HTMLElement>('.default-chat-screen')
    if (!list) {
        throw new Error('the chat list element was not rendered')
    }
    return list
}

function composerRowOf(root: HTMLElement): HTMLElement {
    const row = listOf(root).querySelector<HTMLElement>(':scope > [data-classic-composer]')
    if (!row) {
        throw new Error('the composer row was not rendered')
    }
    return row
}

describe('the composer row', () => {
    test('R T2d the composer row is the scroller first child and carries the composer marker', async () => {
        const root = await showScreen(4)
        expect(listOf(root).firstElementChild).toBe(composerRowOf(root))
    })

    test('G T2d the key-driven classes stay for pointer-fine layouts', async () => {
        const off = await showScreen(4)
        expect(composerRowOf(off).className).toContain('mt-2')
        expect(composerRowOf(off).className).not.toContain('sticky')
        const on = await showScreen(4)
        DBState.db.fixedChatTextarea = true
        flushSync()
        expect(composerRowOf(on).className).toContain('sticky')
        expect(composerRowOf(on).getAttribute('style')).toMatch(/z-index:\s*29/)
    })
})

describe('the touch markers', () => {
    test('R T6b every new-message button style carries the tap marker, and the top bar the pill marker', async () => {
        const styles = ['bottom-center', 'bottom-right', 'bottom-left', 'floating-circle', 'right-center', 'top-bar']
        for (const style of styles) {
            const root = await showScreen(4)
            DBState.db.newMessageButtonStyle = style
            h.chatsProps!.hasNewUnreadMessage = true
            flushSync()
            const pills = Array.from(root.querySelectorAll<HTMLElement>('button')).filter((b) => b.querySelector('svg.lucide-arrow-down'))
            expect(pills, style).toHaveLength(1)
            expect(pills[0].hasAttribute('data-classic-tap'), style).toBe(true)
            expect(pills[0].getAttribute('data-classic-pill'), style).toBe(style === 'top-bar' ? 'top' : null)
        }
    })

    test('R T6b an attachment remove button carries the tap marker', async () => {
        const root = await showScreen(4)
        composerDrafts.write({ chaId: 'cha-1', chatId: 'chat-1' }, (record) => { record.fileInput.push('a.png') })
        await tick()
        flushSync()
        const remove = root.querySelector<HTMLElement>(`button[aria-label="${language.chatShellRemoveAttachment}"]`)
        expect(remove).not.toBeNull()
        expect(remove!.hasAttribute('data-classic-tap')).toBe(true)
    })

    test('R T6b the side menu carries the menu marker', async () => {
        const root = await showScreen(4)
        root.querySelector('svg.lucide-menu')!.closest('button')!.click()
        flushSync()
        expect(root.querySelector('[data-classic-menu]')).not.toBeNull()
    })
})

describe('the composer height', () => {
    const observers: Array<{ cb: () => void, targets: Element[] }> = []
    let original: typeof ResizeObserver | undefined

    beforeEach(() => {
        original = globalThis.ResizeObserver
        observers.length = 0
        globalThis.ResizeObserver = class {
            entry = { cb: () => {}, targets: [] as Element[] }
            constructor(cb: () => void) {
                this.entry.cb = cb
                observers.push(this.entry)
            }
            observe(target: Element) { this.entry.targets.push(target) }
            unobserve() {}
            disconnect() { this.entry.targets.length = 0 }
        } as unknown as typeof ResizeObserver
    })

    afterEach(() => {
        globalThis.ResizeObserver = original as typeof ResizeObserver
    })

    async function openMenuOf(root: HTMLElement): Promise<HTMLElement> {
        root.querySelector('svg.lucide-menu')!.closest('button')!.click()
        flushSync()
        return root.querySelector<HTMLElement>('[data-classic-menu]')!
    }

    test('R the menu gets the measured composer height, tracks a change and keeps the fallback while unmeasured', async () => {
        const proto = HTMLElement.prototype
        let height = 0
        Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => height })
        try {
            const root = await showScreen(4)
            const unmeasured = await openMenuOf(root)
            expect(unmeasured.style.getPropertyValue('--classic-composer-h')).toBe('')

            height = 88
            for (const observer of observers) {
                observer.cb()
            }
            flushSync()
            expect(root.querySelector<HTMLElement>('[data-classic-menu]')!.style.getPropertyValue('--classic-composer-h')).toBe('88px')

            height = 120
            for (const observer of observers) {
                observer.cb()
            }
            flushSync()
            expect(root.querySelector<HTMLElement>('[data-classic-menu]')!.style.getPropertyValue('--classic-composer-h')).toBe('120px')
        } finally {
            delete (proto as { offsetHeight?: number }).offsetHeight
        }
    })
})
const toggle = createRawSnippet(() => ({ render: () => '<button data-stub-toggle>toggle</button>' }))

describe('the phone header', () => {
    test('R T1a the header sits before the scroller, outside it, with the toggle and a truncated name', async () => {
        const root = await showScreen(4, undefined, { phoneHeaderToggle: toggle })
        const header = root.querySelector<HTMLElement>('[data-classic-header]')
        expect(header).not.toBeNull()
        expect(header!.tagName).toBe('HEADER')
        const list = listOf(root)
        expect(list.contains(header)).toBe(false)
        expect(header!.parentElement).toBe(list.parentElement)
        expect(header!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(header!.querySelector('[data-stub-toggle]')).not.toBeNull()
        const name = header!.querySelector<HTMLElement>('.truncate')
        expect(name!.textContent).toBe('cha-1')
        expect(list.firstElementChild).toBe(composerRowOf(root))
    })

    test('G T1a without a toggle snippet the header still renders the name', async () => {
        const root = await showScreen(4)
        expect(root.querySelector('[data-classic-header] .truncate')!.textContent).toBe('cha-1')
    })
})

describe('the skip links', () => {
    function skipButtons(root: HTMLElement): HTMLButtonElement[] {
        return Array.from(root.firstElementChild!.children).slice(0, 2) as HTMLButtonElement[]
    }

    test('R T3a the two skip buttons come first and are screen-reader-only until focused', async () => {
        const root = await showScreen(4)
        const [toBox, toMessages] = skipButtons(root)
        expect(toBox.tagName).toBe('BUTTON')
        expect(toBox.textContent).toBe(language.classicChatSkipToMessageBox)
        expect(toMessages.textContent).toBe(language.classicChatSkipToMessages)
        for (const button of [toBox, toMessages]) {
            expect(button.type).toBe('button')
            expect(button.className).toContain('sr-only')
            expect(button.className).toContain('focus:not-sr-only')
        }
    })

    test('R T3a the message box skip focuses the composer textarea', async () => {
        const root = await showScreen(4)
        skipButtons(root)[0].click()
        expect(document.activeElement).toBe(root.querySelector('textarea'))
    })

    test('R T3b the messages skip focuses the labelled region without scrolling', async () => {
        h.realChats = true
        const root = await showScreen(4)
        const host = root.querySelector<HTMLElement>('[data-part="chat-messages"]')!
        expect(host.getAttribute('role')).toBe('region')
        expect(host.getAttribute('aria-label')).toBe(language.chatShellMessages)
        expect(host.getAttribute('tabindex')).toBe('-1')
        expect(host.hasAttribute('aria-live')).toBe(false)
        const focus = vi.spyOn(host, 'focus')
        skipButtons(root)[1].click()
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })
        expect(document.activeElement).toBe(host)
    })

    test('G T3c no skip buttons while the selected character is archived', async () => {
        const root = await showScreen(4)
        ;(DBState.db.characters[0] as { coldstorage?: string }).coldstorage = 'unit-archived'
        flushSync()
        expect(root.querySelector('[data-classic-header]')).not.toBeNull()
        expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === language.classicChatSkipToMessages)).toBe(false)
    })
})

describe('the empty state', () => {
    const emptyText = (root: HTMLElement) => root.textContent?.includes(language.classicChatEmpty) ?? false

    test('R T4a a group chat with no messages shows the empty text and hint', async () => {
        const root = await showScreen(0)
        ;(DBState.db.characters[0] as { type: string }).type = 'group'
        flushSync()
        expect(emptyText(root)).toBe(true)
        expect(root.textContent).toContain(language.classicChatEmptyHint)
    })

    test('R T4c a playground chat with no messages shows the empty text', async () => {
        const root = await showScreen(0)
        ;(DBState.db.characters[0] as { chaId: string }).chaId = '§playground'
        flushSync()
        expect(emptyText(root)).toBe(true)
    })

    test('G T4b a character with its greeting and no messages shows no empty text', async () => {
        const root = await showScreen(0)
        expect(emptyText(root)).toBe(false)
    })

    test('G T4b a group chat with a message shows no empty text', async () => {
        const root = await showScreen(1)
        ;(DBState.db.characters[0] as { type: string }).type = 'group'
        flushSync()
        expect(emptyText(root)).toBe(false)
    })
})
