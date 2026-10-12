/**
 * Production wiring of the model data service (`modelDataStore.ts`): the
 * global fetch, the page's byte store and the write permission. The page's
 * app store is replaced by a stand-in that offers the same three functions
 * the wiring uses (the real module's import graph loads the whole
 * application), and the fetch is a stub, so this is a wiring check and says
 * nothing about store selection, a native backend or the live listing.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LLMProvider } from '../../types'
import type { ByteStore, ReadResult, StoreCondition, WriteResult } from '../../../storage/store/contract'
import { resetPageStorageModeForTests, setPageStorageMode } from '../../../storage/pageStorageMode'
import { OPENROUTER_DATA_KEY, decodeOpenRouterData } from '../openrouterData'
import { getModelContextLimit, resetModelDataForTests } from '../modelDataService.svelte'
import { refreshModelDataNow, startModelData } from '../modelDataStore'

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

function recordingStore(writes: Write[]): ByteStore {
    return {
        capabilities: { conditionalWrites: false },
        async read(): Promise<ReadResult> { return { bytes: null, version: null } },
        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            writes.push({ key, condition, bytes: bytes.slice() })
            return { version: null }
        },
        async delete(): Promise<void> { },
        async deleteMany(): Promise<void> { },
        async list(): Promise<string[]> { return [] },
        async has(): Promise<boolean> { return false },
    }
}

const listing = { data: [{ id: 'openai/gpt-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } }] }
const gpt4o = { id: 'gpt-4o', provider: LLMProvider.OpenAI }
const db = { openrouterRequestModel: 'x/y' }

let writes: Write[]
let fetchStub: ReturnType<typeof vi.fn>

beforeEach(() => {
    writes = []
    resetModelDataForTests()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    fetchStub = vi.fn(async () => new Response(JSON.stringify(listing), { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    injectAppStore(recordingStore(writes))
})

afterEach(() => {
    injectAppStore(null)
    resetPageStorageModeForTests()
    resetModelDataForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('modelDataStore wiring', () => {
    test('(F) S10 refreshModelDataNow makes one keyless request and writes the key to the page store', async () => {
        await expect(refreshModelDataNow()).resolves.toBe('ok')

        expect(fetchStub).toHaveBeenCalledTimes(1)
        const [url, init] = fetchStub.mock.calls[0]
        expect(url).toBe('https://openrouter.ai/api/v1/models')
        expect(init.credentials).toBe('omit')
        const headers = new Headers(init.headers)
        expect(headers.has('authorization')).toBe(false)

        expect(writes).toHaveLength(1)
        expect(writes[0].key).toBe(OPENROUTER_DATA_KEY)
        expect(writes[0].condition).toBe('unconditional')
        expect(decodeOpenRouterData(writes[0].bytes)?.limits['openai/gpt-4o']).toEqual({ context: 128000 })
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
    })

    test('(F) S10 a page in read-only mode still fetches and shows the data but writes nothing', async () => {
        setPageStorageMode({ kind: 'read-only' })
        await expect(refreshModelDataNow()).resolves.toBe('ok')
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
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

    test('(F) startModelData(true) fetches once when nothing is saved', async () => {
        startModelData(true)
        await vi.waitFor(() => expect(writes).toHaveLength(1))
        expect(fetchStub).toHaveBeenCalledTimes(1)
    })

    test('(G) startModelData never throws or rejects when the request fails', async () => {
        fetchStub.mockRejectedValue(new TypeError('offline'))
        expect(() => startModelData(true)).not.toThrow()
        await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1))
        expect(writes).toHaveLength(0)
    })
})
