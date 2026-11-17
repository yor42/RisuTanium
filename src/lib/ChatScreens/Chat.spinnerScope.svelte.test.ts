// @vitest-environment jsdom

/**
 * The card motion mark reaches the animated nodes a chat body renders itself. The real `Chat.svelte` and
 * `ChatBody.svelte` run on a real `$state` `DBState.db` with the real `trimMarkdown`, so the translation spinner
 * markup and the loading indicator are what the app sanitizes and mounts inside the message body. The parser and
 * the translator are held doubles that give every call a fresh deferred.
 *
 * Labels: G = guard (passes before and after; the base already mounts these nodes inside the body).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import css, { type CssRuleAST } from '@adobe/css-tools'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chat from './Chat.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { ensureSelectedModules } from 'src/ts/process/moduleEnsure'
import { bumpModuleGui } from 'src/ts/process/moduleGuiBump'
import 'src/ts/chatShell/motionPrefs.svelte'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
    reject: (error: Error) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    translations: [] as Held[],
    // 'hold' gives every ParseMarkdown call a fresh deferred; 'reject' fails the call at once.
    parseMode: 'hold' as 'hold' | 'reject',
}))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn((...args: unknown[]) => {
        if (h.parseMode === 'reject') {
            return Promise.reject(new Error('parse failed'))
        }
        return new Promise<string>((resolve, reject) => { h.parses.push({ args, resolve, reject }) })
    }),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: actual.trimMarkdown,
    getDistance: vi.fn(() => 0),
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
        changeChatTo: vi.fn((v: number | string) => {
            const char = (stores.DBState as unknown as { db: any }).db.characters[
                (stores.selIdState as unknown as { selId: number }).selId
            ]
            if (typeof v === 'number' && char) {
                char.chatPage = v
            }
        }),
        foldChatToMessage: vi.fn(),
        chatFoldedStateMessageIndex: { index: -1 },
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
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
    translateHTML: vi.fn((...args: unknown[]) => new Promise<string>((resolve, reject) => { h.translations.push({ args, resolve, reject }) })),
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
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
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

vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

// wasmoon cannot load under happy-dom; the button and form scripts are not part of these rows.
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

function makeChat(id: string, overrides: Record<string, unknown> = {}): ChatData {
    return {
        id,
        message: [] as unknown[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as ChatData
}

function makeCharacter(chaId: string, chats: ChatData[], overrides: Record<string, unknown> = {}): character {
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
        ...overrides,
    } as unknown as character
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        ...overrides,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

/** One macrotask of the body's markup: text and html of the message body span. */
async function sampleBody(target: HTMLElement, selector = '.chattext') {
    flushSync()
    await tick()
    await wait(0)
    await tick()
    const bodies = [...target.querySelectorAll(selector)]
    return {
        text: bodies.map((b) => b.textContent ?? '').join('|'),
        html: bodies.map((b) => b.innerHTML).join('|'),
        indicators: target.querySelectorAll(`${selector} [role="status"]`).length,
    }
}

async function answerParse(index: number, text: string) {
    h.parses[index].resolve(text)
    await wait(0)
    await tick()
}

async function answerTranslation(index: number, text: string) {
    h.translations[index].resolve(text)
    await wait(20)
    await tick()
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    selIdState.selId = 0
    h.parses.length = 0
    h.translations.length = 0
    h.parseMode = 'hold'
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

//#endregion

type Plain = Record<string, unknown>

function stub(id: string): Plain {
    return { id, name: id, description: '', [MODULE_STUB_KEY]: 1 }
}

function live(): { modules: Plain[], enabledModules: string[], characters: Plain[] } {
    return DBState.db as unknown as { modules: Plain[], enabledModules: string[], characters: Plain[] }
}

let loaderCalls: string[] = []
let parsesAtLastBump = -1
let releaseLoads: () => void = () => {}

/** A loader that waits for `releaseLoads`, then installs (or fails) like the production loader and bumps. */
function registerHeldLoader(failing: string[] = []) {
    loaderCalls = []
    parsesAtLastBump = -1
    const gate = new Promise<void>((resolve) => { releaseLoads = resolve })
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await gate
        if (failing.includes(id)) {
            throw new ModuleLoadError('unreadable', id, id)
        }
        const index = live().modules.findIndex((m) => m.id === id)
        live().modules[index] = { id, name: id, description: '', lorebook: [] }
        bumpModuleGui()
        parsesAtLastBump = h.parses.length
        return live().modules[index] as never
    })
}

function installDb(over: { modules?: Plain[], enabled?: string[], dbOver?: Record<string, unknown>, characters?: character[] } = {}) {
    DBState.db = baseDb({
        modules: over.modules ?? [],
        enabledModules: over.enabled ?? [],
        ...(over.dbOver ?? {}),
    }) as never
    DBState.db.characters = (over.characters ?? [makeCharacter('a', [makeChat('cA')])]) as never
}

async function mountChat(props: Record<string, unknown> = {}) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props: { idx: 0, message: 'hello', isLastMemory: false, ...props } as never })
    mountedInstances.push(instance)
    flushSync()
    await wait(20)
    return { target, instance }
}

afterEach(async () => {
    // A held load would leave its run (and the module-level active ids) open for the rest of the file.
    releaseLoads()
    await wait(20)
    unregisterModuleLoader()
})

async function settleLoad() {
    releaseLoads()
    await wait(20)
    await tick()
}

const MOTION_ATTR = 'data-card-motion-off'

/** Selectors of the sheet's motion rule that a script-side `matches` can evaluate (pseudo-element tokens cannot). */
function motionSelectors(): string[] {
    const text = document.head.querySelector('style[data-risu-sheet="card-effects"]')?.textContent ?? ''
    const rules = css.parse(text).stylesheet.rules.filter((rule) => rule.type === 'rule') as CssRuleAST[]
    return rules
        .filter((rule) => (rule.declarations ?? []).some((entry) => entry.type === 'declaration' && 'property' in entry && entry.property === 'animation-duration'))
        .flatMap((rule) => rule.selectors ?? [])
        .filter((selector) => !selector.includes('::'))
}

/** The nodes of a body that animate by themselves: an inline animation, or the Tailwind spin class. */
function animatedNodes(body: Element): Element[] {
    return [...body.querySelectorAll('*')].filter((node) => /animation/.test(node.getAttribute('style') ?? '') || node.classList.contains('animate-spin'))
}

function expectReachedByMotionMark(target: HTMLElement): void {
    const body = target.querySelector('.chattext')!
    const animated = animatedNodes(body)
    expect(animated.length).toBeGreaterThan(0)
    const selectors = motionSelectors()
    expect(selectors.length).toBeGreaterThan(0)
    document.documentElement.setAttribute(MOTION_ATTR, '')
    for (const node of animated) {
        expect(selectors.some((selector) => node.matches(selector)), node.outerHTML).toBe(true)
        expect(node).not.toBe(body)
    }
}

afterEach(() => {
    document.documentElement.removeAttribute(MOTION_ATTR)
})

describe('the motion mark reaches the body spinners (A3b)', () => {
    test('the translation spinner the real sanitizer keeps is a descendant the motion rule matches', async () => {
        installDb({ dbOver: { autoTranslate: true, translatorType: 'google', translator: 'ko', translatorInputLanguage: 'en', showTranslationLoading: true } })
        const { target } = await mountChat()
        await wait(30)
        await answerParse(0, 'P:FIRST')
        await wait(30)
        const seen = await sampleBody(target)
        expect(seen.html).toContain('animation')
        expectReachedByMotionMark(target)
    })

    test('the loading indicator inside the body is a descendant the motion rule matches', async () => {
        installDb({ modules: [stub('m1')], enabled: ['m1'] })
        registerHeldLoader()
        const { target } = await mountChat()
        ensureSelectedModules(true)
        const seen = await sampleBody(target)
        expect(seen.indicators).toBe(1)
        expect(target.querySelector('.chattext [role="status"]')!.classList.contains('animate-spin')).toBe(true)
        expectReachedByMotionMark(target)
    })
})