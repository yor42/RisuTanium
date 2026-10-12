/**
 * Pure layer of the saved provider lists: reading one page of a provider's
 * model listing, the cumulative item cap and the stored file. Every id and name
 * here comes from a remote response, so the hostile cases must fail against a
 * parser that passes values through unchanged.
 *
 * Labels: (F) feature test that fails against a missing or wrong implementation
 * on its own assertion; (G) guard that passes with any implementation of the
 * same contract.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    PROVIDER_LIST_MAX_ITEMS,
    PROVIDER_LISTS_MAX_FILE_BYTES,
    appendListPage,
    decodeProviderLists,
    emptyProviderLists,
    encodeProviderLists,
    parseProviderListPage,
    type ProviderListItem,
    type ProviderListsData,
} from '../providerListData'

const NOW = 1_800_000_000_000

afterEach(() => {
    vi.restoreAllMocks()
})

function bytesOf(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value))
}

function googleEntry(name: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { name, supportedGenerationMethods: ['generateContent'], ...extra }
}

const HOSTILE_IDS: unknown[] = [
    'pluginmodel:::x',
    'xcustom:::x',
    'hf:::x',
    'horde:::x',
    'a/../../x',
    'a..b',
    '../x',
    'tunedModels/x',
    '<img onerror=alert(1)>',
    'a||b',
    '__proto__',
    'a'.repeat(10 * 1024),
    'a'.repeat(201),
    '-leading',
    ' spaced',
    '',
    5,
    null,
    undefined,
    { id: 'x' },
]

/** Ids that stay hostile after a family prefix is put in front of them. */
const PREFIXABLE = new Set<unknown>(HOSTILE_IDS.filter(id => typeof id === 'string' && id !== '' && id !== '-leading' && id !== '__proto__'))

describe('parseProviderListPage: Google', () => {
    test('(F) keeps generateContent models, strips models/ and keeps the display name', () => {
        const items = parseProviderListPage('google', {
            models: [
                googleEntry('models/gemini-2.5-flash', { displayName: 'Gemini 2.5 Flash' }),
                googleEntry('models/gemini-pro-latest'),
                { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
                { name: 'models/no-methods' },
            ],
        })
        expect(items).toEqual([
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro-latest' },
        ])
    })

    test('(F) a missing models array is an empty page and a non-object body is not a page', () => {
        expect(parseProviderListPage('google', {})).toEqual([])
        expect(parseProviderListPage('google', { models: 'x' })).toBeNull()
        expect(parseProviderListPage('google', null)).toBeNull()
        expect(parseProviderListPage('google', [])).toBeNull()
    })

    test('(F) an id that is not a plain model id is dropped and a good one survives', () => {
        for (const bad of HOSTILE_IDS) {
            const items = parseProviderListPage('google', { models: [googleEntry(bad), typeof bad === 'string' ? googleEntry('models/' + bad) : googleEntry(bad), googleEntry('models/ok')] })
            expect(items, String(bad).slice(0, 40)).toEqual([{ id: 'ok' }])
        }
    })
})

describe('parseProviderListPage: Anthropic and OpenAI', () => {
    test('(F) Anthropic keeps the id and the display name', () => {
        expect(parseProviderListPage('anthropic', { data: [{ id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' }, { id: 'claude-x' }] })).toEqual([
            { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
            { id: 'claude-x' },
        ])
        expect(parseProviderListPage('anthropic', {})).toEqual([])
    })

    test('(F) OpenAI keeps gpt- ids without a name and needs a data array', () => {
        expect(parseProviderListPage('openai', { data: [{ id: 'gpt-4.1', name: 'ignored' }, { id: 'o3' }, { id: 'text-embedding-3-small' }, { id: 'gpt-5-pro' }] })).toEqual([
            { id: 'gpt-4.1' },
            { id: 'gpt-5-pro' },
        ])
        expect(parseProviderListPage('openai', {})).toBeNull()
        expect(parseProviderListPage('openai', { data: 'x' })).toBeNull()
    })

    test('(F) hostile ids are dropped in every family', () => {
        for (const bad of HOSTILE_IDS) {
            const openAI = parseProviderListPage('openai', { data: [{ id: bad }, { id: PREFIXABLE.has(bad) ? 'gpt-' + String(bad) : bad }, { id: 'gpt-ok' }] })
            expect(openAI, 'openai ' + String(bad).slice(0, 40)).toEqual([{ id: 'gpt-ok' }])
            const anthropic = parseProviderListPage('anthropic', { data: [{ id: bad }, { id: 'claude-ok' }] })
            expect(anthropic, 'anthropic ' + String(bad).slice(0, 40)).toEqual([{ id: 'claude-ok' }])
        }
    })

    test('(F) entries that are not objects are skipped', () => {
        expect(parseProviderListPage('anthropic', { data: [null, 'claude-x', 5, [], { id: 'claude-ok' }] })).toEqual([{ id: 'claude-ok' }])
    })

    test('(F) a 200 character id is kept and a 201 character one is not', () => {
        const ok = 'a'.repeat(200)
        expect(parseProviderListPage('anthropic', { data: [{ id: ok }, { id: ok + 'a' }] })).toEqual([{ id: ok }])
    })
})

describe('display names', () => {
    test('(F) control characters are removed and the name is capped at 100 characters', () => {
        const items = parseProviderListPage('anthropic', {
            data: [
                { id: 'a1', display_name: 'Cl\u0000au\u0007de\n\r\t \u007f\u0085x' },
                { id: 'a2', display_name: 'n'.repeat(250) },
                { id: 'a3', display_name: '😀'.repeat(150) },
            ],
        })
        expect(items?.[0].name).toBe('Claude x')
        expect(items?.[1].name).toBe('n'.repeat(100))
        expect(Array.from(items?.[2].name ?? '')).toHaveLength(100)
        expect(items?.[2].name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    })

    test('(F) a name that is not a string or is empty after cleaning leaves the item without a name', () => {
        const items = parseProviderListPage('anthropic', {
            data: [
                { id: 'a1', display_name: 5 },
                { id: 'a2', display_name: '\u0000\u0001' },
                { id: 'a3', display_name: '   ' },
                { id: 'a4', display_name: { x: 1 } },
            ],
        })
        expect(items).toEqual([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }])
    })

    test('(G) markup in a name is kept as text, never interpreted here', () => {
        const items = parseProviderListPage('anthropic', { data: [{ id: 'a1', display_name: '<img src=x onerror=alert(1)>' }] })
        expect(items?.[0].name).toBe('<img src=x onerror=alert(1)>')
    })
})

describe('item cap', () => {
    function manyGoogle(usable: number, unusable: number): unknown {
        const models: unknown[] = []
        for (let i = 0; i < usable; i++) {
            models.push(googleEntry('models/m' + i))
        }
        for (let i = 0; i < unusable; i++) {
            models.push({ name: 'models/skip' + i, supportedGenerationMethods: ['embedContent'] })
        }
        return { models }
    }

    test('(F) the cap counts items after the family filter, so unusable raw items do not count', () => {
        const items = parseProviderListPage('google', manyGoogle(100, 2000))
        expect(items).toHaveLength(100)
        expect(parseProviderListPage('google', manyGoogle(PROVIDER_LIST_MAX_ITEMS, 0))).toHaveLength(PROVIDER_LIST_MAX_ITEMS)
    })

    test('(G) more than 2,000 items after the filter in one response is an invalid response', () => {
        expect(parseProviderListPage('google', manyGoogle(PROVIDER_LIST_MAX_ITEMS + 1, 0))).toBeNull()
    })

    test('(F) the cap is cumulative across pages', () => {
        const page = (from: number, count: number): ProviderListItem[] => Array.from({ length: count }, (_, i) => ({ id: 'm' + (from + i) }))
        const first = appendListPage([], page(0, 1500))
        expect(first).toHaveLength(1500)
        expect(appendListPage(first ?? [], page(1500, 500))).toHaveLength(PROVIDER_LIST_MAX_ITEMS)
        expect(appendListPage(first ?? [], page(1500, 501))).toBeNull()
    })

    test('(F) an id repeated on a later page counts once', () => {
        const first = appendListPage([], [{ id: 'a', name: 'First' }, { id: 'b' }])
        expect(appendListPage(first ?? [], [{ id: 'a', name: 'Second' }, { id: 'c' }])).toEqual([
            { id: 'a', name: 'First' },
            { id: 'b' },
            { id: 'c' },
        ])
    })

    test('(G) appending does not change the list it extends', () => {
        const first: ProviderListItem[] = [{ id: 'a' }]
        const next = appendListPage(first, [{ id: 'b' }])
        expect(first).toEqual([{ id: 'a' }])
        expect(next).not.toBe(first)
    })
})

describe('stored file', () => {
    function sample(): ProviderListsData {
        return {
            v: 1,
            lists: {
                openai: { fetchedAt: NOW, items: [{ id: 'gpt-4.1' }, { id: 'gpt-5-pro' }] },
                google: { fetchedAt: NOW - 5, items: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }] },
            },
        }
    }

    test('(F) round trips', () => {
        const bytes = encodeProviderLists(sample())
        expect(bytes).not.toBeNull()
        expect(decodeProviderLists(bytes ?? new Uint8Array())).toEqual(sample())
    })

    test('(G) an empty file value decodes to no lists', () => {
        expect(decodeProviderLists(bytesOf(emptyProviderLists()))).toEqual({ v: 1, lists: {} })
    })

    test('(G) encode returns null above the 256 KB cap', () => {
        const items: ProviderListItem[] = []
        for (let i = 0; i < PROVIDER_LIST_MAX_ITEMS; i++) {
            items.push({ id: 'g' + i + 'x'.repeat(180), name: 'n'.repeat(100) })
        }
        expect(encodeProviderLists({ v: 1, lists: { google: { fetchedAt: NOW, items } } })).toBeNull()
    })

    test('(G) the stored length is checked before JSON.parse', () => {
        const spy = vi.spyOn(JSON, 'parse')
        expect(decodeProviderLists(new Uint8Array(PROVIDER_LISTS_MAX_FILE_BYTES + 1).fill(0x20))).toEqual({ v: 1, lists: {} })
        expect(spy).not.toHaveBeenCalled()
    })

    test('(G) corrupt, foreign and old-version files decode to no lists', () => {
        const none = { v: 1, lists: {} }
        expect(decodeProviderLists(new TextEncoder().encode('not json'))).toEqual(none)
        expect(decodeProviderLists(new Uint8Array([0xff, 0xfe]))).toEqual(none)
        expect(decodeProviderLists(bytesOf([]))).toEqual(none)
        expect(decodeProviderLists(bytesOf({ v: 2, lists: sample().lists }))).toEqual(none)
        expect(decodeProviderLists(bytesOf({ lists: sample().lists }))).toEqual(none)
        expect(decodeProviderLists(bytesOf({ v: 1, lists: 'x' }))).toEqual(none)
    })

    test('(F) a malformed family is dropped alone', () => {
        const decoded = decodeProviderLists(bytesOf({
            v: 1,
            lists: {
                openai: { fetchedAt: NOW, items: 'x' },
                anthropic: { fetchedAt: 'now', items: [{ id: 'claude-x' }] },
                google: { fetchedAt: NOW, items: [{ id: 'gemini-x' }] },
            },
        }))
        expect(decoded).toEqual({ v: 1, lists: { google: { fetchedAt: NOW, items: [{ id: 'gemini-x' }] } } })
    })

    test('(F) an item that fails the rules is dropped alone and its name is cleaned', () => {
        const decoded = decodeProviderLists(bytesOf({
            v: 1,
            lists: {
                anthropic: {
                    fetchedAt: NOW,
                    items: [
                        { id: 'claude-ok', name: 'Cl\u0000aude' },
                        ...HOSTILE_IDS.map(id => ({ id })),
                        'claude-bare-string',
                        { id: 'claude-two' },
                    ],
                },
                openai: { fetchedAt: NOW, items: [{ id: 'o3' }, { id: 'gpt-ok' }] },
            },
        }))
        expect(decoded.lists.anthropic?.items).toEqual([{ id: 'claude-ok', name: 'Claude' }, { id: 'claude-two' }])
        expect(decoded.lists.openai?.items).toEqual([{ id: 'gpt-ok' }])
    })

    test('(F) a family above the item cap is dropped, unknown families and fields are ignored', () => {
        const items = Array.from({ length: PROVIDER_LIST_MAX_ITEMS + 1 }, (_, i) => ({ id: 'a' + i }))
        const decoded = decodeProviderLists(bytesOf({
            v: 1,
            future: true,
            lists: {
                anthropic: { fetchedAt: NOW, items },
                evil: { fetchedAt: NOW, items: [{ id: 'x' }] },
                google: { fetchedAt: NOW, extra: 1, items: [{ id: 'gemini-x', extra: 2 }] },
            },
        }))
        expect(decoded).toEqual({ v: 1, lists: { google: { fetchedAt: NOW, items: [{ id: 'gemini-x' }] } } })
    })

    test('(F) the decoded dictionary has no inherited family', () => {
        const decoded = decodeProviderLists(bytesOf({ v: 1, lists: { google: { fetchedAt: NOW, items: [{ id: 'gemini-x' }] } } }))
        expect(Object.getPrototypeOf(decoded.lists)).toBeNull()
        expect((decoded.lists as Record<string, unknown>)['constructor']).toBeUndefined()
    })
})
