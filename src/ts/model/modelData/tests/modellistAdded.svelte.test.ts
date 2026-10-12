/**
 * Added models in `modellist.ts`: how a saved id resolves (`getModelInfo`), what the picker list
 * gains (`getModelList`), and the provider list pass (`refreshProviderLists`, called by
 * `registerModelDynamic`).
 *
 * Drives the real catalog, the real registry and the real model data service. MOCKED: the
 * provider transport (`fetchNative`, a scripted queue per family), the database holder, the model
 * data store module (its saved-list functions are spies), the platform and plugin modules.
 * Nothing here says anything about the providers' real pagination fields or about a native
 * backend; the request URLs are asserted as strings.
 *
 * Labels: (F) feature test; its red evidence was taken against a stub implementation (neutral stubs
 * of the new exports), where it failed on its own assertion; (G) compatibility guard: it passes
 * against the old code and the new code, and the named mutants are its falsification.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GPT5XHighParameters, LLMFlags, LLMFormat, LLMProvider } from '../../types'
import type { LiteLLMData, LiteLLMRow } from '../litellmData'

type Reply = { json: unknown } | { status: number } | { throws: Error }
type Family = 'google' | 'anthropic' | 'openai'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    plugins: [] as Array<Record<string, unknown>>,
    calls: [] as Array<{ family: string, url: string }>,
    queues: { google: [], anthropic: [], openai: [] } as Record<string, unknown[]>,
    afterServe: null as null | ((family: string, index: number) => void),
    save: vi.fn(),
    startModelData: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return { db: h.db } },
        selectedCharID: writable(-1),
    }
})
vi.mock('src/ts/model/modelData/modelDataStore', () => ({
    startModelData: h.startModelData,
    refreshModelDataNow: vi.fn(),
    loadProviderLists: vi.fn(),
    saveProviderLists: h.save,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string) => {
        const family = url.includes('generativelanguage') ? 'google' : url.includes('anthropic.com') ? 'anthropic' : 'openai'
        h.calls.push({ family, url })
        const reply = (h.queues[family].shift() ?? { json: family === 'google' ? { models: [] } : { data: [] } }) as Reply
        h.afterServe?.(family, h.calls.filter(call => call.family === family).length)
        if ('throws' in reply) {
            throw reply.throws
        }
        if ('status' in reply) {
            return new Response('{}', { status: reply.status })
        }
        return new Response(JSON.stringify(reply.json), { status: 200 })
    }),
    globalFetch: vi.fn(),
}))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/plugins/plugins.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        customProviderStore: writable([]),
        pluginV2: { providerOptions: new Map(), providers: new Map() },
    }
})
vi.mock('src/ts/plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: h.plugins }))

import { getModelInfo, getModelList, refreshProviderLists, registerModelDynamic } from 'src/ts/model/modellist'
import { resetAddedModelsForTests, seedProviderLists, setProviderList } from '../addedModels.svelte'
import { resetModelDataForTests, seedLiteLLMForTests } from '../modelDataService.svelte'

const NOW = 1_800_000_000_000
const OPENAI_FLAGS = [LLMFlags.hasStreaming, LLMFlags.OAICompletionTokens, LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.DeveloperRole]

function datasetOf(rows: Record<string, Partial<LiteLLMRow>>): LiteLLMData {
    const out: Record<string, LiteLLMRow> = Object.create(null) as Record<string, LiteLLMRow>
    for (const [key, row] of Object.entries(rows)) {
        out[key] = { p: 'openai', m: 'chat', ctx: 1000, ...row }
    }
    return { v: 1, fetchedAt: NOW, rows: out }
}

function reply(family: Family, ...replies: Reply[]): void {
    h.queues[family].push(...replies)
}

const googlePage = (ids: string[], next?: string): Reply => ({
    json: {
        models: ids.map(id => ({ name: 'models/' + id, displayName: id, supportedGenerationMethods: ['generateContent'] })),
        ...(next === undefined ? {} : { nextPageToken: next }),
    },
})
const anthropicPage = (ids: string[], hasMore: boolean): Reply => ({
    json: { data: ids.map(id => ({ id, display_name: id })), has_more: hasMore, last_id: ids[ids.length - 1], first_id: ids[0] },
})
const openaiPage = (ids: string[]): Reply => ({ json: { data: ids.map(id => ({ id })) } })

function setKeys(keys: { openai?: string, anthropic?: string, google?: string }): void {
    h.db.openAIKey = keys.openai ?? ''
    h.db.claudeAPIKey = keys.anthropic ?? ''
    h.db.google = { accessToken: keys.google ?? '' }
}

const ALL_KEYS = { openai: 'k', anthropic: 'k', google: 'k' }

const listIds = () => getModelList({ recommendedOnly: false, groupedByProvider: false }).map(model => model.id)
const urlsOf = (family: Family) => h.calls.filter(call => call.family === family).map(call => call.url)

async function settle(): Promise<void> {
    await vi.dynamicImportSettled()
    await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
    // A real copy, not an identity stub: the guards on the clone need one. The setup file's stub also
    // cannot clone `undefined`, which an implementation that clones before the catalog lookup hands it
    // for an unknown id; `getModelInfo` itself clones only on a hit.
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => structuredClone(value))
    resetModelDataForTests()
    resetAddedModelsForTests()
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, { dynamicModelRegistry: true, enableCustomFlags: false, customFlags: [] })
    setKeys(ALL_KEYS)
    h.plugins.length = 0
    h.calls.length = 0
    h.queues.google = []
    h.queues.anthropic = []
    h.queues.openai = []
    h.afterServe = null
    h.save.mockReset()
    h.startModelData.mockReset()
})

/** The provider lists reach the registry through the public entry point, as at boot. */
async function boot(): Promise<void> {
    await registerModelDynamic()
    await settle()
}

describe('compatibility guards: a saved id resolves as it does today (R1, N1, N3, R2)', () => {
    test('(G) a listed near-duplicate OpenAI id resolves to the plain entry with today\'s flags, and its twin to the Response API entry (mutant: canonical coverage or deny list in resolution)', async () => {
        reply('openai', openaiPage(['gpt-5.1-2025-11-13']))
        await boot()

        const plain = getModelInfo('gpt-5.1-2025-11-13')
        expect(plain.provider).toBe(LLMProvider.OpenAI)
        expect(plain.format).toBe(LLMFormat.OpenAICompatible)
        expect(plain.internalID).toBe('gpt-5.1-2025-11-13')
        expect(plain.flags).toEqual(OPENAI_FLAGS)
        expect(plain.parameters).toEqual([...GPT5XHighParameters])

        const twin = getModelInfo('gpt-5.1-2025-11-13-response-api')
        expect(twin.provider).toBe(LLMProvider.OpenAI)
        expect(twin.format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(twin.internalID).toBe('gpt-5.1-2025-11-13')
        expect(twin.flags).toEqual([...OPENAI_FLAGS, LLMFlags.hasPrefill])
    })

    test('(G) a near-duplicate Anthropic id resolves through its dynamic_anthropic_ form (mutant: canonical coverage in resolution)', async () => {
        reply('anthropic', anthropicPage(['claude-opus-4-6-20260205'], false))
        await boot()

        const info = getModelInfo('dynamic_anthropic_claude-opus-4-6-20260205')
        expect(info.provider).toBe(LLMProvider.Anthropic)
        expect(info.format).toBe(LLMFormat.Anthropic)
        expect(info.internalID).toBe('claude-opus-4-6-20260205')
        expect(info.flags).toEqual([LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt, LLMFlags.hasStreaming, LLMFlags.claudeThinking, LLMFlags.claudeAdaptiveThinking])
    })

    test('(G) an id that only matches a built-in internalID stays as-is, an exact catalog id returns the catalog entry, and a twin of a built-in is as-is (N3)', async () => {
        seedLiteLLMForTests(datasetOf({ 'gpt-4o': {}, 'gpt-4': {}, 'gpt-4o-mini': {}, 'gpt-4.1': {} }))
        reply('openai', openaiPage(['gpt-4o', 'gpt-4', 'gpt-4o-mini', 'gpt-4.1']))
        await boot()

        for (const id of ['gpt-4o', 'gpt-4', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o-response-api']) {
            expect(getModelInfo(id).provider, id).toBe(LLMProvider.AsIs)
        }
        expect(getModelInfo('gpt-5.1').id).toBe('gpt-5.1')
        expect(getModelInfo('gpt-5.1').provider).toBe(LLMProvider.OpenAI)
    })

    test('(G) a listed responses-only model still resolves as the plain OpenAI entry (N1; mutant: twin policy applied in resolution)', async () => {
        seedLiteLLMForTests(datasetOf({ 'gpt-5-pro': { m: 'responses', ep: ['responses'] } }))
        reply('openai', openaiPage(['gpt-5-pro']))
        await boot()

        const plain = getModelInfo('gpt-5-pro')
        expect(plain.provider).toBe(LLMProvider.OpenAI)
        expect(plain.format).toBe(LLMFormat.OpenAICompatible)
        expect(getModelInfo('gpt-5-pro-response-api').format).toBe(LLMFormat.OpenAIResponseAPI)
    })

    test('(G) bare claude- and gemini- ids stay as-is even though the registry holds them; the dynamic_ forms resolve (R2; mutant: bare lookup)', async () => {
        reply('anthropic', anthropicPage(['claude-opus-5-5'], false))
        reply('google', googlePage(['gemini-3.1-flash-lite']))
        await boot()

        expect(getModelInfo('claude-opus-5-5').provider).toBe(LLMProvider.AsIs)
        expect(getModelInfo('gemini-3.1-flash-lite').provider).toBe(LLMProvider.AsIs)
        expect(getModelInfo('dynamic_anthropic_claude-opus-5-5').provider).toBe(LLMProvider.Anthropic)
        expect(getModelInfo('dynamic_google_gemini-3.1-flash-lite').provider).toBe(LLMProvider.GoogleCloud)
    })

    test('(G) a plugin model and a custom model resolve to their own entries while added models are loaded (F3 precedence)', async () => {
        const plugin = { id: 'pluginmodel:::p1', name: 'P1', provider: LLMProvider.AsIs, format: LLMFormat.OpenAICompatible, flags: [], parameters: [], tokenizer: 0 }
        h.plugins.push(plugin)
        h.db.customModels = [{ id: 'xcustom:::c1', name: 'C1', internalId: 'c-model', format: LLMFormat.OpenAICompatible, flags: [], tokenizer: 0 }]
        reply('openai', openaiPage(['gpt-9-new']))
        await boot()

        expect(getModelInfo('pluginmodel:::p1')).toBe(plugin)
        expect(getModelInfo('xcustom:::c1').internalID).toBe('c-model')
        expect(getModelInfo('pluginmodel:::missing').provider).toBe(LLMProvider.AsIs)
    })

    test('(G) hostile dynamic_ ids resolve as-is and never reach a request path', () => {
        for (const id of ['dynamic_google_a/b', 'dynamic_google_../x', 'dynamic_anthropic_x:::y', 'dynamic_google_a..b', 'dynamic_anthropic_', 'dynamic_google_<img onerror=1>']) {
            const info = getModelInfo(id)
            expect(info.provider, id).toBe(LLMProvider.AsIs)
            expect(info.internalID, id).toBe(id)
        }
    })
})

describe('resolution of a saved id', () => {
    test('(F) dynamic_google_ and dynamic_anthropic_ ids resolve from the id alone: empty registry, option off, no key', () => {
        h.db.dynamicModelRegistry = false
        setKeys({})

        const google = getModelInfo('dynamic_google_gemini-x')
        expect(google.provider).toBe(LLMProvider.GoogleCloud)
        expect(google.format).toBe(LLMFormat.GoogleCloud)
        expect(google.internalID).toBe('gemini-x')
        const anthropic = getModelInfo('dynamic_anthropic_claude-x-1')
        expect(anthropic.provider).toBe(LLMProvider.Anthropic)
        expect(anthropic.internalID).toBe('claude-x-1')
    })

    test('(F) a saved bare OpenAI id resolves from the saved list with no key and the option off', () => {
        h.db.dynamicModelRegistry = false
        setKeys({})
        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })

        expect(getModelInfo('gpt-9-saved').provider).toBe(LLMProvider.OpenAI)
        expect(getModelInfo('gpt-9-saved-response-api').format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(getModelInfo('gpt-9-unknown').provider).toBe(LLMProvider.AsIs)
    })

    test('(F) a bare OpenAI id that only the dataset would create resolves, with the twin policy applied; option and key do not matter', () => {
        h.db.dynamicModelRegistry = false
        setKeys({})
        seedLiteLLMForTests(datasetOf({
            'gpt-9-data': {},
            'gpt-9-resp': { m: 'responses', ep: ['responses'] },
            'gpt-9-old': { dep: '2020-01-01' },
            'gpt-9-audio-preview': {},
        }))

        expect(getModelInfo('gpt-9-data').provider).toBe(LLMProvider.OpenAI)
        expect(getModelInfo('gpt-9-data-response-api').format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(getModelInfo('gpt-9-resp').provider).toBe(LLMProvider.AsIs)
        expect(getModelInfo('gpt-9-resp-response-api').provider).toBe(LLMProvider.OpenAI)
        expect(getModelInfo('gpt-9-old').provider).toBe(LLMProvider.OpenAI)
        expect(getModelInfo('gpt-9-audio-preview').provider).toBe(LLMProvider.AsIs)
    })

    test('(F) every hit gets the custom-flags override and is a copy (mutant: skip the override)', () => {
        const custom = [LLMFlags.hasPrefill]
        h.db.enableCustomFlags = true
        h.db.customFlags = custom
        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })
        seedLiteLLMForTests(datasetOf({ 'gpt-9-data': {} }))

        for (const id of ['dynamic_google_gemini-x', 'dynamic_anthropic_claude-x-1', 'gpt-9-saved', 'gpt-9-saved-response-api', 'gpt-9-data']) {
            const first = getModelInfo(id)
            expect(first.flags, id).toEqual(custom)
            first.name = 'changed'
            first.parameters.push('changed' as never)
            const second = getModelInfo(id)
            expect(second.name, id).not.toBe('changed')
            expect(second.parameters, id).not.toContain('changed')
        }
    })

    test('(G) a built-in catalog entry is a copy: the custom-flags override never reaches the catalog (mutant: no clone)', () => {
        const custom = [LLMFlags.hasPrefill]
        const literal = [...getModelInfo('gpt-5.1').flags]
        expect(literal).not.toEqual(custom)
        h.db.enableCustomFlags = true
        h.db.customFlags = custom

        const withOverride = getModelInfo('gpt-5.1')
        expect(withOverride.id).toBe('gpt-5.1')
        expect(withOverride.flags).toEqual(custom)
        withOverride.name = 'changed'
        withOverride.parameters.push('changed' as never)

        h.db.enableCustomFlags = false
        const after = getModelInfo('gpt-5.1')
        expect(after.flags).toEqual(literal)
        expect(after.name).not.toBe('changed')
        expect(after.parameters).not.toContain('changed')
    })

    test('(F) with the override off the entries keep their own flags', () => {
        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })

        expect(getModelInfo('gpt-9-saved').flags).toEqual(OPENAI_FLAGS)
        expect(getModelInfo('dynamic_google_gemini-x').flags).toContain(LLMFlags.geminiThinking)
    })
})

describe('getModelList', () => {
    test('(F) appends the listed added entries to the catalog; the built-ins are untouched', () => {
        const before = listIds()
        setProviderList('google', [{ id: 'gemini-x' }])
        setProviderList('openai', [{ id: 'gpt-9-new' }])

        const after = listIds()
        expect(after.slice(0, before.length)).toEqual(before)
        expect(after).toContain('dynamic_google_gemini-x')
        expect(after).toContain('gpt-9-new')
        expect(after).toContain('gpt-9-new-response-api')
        expect(after.length).toBe(before.length + 3)
    })

    test('(F) a near-duplicate and a non-chat listed id are not in the list yet resolve as OpenAI (mutant: list them, or stop resolving them)', async () => {
        reply('openai', openaiPage(['gpt-4.1-2025-04-14', 'gpt-4o-search-preview', 'gpt-9-new']))
        await boot()

        const listed = listIds()
        expect(listed).not.toContain('gpt-4.1-2025-04-14')
        expect(listed).not.toContain('gpt-4o-search-preview')
        expect(listed).toContain('gpt-9-new')
        expect(getModelInfo('gpt-4.1-2025-04-14').provider).toBe(LLMProvider.OpenAI)
        expect(getModelInfo('gpt-4o-search-preview').provider).toBe(LLMProvider.OpenAI)
    })

    test('(F) only entries listed by both sources are recommended; gray ones appear with unrecommended models, and grouping puts them under their provider', () => {
        setProviderList('anthropic', [{ id: 'claude-both-1' }, { id: 'claude-list-2' }])
        seedLiteLLMForTests(datasetOf({ 'claude-both-1': { p: 'anthropic' }, 'gpt-9-data': {} }))

        const recommended = getModelList({ recommendedOnly: true, groupedByProvider: false }).map(model => model.id)
        expect(recommended).toContain('dynamic_anthropic_claude-both-1')
        expect(recommended).not.toContain('dynamic_anthropic_claude-list-2')
        expect(recommended).not.toContain('gpt-9-data')
        expect(listIds()).toContain('dynamic_anthropic_claude-list-2')
        expect(listIds()).toContain('gpt-9-data')

        const groups = getModelList({ recommendedOnly: false, groupedByProvider: true })
        const anthropic = groups.find(group => group.models.some(model => model.id === 'dynamic_anthropic_claude-both-1'))
        expect(anthropic?.providerName).toBe('Anthropic')
        expect(anthropic?.models.some(model => model.id === 'dynamic_anthropic_claude-list-2')).toBe(true)
    })

    test('(F) the option off lists no added entry; clearing a key turns a both-listed entry gray', () => {
        setProviderList('anthropic', [{ id: 'claude-both-1' }])
        seedLiteLLMForTests(datasetOf({ 'claude-both-1': { p: 'anthropic' } }))
        const recommendedIds = () => getModelList({ recommendedOnly: true, groupedByProvider: false }).map(model => model.id)

        expect(recommendedIds()).toContain('dynamic_anthropic_claude-both-1')
        setKeys({ openai: 'k', google: 'k' })
        expect(recommendedIds()).not.toContain('dynamic_anthropic_claude-both-1')
        expect(listIds()).toContain('dynamic_anthropic_claude-both-1')
        h.db.dynamicModelRegistry = false
        expect(listIds()).not.toContain('dynamic_anthropic_claude-both-1')
    })
})

describe('registerModelDynamic (the public path)', () => {
    test('(F) F8: running it twice lists the Google model once, and the entry\'s internalID is the bare id', async () => {
        reply('google', googlePage(['gemini-x']), googlePage(['gemini-x']))

        await boot()
        await boot()

        expect(listIds().filter(id => id === 'dynamic_google_gemini-x')).toHaveLength(1)
        expect(getModelInfo('dynamic_google_gemini-x').internalID).toBe('gemini-x')
    })

    test('(F) the start hook gets the registry seed: a saved list it is handed becomes resolvable', async () => {
        setKeys({})
        await boot()

        expect(h.startModelData).toHaveBeenCalledTimes(1)
        const [autoRefresh, seed] = h.startModelData.mock.calls[0] as [boolean, (saved: unknown) => void]
        expect(autoRefresh).toBe(true)
        expect(typeof seed).toBe('function')
        seed({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })

        expect(getModelInfo('gpt-9-saved').provider).toBe(LLMProvider.OpenAI)
    })

    test('(G) with the option off nothing is fetched and the hook still gets false', async () => {
        h.db.dynamicModelRegistry = false

        await boot()

        expect(h.calls).toEqual([])
        expect(h.startModelData.mock.calls[0][0]).toBe(false)
    })

    test('(F) each successful family is handed to the saved-list store; a family that fails is not', async () => {
        reply('google', googlePage(['gemini-x']))
        reply('anthropic', { throws: new Error('scratch: network') })
        reply('openai', openaiPage(['gpt-9-new']))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await boot()
        errors.mockRestore()

        expect(h.save.mock.calls.map(call => call[0]).sort()).toEqual(['google', 'openai'])
        const openai = h.save.mock.calls.find(call => call[0] === 'openai')?.[1] as { fetchedAt: number, items: Array<{ id: string }> }
        expect(openai.items.map(item => item.id)).toEqual(['gpt-9-new'])
        expect(typeof openai.fetchedAt).toBe('number')
    })

    test('(F) a saved-list store whose save never settles does not delay the live lists (mutant: await persistence before the registry)', async () => {
        h.save.mockImplementation(() => new Promise<void>(() => {}))
        reply('openai', openaiPage(['gpt-9-new']))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')

        expect(listIds()).toContain('gpt-9-new')
    })

    test('(F) a saved-list store whose save rejects is logged once as Model data and is not unhandled', async () => {
        const unhandled: unknown[] = []
        const record = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', record)
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        h.save.mockRejectedValue(new Error('scratch: save rejected'))
        setKeys({ openai: 'k' })
        reply('openai', openaiPage(['gpt-9-new']))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')
        await settle()
        process.off('unhandledRejection', record)

        expect(errors.mock.calls.filter(args => args[0] === 'Model data')).toHaveLength(1)
        expect(unhandled).toEqual([])
        expect(listIds()).toContain('gpt-9-new')
        errors.mockRestore()
    })
})

describe('refreshProviderLists', () => {
    test('(F) F6 Google: pageSize on the first request, nextPageToken followed as pageToken, both pages listed', async () => {
        reply('google', googlePage(['gemini-a'], 'TOKEN-1'), googlePage(['gemini-b']))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')
        await settle()

        const urls = urlsOf('google').map(url => new URL(url))
        expect(urls).toHaveLength(2)
        expect(urls[0].searchParams.get('pageSize')).toBe('1000')
        expect(urls[0].searchParams.get('pageToken')).toBeNull()
        expect(urls[0].searchParams.get('key')).toBe('k')
        expect(urls[1].searchParams.get('pageToken')).toBe('TOKEN-1')
        expect(listIds()).toEqual(expect.arrayContaining(['dynamic_google_gemini-a', 'dynamic_google_gemini-b']))
        const saved = h.save.mock.calls.find(call => call[0] === 'google')?.[1] as { items: Array<{ id: string }> }
        expect(saved.items.map(item => item.id)).toEqual(['gemini-a', 'gemini-b'])
    })

    test('(F) F6 Anthropic: limit on the first request, has_more followed as after_id=<last_id>, both pages listed', async () => {
        reply('anthropic', anthropicPage(['claude-a-1', 'claude-a-2'], true), anthropicPage(['claude-b-1'], false))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')

        const urls = urlsOf('anthropic').map(url => new URL(url))
        expect(urls).toHaveLength(2)
        expect(urls[0].searchParams.get('limit')).toBe('1000')
        expect(urls[0].searchParams.get('after_id')).toBeNull()
        expect(urls[1].searchParams.get('after_id')).toBe('claude-a-2')
        expect(listIds()).toEqual(expect.arrayContaining(['dynamic_anthropic_claude-a-1', 'dynamic_anthropic_claude-a-2', 'dynamic_anthropic_claude-b-1']))
    })

    test('(G) F6 OpenAI: one request, no paging parameters', async () => {
        reply('openai', openaiPage(['gpt-9-new']))

        await refreshProviderLists(() => true)

        expect(urlsOf('openai')).toEqual(['https://api.openai.com/v1/models'])
    })

    test('(F) the 11th page fails the family: ten requests, nothing applied, the saved list stays in use', async () => {
        seedProviderLists({ v: 1, lists: { google: { fetchedAt: 1, items: [{ id: 'gemini-saved' }] } } })
        for (let page = 0; page < 12; page++) {
            reply('google', googlePage([`gemini-p${page}`], `TOKEN-${page}`))
        }
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(refreshProviderLists(() => true)).resolves.toBe('failed')
        errors.mockRestore()

        expect(urlsOf('google')).toHaveLength(10)
        expect(listIds()).not.toContain('dynamic_google_gemini-p0')
        expect(listIds()).not.toContain('dynamic_google_gemini-p9')
        expect(h.save.mock.calls.find(call => call[0] === 'google')).toBeUndefined()
        expect(getModelInfo('dynamic_google_gemini-saved').provider).toBe(LLMProvider.GoogleCloud)
        expect(listIds()).toContain('dynamic_google_gemini-saved')
    })

    test('(F) an item-cap overrun across two pages fails the family and applies nothing from the first page', async () => {
        const first = Array.from({ length: 1500 }, (_, index) => `claude-a-${index}`)
        const second = Array.from({ length: 600 }, (_, index) => `claude-b-${index}`)
        reply('anthropic', anthropicPage(first, true), anthropicPage(second, false))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(refreshProviderLists(() => true)).resolves.toBe('failed')
        errors.mockRestore()

        expect(listIds().some(id => id.startsWith('dynamic_anthropic_'))).toBe(false)
        expect(h.save.mock.calls.find(call => call[0] === 'anthropic')).toBeUndefined()
    })

    test.each([
        ['a non-200 answer', { status: 500 } as Reply],
        ['a transport failure', { throws: new Error('scratch: network') } as Reply],
        ['a body that is not an object', { json: ['not', 'a', 'list'] } as Reply],
    ])('(F) page 2 failing with %s fails the family, applies nothing from page 1 and keeps the saved list', async (_title, failure) => {
        seedProviderLists({ v: 1, lists: { google: { fetchedAt: 1, items: [{ id: 'gemini-saved' }] } } })
        reply('google', googlePage(['gemini-a'], 'TOKEN-1'), failure)
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(refreshProviderLists(() => true)).resolves.toBe('failed')
        errors.mockRestore()

        expect(listIds()).not.toContain('dynamic_google_gemini-a')
        expect(listIds()).toContain('dynamic_google_gemini-saved')
        expect(h.save.mock.calls.find(call => call[0] === 'google')).toBeUndefined()
    })

    test('(F) the option turned off before page 2 stops the family: page 2 is not requested, nothing is applied (mutant: option checked once per family)', async () => {
        let on = true
        h.afterServe = (family, index) => { if (family === 'google' && index === 1) { on = false } }
        reply('google', googlePage(['gemini-a'], 'TOKEN-1'), googlePage(['gemini-b']))

        await expect(refreshProviderLists(() => on)).resolves.toBe('skipped')

        expect(urlsOf('google')).toHaveLength(1)
        expect(listIds()).not.toContain('dynamic_google_gemini-a')
        expect(h.save).not.toHaveBeenCalled()
    })

    test('(F) the option turned off between families: later families are never requested', async () => {
        let on = true
        h.afterServe = (family) => { if (family === 'google') { on = false } }
        reply('google', googlePage(['gemini-a']))

        const outcome = await refreshProviderLists(() => on)

        expect(outcome).toBe('ok')
        expect(urlsOf('anthropic')).toEqual([])
        expect(urlsOf('openai')).toEqual([])
    })

    test('(G) the option off from the start requests nothing', async () => {
        await expect(refreshProviderLists(() => false)).resolves.toBe('skipped')

        expect(h.calls).toEqual([])
    })

    test('(F) two concurrent passes share one request per family and one outcome (mutant: no shared promise)', async () => {
        reply('google', googlePage(['gemini-a']))
        reply('anthropic', anthropicPage(['claude-a-1'], false))
        reply('openai', openaiPage(['gpt-9-new']))

        const [first, second] = await Promise.all([refreshProviderLists(() => true), refreshProviderLists(() => true)])

        expect(first).toBe('ok')
        expect(second).toBe('ok')
        expect(h.calls.map(call => call.family)).toEqual(['google', 'anthropic', 'openai'])
        await refreshProviderLists(() => true)
        expect(h.calls).toHaveLength(6)
    })

    test('(F) a missing key skips the family: no request, no write, the saved list is unchanged', async () => {
        setKeys({ openai: 'k' })
        seedProviderLists({ v: 1, lists: { google: { fetchedAt: 1, items: [{ id: 'gemini-saved' }] } } })
        reply('openai', openaiPage(['gpt-9-new']))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')
        await settle()

        expect(urlsOf('google')).toEqual([])
        expect(urlsOf('anthropic')).toEqual([])
        expect(h.save.mock.calls.map(call => call[0])).toEqual(['openai'])
        expect(getModelInfo('dynamic_google_gemini-saved').provider).toBe(LLMProvider.GoogleCloud)
    })

    test('(G) no key at all is a skipped pass', async () => {
        setKeys({})

        await expect(refreshProviderLists(() => true)).resolves.toBe('skipped')

        expect(h.calls).toEqual([])
    })

    test('(F) a failed fetch keeps the saved list in use and in the picker (mutant: clear the list on failure)', async () => {
        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-9-saved' }] } } })
        reply('openai', { throws: new Error('scratch: network') })
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(refreshProviderLists(() => true)).resolves.toBe('failed')
        errors.mockRestore()

        expect(listIds()).toContain('gpt-9-saved')
        expect(getModelInfo('gpt-9-saved').provider).toBe(LLMProvider.OpenAI)
        expect(h.save).not.toHaveBeenCalled()
    })

    test('(F) a family that answers with no usable item keeps its saved list and counts as ok (mutant: apply the empty list)', async () => {
        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: 1, items: [{ id: 'gpt-x' }] } } })
        setKeys({ openai: 'k' })
        reply('openai', openaiPage(['o1-mini', 'text-embedding-3-small']))

        await expect(refreshProviderLists(() => true)).resolves.toBe('ok')
        await settle()

        expect(getModelInfo('gpt-x').provider).toBe(LLMProvider.OpenAI)
        expect(listIds()).toContain('gpt-x')
        expect(h.save).not.toHaveBeenCalled()
    })

    test('(F) a failing family does not stop the others, and the pass reports failed', async () => {
        reply('google', { throws: new Error('scratch: network') })
        reply('anthropic', anthropicPage(['claude-a-1'], false))
        reply('openai', openaiPage(['gpt-9-new']))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(refreshProviderLists(() => true)).resolves.toBe('failed')
        errors.mockRestore()

        expect(listIds()).toEqual(expect.arrayContaining(['dynamic_anthropic_claude-a-1', 'gpt-9-new']))
    })

    test('(F) a second pass after the first replaces the live list and leaves one entry per id', async () => {
        reply('openai', openaiPage(['gpt-9-new']), openaiPage(['gpt-9-new', 'gpt-9-newer']))

        await refreshProviderLists(() => true)
        await refreshProviderLists(() => true)

        expect(listIds().filter(id => id === 'gpt-9-new')).toHaveLength(1)
        expect(listIds()).toContain('gpt-9-newer')
    })
})
