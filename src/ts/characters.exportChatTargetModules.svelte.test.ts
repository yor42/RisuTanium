// @vitest-environment jsdom
/**
 * A translated export (HTML file or clipboard) runs its display pass with the modules of the chat it exports, even when
 * that chat is not the open one. The rig is that of characters.exportChatModuleWait.svelte.test.ts, with two changes:
 * it counts the current-chat ensure and the target ensure separately, and the fake translateHTML reads the modules
 * through the subject it receives, so its output names the module regexes the pass would apply.
 *
 * - Resident modules of the exported chat apply; stubs of the exported chat load first (one alert on failure, then
 *   nothing is written).
 * - After the wait the file is built only while the subject still resolves to the exported objects and the exported
 *   chat's module list holds no stub.
 * - A chat with no id has no subject, so it exports only while it is the open chat.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'
import type { Database } from './storage/database.svelte'
import type { Origin, OriginHint, RunSubject } from './process/chatOrigin'
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
    subjects: [] as (RunSubject | undefined)[],
    currentEnsure: 0,
    targetEnsure: [] as { origin: Origin, hint: OriginHint | undefined }[],
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
    downloadFile: async (name: string, data: Buffer) => { h.downloads.push({ name, data }); return true },
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

// The fake appends the ids of the module display regexes the subject (or, without one, the selection) reads.
vi.mock(import('./translator/translator'), () => ({
    translateHTML: async (v: string, _reverse: boolean, _char: unknown, _chatID: number, _regenerate: boolean, subject?: RunSubject) => {
        h.translated.push(v)
        h.subjects.push(subject)
        const { getModuleRegexScripts } = await import('./process/modules')
        const ids = getModuleRegexScripts(subject)
            .map((script) => /^(m\d+) display marker$/.exec(script.comment)?.[1])
            .filter((id): id is string => id !== undefined)
        const suffix = ids.length > 0 ? `+MOD[${ids.join(',')}]` : '+RAW'
        const display = document.createElement('div')
        display.innerHTML = v
        const textNodes = document.createTreeWalker(display, NodeFilter.SHOW_TEXT)
        for(let node = textNodes.nextNode(); node; node = textNodes.nextNode()){
            node.textContent += suffix
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
                h.currentEnsure++
                return actual.ensureCurrentModulesOrAlert(...args)
            },
            ensureModulesOrAlert: (...args: Parameters<typeof actual.ensureModulesOrAlert>) => {
                h.targetEnsure.push({ origin: args[0], hint: args[2] })
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

// The exported chat (second chat of the first character) references only the stub m2; nothing else is enabled.
function stubbedTarget(r: Row) {
    r.db.modules = [stub('m1', 'Alpha'), stub('m3', 'Gamma'), stub('m2', 'Beta')]
    r.db.enabledModules = []
    r.db.characters[0].chats[1].modules = ['m2']
}

function deferred() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

function loader(r: Row, kind: 'gated' | 'failing' = 'gated') {
    const gate = deferred()
    r.acquire.registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        h.loaderCalls.push(id)
        if(kind === 'failing') {
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

function ensures(): number { return h.currentEnsure + h.targetEnsure.length }

async function start(r: Row, answers: string[], page = 0) {
    const menu = deferred()
    h.menuAnswered = menu.resolve
    h.selections = [...answers]
    const done = r.exportChat(page)
    await menu.promise
    // Let the export resume from its menu answers until it has entered an ensure or written (or stopped before any),
    // before a test mutates state.
    const ensureBefore = ensures(), writesBefore = writes()
    for(let i = 0; i < 400 && ensures() === ensureBefore && writes() === writesBefore; i++){ await Promise.resolve() }
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
    h.translated.length = 0; h.subjects.length = 0; h.loaderCalls.length = 0; h.targetEnsure.length = 0
    h.waits = 0; h.currentEnsure = 0
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) { h.clipboardHtml.push(items['text/html']) } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => { h.clipboard.push(items) } } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    const acquire = await import('./storage/store2/moduleAcquire')
    acquire.unregisterModuleLoader()
    vi.doUnmock('./process/moduleEnsure')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if(clipboardBefore){ Object.defineProperty(navigator, 'clipboard', clipboardBefore) }
    else { Reflect.deleteProperty(navigator, 'clipboard') }
})

describe('exportChat display pass follows the exported chat', () => {
    // Invariant: the display pass reads the exported chat's modules, not the open chat's.
    test('N1 a non-current export applies the modules of the exported chat', async () => {
        const r = await row()
        r.db.modules = [body('m1'), body('m2')]; r.db.enabledModules = []
        r.db.characters[0].chats[0].modules = ['m1']; r.db.characters[0].chats[1].modules = ['m2']
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(output()).toContain('Second+MOD[m2]')
        expect(output()).not.toContain('m1]')
        expect(h.subjects.length).toBeGreaterThan(0)
        expect(h.subjects[0]?.resolve()?.chat).toBe(r.db.characters[0].chats[1])
    })

    // Invariant: nothing is written until the exported chat's stub is loaded.
    test('N2 a non-current export waits for the stubs of the exported chat, then writes', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        expect(writes()).toBe(0)
        expect(h.currentEnsure).toBe(0)
        expect(h.targetEnsure).toHaveLength(1)
        expect(h.targetEnsure[0].origin).toEqual({ chaId: 'a', chatId: 'c2' })
        expect(h.targetEnsure[0].hint?.owner).toBe(r.db.characters[0])
        expect(h.targetEnsure[0].hint?.chat).toBe(r.db.characters[0].chats[1])
        release(); await done
        expect(h.loaderCalls).toEqual(['m2'])
        expect(output()).toContain('Second+MOD[m2]')
    })

    // Invariant: a stub the exported chat references is loaded before the file is written.
    test('N3 a failed load alerts once and writes nothing', async () => {
        const r = await row(); stubbedTarget(r); loader(r, 'failing')
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(writes()).toBe(0)
        expect(h.translated).toHaveLength(0)
        expect(h.waits).toBe(0)
        expect(h.notices).toHaveLength(0)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Beta'])])
    })

    // Regression reproducer: as N2, for the clipboard.
    test('N4 a non-current clipboard export waits for the stubs of the exported chat', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['3', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        expect(writes()).toBe(0)
        expect(h.targetEnsure).toHaveLength(1)
        release(); await done
        expect(h.clipboard).toHaveLength(1)
        expect(await h.clipboardHtml[0].text()).toContain('Second+MOD[m2]')
    })

    // Post-fix check: the export reaches this state only after the target's stub load.
    test('N5 a new stub in the exported chat during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[1].modules?.push('m3')
        release(); await done
        expect(h.loaderCalls).toEqual(['m2'])
        noSideEffects()
    })

    // Post-fix check: the open chat's references are not the exported chat's.
    test('N6 a new stub in the open chat during the wait does not stop the export', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[0].modules?.push('m3')
        release(); await done
        expect(output()).toContain('Second+MOD[m2]')
    })

    // Post-fix check: the target's module load is the one the export waits on.
    test('N7 a group target loads its modules and stops after the alert on failure', async () => {
        const r = await row(); stubbedTarget(r); loader(r, 'failing')
        r.db.characters[0].type = 'group'
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(h.targetEnsure).toHaveLength(1)
        expect(h.alerts).toEqual([r.moduleLoadFailedText(['Beta'])])
        expect(writes()).toBe(0)
        expect(h.translated).toHaveLength(0)
    })

    // Compatibility guard: passes before and after the fix.
    test('N8a an id-less current chat keeps the current-chat path without a load', async () => {
        const r = await row()
        r.db.characters[0].chats[0].modules = ['m1']; r.db.enabledModules = []
        delete r.db.characters[0].chats[0].id
        loader(r, 'failing')
        await (await start(r, ['2', '0', '0'], 0)).done
        expect(h.currentEnsure).toBe(1)
        expect(h.targetEnsure).toHaveLength(0)
        expect(h.loaderCalls).toEqual([])
        expect(h.alerts).toEqual([])
        expect(h.subjects.length).toBeGreaterThan(0)
        expect(h.subjects.every((subject) => subject === undefined)).toBe(true)
        expect(output()).toContain('Question+RAW')
    })

    // Invariant: an id-less non-current chat is never written with the open chat's modules.
    test('N8b an id-less non-current chat with a stub stops silently before any wait', async () => {
        const r = await row(); stubbedTarget(r); loader(r, 'failing')
        delete r.db.characters[0].chats[1].id
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(ensures()).toBe(0)
        expect(h.loaderCalls).toEqual([])
        noSideEffects()
    })

    // Regression reproducer: the stop does not depend on a stub being present.
    test('N8c an id-less non-current chat with resident modules stops silently', async () => {
        const r = await row()
        r.db.modules = [body('m1'), body('m2')]; r.db.enabledModules = []
        r.db.characters[0].chats[1].modules = ['m2']
        delete r.db.characters[0].chats[1].id
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(ensures()).toBe(0)
        noSideEffects()
    })

    // Compatibility guard: passes before and after the fix.
    test('N8d the LLM route is exempt from the id-less stop', async () => {
        const r = await row(); stubbedTarget(r); loader(r, 'failing')
        r.db.translatorType = 'llm'
        delete r.db.characters[0].chats[1].id
        await (await start(r, ['2', '0', '0'], 1)).done
        expect(ensures()).toBe(0)
        expect(writes()).toBe(1)
        expect(output()).toContain('Second')
        expect(h.alerts).toHaveLength(0)
    })

    // Post-fix check: with a duplicated chaId only the hinted holder is the exported chat.
    test('N9 a duplicated owner id resolves to the exported holder', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        r.db.characters.push(JSON.parse(JSON.stringify(r.db.characters[0])) as Database['characters'][number])
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        release(); await done
        expect(h.loaderCalls).toEqual(['m2'])
        expect(output()).toContain('Second+MOD[m2]')
    })

    // Compatibility guard: passes before and after the fix.
    test('N10 a current-chat export applies the modules of the open chat', async () => {
        const r = await row()
        r.db.modules = [body('m1')]; r.db.enabledModules = []
        r.db.characters[0].chats[0].modules = ['m1']
        await (await start(r, ['2', '0', '0'], 0)).done
        expect(output()).toContain('Question+MOD[m1]')
    })

    // Post-fix check: a selection change during the wait stops the export.
    test('N11 a selection change during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.selected.set(1)
        release(); await done
        noSideEffects()
    })

    // Post-fix check: a replaced character object during the wait stops the export.
    test('N11b a replaced character slot during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0] = { ...r.db.characters[0] }
        release(); await done
        noSideEffects()
    })

    // Compatibility guard: passes before and after the fix.
    test.each([['2', '1', '0'], ['0']])('N12 an untranslated or non-HTML export skips both ensures: %s', async (...answers) => {
        const r = await row(); stubbedTarget(r); loader(r, 'failing')
        await (await start(r, answers, 1)).done
        expect(ensures()).toBe(0)
        expect(writes()).toBe(1)
        expect(h.translated).toHaveLength(0)
    })

    // Post-fix check: after an in-place id edit the subject no longer resolves to the exported chat.
    test('N13a a chat id edited during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[1].id = 'c2-renamed'
        release(); await done
        expect(h.loaderCalls).toEqual(['m2'])
        noSideEffects()
    })

    // Post-fix check: after an in-place owner id edit the subject no longer resolves to the exported owner.
    test('N13b an owner chaId edited during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chaId = 'a-renamed'
        release(); await done
        expect(h.loaderCalls).toEqual(['m2'])
        noSideEffects()
    })

    // Post-fix check: the id now resolves to another chat of the same owner, so only the chat comparison stops it.
    test('N13c a chat id taken over by another chat of the owner during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters[0].chats[0].id = 'c2'
        r.db.characters[0].chats[1].id = 'c2-renamed'
        release(); await done
        noSideEffects()
    })

    // Post-fix check: the id now resolves to another owner holding the same chat object, so only the owner comparison
    // stops it.
    test('N13d an owner id taken over by another character during the wait stops silently', async () => {
        const r = await row(); stubbedTarget(r)
        const release = loader(r)
        const done = (await start(r, ['2', '0', '0'], 1)).done
        expect(h.translated).toHaveLength(0)
        r.db.characters.push({ type: 'character', chaId: 'a', name: 'Dup', modules: [], chats: [r.db.characters[0].chats[1]] } as unknown as Database['characters'][number])
        r.db.characters[0].chaId = 'a-renamed'
        release(); await done
        noSideEffects()
    })
})
