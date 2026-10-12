/**
 * The status table is keyed by catalog id and the picker applies it. Saved ids must keep
 * resolving to their registered entry (hiding never deletes), catalog ids are unique, and the
 * first-run ids resolve to entries that are not retired.
 *
 * Drives the real `LLMModels`, `getModelInfo` and `getModelList`. Mocked: the database, the page
 * store, the plugin stores and the model data service, which this file does not exercise. Dates
 * come from fake timers built from local components, never from date-only ISO strings.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

vi.mock('../storage/database.svelte', () => ({ getDatabase: () => ({}) }))
vi.mock('../stores.svelte', () => ({
    get DBState() { return { db: {} } },
    selectedCharID: writable(-1),
}))
vi.mock('./modelData/modelDataStore', () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
}))
vi.mock('../globalApi.svelte', () => ({ fetchNative: vi.fn(), globalFetch: vi.fn() }))
vi.mock('../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('../plugins/apiV3/v3.svelte', () => ({
    customV3ProviderMetaStore: [{ id: 'pluginmodel:::probe', name: 'Probe', recommended: true }],
}))

//#endregion

import { LLMModels, getModelInfo, getModelList } from './modellist'
import { LLMProvider } from './types'
import { MODEL_STATUS_TABLE } from './modelStatusTable'
import { modelIdStatus } from './modelStatus'
import { FIRST_RUN_MODELS } from './firstRunModels'

function setToday(year: number, month: number, date: number) {
    vi.setSystemTime(new Date(year, month - 1, date, 12, 0, 0))
}

function listedIds(arg: { recommendedOnly: boolean }): string[] {
    return getModelList({ ...arg, groupedByProvider: true }).flatMap(group => group.models.map(model => model.id))
}

beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => structuredClone(value))
    vi.useFakeTimers({ toFake: ['Date'] })
    setToday(2026, 10, 12)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('catalog ids', () => {
    test('are unique', () => {
        const seen = new Set<string>()
        const duplicates = new Set<string>()
        for (const model of LLMModels) {
            if (seen.has(model.id)) { duplicates.add(model.id) }
            seen.add(model.id)
        }
        expect([...duplicates]).toEqual([])
    })

    test('the dated gpt-5 snapshot resolves to its own entry, not the generic fallback', () => {
        const info = getModelInfo('gpt-5-2025-08-07')
        expect(info.internalID).toBe('gpt-5-2025-08-07')
        expect(info.name).toBe('GPT 5 (2025-08-07)')
        expect(info.provider).toBe(LLMProvider.OpenAI)
    })

    test('guard: the saved gpt-5 id keeps resolving to the undated entry', () => {
        expect(getModelInfo('gpt-5').internalID).toBe('gpt-5')
    })
})

describe('status table against the catalog', () => {
    const registered = new Set(LLMModels.map(model => model.id))

    test('guard: every table key is a registered id', () => {
        const missing = Object.keys(MODEL_STATUS_TABLE).filter(id => !registered.has(id))
        expect(missing).toEqual([])
    })

    test('guard: every redirect target is a registered id', () => {
        const missing = Object.values(MODEL_STATUS_TABLE).flatMap(entry => entry.kind === 'redirected' && !registered.has(entry.target) ? [entry.target] : [])
        expect(missing).toEqual([])
    })

    test('guard: a saved id with a status row still resolves to its registered entry, not the generic fallback', () => {
        for (const id of Object.keys(MODEL_STATUS_TABLE)) {
            const info = getModelInfo(id)
            expect(info.id, id).toBe(id)
            expect(info.provider, id).not.toBe(LLMProvider.AsIs)
        }
    })
})

describe('getModelList', () => {
    const HIDDEN = ['claude-3-opus-20240229', 'gemini-3.7-flash', 'gemini-3-pro-preview', 'gpt-5.1-chat-latest', 'novelai', 'gpt35_0613', 'gpt35_0613-response-api']

    test.each([true, false])('recommendedOnly=%s lists no retired or redirected id and keeps deprecated ones', (recommendedOnly) => {
        const ids = new Set(listedIds({ recommendedOnly }))
        for (const id of HIDDEN) {
            expect(ids.has(id), id).toBe(false)
        }
        for (const [id] of Object.entries(MODEL_STATUS_TABLE)) {
            const status = modelIdStatus(id)
            if (status.kind === 'retired' || status.kind === 'redirected') {
                expect(ids.has(id), id).toBe(false)
            }
        }
        expect(ids.has('gpt-5.1')).toBe(true)
        expect(ids.has('gemini-3.5-flash-vertex')).toBe(true)
    })

    test('a deprecated id leaves the list on its shutdown day, with its response-api twin', () => {
        setToday(2026, 10, 22)
        let ids = new Set(listedIds({ recommendedOnly: false }))
        expect(ids.has('o1')).toBe(true)
        expect(ids.has('o1-response-api')).toBe(true)

        setToday(2026, 10, 23)
        ids = new Set(listedIds({ recommendedOnly: false }))
        expect(ids.has('o1')).toBe(false)
        expect(ids.has('o1-response-api')).toBe(false)
    })

    test('includeHidden lists retired and redirected ids too', () => {
        const ids = new Set(getModelList({ recommendedOnly: false, groupedByProvider: true, includeHidden: true }).flatMap(group => group.models.map(model => model.id)))
        expect(ids.has('claude-3-opus-20240229')).toBe(true)
        expect(ids.has('gemini-3.7-flash')).toBe(true)
    })

    test('guard: includeHidden with recommendedOnly still lists only recommended entries', () => {
        const all = getModelList({ recommendedOnly: true, groupedByProvider: true, includeHidden: true }).flatMap(group => group.models)
        expect(all.length).toBeGreaterThan(0)
        expect(all.every(model => model.recommended)).toBe(true)
    })

    test('guard: no provider group is empty', () => {
        for (const recommendedOnly of [true, false]) {
            for (const group of getModelList({ recommendedOnly, groupedByProvider: true })) {
                expect(group.models.length, group.providerName).toBeGreaterThan(0)
            }
        }
    })

    test('a non-grouped call returns a fresh array and leaves the catalog without plugin models', () => {
        const before = LLMModels.length
        getModelList({ recommendedOnly: false })
        getModelList({ recommendedOnly: false, includeHidden: true })
        expect(LLMModels.length).toBe(before)
    })
})

describe('first-run models', () => {
    test.each(Object.entries(FIRST_RUN_MODELS))('%s resolves to a registered entry that is ok', (_provider, id) => {
        expect(LLMModels.some(model => model.id === id)).toBe(true)
        expect(modelIdStatus(id)).toEqual({ kind: 'ok' })
    })
})
