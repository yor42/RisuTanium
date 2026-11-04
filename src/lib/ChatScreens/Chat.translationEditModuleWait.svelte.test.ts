// @vitest-environment happy-dom

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
    ensureCalls: 0,
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
vi.mock(import('src/ts/process/moduleEnsure'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ensureCurrentModulesOrAlert: (...args: Parameters<typeof actual.ensureCurrentModulesOrAlert>) => {
            rig.ensureCalls += 1
            return actual.ensureCurrentModulesOrAlert(...args)
        },
    }
})
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
vi.mock('./ChatBody.svelte', () => ({ default: () => ({ destroy: () => {} }) }))

const context = vi.hoisted(() => ({ get: null as null | (() => Promise<{ key: string; data: string } | null | 'unavailable'>) }))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: HTMLElement, props: { getTranslationEditContext: typeof context.get }) => {
        context.get = props.getTranslationEditContext
        return { destroy: () => { context.get = null } }
    },
}))

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import Chat from './Chat.svelte'
import { language } from '../../lang'

let target: HTMLElement
let instance: ReturnType<typeof mount> | null = null
let releaseLoad: (() => void) | null = null
let calls = 0
let failCount = 0

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
    rig.cache = new Map([['hello', 'PRE'], ['hello+MOD', 'POST']])
    rig.reads = []
    rig.writes = []
    rig.emptyKeyParse = false
    rig.ensureCalls = 0
    rig.deferredRead = null
    releaseLoad = null
    calls = 0
    vi.clearAllMocks()
})

afterEach(async () => {
    releaseLoad?.()
    if (instance) await unmount(instance)
    instance = null
    unregisterModuleLoader()
    resetChatSurfaceForTests()
    document.body.replaceChildren()
})

describe('translation edit module wait', () => {
    test.each([false, true])('T1 waits, seeds and saves under the loaded key (legacy=%s)', async (legacy) => {
        loader()
        setup()
        DBState.db.legacyTranslation = legacy
        clickEdit()
        expect(area()).toBeNull()
        expect(rig.reads).toEqual([])
        await settle()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('POST') })
        expect(rig.reads).toEqual(['hello+MOD'])
        expect(rig.ensureCalls).toBe(1)
        area()!.value = 'changed'
        area()!.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        button(language.editTranslationSave).click()
        await vi.waitFor(() => expect(rig.writes).toEqual([['hello+MOD', 'changed']]))
    })

    test('T2 a failed wait opens nothing and alerts once', async () => {
        loader(1)
        setup()
        clickEdit()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(alertError).toHaveBeenCalledTimes(1) })
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(area()).toBeNull()
        expect(rig.reads).toEqual([])
        expect(rig.writes).toEqual([])
        expect(button(language.editTranslation).disabled).toBe(false)
        expect(target.querySelector<HTMLButtonElement>('.button-icon-translate')!.disabled).toBe(false)
    })

    test('T3 each failed click retries and a later load can open', async () => {
        loader(2)
        setup()
        clickEdit()
        await settle()
        await vi.waitFor(() => expect(alertError).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        clickEditButton()
        await settle()
        await vi.waitFor(() => expect(alertError).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(area()).toBeNull()
        expect(calls).toBe(2)
        clickEditButton()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('POST') })
        expect(calls).toBe(3)
    })

    test('T4 partial context waits for the loaded key', async () => {
        loader()
        setup()
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        let settled = false
        const pending = context.get!().then((value) => { settled = true; return value })
        await tick()
        expect(settled).toBe(false)
        await settle()
        expect(await pending).toEqual({ key: 'hello+MOD', data: 'POST' })
    })

    test('T18a partial context rejects an in-place data change during the module wait', async () => {
        loader()
        setup()
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        const pending = context.get!()
        await vi.waitFor(() => expect(releaseLoad).not.toBeNull())
        DBState.db.characters[0].chats[0].message[0].data = 'hello changed'
        flushSync()
        await settle()
        expect(await pending).toBe('unavailable')
        expect(rig.reads).toEqual([])
    })

    test('T18b partial context rejects an in-place data change during the cache read', async () => {
        setup(false)
        rig.deferredRead = () => {}
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        const pending = context.get!()
        await vi.waitFor(() => expect(rig.reads).toEqual(['hello+MOD']))
        DBState.db.characters[0].chats[0].message[0].data = 'hello changed'
        flushSync()
        rig.deferredRead!()
        expect(await pending).toBe('unavailable')
        expect(rig.reads).toEqual(['hello+MOD'])
    })

    test.each([true, false])('T5 partial context reports a failed wait as unavailable (pre-key cache=%s)', async (withPreKey) => {
        loader(1)
        setup()
        if (!withPreKey) rig.cache.delete('hello')
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        const pending = context.get!()
        await settle()
        expect(await pending).toBe('unavailable')
        expect(rig.reads).toEqual([])
        expect(alertError).toHaveBeenCalledTimes(1)
    })

    test('T9 Settings during the wait prevents the cache read', async () => {
        loader()
        setup()
        clickEdit()
        chatSurface.closeEpoch += 1
        flushSync()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(rig.reads).toEqual([])
        expect(area()).toBeNull()
    })

    test('T8 unmount during the wait prevents the cache read', async () => {
        loader()
        setup()
        clickEdit()
        await unmount(instance!)
        instance = null
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(rig.reads).toEqual([])
    })

    test.each(['replace', 'page', 'shift', 'shared-row'])('T10 %s during the wait prevents the cache read', async (change) => {
        loader()
        setup()
        if (change === 'shift') DBState.db.characters[0].chats[0].message = [
            { role: 'char', data: 'hello' }, { role: 'char', data: 'hello' },
        ]
        if (change === 'shared-row') {
            DBState.db.characters[0].chats[1].message[0] = DBState.db.characters[0].chats[0].message[0]
        }
        clickEdit()
        if (change === 'replace') DBState.db.characters[0].chats[0].message[0] = { role: 'char', data: 'hello', chatId: 'm-2' }
        if (change === 'page' || change === 'shared-row') DBState.db.characters[0].chatPage = 1
        if (change === 'shift') DBState.db.characters[0].chats[0].message.splice(0, 1)
        flushSync()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(rig.reads).toEqual([])
        expect(area()).toBeNull()
    })

    test.each([false, true])('T9b Settings while a cache read is pending prevents the editor (stub=%s)', async (stub) => {
        if (stub) loader()
        setup(stub)
        rig.deferredRead = () => {}
        clickEdit()
        if (stub) await settle()
        await vi.waitFor(() => expect(rig.reads).toEqual(['hello+MOD']))
        chatSurface.closeEpoch += 1
        flushSync()
        rig.deferredRead!()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(area()).toBeNull()
    })

    test('T10b a shifted id-less row while a read is pending prevents the editor', async () => {
        setup(false)
        DBState.db.characters[0].chats[0].message = [
            { role: 'char', data: 'hello' }, { role: 'char', data: 'hello' },
        ]
        rig.deferredRead = () => {}
        clickEdit()
        await vi.waitFor(() => expect(rig.reads).toEqual(['hello+MOD']))
        DBState.db.characters[0].chats[0].message.splice(0, 1)
        flushSync()
        rig.deferredRead!()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(area()).toBeNull()
    })

    test('T17a in-place message change during the wait prevents the cache read', async () => {
        loader()
        setup()
        clickEdit()
        DBState.db.characters[0].chats[0].message[0].data = 'hello changed'
        flushSync()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(rig.reads).toEqual([])
        expect(area()).toBeNull()
        expect(target.querySelector<HTMLButtonElement>('.button-icon-translate')!.disabled).toBe(false)
    })

    test('T17b in-place message change during a pending cache read prevents the editor', async () => {
        setup(false)
        rig.deferredRead = () => {}
        clickEdit()
        await vi.waitFor(() => expect(rig.reads).toEqual(['hello+MOD']))
        DBState.db.characters[0].chats[0].message[0].data = 'hello changed'
        flushSync()
        rig.deferredRead!()
        await vi.waitFor(() => { flushSync(); expect(button(language.editTranslation).disabled).toBe(false) })
        expect(area()).toBeNull()
    })
    test('T11 a pending load disables a second editor click', async () => {
        loader()
        setup()
        clickEdit()
        expect(button(language.editTranslation).disabled).toBe(true)
        button(language.editTranslation).click()
        await vi.waitFor(() => expect(calls).toBe(1))
        await settle()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('POST') })
        expect(rig.reads).toEqual(['hello+MOD'])
        expect(rig.ensureCalls).toBe(1)
    })

    test('T6 guard: no stubs use the resident key without loading', async () => {
        setup(false)
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        expect(await context.get!()).toEqual({ key: 'hello+MOD', data: 'POST' })
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        clickEdit()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('POST') })
        expect(calls).toBe(0)
        expect(rig.ensureCalls).toBe(0)
        expect(rig.reads).toEqual(['hello+MOD', 'hello+MOD'])
    })

    test('T7 guard: before-HTML keys do not wait for stubs', async () => {
        loader(1)
        setup(true, true)
        clickEdit()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('PRE') })
        expect(calls).toBe(0)
        expect(rig.ensureCalls).toBe(0)
        expect(rig.reads).toEqual(['hello'])
        expect(alertError).not.toHaveBeenCalled()
    })

    test('T16a guard: an empty key still opens the full editor', async () => {
        rig.emptyKeyParse = true
        rig.cache.set('', 'EMPTY')
        setup(false)
        clickEdit()
        await vi.waitFor(() => { flushSync(); expect(area()?.value).toBe('EMPTY') })
        expect(rig.reads).toEqual([''])
    })

    test('T16b guard: an empty key gives no partial context', async () => {
        rig.emptyKeyParse = true
        setup(false)
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        expect(await context.get!()).toBe(null)
        expect(rig.reads).toEqual([])
    })
})
