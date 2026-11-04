// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DBState as DatabaseState } from 'src/ts/stores.svelte'
import type { Chat as ChatData, character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

type Database = typeof DatabaseState.db
const rig = vi.hoisted(() => ({
    loaded: false,
    emptyKeyParse: false,
    reads: [] as string[],
    writes: [] as Array<[string, string]>,
    cache: new Map<string, string>(),
    deferredRead: null as null | (() => void),
}))

vi.mock('src/ts/stores.svelte', () => {
    const DBState = $state({ db: {} as Database })
    const selIdState = $state({ selId: 0 })
    return {
    DBState,
    selIdState,
    selectedCharID: writable(0),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
    CurrentTriggerIdStore: writable(null),
    popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
    HideIconStore: writable(false),
    bookmarkListOpen: writable(false),
    ScrollToMessageStore: { value: -1 },
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    aiLawApplies: () => false, changeChatTo: vi.fn(), foldChatToMessage: vi.fn(),
    getFileSrc: async () => '', createChatCopyName: (name: string) => name,
    downloadFile: vi.fn(), fetchNative: vi.fn(), readImage: vi.fn(),
}))
vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const currentCharacter = () => stores.DBState.db.characters[stores.selIdState.selId]
    return {
        getDatabase: () => stores.DBState.db,
        getCurrentCharacter: currentCharacter,
        getCurrentChat: () => {
            const owner = currentCharacter()
            return owner?.chats?.[owner.chatPage]
        },
        setCurrentChat: vi.fn(), setDatabase: vi.fn(),
    }
})
vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertNormal: vi.fn(),
    alertWait: vi.fn(), alertInput: vi.fn(async () => ''), alertRequestData: vi.fn(),
    alertError: vi.fn(), alertSelect: vi.fn(async () => ''),
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: vi.fn(async (data: string, _character: string, mode: string) => {
        if (rig.emptyKeyParse && (mode === 'pretranslate' || mode === 'notrim')) return ''
        return data + (rig.loaded ? '+MOD' : '')
    }),
}))
vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: vi.fn(async (key: string) => {
        rig.reads.push(key)
        if (rig.deferredRead) await new Promise<void>((resolve) => { rig.deferredRead = resolve })
        return rig.cache.get(key) ?? null
    }),
    setLLMCache: vi.fn(async (key: string, value: string) => { rig.writes.push([key, value]) }),
}))
vi.mock('src/ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('src/ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('src/ts/process/tts', () => ({ sayTTS: vi.fn() }))
vi.mock('src/ts/gui/colorscheme', () => ({ ColorSchemeTypeStore: writable('dark') }))
vi.mock('src/ts/gui/longtouch', () => ({ longpress: () => ({ destroy: () => {} }) }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'test' }) }))
vi.mock('src/ts/util', () => ({
    capitalize: (text: string) => text, getUserIcon: () => '', getUserName: () => 'User',
    sleep: async () => {}, findCharacterbyId: () => null, checkPersonaBinded: () => false,
}))
vi.mock('src/ts/characters', () => ({ getCharImage: () => '' }))
vi.mock('src/ts/process/modules', () => ({
    getModuleLorebooks: () => [], getModuleTriggers: () => [],
    getModuleAssets: () => [], getModuleRegexScripts: () => [],
}))
vi.mock('src/ts/process/command', () => ({ processMultiCommand: vi.fn() }))
vi.mock('src/ts/process/files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn() }))
vi.mock('src/ts/process/lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('src/ts/process/stableDiff', () => ({ generateAIImage: vi.fn() }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('./ChatBody.svelte', () => ({
    default: (anchor: Node) => {
        const paragraph = document.createElement('p')
        paragraph.textContent = 'PRE text long enough'
        anchor.parentNode?.insertBefore(paragraph, anchor)
        return { destroy: () => paragraph.remove() }
    },
}))

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { resetChatSurfaceForTests } from './chatSurface.svelte'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import Chat from './Chat.svelte'
import { language } from '../../lang'

let target: HTMLElement
let instance: ReturnType<typeof mount> | null = null
let releaseLoad: (() => void) | null = null
let calls = 0
let failCount = 0
let elementFromPointDescriptor: PropertyDescriptor | undefined

function chat(id: string): ChatData {
    return { id, message: [{ role: 'char', data: 'hello', chatId: 'm-1' }] } as ChatData
}

function owner(chats: ChatData[]): character {
    return { chaId: 'a', name: 'A', type: 'character', chatPage: 0, chats, modules: [] } as character
}

function setup(stub = true, beforeHtml = false) {
    rig.loaded = !stub
    DBState.db = {
        characters: [owner([chat('c1'), chat('c2')])],
        modules: stub ? [{ id: 'm1', name: 'Alpha', [MODULE_STUB_KEY]: 1 }] : [],
        enabledModules: stub ? ['m1'] : [],
        translatorType: 'llm', translateBeforeHTMLFormatting: beforeHtml,
        legacyTranslation: false, theme: 'default', zoomsize: 100, lineHeight: 1.25,
        enableBlockPartialEdit: true, enableDragPartialEdit: false,
    } as unknown as Database
    selectedCharID.set(0)
    selIdState.selId = 0
    target = document.createElement('div')
    document.body.append(target)
    instance = mount(Chat, { target, props: { idx: 0, message: 'hello', isLastMemory: false } })
    flushSync()
}

function loader(failures = 0) {
    failCount = failures
    registerModuleLoader(async () => {
        calls += 1
        await new Promise<void>((resolve) => { releaseLoad = resolve })
        if (failCount > 0) {
            failCount -= 1
            throw new ModuleLoadError('unreadable', 'm1', 'Alpha')
        }
        const live = { id: 'm1', name: 'Alpha', lorebook: [] } as RisuModule
        DBState.db.modules[0] = live
        rig.loaded = true
        return live
    })
}

async function settle() {
    await vi.waitFor(() => expect(releaseLoad).not.toBeNull())
    const release = releaseLoad!
    releaseLoad = null
    release()
    await tick()
    flushSync()
}

function button(label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
    if (!found) throw new Error(`Missing button ${label}`)
    return found
}

function clickEdit() {
    target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
    flushSync()
    clickEditButton()
}

function clickEditButton() {
    button(language.editTranslation).click()
    flushSync()
}

function area() { return target.querySelector<HTMLTextAreaElement>('.message-edit-area') }

beforeEach(() => {
    elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    rig.cache = new Map([['hello', 'PRE'], ['hello+MOD', 'POST']])
    rig.reads = []
    rig.writes = []
    rig.emptyKeyParse = false
    rig.deferredRead = null
    releaseLoad = null
    calls = 0
    vi.clearAllMocks()
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
        observe() { this.callback([{ isIntersecting: true }]) }
        disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
})

afterEach(async () => {
    releaseLoad?.()
    if (instance) await unmount(instance)
    instance = null
    unregisterModuleLoader()
    resetChatSurfaceForTests()
    document.body.replaceChildren()
    if (elementFromPointDescriptor) Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor)
    else Reflect.deleteProperty(document, 'elementFromPoint')
    resetLocalDraftsForTest()
    vi.unstubAllGlobals()
})


describe('T14 translated block edit after a failed module wait', () => {
    test('does not open a modal or a draft', async () => {
        loader(1)
        rig.cache.set('hello', 'PRE text long enough')
        setup()
        const paragraph = target.querySelector('p')!
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => paragraph })
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
        flushSync()
        const button = document.body.querySelector<HTMLButtonElement>('.partial-edit-btn-wrapper .partial-edit-btn-edit')
        expect(button).not.toBeNull()
        button!.click()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(alertError).toHaveBeenCalledTimes(1) })
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
        expect(document.body.querySelector('.partial-edit-modal')).toBeNull()
        expect(document.body.querySelector('.partial-match-failed-modal')).toBeNull()
        expect(hasMessageEditorDrafts()).toBe(false)
    })
})
