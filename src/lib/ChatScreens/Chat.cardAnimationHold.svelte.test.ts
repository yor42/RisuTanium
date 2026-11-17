// @vitest-environment jsdom

/**
 * A legacy chat row holds the infinite animations of its card while the row is outside the far band, and releases
 * them when it comes back or is destroyed. The real `Chat.svelte`, `ChatBody.svelte` and `nearViewport` run; the
 * card markup is the real parser's sanitized output; `getAnimations` and `IntersectionObserver` are browser-shaped
 * stand-ins (shapes measured on a device).
 *
 * Labels: R = regression reproducer (the base never marks anything), G = guard.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chat from './Chat.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'
import { FakeIntersectionObserver, installAnimationWorld, type AnimationWorld } from 'src/ts/gui/tests/realAnimationShape'

//#region module mocks

// The real sanitizer and markup pipeline, with no character so no script or asset step runs.
vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        risuChatParser: vi.fn((text: string) => text ?? ''),
        ParseMarkdown: vi.fn((data: string, _chara: unknown, mode?: 'normal' | 'back' | 'pretranslate' | 'notrim') => actual.ParseMarkdown(data, null, mode)),
    } as unknown as typeof import('src/ts/parser/parser.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
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
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        aiLawApplies: vi.fn(() => false),
        aiWatermarkingLawApplies: vi.fn(() => false),
        changeChatTo: vi.fn(),
        foldChatToMessage: vi.fn(),
        chatFoldedStateMessageIndex: { index: -1 },
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(async () => undefined),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[0]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        appVer: '1234.5.67',
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertError: vi.fn(),
    alertSelect: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(async (html: string) => html),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/longtouch'), () => ({
    longpress: vi.fn(() => ({ destroy: () => {} })),
}) as unknown as typeof import('src/ts/gui/longtouch'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
    findCharacterbyId: vi.fn(() => null),
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    checkPersonaBinded: vi.fn(() => false),
    parseKeyValue: () => [],
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
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

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

// One card with a self loop, a ::before loop, a finite fill-forwards reveal and a ::marker loop.
const CARD = '<style>.badge{animation:pulse 1s infinite}.glow::before{content:"";animation:spin 1s infinite}.reveal{animation:fade 1s forwards}.mk::marker{animation:col 1s infinite}</style>'
    + '<div class="badge">B</div><span class="glow">G</span><div class="reveal">R</div><ul><li class="mk">M</li></ul>'

const NEAR = '50% 0px'
const FAR = '100% 0px'

function makeChat(id: string): ChatData {
    return {
        id,
        message: [] as unknown[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
    } as unknown as ChatData
}

function makeCharacter(chaId: string, chats: ChatData[]): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        modules: [] as string[],
    } as unknown as character
}

function installDb() {
    DBState.db = {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        globalChatVariables: {},
    } as never
    DBState.db.characters = [makeCharacter('a', [makeChat('cA')])] as never
}

let world: AnimationWorld
const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

async function settle() {
    flushSync()
    await tick()
    await wait(0)
    await tick()
    await wait(0)
}

async function mountChat() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props: { idx: 0, message: CARD, isLastMemory: false } as never })
    mountedInstances.push(instance)
    flushSync()
    await wait(30)
    await settle()
    return { target, instance }
}

function holdOf(element: Element | null): string | null {
    return element ? element.getAttribute('data-risu-anim-hold') : 'ELEMENT-MISSING'
}

function card(target: HTMLElement) {
    const root = target.querySelector<HTMLElement>('.chattext')!
    return {
        root,
        badge: root.querySelector('.x-risu-badge'),
        glow: root.querySelector('.x-risu-glow'),
        reveal: root.querySelector('.x-risu-reveal'),
        marker: root.querySelector('.x-risu-mk'),
    }
}

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    selIdState.selId = 0
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    clearChatBodyRenderCache()
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    world = installAnimationWorld()
    world.rule('.x-risu-badge', 'selfLoopInfinite')
    world.rule('.x-risu-glow', 'beforeLoopInfinite')
    world.rule('.x-risu-badge', 'cssTransitionOpacity')
    world.rule('.x-risu-reveal', 'finiteFillForwardsRunning')
    world.rule('.x-risu-mk', 'markerLoopInfinite')
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    world.restore()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

//#endregion

describe('a legacy chat row holds its card outside the far band', () => {
    test('R T2.1: far-exit holds the infinite self and ::before targets and nothing else', async () => {
        installDb()
        const { target } = await mountChat()
        const { root, badge, glow, reveal, marker } = card(target)
        expect(badge).not.toBeNull()
        expect(glow).not.toBeNull()
        expect(reveal).not.toBeNull()
        expect(marker).not.toBeNull()
        expect(holdOf(badge)).toBeNull()

        FakeIntersectionObserver.send(FAR, root, false)

        expect(holdOf(badge)).toBe('self')
        expect(holdOf(glow)).toBe('before')
        // Finite, the row root and the unsupported pseudo-element's host stay untouched.
        expect(holdOf(reveal)).toBeNull()
        expect(holdOf(root)).toBeNull()
        expect(holdOf(marker)).toBeNull()
    })

    test('G T2.1b: no animation is ever paused, played or finished through script', async () => {
        installDb()
        const { target } = await mountChat()
        const { root, badge } = card(target)
        FakeIntersectionObserver.send(FAR, root, false)
        expect(holdOf(badge)).toBe('self')
        FakeIntersectionObserver.send(NEAR, root, true)
        expect(holdOf(badge)).toBeNull()
        const issued = world.handedOut()
        expect(issued.length).toBeGreaterThan(0)
        for (const animation of issued) {
            expect(animation.pause).not.toHaveBeenCalled()
            expect(animation.play).not.toHaveBeenCalled()
            expect(animation.finish).not.toHaveBeenCalled()
        }
    })

    test('R T2.2: near-enter releases what far-exit held', async () => {
        installDb()
        const { target } = await mountChat()
        const { root, badge, glow } = card(target)
        FakeIntersectionObserver.send(FAR, root, false)
        expect(holdOf(badge)).toBe('self')
        expect(holdOf(glow)).toBe('before')

        FakeIntersectionObserver.send(NEAR, root, true)

        expect(holdOf(badge)).toBeNull()
        expect(holdOf(glow)).toBeNull()
    })

    test('R T2.2: destroying the row releases what it held, and the trailing report does not hold again', async () => {
        installDb()
        const { target, instance } = await mountChat()
        const { root, badge } = card(target)
        FakeIntersectionObserver.send(FAR, root, false)
        expect(holdOf(badge)).toBe('self')

        mountedInstances.splice(mountedInstances.indexOf(instance), 1)
        await unmount(instance as never)
        await settle()

        expect(badge!.hasAttribute('data-risu-anim-hold')).toBe(false)
    })

    test('R T2.2: a held row that re-renders its body holds the new nodes', async () => {
        installDb()
        const { target } = await mountChat()
        const { root, badge } = card(target)
        FakeIntersectionObserver.send(FAR, root, false)
        expect(holdOf(badge)).toBe('self')

        ReloadGUIPointer.update((v) => v + 1)
        await settle()
        await wait(30)
        await settle()

        const after = card(target)
        expect(after.badge).not.toBe(badge)
        expect(holdOf(after.badge)).toBe('self')
        expect(holdOf(after.glow)).toBe('before')
        expect(holdOf(after.reveal)).toBeNull()
    })

    test('G T2.2: a row that was never far-exited holds nothing, even after it re-renders', async () => {
        installDb()
        const { target } = await mountChat()
        ReloadGUIPointer.update((v) => v + 1)
        await settle()
        await wait(30)
        await settle()
        const after = card(target)
        expect(after.badge).not.toBeNull()
        expect(holdOf(after.badge)).toBeNull()
    })
})
