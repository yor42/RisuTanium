// @vitest-environment happy-dom

/**
 * Mounts the real `ChatBody.svelte` over the real `translator.ts`, `moduleEnsure.ts`, `moduleRefList.ts` and
 * `moduleAcquire.ts`. The module loader is a double (gated or failing), the parser is a mock that adds the module's
 * display output ("+MOD") only once no module slot is a stub, and the request boundary (`requestChatData`) records
 * the translator input. `translatorMemory` is module level, so every row loads a fresh module graph.
 *
 * Labels: R = reproducer (fails at an assertion on the base without the wait), G = guard (passes before and after
 * or only guards the new wait against a mutant).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'

//#region module mocks

const h = vi.hoisted(() => ({
    alerts: [] as string[],
    store: new Map<string, string>(),
    requests: [] as string[],
    parseCalls: [] as string[],
    ensureCalls: 0,
    loaderCalls: [] as string[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    }
})

vi.mock('src/ts/parser/parser.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const resident = () => {
        const modules = (stores.DBState as unknown as { db: { modules: Record<string, unknown>[] } }).db.modules
        return modules.every((m) => !(MODULE_STUB_KEY in m))
    }
    return {
        applyMarkdownToNode: () => {},
        risuChatParser: (data: string) => data,
        ParseMarkdown: vi.fn(async (data: string) => {
            const out = resident() ? `${data}+MOD` : data
            h.parseCalls.push(out)
            return out
        }),
        addMetadataToElement: (html: string) => html,
        postTranslationParse: (html: string) => html,
        trimMarkdown: (html: string) => html,
        getDistance: () => 0,
    }
})

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertWait: vi.fn(),
}))

vi.mock('src/ts/util', () => ({
    checkPersonaBinded: vi.fn(() => false),
    getNodetextToSentence: vi.fn(() => []),
    sleep: vi.fn(async () => {}),
}))

vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    type CharShape = { chats?: unknown[], chatPage?: number }
    const db = () => (stores.DBState as unknown as { db: Record<string, unknown> }).db
    const getCurrentCharacter = () => (db().characters as CharShape[] | undefined)?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { getDatabase: db, getCurrentCharacter, getCurrentChat }
})

vi.mock('src/ts/process/index.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) }
})

vi.mock('src/ts/process/request/request', () => ({
    requestChatData: vi.fn(async (req: { formated: { content: string }[] }) => {
        const text = req.formated[req.formated.length - 1].content
        h.requests.push(text)
        return { type: 'success', result: `T:${text}` }
    }),
}))

vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
}))
vi.mock('src/ts/process/scripts', () => ({ processScriptFull: async (_char: unknown, data: string) => ({ data }) }))
vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: async () => '',
    globalFetch: async (_url: string, init: { body: { text: string[] } }) => ({
        ok: true,
        data: { translations: [{ text: `D:${init.body.text[0]}` }] },
    }),
}))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: async (value: string) => value,
    SecretRefError: class SecretRefError extends Error {},
}))
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => h.store.get(key) ?? null,
            setItem: async (key: string, value: string) => { h.store.set(key, value); return value },
            iterate: async () => {},
            clear: async () => { h.store.clear() },
        }),
    },
}))

//#endregion

type Plain = Record<string, unknown>

interface Mounted {
    target: HTMLElement
    rerunSameInstance: () => void
    unmountBody: () => Promise<void>
    release: () => void
}

const mounted: Mounted[] = []

function stub(id: string, name: string): Plain {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1 }
}

async function settle(ms = 40) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface RowOptions {
    translatorType?: string
    legacy?: boolean
    cachedOnly?: boolean
    stubs?: boolean
    loader?: 'gated' | 'failing'
    cache?: Record<string, string>
}

/** Fresh module graph per row: the translator's failure memory and the loader registry are module level. */
async function mountRow(options: RowOptions = {}): Promise<Mounted> {
    vi.resetModules()
    // A static factory result is cached across resetModules, which would bind the wrapper to the first row's
    // module graph (and its loader registry); doMock re-evaluates the factory for this row's graph.
    vi.doMock('src/ts/process/moduleEnsure', async (importOriginal) => {
        const actual = await importOriginal<typeof import('src/ts/process/moduleEnsure')>()
        return {
            ...actual,
            ensureCurrentModules: (...args: Parameters<typeof actual.ensureCurrentModules>) => {
                h.ensureCalls++
                return actual.ensureCurrentModules(...args)
            },
        }
    })
    const { mount, unmount, flushSync } = await import('svelte')
    const { DBState } = await import('src/ts/stores.svelte')
    const acquire = await import('src/ts/storage/store2/moduleAcquire')
    const bodyModule = await import('./ChatBody.svelte')
    const modules = options.stubs === false ? [] : [stub('m1', 'Alpha')]
    DBState.db = {
        translatorType: options.translatorType ?? 'llm',
        translator: 'ko',
        translatorInputLanguage: 'en',
        aiModel: 'gpt',
        playMessageOnTranslateEnd: false,
        deeplOptions: { freeApi: true, key: 'k' },
        presetRegex: [],
        autoTranslate: true,
        autoTranslateCachedOnly: options.cachedOnly === true,
        translateBeforeHTMLFormatting: false,
        legacyTranslation: options.legacy === true,
        newImageHandlingBeta: false,
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{ id: 'cA', modules: [], message: [] }],
        }],
        modules,
        enabledModules: modules.map((m) => m.id),
        moduleIntergration: '',
        personas: [],
    } as never
    for (const [key, value] of Object.entries(options.cache ?? {})) {
        h.store.set(key, value)
    }

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slots = () => (DBState.db as unknown as { modules: Plain[] }).modules
    let failTriggerRun = options.stubs !== false
    acquire.registerModuleLoader(async (handle: string) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        h.loaderCalls.push(id)
        if (failTriggerRun) {
            failTriggerRun = false
            throw new acquire.ModuleLoadError('unreadable', id, id)
        }
        if (options.loader === 'failing') {
            throw new acquire.ModuleLoadError('unreadable', id, id)
        }
        await gate
        const index = slots().findIndex((m) => m.id === id)
        slots()[index] = { id, name: id, description: '', lorebook: [] }
        return slots()[index] as never
    })

    if (options.stubs !== false) {
        // The body gates its first parse while the selected modules are pending, so it reaches the translator's module
        // wait only once the trigger has failed for the stub: the gate then opens with the stub still unloaded.
        // The recordings of that failed run are cleared, so every assertion below stays about the wait itself.
        const ensureModule = await import('src/ts/process/moduleEnsure')
        ensureModule.ensureSelectedModules(true)
        await settle()
        h.loaderCalls.length = 0
        h.alerts.length = 0
    }

    const target = document.createElement('div')
    document.body.appendChild(target)
    // The revision signal must come from the component's own Svelte runtime: after resetModules that is a different
    // instance from the one this file's `$state` compiles against, and a foreign signal would never re-run the derived.
    const internal = await import('svelte/internal/client')
    const revision = internal.state(0)
    const props = {
        character: 'char',
        idx: 0,
        msgDisplay: 'hello',
        role: 'char',
        translated: !options.cachedOnly,
        translating: false,
        retranslate: false,
        get renderRevision() { return internal.get(revision) },
        modelShortName: '',
    }
    const instance = mount(bodyModule.default, { target, props: props as never })
    flushSync()
    let unmounted = false
    const row: Mounted = {
        target,
        rerunSameInstance: () => {
            internal.set(revision, internal.get(revision) + 1)
            flushSync()
        },
        release,
        unmountBody: async () => {
            if (!unmounted) {
                unmounted = true
                await unmount(instance)
            }
        },
    }
    mounted.push(row)
    return row
}

beforeEach(() => {
    h.alerts.length = 0
    h.store.clear()
    h.requests.length = 0
    h.parseCalls.length = 0
    h.ensureCalls = 0
    h.loaderCalls.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    for (const row of mounted.splice(0)) {
        await row.unmountBody().catch(() => {})
        row.target.remove()
    }
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('ChatBody waits for the translator module check before it builds the LLM input', () => {
    test.each([
        ['non-legacy', false],
        ['legacy', true],
    ])('R1 %s: a gated load releases into exactly one request whose input holds the module output', async (_name, legacy) => {
        const row = await mountRow({ legacy })
        await settle()
        expect(h.requests).toEqual([])
        row.release()
        await settle()

        expect(h.requests).toEqual(['hello+MOD'])
        expect(row.target.textContent).toContain('T:hello+MOD')
    })

    test.each([
        ['non-legacy', false],
        ['legacy', true],
    ])('R2 %s: an unmount during the gated wait sends no request', async (_name, legacy) => {
        const row = await mountRow({ legacy })
        await settle()
        await row.unmountBody()
        row.release()
        await settle()

        expect(h.requests).toEqual([])
    })

    test('R2c cached-only: an unmount during the gated wait builds no lookup input', async () => {
        const row = await mountRow({ cachedOnly: true })
        await settle()
        await row.unmountBody()
        row.release()
        await settle()

        expect(h.parseCalls).toEqual([])
        expect(h.requests).toEqual([])
    })

    test('R3 cached-only: the lookup key is the post-load text, so a pre-load entry is not shown', async () => {
        const row = await mountRow({ cachedOnly: true, cache: { hello: 'CACHED-PRE' } })
        await settle()
        row.release()
        await settle()

        expect(row.target.textContent).not.toContain('CACHED-PRE')
        expect(row.target.textContent).toContain('hello+MOD')
        expect(h.loaderCalls).toEqual(['m1'])
        expect(h.requests).toEqual([])
    })

    // Not a guard on the base: without a wait nothing loads the stub, so the post-load key is never looked up.
    test('G N1 cached-only: a same-instance re-run during the wait does not lose the translation', async () => {
        const row = await mountRow({ cachedOnly: true, cache: { 'hello+MOD': 'CACHED-POST' } })
        await settle()
        row.rerunSameInstance()
        await settle()
        // The re-run is a real second markParsing run of the same instance: it parses without waiting.
        expect(h.parseCalls).toEqual(['hello'])
        row.release()
        await settle(80)

        expect(row.target.textContent).toContain('CACHED-POST')
        expect(h.requests).toEqual([])
    })

    test('G a failed load (the loader fails every call) sends no request and alerts once', async () => {
        const row = await mountRow({ loader: 'failing' })
        await settle(80)

        expect(h.requests).toEqual([])
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.loaderCalls).toEqual(['m1'])
        expect(row.target.textContent).toContain('hello')
    })

    test('G the google translator never waits', async () => {
        const row = await mountRow({ translatorType: 'google', loader: 'failing' })
        await settle(80)

        expect(row.target).toBeTruthy()
        expect(h.ensureCalls).toBe(0)
        expect(h.loaderCalls).toEqual([])
        expect(h.alerts).toEqual([])
    })

    test('G no stubs means no ensure call, and the request is sent without a gate', async () => {
        await mountRow({ stubs: false })
        await settle(80)

        expect(h.ensureCalls).toBe(0)
        expect(h.loaderCalls).toEqual([])
        expect(h.requests).toEqual(['hello+MOD'])
    })
})
