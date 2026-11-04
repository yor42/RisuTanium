// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'
import type { Database } from './storage/database.svelte'
import type { RunSubject } from './process/chatOrigin'
import { MODULE_STUB_KEY } from './storage/moduleStub'

const h = vi.hoisted(() => ({
    selections: [] as string[],
    downloads: [] as { name: string, data: Buffer }[],
    clipboard: [] as ClipboardItem[][],
    clipboardHtml: [] as Blob[],
    alerts: [] as (string | Error)[],
    notices: [] as string[],
    waits: 0,
    translated: [] as string[],
    ensureCalls: 0,
    targetEnsureCalls: 0,
    loaderCalls: [] as string[],
    menuAnswered: () => {},
}))

vi.mock(import('./storage/database.svelte'), async () => {
    const { DBState, selectedCharID } = await import('./stores.svelte')
    const getCurrentCharacter = () => DBState.db.characters[get(selectedCharID)]
    return {
        appVer: '1234.5.67',
        getDatabase: () => DBState.db,
        getCurrentCharacter,
        getCurrentChat: () => {
            const char = getCurrentCharacter()
            return char?.chats?.[char.chatPage]
        },
    } as typeof import('./storage/database.svelte')
})

vi.mock(import('./stores.svelte'), () => {
    const state = $state({ db: {} as Database })
    const selectedCharID = writable(0)
    const selIdState = $state({ selId: 0 })
    selectedCharID.subscribe((selId) => { selIdState.selId = selId })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        moduleBackgroundEmbedding: writable(''),
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('./stores.svelte')
})

vi.mock(import('./globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
    downloadFile: async (name: string, data: Buffer) => { h.downloads.push({ name, data }) },
}) as unknown as typeof import('./globalApi.svelte'))

vi.mock(import('./alert'), () => ({
    alertSelect: async () => {
        const answer = h.selections.shift() ?? '0'
        if(h.selections.length === 0){ h.menuAnswered() }
        return answer
    },
    alertWait: () => { h.waits++ },
    alertError: (error: string | Error) => { h.alerts.push(error) },
    alertNormal: (text: string) => { h.notices.push(text) },
}) as unknown as typeof import('./alert'))

vi.mock(import('./util'), async (importOriginal) => ({
    ...(await importOriginal()),
    checkPersonaBinded: () => null,
    findCharacterbyId: () => ({ name: 'Aria' } as ReturnType<typeof import('./util').findCharacterbyId>),
    getUserName: () => 'User',
}))

vi.mock(import('./translator/translator'), () => ({
    translateHTML: async (v: string, _reverse: boolean, _char: unknown, _chatID: number, _regenerate: boolean, subject?: RunSubject) => {
        h.translated.push(v)
        const { getModuleRegexScripts } = await import('./process/modules')
        const resident = getModuleRegexScripts(subject).some((script) => script.comment === 'm1 display marker')
        const display = document.createElement('div')
        display.innerHTML = v
        const textNodes = document.createTreeWalker(display, NodeFilter.SHOW_TEXT)
        for(let node = textNodes.nextNode(); node; node = textNodes.nextNode()){
            node.textContent += resident ? '+MOD' : '+RAW'
        }
        return display.innerHTML
    },
}) as unknown as typeof import('./translator/translator'))

vi.mock(import('./process/index.svelte'), () => ({ doingChat: writable(false) } as unknown as typeof import('./process/index.svelte')))
vi.mock(import('./characterCards'), () => ({} as unknown as typeof import('./characterCards')))
vi.mock(import('./pngChunk'), () => ({} as unknown as typeof import('./pngChunk')))
vi.mock(import('./process/inlayScreen'), () => ({} as unknown as typeof import('./process/inlayScreen')))
vi.mock(import('./process/coldCharacterRestore'), () => ({} as unknown as typeof import('./process/coldCharacterRestore')))
vi.mock(import('./media/avatarThumb'), () => ({} as unknown as typeof import('./media/avatarThumb')))
vi.mock(import('./storage/characterSaveMarks'), () => ({} as unknown as typeof import('./storage/characterSaveMarks')))
vi.mock(import('./process/memory/busyActions'), () => ({} as unknown as typeof import('./process/memory/busyActions')))
vi.mock(import('./process/files/inlayCleanup'), () => ({} as unknown as typeof import('./process/files/inlayCleanup')))
vi.mock(import('./media'), () => ({} as unknown as typeof import('./media')))

type Modules = Database['modules']
function stub(id: string, name: string): Modules[number] {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1 } as Modules[number]
}
function body(id: string): Modules[number] {
    return { id, name: id, description: '', lorebook: [], regex: [{ comment: `${id} display marker`, in: '$', out: '+MOD', type: 'editdisplay' }] } as Modules[number]
}
function fixture(): Database {
    return {
        translatorType: 'google', combineTranslation: true,
        modules: [stub('m1', 'Alpha'), stub('m3', 'Gamma')], enabledModules: ['m1'], moduleIntergration: '', personas: [],
        characters: [{
            type: 'character', chaId: 'a', name: 'Aria', firstMessage: 'Hi', alternateGreetings: ['Yo'],
            chatPage: 0, modules: [], defaultVariables: '',
            chats: [
                { id: 'c1', modules: [], fmIndex: -1, message: [{ role: 'user', data: 'Question' }, { role: 'char', data: 'Answer' }], note: '', name: 'Chat 1', localLore: [] },
                { id: 'c2', modules: [], fmIndex: -1, message: [{ role: 'user', data: 'Second' }, { role: 'char', data: 'Reply' }], note: '', name: 'Chat 2', localLore: [] },
            ],
        }, { type: 'character', chaId: 'b', name: 'Bea', firstMessage: 'Hello', chatPage: 0, modules: [], chats: [{ id: 'b1', message: [], note: '', name: 'Chat 1', localLore: [] }] }],
        globalChatVariables: {}, templateDefaultVariables: '',
    } as unknown as Database
}

type Row = {
    db: Database
    selected: Writable<number>
    exportChat: typeof import('./characters').exportChat
    acquire: typeof import('./storage/store2/moduleAcquire')
    moduleLoadFailedText: typeof import('./process/moduleRefList').moduleLoadFailedText
}

async function row(): Promise<Row> {
    vi.resetModules()
    vi.doMock('./process/moduleEnsure', async (importOriginal) => {
        const actual = await importOriginal<typeof import('./process/moduleEnsure')>()
        return {
            ...actual,
            ensureCurrentModulesOrAlert: (...args: Parameters<typeof actual.ensureCurrentModulesOrAlert>) => {
                h.ensureCalls++
                return actual.ensureCurrentModulesOrAlert(...args)
            },
            ensureModulesOrAlert: (...args: Parameters<typeof actual.ensureModulesOrAlert>) => {
                h.targetEnsureCalls++
                return actual.ensureModulesOrAlert(...args)
            },
        }
    })
    const { DBState, selectedCharID } = await import('./stores.svelte')
    DBState.db = fixture()
    // The mocked store instance can outlive resetModules; every row starts on the first character.
    selectedCharID.set(0)
    return {
        db: DBState.db, selected: selectedCharID,
        exportChat: (await import('./characters')).exportChat,
        acquire: await import('./storage/store2/moduleAcquire'),
        moduleLoadFailedText: (await import('./process/moduleRefList')).moduleLoadFailedText,
    }
}

function deferred() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

function loader(r: Row, kind: 'gated' | 'failing' | 'failThenGated' = 'gated') {
    const gate = deferred()
    r.acquire.registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        h.loaderCalls.push(id)
        if(kind === 'failing' || (kind === 'failThenGated' && h.loaderCalls.length === 1)) {
            throw new r.acquire.ModuleLoadError('unreadable', id, id)
        }
        await gate.promise
        const index = r.db.modules.findIndex((m) => m.id === id)
        r.db.modules[index] = body(id)
        const { refreshModules } = await import('./process/modules')
        refreshModules()
        return r.db.modules[index]
    })
    return gate.resolve
}

async function start(r: Row, answers: string[], page = 0) {
    const menu = deferred()
    h.menuAnswered = menu.resolve
    h.selections = [...answers]
    const done = r.exportChat(page)
    await menu.promise
    // Let the export resume from its menu answers until it has taken its pre-wait captures and entered the ensure
    // (or has written without one) before a test mutates state.
    const ensureBefore = h.ensureCalls + h.targetEnsureCalls, writesBefore = writes()
    for(let i = 0; i < 400 && h.ensureCalls + h.targetEnsureCalls === ensureBefore && writes() === writesBefore; i++){ await Promise.resolve() }
    return { done }
}

function output(): string { return h.downloads[0]?.data.toString('utf-8') ?? '' }
function writes(): number { return h.downloads.length + h.clipboard.length }
function noSideEffects() {
    expect(writes()).toBe(0)
    expect(h.translated).toHaveLength(0)
    expect(h.waits).toBe(0)
    expect(h.notices).toHaveLength(0)
    expect(h.alerts).toHaveLength(0)
}

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
beforeEach(() => {
    h.downloads.length = 0; h.clipboard.length = 0; h.clipboardHtml.length = 0; h.alerts.length = 0; h.notices.length = 0
    h.translated.length = 0; h.loaderCalls.length = 0; h.waits = 0; h.ensureCalls = 0; h.targetEnsureCalls = 0
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) { h.clipboardHtml.push(items['text/html']) } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => { h.clipboard.push(items) } } })
})
afterEach(async () => {
    const acquire = await import('./storage/store2/moduleAcquire')
    acquire.unregisterModuleLoader()
    vi.doUnmock('./process/moduleEnsure')
    vi.unstubAllGlobals()
    if(clipboardBefore){ Object.defineProperty(navigator, 'clipboard', clipboardBefore) }
    else { Reflect.deleteProperty(navigator, 'clipboard') }
})

describe('exportChat module wait', () => {
    test('post-fix T1 HTML file waits for the display module before all translated parts', async () => {
        const r = await row(), release = loader(r)
        const done = (await start(r, ['2', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        expect(h.waits).toBe(0)
        expect(writes()).toBe(0)
        release(); await done
        expect(h.loaderCalls).toEqual(['m1'])
        expect(h.translated).toHaveLength(3)
        expect(output()).toContain('Question+MOD')
        expect(output()).toContain('Answer+MOD')
        expect(output()).toContain('Hi+MOD')
        expect(h.notices).toHaveLength(1)
    })

    test('post-fix T2 failed load alerts once and leaves no cover or output', async () => {
        const r = await row(); loader(r, 'failing')
        await (await start(r, ['2', '0', '0'])).done
        expect(writes()).toBe(0)
        expect(h.translated).toHaveLength(0)
        expect(h.waits).toBe(0)
        expect(h.notices).toHaveLength(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Alpha'])])
    })

    test('post-fix T3 a failed export retries the loader', async () => {
        const r = await row(), release = loader(r, 'failThenGated')
        await (await start(r, ['2', '0', '0'])).done
        expect(writes()).toBe(0)
        const retry = (await start(r, ['2', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        expect(h.loaderCalls).toEqual(['m1', 'm1'])
        release(); await retry
        expect(output()).toContain('Question+MOD')
        expect(h.alerts).toHaveLength(1)
    })

    test('post-fix T4a translated clipboard waits for residency', async () => {
        const r = await row(), release = loader(r)
        const done = (await start(r, ['3', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        expect(writes()).toBe(0)
        release(); await done
        expect(h.clipboard).toHaveLength(1)
        expect(await h.clipboardHtml[0].text()).toContain('Question+MOD')
        expect(h.translated).toHaveLength(3)
        expect(h.notices).toHaveLength(1)
    })

    test('post-fix T4b failed clipboard load writes nothing', async () => {
        const r = await row(); loader(r, 'failing')
        await (await start(r, ['3', '0', '0'])).done
        expect(writes()).toBe(0)
        expect(h.translated).toHaveLength(0)
        expect(h.waits).toBe(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Alpha'])])
    })

    test.each(['empty', 'resident'] as const)('guard T5 %s skips ensure without stubs', async (kind) => {
        const r = await row()
        r.db.modules = kind === 'empty' ? [] : [body('m1')]
        r.db.enabledModules = kind === 'empty' ? [] : ['m1']
        await (await start(r, ['2', '0', '0'])).done
        expect(h.ensureCalls).toBe(0)
        expect(output()).toContain(kind === 'empty' ? 'Question+RAW' : 'Question+MOD')
    })

    test('guard T6 LLM export skips the new ensure', async () => {
        const r = await row(); r.db.translatorType = 'llm'; loader(r, 'failing')
        await (await start(r, ['2', '0', '0'])).done
        expect(h.ensureCalls).toBe(0)
        expect(writes()).toBe(1)
        expect(h.alerts).toHaveLength(0)
    })

    test.each([['2', '1', '0'], ['0'], ['1']])('guard T7 untranslated or non-HTML export skips ensure: %s', async (...answers) => {
        const r = await row(); loader(r, 'failing')
        await (await start(r, answers)).done
        expect(h.ensureCalls).toBe(0)
        expect(writes()).toBe(1)
        expect(h.translated).toHaveLength(0)
    })

    test.each(['selection', 'currentPage', 'chatSlot', 'characterSlot'] as const)('post-fix T8 identity change %s stops silently', async (change) => {
        const r = await row(), release = loader(r)
        const page = change === 'chatSlot' ? 1 : 0
        const done = (await start(r, ['2', '0', '0'], page)).done
        expect(h.translated).toHaveLength(0)
        if(change === 'selection'){ r.selected.set(1) }
        if(change === 'currentPage'){ r.db.characters[0].chatPage = 1 }
        if(change === 'chatSlot'){ r.db.characters[0].chats[1] = { ...r.db.characters[0].chats[1] } }
        if(change === 'characterSlot'){ r.db.characters[0] = { ...r.db.characters[0] } }
        release(); await done
        noSideEffects()
    })

    test('post-fix T8 edited message writes its current text after the wait', async () => {
        const r = await row(), release = loader(r)
        const done = (await start(r, ['2', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[0].message[1].data = 'Changed'
        release(); await done
        expect(output()).toContain('Changed+MOD')
    })

    test('post-fix T9 non-current export loads the exported chat modules and stops on failure', async () => {
        const r = await row(); r.db.modules = [stub('m2', 'Beta')]; r.db.enabledModules = []
        r.db.characters[0].chats[1].modules = ['m2']; loader(r, 'failing')
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(h.targetEnsureCalls).toBe(1)
        expect(h.ensureCalls).toBe(0)
        expect(h.loaderCalls).toEqual(['m2'])
        expect(writes()).toBe(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Beta'])])
    })

    test('post-fix T10 group current chat loads its modules and stops on failure', async () => {
        const r = await row(); loader(r, 'failing')
        r.db.characters[0].type = 'group'
        await (await start(r, ['2', '0', '0'])).done
        expect(h.targetEnsureCalls).toBe(1)
        expect(h.ensureCalls).toBe(0)
        expect(h.loaderCalls).toEqual(['m1'])
        expect(writes()).toBe(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Alpha'])])
    })

    test('post-fix T10 idless current chat keeps declined-load behavior', async () => {
        const r = await row(); loader(r, 'failing')
        delete r.db.characters[0].chats[0].id
        await (await start(r, ['2', '0', '0'])).done
        expect(h.ensureCalls).toBe(1)
        expect(h.loaderCalls).toHaveLength(0)
        expect(output()).toContain('Question+RAW')
        expect(h.alerts).toHaveLength(0)
    })

    test('post-fix T12 combineTranslation off still waits and stops on failure', async () => {
        const r = await row(); r.db.combineTranslation = false; loader(r, 'failing')
        await (await start(r, ['2', '0', '0'])).done
        expect(writes()).toBe(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Alpha'])])
    })

    test('post-fix T13 simultaneous starts each finish after the same gate', async () => {
        const r = await row(), release = loader(r)
        const first = (await start(r, ['2', '0', '0'])).done
        const second = (await start(r, ['2', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        release(); await Promise.all([first, second])
        expect(writes()).toBe(2)
        expect(h.downloads.every((file) => file.data.toString('utf-8').includes('Question+MOD'))).toBe(true)
    })

    test('post-fix T14 a new unloaded reference of the open chat does not stop an export of another chat', async () => {
        const r = await row(), release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[0].modules?.push('m3')
        release(); await done
        expect(h.loaderCalls).toEqual(['m1'])
        expect(output()).toContain('Second+MOD')
    })

    test.each(['enabled', 'owner', 'row'] as const)('post-fix T14 new unloaded %s reference stops', async (change) => {
        const r = await row(), release = loader(r)
        if(change === 'row'){ r.db.modules.push(body('m4')); r.db.enabledModules.push('m4') }
        const done = (await start(r, ['2', '0', '0'], 0)).done
        expect(h.translated).toHaveLength(0)
        if(change === 'enabled'){ r.db.enabledModules.push('m3') }
        if(change === 'owner'){ r.db.characters[0].modules?.push('m3') }
        if(change === 'row'){ r.db.modules[r.db.modules.findIndex((m) => m.id === 'm4')] = stub('m4', 'Delta') }
        release(); await done
        expect(h.loaderCalls).toEqual(['m1'])
        noSideEffects()
    })

    test('post-fix T14e a resident reference change still exports', async () => {
        const r = await row(), release = loader(r)
        r.db.modules.push(body('m5'))
        const done = (await start(r, ['2', '0', '0'])).done
        expect(h.translated).toHaveLength(0)
        r.db.enabledModules.push('m5')
        release(); await done
        expect(output()).toContain('Question+MOD')
    })
})
