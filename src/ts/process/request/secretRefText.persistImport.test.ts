/**
 * The dynamic model registry hands each provider list to the registry first and to the saved-list
 * store second. When the store module cannot even be imported, the live list must still reach the
 * registry: the picker gains the model, `registerModelDynamic` resolves, nothing is unhandled and
 * the failures are logged as `'Model data'`.
 *
 * Drives the real `registerModelDynamic` and `getModelList`. Mocked: the transport
 * (`fetchNative`), the database holder, and the platform and plugin modules. The store module
 * is replaced, per test, by a factory that throws, so the dynamic import itself rejects.
 * Nothing here says anything about the real store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string) => {
        if (String(url).includes('generativelanguage')) {
            return new Response(JSON.stringify({ models: [{ name: 'models/gemini-h4', displayName: 'Gemini H4', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 })
        }
        return new Response(JSON.stringify({ models: [], data: [] }), { status: 200 })
    }),
    globalFetch: vi.fn(),
}))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    selectedCharID: writable(-1),
}))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('../../plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))

const unhandled: unknown[] = []
const recordUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', recordUnhandled)
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, { dynamicModelRegistry: true, google: { accessToken: 'plain-key' }, claudeAPIKey: '', openAIKey: '' })
})

afterEach(() => {
    process.off('unhandledRejection', recordUnhandled)
    vi.doUnmock('../../model/modelData/modelDataStore')
    vi.resetModules()
})

describe('H4 the saved-list store module cannot be imported', () => {
    test('the live list still reaches the registry, the call resolves, and the failures are logged as Model data (the start hook import and the persist import; mutant: await persistence before the registry)', async () => {
        vi.doMock('../../model/modelData/modelDataStore', () => { throw new Error('scratch: store import failed') })
        vi.resetModules()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { registerModelDynamic, getModelList } = await import('../../model/modellist')

        await expect(registerModelDynamic()).resolves.toBeUndefined()
        await vi.dynamicImportSettled()
        await new Promise((resolve) => setTimeout(resolve, 0))

        const listed = getModelList({ recommendedOnly: false, groupedByProvider: false }).map(model => model.id)
        expect(listed).toContain('dynamic_google_gemini-h4')
        const logged = errorSpy.mock.calls.filter((args) => args[0] === 'Model data')
        expect(logged.length).toBeGreaterThanOrEqual(1)
        expect(unhandled).toEqual([])
        errorSpy.mockRestore()
    })
})
