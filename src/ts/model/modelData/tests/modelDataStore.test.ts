/**
 * Production wiring of the model data service (`modelDataStore.ts`): the
 * global fetch, the page's byte store and the write permission. The page's
 * app store is replaced by a stand-in that offers the same three functions
 * the wiring uses (the real module's import graph loads the whole
 * application), and the fetch is a stub, so this is a wiring check and says
 * nothing about store selection, a native backend or the live listing.
 *
 * The wiring refreshes two keyless sources (OpenRouter and the LiteLLM
 * dataset), so a refresh makes two requests and writes two keys. The stub
 * answers each URL with its own body.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LLMProvider } from '../../types'
import type { ByteStore, ReadResult, StoreCondition, WriteResult } from '../../../storage/store/contract'
import { resetPageStorageModeForTests, setPageStorageMode } from '../../../storage/pageStorageMode'
import { OPENROUTER_DATA_KEY, decodeOpenRouterData } from '../openrouterData'
import { LITELLM_DATA_KEY, LITELLM_DATA_URL, decodeLiteLLMData } from '../litellmData'
import { PROVIDER_LISTS_KEY, encodeProviderLists, type ProviderListsData } from '../providerListData'
import { getModelContextLimit, modelDataStatus, resetModelDataForTests, type TaskOutcome } from '../modelDataService.svelte'
import { refreshAllNow, refreshModelDataNow, resetProviderListsStateForTests, startModelData } from '../modelDataStore'

const pageStore = vi.hoisted(() => ({
    injected: null as ByteStore | null,
    kind: null as string | null,
}))

vi.mock('../../../storage/store/appStore', () => ({
    getAppStore: async () => {
        if (pageStore.injected === null) {
            throw new Error('no store injected')
        }
        return pageStore.injected
    },
    pageStoreIsOpfsTransitional: async () => pageStore.kind === 'opfs-transitional',
}))

function injectAppStore(store: ByteStore | null, kind: string | null = null): void {
    pageStore.injected = store
    pageStore.kind = kind
}

interface Write {
    key: string
    condition: StoreCondition
    bytes: Uint8Array
}

function recordingStore(writes: Write[], files: Map<string, Uint8Array> = new Map()): ByteStore {
    return {
        capabilities: { conditionalWrites: false },
        async read(key: string): Promise<ReadResult> {
            const bytes = files.get(key)
            return { bytes: bytes ? bytes.slice() : null, version: null }
        },
        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            writes.push({ key, condition, bytes: bytes.slice() })
            files.set(key, bytes.slice())
            return { version: null }
        },
        async delete(): Promise<void> { },
        async deleteMany(): Promise<void> { },
        async list(): Promise<string[]> { return [] },
        async has(): Promise<boolean> { return false },
    }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const listing = { data: [{ id: 'openai/gpt-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } }] }
const dataset = { 'gpt-4.1': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1047576, input_cost_per_token: 0.000002 } }
const gpt4o = { id: 'gpt-4o', provider: LLMProvider.OpenAI }
const gpt41 = { id: 'gpt-4.1', provider: LLMProvider.OpenAI }
const db = { openrouterRequestModel: 'x/y' }

let writes: Write[]
let files: Map<string, Uint8Array>
let fetchStub: ReturnType<typeof vi.fn>

const writtenKeys = (): string[] => writes.map(write => write.key).sort()
const urls = (): string[] => fetchStub.mock.calls.map(call => String(call[0])).sort()

beforeEach(() => {
    writes = []
    files = new Map()
    resetModelDataForTests()
    resetProviderListsStateForTests()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    fetchStub = vi.fn(async (url: string) => new Response(JSON.stringify(url === LITELLM_DATA_URL ? dataset : listing), { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    injectAppStore(recordingStore(writes, files))
})

afterEach(() => {
    injectAppStore(null)
    resetPageStorageModeForTests()
    resetModelDataForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('modelDataStore wiring', () => {
    test('(F) S10 refreshModelDataNow makes one keyless request per source and writes both keys to the page store', async () => {
        await expect(refreshModelDataNow()).resolves.toBe('ok')

        expect(urls()).toEqual([LITELLM_DATA_URL, OPENROUTER_URL].sort())
        for (const [, init] of fetchStub.mock.calls) {
            expect(init.credentials).toBe('omit')
            expect(new Headers(init.headers).has('authorization')).toBe(false)
        }

        expect(writtenKeys()).toEqual([LITELLM_DATA_KEY, OPENROUTER_DATA_KEY].sort())
        expect(writes.every(write => write.condition === 'unconditional')).toBe(true)
        const openrouter = writes.find(write => write.key === OPENROUTER_DATA_KEY)
        expect(decodeOpenRouterData(openrouter!.bytes)?.limits['openai/gpt-4o']).toEqual({ context: 128000 })
        const litellm = writes.find(write => write.key === LITELLM_DATA_KEY)
        expect(decodeLiteLLMData(litellm!.bytes)?.rows['gpt-4.1']?.ctx).toBe(1047576)
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(getModelContextLimit(gpt41, db)).toBe(1047576)
    })

    test('(F) S10 a page in read-only mode still fetches and shows the data but writes nothing', async () => {
        setPageStorageMode({ kind: 'read-only', reason: 'opfs-transitional' })
        await expect(refreshModelDataNow()).resolves.toBe('ok')
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(getModelContextLimit(gpt41, db)).toBe(1047576)
        expect(writes).toHaveLength(0)
    })

    test('(F) S10 a page on the transitional OPFS store writes nothing', async () => {
        injectAppStore(recordingStore(writes), 'opfs-transitional')
        await expect(refreshModelDataNow()).resolves.toBe('ok')
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(writes).toHaveLength(0)
    })

    test('(F) startModelData(false) makes no request (the file is loaded once per test file, by the first test)', async () => {
        startModelData(false)
        for (let i = 0; i < 30; i++) {
            await Promise.resolve()
        }
        expect(fetchStub).not.toHaveBeenCalled()
        expect(writes).toHaveLength(0)
    })

    test('(F) startModelData(true) fetches each source once when nothing is saved', async () => {
        startModelData(true)
        await vi.waitFor(() => expect(writes).toHaveLength(2))
        expect(fetchStub).toHaveBeenCalledTimes(2)
    })

    test('(G) startModelData never throws or rejects when the requests fail', async () => {
        fetchStub.mockRejectedValue(new TypeError('offline'))
        expect(() => startModelData(true)).not.toThrow()
        await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(2))
        expect(writes).toHaveLength(0)
    })

    test('(F) startModelData hands the saved provider lists to the seeder, read from the page store', async () => {
        const saved: ProviderListsData = { v: 1, lists: { openai: { fetchedAt: 5, items: [{ id: 'gpt-4.1' }] } } }
        files.set(PROVIDER_LISTS_KEY, encodeProviderLists(saved)!)
        const seeded: ProviderListsData[] = []
        startModelData(false, list => seeded.push(list))
        await vi.waitFor(() => expect(seeded).toHaveLength(1))
        expect(seeded[0]).toEqual(saved)
        expect(fetchStub).not.toHaveBeenCalled()
    })

    test('(G) a seeder that throws is logged and does not stop the data load', async () => {
        const seeder = vi.fn(() => { throw new Error('seed failed') })
        expect(() => startModelData(true, seeder)).not.toThrow()
        await vi.waitFor(() => expect(writes).toHaveLength(2))
        expect(seeder).toHaveBeenCalledTimes(1)
    })
})

describe('refreshAllNow: the button', () => {
    test('(F) with the option on, the list pass runs beside the data sources and its outcome counts', async () => {
        const listPass = vi.fn(async (): Promise<TaskOutcome> => 'failed')
        await expect(refreshAllNow(listPass, () => true)).resolves.toBe('partial')
        expect(listPass).toHaveBeenCalledTimes(1)
        expect(urls()).toEqual([LITELLM_DATA_URL, OPENROUTER_URL].sort())
        expect(modelDataStatus.lastOutcome).toBe('partial')
    })

    test('(F) the list pass receives the option check, so it can stop between families and pages', async () => {
        let seen: (() => boolean) | null = null
        const isOn = () => true
        await refreshAllNow(async (check) => { seen = check; return 'ok' }, isOn)
        expect(seen).toBe(isOn)
    })

    test('(F) with the option off only the data sources refresh and the list pass is never called', async () => {
        const listPass = vi.fn(async (): Promise<TaskOutcome> => 'ok')
        await expect(refreshAllNow(listPass, () => false)).resolves.toBe('ok')
        expect(listPass).not.toHaveBeenCalled()
        expect(urls()).toEqual([LITELLM_DATA_URL, OPENROUTER_URL].sort())
    })

    test('(F) a skipped list pass (no keys) does not count against the outcome', async () => {
        await expect(refreshAllNow(async () => 'skipped', () => true)).resolves.toBe('ok')
    })

    test('(F) two clicks at once share one fetch per source', async () => {
        const listPass = vi.fn(async (): Promise<TaskOutcome> => 'ok')
        await Promise.all([refreshAllNow(listPass, () => true), refreshAllNow(listPass, () => true)])
        expect(fetchStub).toHaveBeenCalledTimes(2)
    })
})
