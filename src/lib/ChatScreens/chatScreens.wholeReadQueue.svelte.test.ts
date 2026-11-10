// @vitest-environment jsdom

/**
 * The chat surfaces on Android: the message list's character and user icons (`Chats.svelte`), the first-message icon of
 * `DefaultChatScreen.svelte`, and the background and portraits of `ChatScreen.svelte`, `ResizeBox.svelte` and
 * `EmotionBox.svelte` read their images through a hold, so a file of 8 MiB or more waits in the app-wide whole-read queue
 * instead of being put on the page together with the other large images.
 *
 * The real components are mounted on the mock set of `DefaultChatScreen.legacyWindow.svelte.test.ts`. `Chat.svelte` is a
 * stand-in whose icon is a `div` that takes the awaited `img` prop as its style, which is how the real `Chat` consumes it.
 * `getCharImage` is the kit's mirror (`wholeReadQueue.testKit.ts`; `util.wholeReadQueue.svelte.test.ts` checks it against
 * the real function) behind a spy; the queue, the size verdict and the detached `Image` are the real ones. `EmotionBox` is
 * mounted by no other component, so it is checked on its own.
 *
 * "Held grant": the test takes 60 MiB of the 64 MiB queue itself, as a chat image would, so any larger read must wait.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix components), `(G)` a compatibility guard, `(U)` a rule test.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import defaultWallpaper from '../../etc/bg.jpg'

const h = vi.hoisted(() => ({
    // The real DefaultChatScreen is mounted by ChatScreen only when set; otherwise a stand-in takes its place.
    realDefault: false,
    // The real message list is mounted by DefaultChatScreen only when set.
    realChats: false,
    getCharImageSpy: vi.fn(),
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
        ViewBoxsize: writable({ width: 200, height: 200 }),
        PlaygroundStore: writable(0),
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        hypaV3ModalOpen: writable(false),
        ScrollToMessageStore: scrollToMessage,
        additionalChatMenu,
        additionalFloatingActionButtons,
        easyPanelStore,
        chatPanelStore,
        HideIconStore: writable(false),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        bookmarkListOpen: writable(false),
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
        changeChatTo: vi.fn(),
        foldChatToMessage: vi.fn(),
        createChatCopyName: vi.fn((name: string) => name),
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
    ParseMarkdown: vi.fn(async (text: string) => text),
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
    isIOS: () => false,
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
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (path: string) => path.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))

// The helpers the screens use are stubs; the two functions under test and the character lookup are the real ones.
vi.mock(import('src/ts/util'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
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
        capitalize: vi.fn((s: string) => s),
        findCharacterbyId: actual.findCharacterbyId,
        getCustomBackground: actual.getCustomBackground,
        getEmotion: actual.getEmotion,
        defaultEmotion: actual.defaultEmotion,
    } as unknown as typeof import('src/ts/util')
})

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
    getCharImage: h.getCharImageSpy,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    chatProcessStage: writable(0),
    sendChat: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

vi.mock('./Chats.svelte', async () => {
    const actual = await vi.importActual<{ default: (anchor: unknown, props: unknown) => unknown }>('./Chats.svelte')
    return {
        default: (anchor: unknown, props: unknown) => (h.realChats ? actual.default(anchor, props) : { destroy: () => {} }),
    }
})
vi.mock('./DefaultChatScreen.svelte', async () => {
    const actual = await vi.importActual<{ default: (anchor: unknown, props: unknown) => unknown }>('./DefaultChatScreen.svelte')
    return {
        default: (anchor: unknown, props: unknown) => (h.realDefault ? actual.default(anchor, props) : {}),
    }
})
// The icon of a row is a `div` that takes the awaited `img` prop as its style, as the real `Chat` does.
vi.mock('./Chat.svelte', () => ({
    default: (anchor: ChildNode, props: { img?: string | Promise<string | null>, idx?: number, role?: string, firstMessage?: boolean }) => {
        const icon = document.createElement('div')
        icon.setAttribute('data-test-icon', props.firstMessage ? 'first' : `${props.role ?? 'row'}-${props.idx ?? ''}`)
        anchor.before(icon)
        void Promise.resolve(props.img).then((style) => icon.setAttribute('style', style ?? ''))
        return {}
    },
}))
vi.mock('./Suggestion.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../UI/MainMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../Playground/PlaygroundMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../ChatShell/ChatShell.svelte', () => ({ default: () => ({}) }))
vi.mock('./BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))

//#endregion

import { DBState, selectedCharID, CharEmotion } from 'src/ts/stores.svelte'
import ChatScreen from './ChatScreen.svelte'
import ResizeBox from './ResizeBox.svelte'
import EmotionBox from './EmotionBox.svelte'
import Chats from './Chats.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { setShellEnabled } from 'src/ts/chatShell/shellSwitch.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import { androidWholeReadQueue, resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidTransport, createMirroredGetCharImage, domUrls, exposedBytes, resetAndroidTransport,
    seedSizes, urlOf,
} from 'src/ts/media/wholeReadQueue.testKit'

const READ_MIN = 8 * MIB
const BACKGROUND_A = 'assets/backgroundA.webp'
const BACKGROUND_B = 'assets/backgroundB.webp'
const EMOTION = 'assets/emotion.webp'
const CHAR_IMAGE = 'assets/char.webp'
const USER_IMAGE = 'assets/user.webp'
const USER_IMAGE_2 = 'assets/user2.webp'
const cssStyleOf = (key: string): string => `background: url("${urlOf(key)}");background-size: cover;`

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

function show(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(component, { target, props })
    mounted.push({ instance, target })
    flushSync()
    return target
}

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        flushSync()
    }
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
}

/** Takes 60 MiB of the app-wide queue, as a chat image in flight would. */
async function holdBudget(): Promise<{ release: () => void }> {
    return androidWholeReadQueue().acquire(60 * MIB)
}

const exposed = (): number => exposedBytes(document.body, { minBytes: READ_MIN })

/** Fires `load` on the oldest unsettled fake image until none is left, checking the cap after every step. */
async function drainReads(): Promise<void> {
    for (let guard = 0; guard < 40; guard++) {
        const next = FakeImage.all.find((image) => !image.settled)
        if (!next) {
            return
        }
        next.fire('load')
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
    }
    throw new Error('reads never drained')
}

const styleOfIcon = (name: string): string => document.body.querySelector(`[data-test-icon="${name}"]`)?.getAttribute('style') ?? ''

interface CharacterFixture {
    viewScreen?: string
    image?: string
    emotionImages?: [string, string][]
}

function installDb(options: CharacterFixture & { theme?: string, customBackground?: string } = {}): void {
    DBState.db = {
        theme: options.theme ?? '',
        customBackground: options.customBackground ?? '',
        textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '',
        classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100, hideAllImages: false,
        characters: [{
            chaId: 'cha-1',
            name: 'cha-1',
            type: 'character',
            viewScreen: options.viewScreen ?? 'none',
            inlayViewScreen: false,
            emotionImages: options.emotionImages ?? [],
            chatPage: 0,
            chats: [{ id: 'chat-1', message: [], scriptstate: {}, note: '', localLore: [] }],
            triggerscript: [],
            customscript: [],
            globalLore: [],
            desc: '',
            firstMessage: 'first message',
            alternateGreetings: [],
            largePortrait: false,
            removedQuotes: true,
            creatorNotes: '',
            image: options.image ?? '',
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
        iconsize: 100, zoomsize: 100, lineHeight: 1.25, streamingDisplayOptimizationMode: 'off',
    } as never
    selectedCharID.set(0)
}

beforeEach(() => {
    resetAndroidTransport(true)
    h.realDefault = false
    h.realChats = false
    h.getCharImageSpy.mockReset()
    h.getCharImageSpy.mockImplementation(createMirroredGetCharImage(() => false))
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetAndroidWholeReadQueueForTest()
    resetQueuedWholeReadsForTest()
    resetLocalDraftsForTest()
    resetChatSurfaceForTests()
    installChatSurface()
    clearChatBodyRenderCache()
    CharEmotion.set({})
    setShellEnabled(false)
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    await unmountAll()
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

//#region ChatScreen

describe('ChatScreen background and portrait on Android', () => {
    test('(R) T12a the classic background of 60 MiB waits while a chat image holds the queue, and paints after its read settles', async () => {
        installDb({ customBackground: BACKGROUND_A })
        seedSizes([BACKGROUND_A], 60)
        const grant = await holdBudget()
        const target = show(ChatScreen)
        await settleReads()
        expect(domUrls(target)).not.toContain(urlOf(BACKGROUND_A))

        grant.release()
        await settleReads()
        await drainReads()
        expect(target.querySelector('div.h-full.w-full')?.getAttribute('style') ?? '').toContain(urlOf(BACKGROUND_A))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T12a the waifu portrait of 20 MiB waits while a chat image holds the queue', async () => {
        installDb({ theme: 'waifu', viewScreen: 'emotion', emotionImages: [['neutral', EMOTION]] })
        seedSizes([EMOTION], 20)
        const grant = await holdBudget()
        const target = show(ChatScreen)
        await settleReads()
        expect(domUrls(target)).not.toContain(urlOf(EMOTION))

        grant.release()
        await settleReads()
        await drainReads()
        expect(domUrls(target)).toContain(urlOf(EMOTION))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T12e a background that is cleared while its read waits leaves the wallpaper, and its waiting read gets no Image', async () => {
        installDb({ theme: 'waifu', customBackground: BACKGROUND_A })
        seedSizes([BACKGROUND_A], 60)
        const grant = await holdBudget()
        const target = show(ChatScreen)
        await settleReads()

        DBState.db.customBackground = ''
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()

        const style = target.querySelector('div.grow')?.getAttribute('style') ?? ''
        expect(style).toContain(String(defaultWallpaper))
        expect(style).not.toContain(urlOf(BACKGROUND_A))
        expect(style).not.toContain('null')
        expect(style).not.toContain('url("")')
        expect(FakeImage.all.map((image) => image.src)).not.toContain(urlOf(BACKGROUND_A))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T12e a background that changes while its read waits ends with the newer one', async () => {
        installDb({ customBackground: BACKGROUND_A })
        seedSizes([BACKGROUND_A, BACKGROUND_B], 60)
        const grant = await holdBudget()
        const target = show(ChatScreen)
        await settleReads()

        DBState.db.customBackground = BACKGROUND_B
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()

        const style = target.querySelector('div.h-full.w-full')?.getAttribute('style') ?? ''
        expect(style).toContain(urlOf(BACKGROUND_B))
        expect(style).not.toContain(urlOf(BACKGROUND_A))
        expect(FakeImage.all.map((image) => image.src)).not.toContain(urlOf(BACKGROUND_A))
    })
})

describe('ResizeBox and EmotionBox on Android', () => {
    test('(R) T12b the portrait box of 20 MiB waits while a chat image holds the queue', async () => {
        installDb({ viewScreen: 'emotion', emotionImages: [['neutral', EMOTION]] })
        seedSizes([EMOTION], 20)
        const grant = await holdBudget()
        const target = show(ResizeBox)
        await settleReads()
        expect(domUrls(target)).not.toContain(urlOf(EMOTION))

        grant.release()
        await settleReads()
        await drainReads()
        expect(domUrls(target)).toContain(urlOf(EMOTION))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T12b the emotion strip of 20 MiB waits while a chat image holds the queue (unit level: no component mounts it)', async () => {
        installDb({ viewScreen: 'emotion', emotionImages: [['neutral', EMOTION]] })
        seedSizes([EMOTION], 20)
        const grant = await holdBudget()
        const target = show(EmotionBox)
        await settleReads()
        // The strip renders nothing until the awaited images arrive; jsdom drops the 'contain' style, so the divs are counted.
        expect(target.querySelectorAll('div.h-full')).toHaveLength(0)

        grant.release()
        await settleReads()
        await drainReads()
        expect(target.querySelectorAll('div.h-full')).toHaveLength(2)
        expect(FakeImage.all.map((image) => image.src)).toEqual([urlOf(EMOTION)])

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})

//#endregion

//#region Chats and DefaultChatScreen

interface RowMessage { role: 'user' | 'char', data: string, chatId: string }

function mountChats(userIcon: string, image: string) {
    installDb({ image })
    const messages: RowMessage[] = [
        { role: 'user', data: 'hello', chatId: 'u1' },
        { role: 'char', data: 'hi', chatId: 'c1' },
    ]
    const character = DBState.db.characters as unknown as Array<Record<string, unknown>>
    ;(character[0].chats as Array<{ message: RowMessage[] }>)[0].message = messages
    const props = $state({
        messages: messages as never,
        currentCharacter: character[0] as never,
        onReroll: () => {},
        unReroll: () => {},
        currentUsername: 'User',
        userIcon,
        loadPages: 30,
    })
    h.realChats = true
    const target = show(Chats, props)
    return { target, props }
}

describe('Chats icons on Android', () => {
    test('(R) T9 a 40 MiB character icon and a 40 MiB user icon stay within 64 MiB in flight and both paint in the end', async () => {
        seedSizes([CHAR_IMAGE, USER_IMAGE], 40)
        mountChats(USER_IMAGE, CHAR_IMAGE)
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        expect(styleOfIcon('char-1')).toBe(cssStyleOf(CHAR_IMAGE))
        expect(styleOfIcon('user-0')).toBe(cssStyleOf(USER_IMAGE))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(U) T9b a user icon that changes while its read waits is shown by the kept row after the newer read settles', async () => {
        seedSizes([USER_IMAGE, USER_IMAGE_2], 20)
        const grant = await holdBudget()
        const { props } = mountChats(USER_IMAGE, '')
        await settleReads()
        expect(styleOfIcon('user-0')).toBe('')

        props.userIcon = USER_IMAGE_2
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()

        expect(styleOfIcon('user-0')).toBe(cssStyleOf(USER_IMAGE_2))
        expect(FakeImage.all.map((image) => image.src)).not.toContain(urlOf(USER_IMAGE))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the icons paint at once with the same two-argument calls', async () => {
        resetAndroidTransport(false)
        seedSizes([CHAR_IMAGE, USER_IMAGE], 40)
        mountChats(USER_IMAGE, CHAR_IMAGE)
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(styleOfIcon('char-1')).toBe(cssStyleOf(CHAR_IMAGE))
        expect(styleOfIcon('user-0')).toBe(cssStyleOf(USER_IMAGE))
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
        expect(calls.map((call) => call[0]).sort()).toEqual([CHAR_IMAGE, USER_IMAGE].sort())
    })
})

describe('DefaultChatScreen first message on Android', () => {
    test('(R) T10 the first-message icon of 20 MiB waits while a chat image holds the queue, and paints after its read settles', async () => {
        installDb({ image: CHAR_IMAGE })
        seedSizes([CHAR_IMAGE], 20)
        const grant = await holdBudget()
        h.realDefault = true
        const target = show(DefaultChatScreen)
        await settleReads()
        expect(target.querySelector('[data-test-icon="first"]')).not.toBeNull()
        expect(styleOfIcon('first')).toBe('')

        grant.release()
        await settleReads()
        await drainReads()
        expect(styleOfIcon('first')).toBe(cssStyleOf(CHAR_IMAGE))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the first-message icon paints at once with a two-argument call', async () => {
        resetAndroidTransport(false)
        installDb({ image: CHAR_IMAGE })
        seedSizes([CHAR_IMAGE], 20)
        h.realDefault = true
        show(DefaultChatScreen)
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(styleOfIcon('first')).toBe(cssStyleOf(CHAR_IMAGE))
        const calls = (h.getCharImageSpy.mock.calls as unknown[][]).filter((call) => call[0] === CHAR_IMAGE)
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
    })
})

//#endregion
