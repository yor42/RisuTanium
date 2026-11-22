import { describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

// The real model list is read; the stores and services its module graph touches are mocked.
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({}) }))
vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return { db: {} } },
    selectedCharID: writable(-1),
}))
vi.mock('src/ts/model/modelData/modelDataStore', () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
}))
vi.mock('src/ts/globalApi.svelte', () => ({ fetchNative: vi.fn(), globalFetch: vi.fn() }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('src/ts/plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))

import { LLMModels } from 'src/ts/model/modellist'
import { setSlotKey } from '../slotEditor'
import { addPrefillName, addableProviders, OAICOMP_KIDS, PROVIDER_CATALOG } from '../providerCatalog'

function makeDb(): Database {
    return { customModels: [] } as unknown as Database
}

describe('addableProviders', () => {
    it('T3: omits a provider that has a connection, keeps reverse proxy, never offers custom', async () => {
        const db = makeDb()
        expect(addableProviders(db).map((e) => e.provider)).toContain('openai')
        await setSlotKey(db, 'openAIKey', 'sk-test-AAAA1234')
        await setSlotKey(db, 'OaiCompAPIKeys:deepseek', 'sk-test-BBBB5678')
        await setSlotKey(db, 'proxyKey', 'sk-test-CCCC9012')
        const offered = addableProviders(db).map((e) => e.provider)
        expect(offered).not.toContain('openai')
        expect(offered).not.toContain('oaicomp:deepseek')
        expect(offered).toContain('oaicomp:deepinfra')
        expect(offered).toContain('reverse_proxy')
        expect(offered).not.toContain('custom')
        expect(PROVIDER_CATALOG.map((e) => e.provider)).not.toContain('custom')
    })

    it('groups and flags match the plan', () => {
        const by = Object.fromEntries(PROVIDER_CATALOG.map((e) => [e.provider, e]))
        expect(by.openrouter.group).toBe('router')
        expect(by.ollama.group).toBe('local')
        expect(by.reverse_proxy).toMatchObject({ group: 'compatible', takesUrl: true })
        expect(by.openai.takesUrl).toBe(false)
        expect(by.vertex.multilineKey).toBe(true)
        expect(PROVIDER_CATALOG.filter((e) => e.multilineKey).map((e) => e.provider)).toEqual(['vertex'])
        expect(by['oaicomp:deepseek'].label).toBe('deepseek')
    })
})

describe('OaiComp kids', () => {
    it('T4: the catalog constant equals the key identifiers of the real model list', () => {
        const kids = [...new Set(LLMModels.map((m) => m.keyIdentifier).filter((k): k is string => typeof k === 'string'))]
        expect([...OAICOMP_KIDS].sort()).toEqual(kids.sort())
        expect(PROVIDER_CATALOG.filter((e) => e.provider.startsWith('oaicomp:')).map((e) => e.provider.slice(8)).sort())
            .toEqual([...OAICOMP_KIDS].sort())
    })
})

describe('addPrefillName', () => {
    it('suffixes a taken default name and names a proxy by its host', async () => {
        const db = makeDb()
        expect(addPrefillName(db, 'openai')).toBe('OpenAI')
        await setSlotKey(db, 'openAIKey', 'sk-test-AAAA1234')
        expect(addPrefillName(db, 'openai')).toBe('OpenAI 2')
        expect(addPrefillName(db, 'reverse_proxy', 'https://p.invalid/v1')).toBe('p.invalid')
        expect(addPrefillName(db, 'reverse_proxy', 'nonsense')).toBe('Reverse proxy')
    })
})
