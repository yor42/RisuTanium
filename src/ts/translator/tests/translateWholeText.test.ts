/**
 * `translateWholeText`: one translator request for a whole spoken text, over the real `translator.ts` with a counting
 * `requestChatData`, a counting `globalFetch` and `fetch`, an `alertError` spy and an in-memory `LLMCacheStorage`.
 *
 * All rows are feature guards for a new export: they pin the request count, the display-path language arguments and
 * the failure fallbacks that auto speech relies on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    state: { db: {} as Record<string, unknown> },
    alerts: [] as string[],
    store: new Map<string, string>(),
    requests: [] as string[],
    systemPrompts: [] as string[],
    requestResult: { type: 'success', result: '' } as { type: string, result: string } | null,
    deeplCalls: 0,
    deeplOk: true,
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
    const getCurrentChat = () => undefined
    return { getDatabase, getCurrentCharacter, getCurrentChat }
})

vi.mock('../../process/index.svelte', async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { doingChat: makeWritable(false) }
})

vi.mock('../../process/request/request', () => ({
    requestChatData: vi.fn(async (req: { formated: { role: string, content: string }[] }) => {
        h.requests.push(req.formated[req.formated.length - 1].content)
        h.systemPrompts.push(req.formated[0].content)
        return h.requestResult ?? { type: 'success', result: 'T:' + req.formated[req.formated.length - 1].content }
    }),
}))

vi.mock('../../parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('../../parser/parser.svelte', () => ({ applyMarkdownToNode: () => {}, risuChatParser: (data: string) => data }))
vi.mock('../../process/modules', () => ({ getModuleRegexScripts: () => [], moduleUpdate: () => {} }))
vi.mock('../../process/scripts', () => ({ processScriptFull: async (_char: unknown, data: string) => ({ data }) }))
vi.mock('../../globalApi.svelte', () => ({
    globalFetch: async (_url: string, init: { body: { text: string[] } }) => {
        h.deeplCalls++
        return h.deeplOk
            ? { ok: true, data: { translations: [{ text: 'D:' + init.body.text[0] }] } }
            : { ok: false, data: ': quota' }
    },
}))
vi.mock('../../secretRef', () => ({
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

import { translateWholeText } from '../translator'

const FIVE_PARAGRAPHS = 'one\n\ntwo\n\nthree\n\nfour\n\nfive'

function installDb(translatorType: string, extra: Record<string, unknown> = {}) {
    h.state.db = {
        translatorType,
        translator: 'ko',
        translatorInputLanguage: 'ja',
        aiModel: 'gpt',
        playMessageOnTranslateEnd: false,
        deeplOptions: { freeApi: true, key: 'k' },
        presetRegex: [],
        characters: [{ chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [], chats: [] }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        ...extra,
    }
}

beforeEach(() => {
    h.alerts.length = 0
    h.store.clear()
    h.requests.length = 0
    h.systemPrompts.length = 0
    h.requestResult = null
    h.deeplCalls = 0
    h.deeplOk = true
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('translateWholeText', () => {
    test('TW-1 guard: the LLM translator gets the whole multi-paragraph text in one request', async () => {
        installDb('llm')

        const result = await translateWholeText(FIVE_PARAGRAPHS)

        expect(h.requests).toEqual([FIVE_PARAGRAPHS])
        expect(result).toBe('T:' + FIVE_PARAGRAPHS)
    })

    test('TW-2 guard: Google makes one GET and DeepL one POST for the same text', async () => {
        const fetchMock = vi.fn(async () => ({ json: async () => [[['G:whole']]] }))
        vi.stubGlobal('fetch', fetchMock)
        installDb('google')

        const google = await translateWholeText(FIVE_PARAGRAPHS)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(google).toBe('G:whole')
        expect(decodeURIComponent(String((fetchMock.mock.calls[0] as unknown[])[0]).split('&q=')[1])).toBe(FIVE_PARAGRAPHS)

        installDb('deepl')
        const deepl = await translateWholeText(FIVE_PARAGRAPHS)

        expect(h.deeplCalls).toBe(1)
        expect(deepl).toBe('D:' + FIVE_PARAGRAPHS)
    })

    test('TW-3 guard: the LLM source language is the translator input language, the target the translator language', async () => {
        installDb('llm', { translatorPrompt: '{{slot::from}}>{{slot}}' })

        await translateWholeText('hello')

        expect(h.systemPrompts).toEqual(['ja>ko'])
    })

    test('TW-4 guard: a DeepL failure returns the original and alerts; an LLM cache hit makes no request', async () => {
        installDb('deepl')
        h.deeplOk = false

        const failed = await translateWholeText('hello')

        expect(failed).toBe('hello')
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('DeepL API Error')

        installDb('llm')
        h.store.set('cached text', 'CACHED')
        const hit = await translateWholeText('cached text')

        expect(hit).toBe('CACHED')
        expect(h.requests).toEqual([])
    })

    test('guard: an empty or blank result returns the original', async () => {
        installDb('llm')
        h.requestResult = { type: 'success', result: '   ' }

        expect(await translateWholeText('hello')).toBe('hello')
    })

    test('guard: the original text, not the trimmed one, comes back when there is nothing to translate', async () => {
        installDb('llm')

        expect(await translateWholeText('  \n')).toBe('  \n')
        expect(h.requests).toEqual([])
    })
})
