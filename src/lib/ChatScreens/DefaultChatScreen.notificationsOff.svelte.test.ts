// @vitest-environment jsdom

/**
 * The notification-permission notice (DD-009) inside the real legacy DefaultChatScreen: it is a sibling
 * of the input row in the flex-col-reverse container, so it sits directly above the composer; it shows in
 * the chat that consumed it and is gone when that instance leaves (Home destroys the composer branch, a
 * chat switch remounts the notice through the key block). The mock set comes from
 * `DefaultChatScreen.chatPanel.svelte.test.ts`; the notice, its module and the key policy are real.
 * A passing test says nothing about the native permission prompt.
 *
 * Every "absent after" assertion first asserts that the notice WAS shown. The result hook is called
 * through `?.`, so on a base without the hook a test fails on its assertion and not on a TypeError.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([] as any[])
    const additionalFloatingActionButtons = $state([] as any[])
    const chatPanelStore = $state([] as any[])
    const easyPanelStore = $state({ open: false })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
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
    const chatFoldedState = $state<{ data: null | { targetCharacterId: string, targetChatId: string, targetMessageId: string } }>({ data: null })
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
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
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

vi.mock(import('src/ts/process/index.svelte'), () => {
    const doingChat = writable(false)
    return {
        doingChat,
        chatProcessStage: writable(0),
        sendChat: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/index.svelte')
})

// The bound props the legacy screen hands its message list, captured so a test can raise the
// new-message flag from outside any effect. The stand-in renders the list's real root shape (a
// flex-col-reverse div whose first child is the latest message) in front of its anchor.
const chatsProps = vi.hoisted(() => ({ current: null as null | { hasNewUnreadMessage?: boolean } }))
vi.mock('./Chats.svelte', () => ({
    default: (anchor: Comment, props: { hasNewUnreadMessage?: boolean }) => {
        chatsProps.current = props
        const root = document.createElement('div')
        root.className = 'flex flex-col-reverse'
        root.setAttribute('data-part', 'chat-messages')
        root.appendChild(document.createElement('div'))
        anchor.parentNode?.insertBefore(root, anchor)
        return { destroy: () => {} }
    },
}))
vi.mock('./Chat.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./Suggestion.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/MainMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/Home/HomeShell.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../Playground/PlaygroundMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import * as replyNotificationsModule from 'src/ts/android/replyNotifications.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'

const NOTICE = '[data-part="notifications-off-notice"]'

function installDb(fixedChatTextarea = false) {
    const character = {
        chaId: 'cha-1',
        name: 'cha-1',
        type: 'character',
        chatPage: 0,
        chats: [
            { id: 'chat-1', message: [], scriptstate: {}, note: '', localLore: [] },
            { id: 'chat-2', message: [], scriptstate: {}, note: '', localLore: [] },
        ],
        triggerscript: [],
        customscript: [],
        globalLore: [],
        desc: '',
        firstMessage: 'greeting',
        alternateGreetings: [],
        largePortrait: false,
        removedQuotes: true,
        creatorNotes: '',
        image: '',
        ttsMode: 'none',
        additionalAssets: [],
    }
    DBState.db = {
        characters: [character],
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
        fixedChatTextarea,
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

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

async function show(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    await settle()
    return target
}

/** The host's push and the keep-alive result, as MainActivity sends them; both go through `?.`. */
async function deny(): Promise<void> {
    window.__risuTaniumReplyNotificationsState?.('{"optedIn":false,"enabled":false,"appNotifications":false}')
    window.__risuTaniumNotificationPermissionResult?.(false)
    await settle()
}

beforeEach(() => {
    replyNotificationsModule.resetNotificationsOffNoticeForTests?.()
    replyNotificationsModule.installReplyNotifications()
    chatsProps.current = null
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    delete window.__risuTaniumReplyNotificationsState
    delete window.__risuTaniumNotificationPermissionResult
})

describe('the notice in the legacy chat screen', () => {
    test('P9: a denial shows the notice as the next sibling of the input row, above the composer', async () => {
        installDb()
        const target = await show()
        await deny()
        const notice = target.querySelector<HTMLElement>(NOTICE)
        expect(notice).not.toBeNull()
        expect(notice?.getAttribute('role')).toBe('status')
        const container = notice?.parentElement
        expect(container?.classList.contains('flex-col-reverse')).toBe(true)
        // The input row is the first DOM child of the reversed container; the notice follows it.
        expect(container?.children[1]).toBe(notice)
        expect(container?.children[0]?.querySelector('textarea.text-input-area')).not.toBeNull()
    })

    test('P9a: a denial that arrived before the screen mounted is shown on mount', async () => {
        installDb()
        await deny()
        const target = await show()
        expect(target.querySelector(NOTICE)).not.toBeNull()
    })

    test('P9b: going Home drops it, and reopening the chat shows nothing', async () => {
        installDb()
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        selectedCharID.set(-1)
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
        selectedCharID.set(0)
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
        expect(replyNotificationsModule.notificationsOff.phase).toBe('consumed')
    })

    test('P9c: switching chat shows it nowhere else, and returning to the first chat shows nothing', async () => {
        installDb()
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        DBState.db.characters[0].chatPage = 1
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
        DBState.db.characters[0].chatPage = 0
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
    })

    test('an allowed push removes it', async () => {
        installDb()
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":false,"enabled":true,"appNotifications":true}')
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
    })
})

describe('the scroll handler beside the notice (E2 diagnostic)', () => {
    /** The new-message button that the bottom-center style renders while the flag is raised. */
    const newMessageButton = (target: HTMLElement) => target.querySelector('button.absolute.bottom-16')

    async function raiseFlagAndScroll(target: HTMLElement, lastElementTop: number): Promise<void> {
        const container = target.querySelector<HTMLElement>('.flex-col-reverse.default-chat-screen')!
        const inputRow = container.children[0] as HTMLElement
        const lastEl = inputRow.firstElementChild as HTMLElement
        container.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 300, width: 300, height: 500, x: 0, y: 0, toJSON: () => ({}) })
        lastEl.getBoundingClientRect = () => ({ top: lastElementTop, bottom: lastElementTop + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: lastElementTop, toJSON: () => ({}) })
        expect(chatsProps.current).not.toBeNull()
        chatsProps.current!.hasNewUnreadMessage = true
        await settle()
        expect(newMessageButton(target)).not.toBeNull()
        container.dispatchEvent(new Event('scroll'))
        await settle()
    }

    test.each([false, true])('the new-message button clears at the bottom and stays away from it, notice shown: %s', async (withNotice) => {
        installDb(false)
        const target = await show()
        if (withNotice) {
            await deny()
            expect(target.querySelector(NOTICE)).not.toBeNull()
        } else {
            expect(target.querySelector(NOTICE)).toBeNull()
        }

        await raiseFlagAndScroll(target, 1000)
        expect(newMessageButton(target)).not.toBeNull()

        await raiseFlagAndScroll(target, 0)
        expect(newMessageButton(target)).toBeNull()
    })

    /** Scrolls with the given tops for the notice's first element, the message list's latest row and the input row's first element. */
    async function scrollWithTops(target: HTMLElement, tops: { notice: number | null, message: number, input: number }): Promise<void> {
        const rect = (top: number) => () => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) })
        const container = target.querySelector<HTMLElement>('.flex-col-reverse.default-chat-screen')!
        container.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 300, width: 300, height: 500, x: 0, y: 0, toJSON: () => ({}) })
        const messageRow = container.querySelector(':scope > [data-part="chat-messages"]')!.firstElementChild as HTMLElement
        messageRow.getBoundingClientRect = rect(tops.message)
        ;(container.children[0].firstElementChild as HTMLElement).getBoundingClientRect = rect(tops.input)
        if (tops.notice !== null) {
            ;(container.querySelector(NOTICE)!.firstElementChild as HTMLElement).getBoundingClientRect = rect(tops.notice)
        }
        expect(chatsProps.current).not.toBeNull()
        chatsProps.current!.hasNewUnreadMessage = true
        await settle()
        expect(newMessageButton(target)).not.toBeNull()
        container.dispatchEvent(new Event('scroll'))
        await settle()
    }

    test('fixed composer with the notice shown reads the message list, so a reader scrolled up keeps the new-message button', async () => {
        installDb(true)
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        // The notice sits at the bottom edge; the latest message is far below the viewport.
        await scrollWithTops(target, { notice: 0, message: 1000, input: 0 })
        expect(newMessageButton(target)).not.toBeNull()
        // Back at the latest messages the button clears.
        await scrollWithTops(target, { notice: 1000, message: 0, input: 1000 })
        expect(newMessageButton(target)).toBeNull()
    })

    test('guard: fixed composer without the notice reads the message list', async () => {
        installDb(true)
        const target = await show()
        expect(target.querySelector(NOTICE)).toBeNull()
        await scrollWithTops(target, { notice: null, message: 1000, input: 0 })
        expect(newMessageButton(target)).not.toBeNull()
        await scrollWithTops(target, { notice: null, message: 0, input: 1000 })
        expect(newMessageButton(target)).toBeNull()
    })

    test('guard: a sibling flex-col-reverse div before the list is not read as the list, notice shown', async () => {
        installDb(true)
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        const container = target.querySelector<HTMLElement>('.flex-col-reverse.default-chat-screen')!
        const list = container.querySelector(':scope > [data-part="chat-messages"]')!
        // The look-alike sits at the bottom edge and comes first in document order; the list is far below.
        const lookAlike = document.createElement('div')
        lookAlike.className = 'flex flex-col-reverse'
        lookAlike.appendChild(document.createElement('div'))
        container.insertBefore(lookAlike, list)
        const edge = () => ({ top: 0, bottom: 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0, toJSON: () => ({}) })
        ;(lookAlike.firstElementChild as HTMLElement).getBoundingClientRect = edge
        await scrollWithTops(target, { notice: 0, message: 1000, input: 0 })
        expect(newMessageButton(target)).not.toBeNull()
    })

    test('guard: a non-fixed composer keeps reading the input row, with or without the notice', async () => {
        installDb(false)
        const target = await show()
        await deny()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        await scrollWithTops(target, { notice: 0, message: 1000, input: 0 })
        expect(newMessageButton(target)).toBeNull()
        await scrollWithTops(target, { notice: 0, message: 0, input: 1000 })
        expect(newMessageButton(target)).not.toBeNull()
    })
})
