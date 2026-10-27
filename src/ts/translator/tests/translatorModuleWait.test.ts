/**
 * The translator's module wait: `runTranslator` and `translateHTML` over the real `translator.ts`, `moduleEnsure.ts`,
 * `moduleRefList.ts`, `moduleAcquire.ts` and `chatOrigin.ts`, with a loader double registered through
 * `registerModuleLoader`, an `alertError` spy, a counting `requestChatData` and an in-memory `LLMCacheStorage`.
 *
 * Labels: R = reproducer (red on the base because no wait exists), G = guard (passes before and after; the mutants
 * that make the wait run before the cache lookup or on a non-LLM translator turn it red).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'

//#region module mocks

const h = vi.hoisted(() => ({
    state: { db: {} as Record<string, unknown> },
    alerts: [] as string[],
    store: new Map<string, string>(),
    setItemCalls: 0,
    requests: [] as string[],
    regexReads: 0,
    audioPlays: 0,
}))

vi.mock('../../stores.svelte', async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { DBState: h.state, selectedCharID: makeWritable(0) }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertWait: vi.fn(),
}))

vi.mock('../../util', () => ({
    checkPersonaBinded: vi.fn(() => false),
    getNodetextToSentence: vi.fn(() => []),
    sleep: vi.fn(async () => {}),
}))

vi.mock('../../storage/database.svelte', () => {
    const getDatabase = () => h.state.db
    const getCurrentCharacter = () => (h.state.db.characters as unknown[])?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter() as { chats?: unknown[], chatPage?: number } | undefined
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { getDatabase, getCurrentCharacter, getCurrentChat }
})

vi.mock('../../process/index.svelte', async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { doingChat: makeWritable(false) }
})

vi.mock('../../process/request/request', () => ({
    requestChatData: vi.fn(async (req: { formated: { content: string }[] }) => {
        const text = req.formated[req.formated.length - 1].content
        h.requests.push(text)
        return { type: 'success', result: 'T:' + text }
    }),
}))

vi.mock('../../parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('../../parser/parser.svelte', () => ({ applyMarkdownToNode: () => {}, risuChatParser: (data: string) => data }))
vi.mock('../../process/modules', () => ({
    getModuleRegexScripts: () => { h.regexReads++; return [] },
    moduleUpdate: () => {},
}))
vi.mock('../../process/scripts', () => ({ processScriptFull: async (_char: unknown, data: string) => ({ data }) }))
vi.mock('../../globalApi.svelte', () => ({
    globalFetch: async (_url: string, init: { body: { text: string[] } }) => ({
        ok: true,
        data: { translations: [{ text: 'D:' + init.body.text[0] }] },
    }),
}))
vi.mock('../../secretRef', () => ({
    resolveSecret: async (value: string) => value,
    SecretRefError: class SecretRefError extends Error {},
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => h.store.get(key) ?? null,
            setItem: async (key: string, value: string) => { h.setItemCalls++; h.store.set(key, value); return value },
            iterate: async () => {},
            clear: async () => { h.store.clear() },
        }),
    },
}))

//#endregion

import { runTranslator, translate, translateHTML, waitForTranslatorModules } from '../translator'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from '../../storage/store2/moduleAcquire'

type Plain = Record<string, unknown>

let loaderCalls: string[] = []

function stub(id: string, name: string): Plain {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1 }
}

function installDb(translatorType: string, modules: Plain[]) {
    h.state.db = {
        translatorType,
        translator: 'ko',
        translatorInputLanguage: 'en',
        aiModel: 'gpt',
        playMessageOnTranslateEnd: false,
        deeplOptions: { freeApi: true, key: 'k' },
        presetRegex: [],
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [],
            chats: [{ id: 'cA', modules: [], message: [] }, { id: 'cB', modules: [], message: [] }],
        }],
        modules,
        enabledModules: modules.map((m) => m.id),
        moduleIntergration: '',
        personas: [],
    }
}

function slots(): Plain[] {
    return h.state.db.modules as Plain[]
}

/** Gate for a loader double: the load waits for `release`, then fails (or installs a resident body). */
function registerGatedLoader(mode: { fail: boolean, install?: boolean }) {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await gate
        if (mode.fail) {
            throw new ModuleLoadError('unreadable', id, id)
        }
        const index = slots().findIndex((m) => m.id === id)
        if (mode.install !== false) {
            slots()[index] = { id, name: id, description: '', lorebook: [] }
        }
        return slots()[index] as never
    })
    return release
}

function registerFailingLoader() {
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        throw new ModuleLoadError('unreadable', id, id)
    })
}

async function settleTasks() {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

const THREE_CHUNKS = 'one\n\ntwo\n\nthree'
// Used by one row only: the translator's session cache lives at module level, so a text another row finishes
// successfully would answer from the cache and make the row depend on test order.
const STOPPED_ONLY_CHUNKS = 'uno\n\ndos\n\ntres'

beforeEach(() => {
    loaderCalls = []
    h.alerts.length = 0
    h.store.clear()
    h.setItemCalls = 0
    h.requests.length = 0
    h.regexReads = 0
    h.audioPlays = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('Audio', class {
        play() { h.audioPlays++; return Promise.resolve() }
    })
})

afterEach(() => {
    unregisterModuleLoader()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('translator module wait: runTranslator', () => {
    test('R a-three-chunk-run-over-a-failing-module-alerts-once-requests-nothing-caches-nothing', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        registerFailingLoader()

        const result = await runTranslator(STOPPED_ONLY_CHUNKS, false, 'ko', 'en')

        expect(result).toBe(STOPPED_ONLY_CHUNKS)
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.requests).toEqual([])
        expect(h.setItemCalls).toBe(0)
        expect(loaderCalls).toEqual(['m1'])

        // The stopped run left the session cache alone: once the module is there, translate() asks again.
        slots()[0] = { id: 'm1', name: 'Alpha', description: '', lorebook: [] }
        const later = await translate(STOPPED_ONLY_CHUNKS, false)
        expect(h.requests.length).toBe(3)
        expect(later).toContain('T:uno')
    })

    test('R a-second-run-in-the-same-chat-stops-quietly-until-the-chat-changes-or-the-module-loads', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        registerFailingLoader()

        await runTranslator(THREE_CHUNKS, false, 'ko', 'en')
        const second = await runTranslator(THREE_CHUNKS, false, 'ko', 'en')
        expect(second).toBe(THREE_CHUNKS)
        expect(h.alerts).toHaveLength(1)
        expect(loaderCalls).toEqual(['m1'])
        expect(h.requests).toEqual([])

        ;((h.state.db.characters as Plain[])[0]).chatPage = 1
        await runTranslator(THREE_CHUNKS, false, 'ko', 'en')
        expect(h.alerts).toHaveLength(2)
        expect(loaderCalls).toEqual(['m1', 'm1'])

        slots()[0] = { id: 'm1', name: 'Alpha', description: '', lorebook: [] }
        const proceeded = await runTranslator(THREE_CHUNKS, false, 'ko', 'en')
        expect(proceeded).toContain('T:one')
        expect(h.requests.length).toBe(3)
        expect(h.alerts).toHaveLength(2)
    })

    test('G a-cache-hit-causes-no-ensure', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        registerFailingLoader()
        h.store.set('one', 'cached-one')

        const result = await runTranslator('one', false, 'ko', 'en')

        expect(result).toBe('cached-one')
        expect(loaderCalls).toEqual([])
        expect(h.alerts).toEqual([])
    })

    test('R a-ready-run-checks-once-across-its-chunks', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        const release = registerGatedLoader({ fail: false, install: false })
        const pending = runTranslator(THREE_CHUNKS, false, 'ko', 'en')
        await settleTasks()
        release()
        await pending

        expect(h.requests.length).toBe(3)
        expect(loaderCalls).toEqual(['m1'])
    })

    test('G a-non-llm-translator-never-ensures', async () => {
        installDb('deepl', [stub('m1', 'Alpha')])
        registerFailingLoader()

        const result = await runTranslator('one', false, 'ko', 'en')

        expect(result).toBe('D:one')
        expect(loaderCalls).toEqual([])
        expect(h.alerts).toEqual([])
    })
})

describe('translator module wait: translateHTML', () => {
    test('R two-concurrent-translateHTML-runs-give-exactly-one-alert', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        const release = registerGatedLoader({ fail: true })

        const first = translateHTML('<p>one</p>', false, '', -1)
        const second = translateHTML('<p>two</p>', false, '', -1)
        await settleTasks()
        release()
        const results = await Promise.all([first, second])

        expect(results).toEqual(['<p>one</p>', '<p>two</p>'])
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.requests).toEqual([])
        expect(loaderCalls).toEqual(['m1'])

        await expect(translateHTML('<p>three</p>', false, '', -1)).resolves.toBe('<p>three</p>')
        expect(h.alerts).toHaveLength(1)
        expect(loaderCalls).toEqual(['m1'])
        expect(h.setItemCalls).toBe(0)
    })

    test('R a-stopped-translateHTML-returns-the-html-without-the-edittrans-pass-or-the-end-sound', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        ;(h.state.db as Plain).playMessageOnTranslateEnd = true
        registerFailingLoader()

        const result = await translateHTML('<p>one</p>', false, 'char', 0)

        expect(result).toBe('<p>one</p>')
        expect(h.regexReads).toBe(0)
        expect(h.audioPlays).toBe(0)
        expect(h.requests).toEqual([])
    })

    test('G a-translateHTML-run-with-loaded-modules-proceeds-to-the-edittrans-pass-and-the-sound', async () => {
        installDb('llm', [])
        ;(h.state.db as Plain).playMessageOnTranslateEnd = true

        const result = await translateHTML('<p>one</p>', false, 'char', 0)

        expect(result).toBe('T:<p>one</p>')
        expect(h.regexReads).toBe(1)
        expect(h.audioPlays).toBe(1)
    })
})

describe('translator module wait: waitForTranslatorModules', () => {
    test('G a-failed-load-alerts-once-and-the-translator-then-stops-quietly-on-the-shared-memory', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        registerFailingLoader()

        await expect(waitForTranslatorModules()).resolves.toBeUndefined()
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')

        await expect(translateHTML('<p>one</p>', false, '', -1)).resolves.toBe('<p>one</p>')
        expect(h.alerts).toHaveLength(1)
        expect(loaderCalls).toEqual(['m1'])
        expect(h.requests).toEqual([])
    })

    test('G a-wait-with-no-stubs-never-reaches-the-loader', async () => {
        installDb('llm', [])
        registerFailingLoader()

        await waitForTranslatorModules()

        expect(loaderCalls).toEqual([])
        expect(h.alerts).toEqual([])
    })

    test('G the-wait-reads-nothing-in-its-synchronous-part', async () => {
        installDb('llm', [stub('m1', 'Alpha')])
        registerFailingLoader()
        let moduleReads = 0
        const modules = h.state.db.modules
        Object.defineProperty(h.state.db, 'modules', {
            configurable: true,
            get() { moduleReads++; return modules },
        })

        const pending = waitForTranslatorModules()
        // A caller's `$derived.by` tracks only this synchronous part, so the module slots must not be read in it.
        expect(moduleReads).toBe(0)
        await pending
        expect(moduleReads).toBeGreaterThan(0)
    })
})
