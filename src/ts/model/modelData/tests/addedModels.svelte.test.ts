/**
 * The registry of added models: one reactive cell replaced whole at the three replacement points
 * (a live list, a saved list, a new dataset), and read-time classification (key, option, clock)
 * in the getters.
 *
 * Runs the real registry and the real model data service. MOCKED: the database holder only. The two
 * no-catalog tests load their own fresh module instances; every other test resets the shared ones.
 *
 * Labels: (F) feature test; its red evidence was taken against a stub implementation, where it
 * failed on its own assertion; (G) guard that passes with any implementation of the same contract; the named mutants
 * are the falsification of the guards.
 */
import { flushSync } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LLMFlags, LLMProvider, type LLMModel } from '../../types'
import type { CatalogModel } from '../addedModelsData'
import type { LiteLLMData, LiteLLMRow } from '../litellmData'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return { db: h.db } },
}))

import * as reg from '../addedModels.svelte'
import * as svc from '../modelDataService.svelte'

const NOW = 1_800_000_000_000

/** `gpt-4.1` is a built-in; `gpt-4.1-2025-04-14` is its near-duplicate. */
const CATALOG: CatalogModel[] = [
    { id: 'gpt4o', internalID: 'gpt-4o', provider: LLMProvider.OpenAI },
    { id: 'gpt-4.1', internalID: 'gpt-4.1', provider: LLMProvider.OpenAI },
    { id: 'claude-opus-4-6', internalID: 'claude-opus-4-6', provider: LLMProvider.Anthropic },
    { id: 'gemini-2.5-pro', internalID: 'models/gemini-2.5-pro', provider: LLMProvider.GoogleCloud },
]

function datasetOf(rows: Record<string, Partial<LiteLLMRow>>): LiteLLMData {
    const out: Record<string, LiteLLMRow> = Object.create(null) as Record<string, LiteLLMRow>
    for (const [key, row] of Object.entries(rows)) {
        out[key] = { p: 'openai', m: 'chat', ctx: 1000, ...row }
    }
    return { v: 1, fetchedAt: NOW, rows: out }
}

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12)

function ids(models: LLMModel[]): string[] {
    return models.map(model => model.id).sort()
}

function setKeys(keys: { openai?: string, anthropic?: string, google?: string }): void {
    h.db.openAIKey = keys.openai ?? ''
    h.db.claudeAPIKey = keys.anthropic ?? ''
    h.db.google = { accessToken: keys.google ?? '' }
}

const ALL_KEYS = { openai: 'k', anthropic: 'k', google: 'k' }

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    h.db.dynamicModelRegistry = true
    setKeys(ALL_KEYS)
    svc.resetModelDataForTests()
    reg.resetAddedModelsForTests()
    reg.registerCatalog(() => CATALOG)
})

describe('no catalog (N5)', () => {
    test('(G) with no registered catalog a list and a dataset create and admit nothing', async () => {
        vi.resetModules()
        const bare = await import('../addedModels.svelte')
        const service = await import('../modelDataService.svelte')
        bare.setProviderList('openai', [{ id: 'gpt-9-new' }])
        bare.setProviderList('anthropic', [{ id: 'claude-new-9' }])
        service.seedLiteLLMForTests(datasetOf({ 'gpt-9-newer': {} }))

        expect(bare.getListedAddedModels()).toEqual([])
        expect(bare.resolveAdded('gpt-9-new')).toBeNull()
        expect(bare.resolveAdded('gpt-9-newer')).toBeNull()
        expect(bare.resolveAdded('dynamic_google_gemini-x')).toBeNull()
        expect(bare.addedSourceOf('gpt-9-new')).toBeUndefined()
    })

    test('(F) registering the catalog recomputes: lists held before it now take effect', async () => {
        vi.resetModules()
        const bare = await import('../addedModels.svelte')
        bare.setProviderList('anthropic', [{ id: 'claude-new-9' }])
        expect(bare.getListedAddedModels()).toEqual([])

        bare.registerCatalog(() => CATALOG)

        expect(ids(bare.getListedAddedModels())).toEqual(['dynamic_anthropic_claude-new-9'])
    })
})

describe('replacement points', () => {
    test('(F) a live list is listed with its entries: Google and Anthropic one each, OpenAI the plain entry and its twin', () => {
        reg.setProviderList('google', [{ id: 'gemini-x', name: 'Gemini X' }])
        reg.setProviderList('anthropic', [{ id: 'claude-new-9' }])
        reg.setProviderList('openai', [{ id: 'gpt-9-new' }])

        expect(ids(reg.getListedAddedModels())).toEqual([
            'dynamic_anthropic_claude-new-9', 'dynamic_google_gemini-x', 'gpt-9-new', 'gpt-9-new-response-api',
        ])
        const google = reg.getListedAddedModels().find(model => model.id === 'dynamic_google_gemini-x')
        expect(google?.internalID).toBe('gemini-x')
        expect(google?.name).toBe('Gemini X')
    })

    test('(F) setting the same list twice leaves one entry per id (idempotent)', () => {
        const list = [{ id: 'gpt-9-new' }, { id: 'claude-ignored' }]
        reg.setProviderList('openai', list)
        reg.setProviderList('openai', list)
        reg.setProviderList('openai', [...list, ...list])

        expect(ids(reg.getListedAddedModels())).toEqual(['gpt-9-new', 'gpt-9-new-response-api'])
    })

    test('(F) a new live list replaces the earlier one of its family', () => {
        reg.setProviderList('anthropic', [{ id: 'claude-old-1' }])
        reg.setProviderList('anthropic', [{ id: 'claude-new-2' }])

        expect(ids(reg.getListedAddedModels())).toEqual(['dynamic_anthropic_claude-new-2'])
    })

    test('(F) a saved list fills a family that has no live list', () => {
        reg.seedProviderLists({ v: 1, lists: { anthropic: { fetchedAt: 1, items: [{ id: 'claude-saved-1' }] } } })

        expect(ids(reg.getListedAddedModels())).toEqual(['dynamic_anthropic_claude-saved-1'])
    })

    test('(F) a saved list that arrives after a live list does not overwrite it', () => {
        reg.setProviderList('openai', [{ id: 'gpt-9-fresh' }])
        reg.seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] }, anthropic: { fetchedAt: 1, items: [{ id: 'claude-saved-1' }] } } })

        expect(reg.resolveAdded('gpt-9-fresh')).not.toBeNull()
        expect(reg.resolveAdded('gpt-9-saved')).toBeNull()
        expect(ids(reg.getListedAddedModels())).toEqual(['dynamic_anthropic_claude-saved-1', 'gpt-9-fresh', 'gpt-9-fresh-response-api'])
    })

    test('(F) a live list that arrives after a saved list replaces it', () => {
        reg.seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })
        reg.setProviderList('openai', [{ id: 'gpt-9-fresh' }])

        expect(reg.resolveAdded('gpt-9-saved')).toBeNull()
        expect(reg.resolveAdded('gpt-9-fresh')).not.toBeNull()
    })

    test('(F) a dataset replacement recomputes, and clearing it removes dataset-only entries', () => {
        svc.seedLiteLLMForTests(datasetOf({ 'gpt-9-data': {} }))
        expect(ids(reg.getListedAddedModels())).toEqual(['gpt-9-data', 'gpt-9-data-response-api'])

        svc.seedLiteLLMForTests(null)
        expect(reg.getListedAddedModels()).toEqual([])
    })
})

describe('listing rules read at call time', () => {
    test('(F) both sources with a key is white and recommended; the key cleared turns it gray with no refetch (mutant: key sampled at recompute)', () => {
        reg.setProviderList('anthropic', [{ id: 'claude-new-9' }])
        svc.seedLiteLLMForTests(datasetOf({ 'claude-new-9': { p: 'anthropic' } }))

        expect(reg.addedSourceOf('dynamic_anthropic_claude-new-9')).toBe('both')
        expect(reg.getListedAddedModels()[0].recommended).toBe(true)

        setKeys({ openai: 'k', google: 'k' })

        expect(reg.addedSourceOf('dynamic_anthropic_claude-new-9')).toBe('dataset')
        expect(reg.getListedAddedModels()[0].recommended).toBe(false)
    })

    test('(F) dataset-only and provider-only entries are not recommended; provider-only needs a key to be listed', () => {
        reg.setProviderList('anthropic', [{ id: 'claude-listed-1' }])
        svc.seedLiteLLMForTests(datasetOf({ 'gpt-9-data': {} }))

        const listed = reg.getListedAddedModels()
        expect(listed.every(model => model.recommended === false)).toBe(true)
        expect(reg.addedSourceOf('dynamic_anthropic_claude-listed-1')).toBe('provider')
        expect(reg.addedSourceOf('gpt-9-data')).toBe('dataset')

        setKeys({ openai: 'k', google: 'k' })

        expect(ids(reg.getListedAddedModels())).toEqual(['gpt-9-data', 'gpt-9-data-response-api'])
        expect(reg.resolveAdded('dynamic_anthropic_claude-listed-1')).not.toBeNull()
    })

    test('(F) a dataset-only entry whose deprecation date is today or past is hidden, tomorrow is shown (mutant: < for <=)', () => {
        svc.seedLiteLLMForTests(datasetOf({ 'gpt-9-data': { dep: '2026-10-10' } }))

        expect(reg.getListedAddedModels(day(2026, 10, 9))).not.toEqual([])
        expect(reg.getListedAddedModels(day(2026, 10, 10))).toEqual([])
        expect(reg.getListedAddedModels(day(2026, 10, 11))).toEqual([])
    })

    test('(F) an entry listed by both sources with a key stays listed past its date (mutant: the date applied to both)', () => {
        reg.setProviderList('openai', [{ id: 'gpt-9-data' }])
        svc.seedLiteLLMForTests(datasetOf({ 'gpt-9-data': { dep: '2026-10-10' } }))

        expect(ids(reg.getListedAddedModels(day(2026, 12, 1)))).toEqual(['gpt-9-data', 'gpt-9-data-response-api'])
    })

    test('(F) a date-hidden dataset entry still resolves and still reports its source', () => {
        svc.seedLiteLLMForTests(datasetOf({ 'gpt-9-data': { dep: '2026-10-10' } }))

        expect(reg.getListedAddedModels(day(2026, 12, 1))).toEqual([])
        expect(reg.resolveAdded('gpt-9-data')?.provider).toBe(LLMProvider.OpenAI)
        expect(reg.addedSourceOf('gpt-9-data')).toBe('dataset')
    })

    test('(F) with the option off nothing is listed, while a saved id still resolves and reports its source', () => {
        reg.setProviderList('openai', [{ id: 'gpt-9-new' }])
        h.db.dynamicModelRegistry = false

        expect(reg.getListedAddedModels()).toEqual([])
        expect(reg.resolveAdded('gpt-9-new')).not.toBeNull()
        expect(reg.addedSourceOf('gpt-9-new')).toBe('provider')
    })

    test('(F) a listed id that is a near-duplicate or non-chat is not listed, yet resolves and reports its source', () => {
        reg.setProviderList('openai', [{ id: 'gpt-4.1-2025-04-14' }, { id: 'gpt-4o-search-preview' }, { id: 'gpt-9-new' }])

        expect(ids(reg.getListedAddedModels())).toEqual(['gpt-9-new', 'gpt-9-new-response-api'])
        expect(reg.resolveAdded('gpt-4.1-2025-04-14')?.provider).toBe(LLMProvider.OpenAI)
        expect(reg.resolveAdded('gpt-4o-search-preview-response-api')?.provider).toBe(LLMProvider.OpenAI)
        expect(reg.addedSourceOf('gpt-4.1-2025-04-14')).toBe('provider')
        expect(reg.addedSourceOf('gpt-4o-search-preview-response-api')).toBe('provider')
    })

    test('(G) addedSourceOf is undefined for a built-in, an unknown id and a (b) id with no registry entry', () => {
        reg.setProviderList('openai', [{ id: 'gpt-9-new' }])

        expect(reg.addedSourceOf('gpt-4.1')).toBeUndefined()
        expect(reg.addedSourceOf('gpt4o')).toBeUndefined()
        expect(reg.addedSourceOf('gpt-unknown-1')).toBeUndefined()
        expect(reg.addedSourceOf('dynamic_google_gemini-unlisted')).toBeUndefined()
        expect(reg.addedSourceOf('dynamic_anthropic_claude-unlisted')).toBeUndefined()
        expect(reg.addedSourceOf('claude-opus-4-6')).toBeUndefined()
        expect(reg.addedSourceOf('')).toBeUndefined()
    })

    test('(F) a bare claude- or gemini- id is never reported or resolved, even when the registry holds it', () => {
        reg.setProviderList('anthropic', [{ id: 'claude-opus-5-5' }])
        reg.setProviderList('google', [{ id: 'gemini-3.1-flash-lite' }])

        expect(reg.addedSourceOf('claude-opus-5-5')).toBeUndefined()
        expect(reg.addedSourceOf('gemini-3.1-flash-lite')).toBeUndefined()
        expect(reg.resolveAdded('claude-opus-5-5')).toBeNull()
        expect(reg.resolveAdded('gemini-3.1-flash-lite')).toBeNull()
        expect(reg.addedSourceOf('dynamic_anthropic_claude-opus-5-5')).toBe('provider')
        expect(reg.addedSourceOf('dynamic_google_gemini-3.1-flash-lite')).toBe('provider')
    })

    test('(F) the listing hands out copies: changing one never changes the next listing or the next lookup', () => {
        reg.setProviderList('anthropic', [{ id: 'claude-new-9' }])

        const listing = reg.getListedAddedModels()
        expect(listing).toHaveLength(1)
        const first = listing[0]
        first.recommended = true
        first.name = 'changed'
        first.flags.push(LLMFlags.hasPrefill)

        const second = reg.getListedAddedModels()[0]
        expect(second.recommended).toBe(false)
        expect(second.name).toBe('claude-new-9')
        expect(second.flags).not.toContain(LLMFlags.hasPrefill)
        expect(reg.resolveAdded('dynamic_anthropic_claude-new-9')?.flags).not.toContain(LLMFlags.hasPrefill)
    })
})

describe('reading the cell inside a derived (E2)', () => {
    test('(F) the getters never write a rune: calling them in a $derived while a list arrives does not throw', async () => {
        reg.setProviderList('openai', [{ id: 'gpt-9-new' }])
        const seen: string[][] = []
        const cleanup = $effect.root(() => {
            const listed = $derived(ids(reg.getListedAddedModels()))
            $effect(() => { seen.push(listed) })
        })
        flushSync()

        reg.setProviderList('anthropic', [{ id: 'claude-new-9' }])
        flushSync()

        cleanup()
        expect(seen[0]).toEqual(['gpt-9-new', 'gpt-9-new-response-api'])
        expect(seen[seen.length - 1]).toEqual(['dynamic_anthropic_claude-new-9', 'gpt-9-new', 'gpt-9-new-response-api'])
    })
})
