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
import { GLOBAL_SLOT_PROVIDERS, providerLabel, SERVICE_SLOTS } from '../connections'
import { addPrefillName, addableProviders, OAICOMP_KIDS, PROVIDER_CATALOG } from '../providerCatalog'

const SERVICE_SLOT_PROVIDERS = SERVICE_SLOTS.map((slot) => GLOBAL_SLOT_PROVIDERS[slot])

function makeDb(): Database {
    return { customModels: [] } as unknown as Database
}

describe('addableProviders', () => {
    it('T3: omits a provider that has a connection, keeps reverse proxy and custom', async () => {
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
        expect(offered).toContain('custom')
        expect(PROVIDER_CATALOG.find((e) => e.provider === 'custom')).toMatchObject({ group: 'compatible', takesUrl: true, label: 'Custom endpoint' })
    })

    it('groups and flags match the plan', () => {
        const by = Object.fromEntries(PROVIDER_CATALOG.map((e) => [e.provider, e]))
        expect(by.openrouter.group).toBe('router')
        expect(by.ollama.group).toBe('local')
        expect(by.reverse_proxy).toMatchObject({ group: 'compatible', takesUrl: true })
        expect(by.openai.takesUrl).toBe(false)
        expect(by.vertex.singleKey).toBe(true)
        expect(PROVIDER_CATALOG.filter((e) => e.singleKey).map((e) => e.provider)).toEqual(['vertex', ...SERVICE_SLOT_PROVIDERS])
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

describe('services group', () => {
    it('C-CAT: lists the 13 service providers in table order, each with the plug icon', () => {
        const services = PROVIDER_CATALOG.filter((e) => e.group === 'services')
        expect(services.map((e) => e.provider)).toEqual(SERVICE_SLOT_PROVIDERS)
        expect(services).toHaveLength(13)
        expect(services.every((e) => e.icon === 'plug' && !e.takesUrl)).toBe(true)
        expect(addableProviders(makeDb()).filter((e) => e.group === 'services')).toHaveLength(13)
    })

    it('C-SINGLE: singleKey is exactly vertex plus the 13 services', () => {
        const single = PROVIDER_CATALOG.filter((e) => e.singleKey).map((e) => e.provider)
        expect(single).toHaveLength(14)
        expect(single).toContain('vertex')
        expect(PROVIDER_CATALOG.filter((e) => !e.singleKey).every((e) => e.group !== 'services')).toBe(true)
    })

    it('C-LABEL: every service entry carries its provider label, never the bare id', () => {
        for (const entry of PROVIDER_CATALOG.filter((e) => e.group === 'services')) {
            expect(entry.label).toBe(providerLabel(entry.provider))
            expect(entry.label).not.toBe(entry.provider)
        }
    })
})
