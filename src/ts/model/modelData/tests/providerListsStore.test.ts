/**
 * Persistence of the saved provider lists (`modelDataStore.ts`): the read
 * rules, write-on-success, the write permission, the read-merge-write rule,
 * the guarded write with one retry, the same-tab save chain and its timeout.
 * The page's app store is replaced by a fake that offers the functions the
 * wiring uses; this is a wiring and ordering check and says nothing about a
 * native backend or a real store.
 *
 * Labels: (F) feature test that fails against a missing or wrong
 * implementation on its own assertion; (G) guard.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ByteStore, ReadResult, StoreCondition, WriteResult } from '../../../storage/store/contract'
import { resetPageStorageModeForTests, setPageStorageMode } from '../../../storage/pageStorageMode'
import {
    PROVIDER_LISTS_KEY,
    PROVIDER_LIST_MAX_ITEMS,
    decodeProviderLists,
    encodeProviderLists,
    type ProviderList,
    type ProviderListsData,
} from '../providerListData'
import { loadProviderLists, resetProviderListsStateForTests, saveProviderLists } from '../modelDataStore'

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

const T = 1_800_000_000_000
const SAVE_TIMEOUT_MS = 30_000

interface Write {
    condition: StoreCondition
    bytes: Uint8Array
}

interface VersionedStore extends ByteStore {
    bytes: Uint8Array | null
    version: number
    reads: number
    writes: Write[]
    /** Runs after every read resolved its value and before it returns: the window another tab can write in. */
    afterRead: (() => Promise<void> | void) | null
    /** Runs before every write is applied. */
    beforeWrite: (() => Promise<void>) | null
    readError: Error | null
    writeError: Error | null
    /** Replaces the file as another tab would, bumping the version. */
    external(data: ProviderListsData): void
}

function versionedStore(conditionalWrites: boolean): VersionedStore {
    const store: VersionedStore = {
        capabilities: { conditionalWrites },
        bytes: null,
        version: 0,
        reads: 0,
        writes: [],
        afterRead: null,
        beforeWrite: null,
        readError: null,
        writeError: null,
        async read(): Promise<ReadResult> {
            store.reads++
            if (store.readError !== null) {
                throw store.readError
            }
            const result: ReadResult = { bytes: store.bytes ? store.bytes.slice() : null, version: conditionalWrites ? store.version : null }
            await store.afterRead?.()
            return result
        },
        async write(_key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            await store.beforeWrite?.()
            if (store.writeError !== null) {
                throw store.writeError
            }
            if (condition !== 'unconditional') {
                if (!conditionalWrites || condition.ifVersion !== store.version) {
                    throw new Error('version conflict')
                }
            }
            store.writes.push({ condition, bytes: bytes.slice() })
            store.bytes = bytes.slice()
            store.version++
            return { version: conditionalWrites ? store.version : null }
        },
        async delete(): Promise<void> { throw new Error('not used') },
        async deleteMany(): Promise<void> { throw new Error('not used') },
        async list(): Promise<string[]> { throw new Error('not used') },
        async has(): Promise<boolean> { return store.bytes !== null },
        external(data: ProviderListsData): void {
            const encoded = encodeProviderLists(data)
            if (encoded === null) {
                throw new Error('fixture too large')
            }
            store.bytes = encoded
            store.version++
        },
    }
    return store
}

function plist(fetchedAt: number, ...ids: string[]): ProviderList {
    return { fetchedAt, items: ids.map(id => ({ id })) }
}

function onDisk(store: VersionedStore): ProviderListsData {
    return decodeProviderLists(store.bytes ?? new Uint8Array())
}

async function flush(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

let store: VersionedStore
let errorSpy: ReturnType<typeof vi.spyOn>

function loggedModelData(): number {
    return errorSpy.mock.calls.filter(call => call[0] === 'Model data').length
}

beforeEach(() => {
    store = versionedStore(false)
    pageStore.injected = store
    pageStore.kind = null
    resetPageStorageModeForTests()
    resetProviderListsStateForTests()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.useRealTimers()
    pageStore.injected = null
    resetPageStorageModeForTests()
    errorSpy.mockRestore()
})

describe('loadProviderLists', () => {
    test('(F) an absent file is no lists, and reading is not a write', async () => {
        await expect(loadProviderLists()).resolves.toEqual({ v: 1, lists: {} })
        expect(store.writes).toHaveLength(0)
    })

    test('(F) a saved file is read back', async () => {
        store.external({ v: 1, lists: { openai: plist(T, 'gpt-4.1'), google: plist(T - 5, 'gemini-x') } })
        const saved = await loadProviderLists()
        expect(saved.lists.openai).toEqual(plist(T, 'gpt-4.1'))
        expect(saved.lists.google).toEqual(plist(T - 5, 'gemini-x'))
    })

    test('(F) a corrupt file reads as no lists and the next success may rewrite it', async () => {
        store.bytes = new TextEncoder().encode('not json')
        await expect(loadProviderLists()).resolves.toEqual({ v: 1, lists: {} })
        await saveProviderLists('openai', plist(T, 'gpt-9'))
        expect(onDisk(store).lists.openai).toEqual(plist(T, 'gpt-9'))
    })

    test('(F) a read that throws is no lists and disables list writes for the session', async () => {
        store.readError = new Error('disk gone')
        await expect(loadProviderLists()).resolves.toEqual({ v: 1, lists: {} })
        store.readError = null
        await saveProviderLists('openai', plist(T, 'gpt-9'))
        expect(store.writes).toHaveLength(0)
        expect(loggedModelData()).toBe(0)
    })

    test('(F) a store that cannot be reached counts as an unreadable file', async () => {
        pageStore.injected = null
        await expect(loadProviderLists()).resolves.toEqual({ v: 1, lists: {} })
        pageStore.injected = store
        await saveProviderLists('openai', plist(T, 'gpt-9'))
        expect(store.writes).toHaveLength(0)
    })
})

describe('saveProviderLists: when it writes', () => {
    test('(F) a successful family is written under the fixed key, unconditionally on a store without conditional writes', async () => {
        await saveProviderLists('openai', plist(T, 'gpt-4.1', 'gpt-5-pro'))
        expect(store.writes).toHaveLength(1)
        expect(store.writes[0].condition).toBe('unconditional')
        expect(onDisk(store)).toEqual({ v: 1, lists: { openai: plist(T, 'gpt-4.1', 'gpt-5-pro') } })
        expect(PROVIDER_LISTS_KEY).toBe('modeldata/providerlists.json')
    })

    test('(F) an empty list is never written and never empties a family', async () => {
        store.external({ v: 1, lists: { openai: plist(T - 9, 'gpt-4.1') } })
        const before = store.bytes
        await saveProviderLists('openai', { fetchedAt: T, items: [] })
        expect(store.writes).toHaveLength(0)
        expect(store.bytes).toBe(before)
        expect(store.reads).toBe(0)
    })

    test('(F) a page on the transitional OPFS store or in read-only mode writes nothing', async () => {
        pageStore.kind = 'opfs-transitional'
        await saveProviderLists('openai', plist(T, 'gpt-9'))
        pageStore.kind = null
        setPageStorageMode({ kind: 'read-only' })
        await saveProviderLists('openai', plist(T, 'gpt-9'))
        expect(store.writes).toHaveLength(0)
        expect(store.reads).toBe(0)
    })

    test('(F) a list too large for the file is skipped and logged, and the save still resolves', async () => {
        const items = Array.from({ length: PROVIDER_LIST_MAX_ITEMS }, (_, i) => ({ id: 'g' + i + 'x'.repeat(180), name: 'n'.repeat(100) }))
        await expect(saveProviderLists('google', { fetchedAt: T, items })).resolves.toBeUndefined()
        expect(store.writes).toHaveLength(0)
        expect(loggedModelData()).toBe(1)
    })

    test('(F) a failing write is logged once, never rejects, and leaves the previous file', async () => {
        store.external({ v: 1, lists: { openai: plist(T - 9, 'gpt-4.1') } })
        const before = store.bytes
        store.writeError = new Error('quota')
        await expect(saveProviderLists('google', plist(T, 'gemini-x'))).resolves.toBeUndefined()
        expect(store.bytes).toBe(before)
        expect(loggedModelData()).toBe(1)
    })
})

describe('saveProviderLists: read, merge, write', () => {
    test('(F) this pass wins for its family, the others come from the freshly read file', async () => {
        store.external({ v: 1, lists: { openai: plist(500, 'gpt-old'), google: plist(500, 'gemini-disk'), anthropic: plist(500, 'claude-disk') } })
        await saveProviderLists('openai', plist(100, 'gpt-new'))
        const lists = onDisk(store).lists
        expect(lists.openai).toEqual(plist(100, 'gpt-new'))
        expect(lists.google).toEqual(plist(500, 'gemini-disk'))
        expect(lists.anthropic).toEqual(plist(500, 'claude-disk'))
    })

    test('(F) a family another tab added between two saves is kept', async () => {
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        store.external({ v: 1, lists: { openai: plist(T, 'gpt-1'), anthropic: plist(T, 'claude-other-tab') } })
        await saveProviderLists('google', plist(T + 1, 'gemini-1'))
        const lists = onDisk(store).lists
        expect(lists.anthropic).toEqual(plist(T, 'claude-other-tab'))
        expect(lists.google).toEqual(plist(T + 1, 'gemini-1'))
        expect(lists.openai).toEqual(plist(T, 'gpt-1'))
    })

    test('(F) a family whose save failed is carried: the larger fetchedAt of the file and the carried copy wins', async () => {
        store.writeError = new Error('quota')
        await saveProviderLists('google', plist(900, 'gemini-carried'))
        store.writeError = null

        await saveProviderLists('openai', plist(T, 'gpt-1'))
        expect(onDisk(store).lists.google).toEqual(plist(900, 'gemini-carried'))
        expect(store.writes).toHaveLength(1)

        // The carried copy was persisted, so a file that is newer now wins over nothing carried.
        store.external({ v: 1, lists: { google: plist(1200, 'gemini-newer-on-disk'), openai: plist(T, 'gpt-1') } })
        await saveProviderLists('anthropic', plist(T, 'claude-1'))
        expect(onDisk(store).lists.google).toEqual(plist(1200, 'gemini-newer-on-disk'))
    })

    test('(F) the carried copy loses to a newer file copy', async () => {
        store.writeError = new Error('quota')
        await saveProviderLists('google', plist(900, 'gemini-carried'))
        store.writeError = null
        store.external({ v: 1, lists: { google: plist(1000, 'gemini-disk') } })
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        expect(onDisk(store).lists.google).toEqual(plist(1000, 'gemini-disk'))
    })

    test('(F) a successful save keeps a carried copy of its own family that is newer than the list it wrote', async () => {
        store.writeError = new Error('quota')
        await saveProviderLists('openai', plist(900, 'gpt-newer'))
        store.writeError = null
        await saveProviderLists('openai', plist(500, 'gpt-older'))
        expect(onDisk(store).lists.openai).toEqual(plist(500, 'gpt-older'))
        await saveProviderLists('google', plist(T, 'gemini-1'))
        expect(onDisk(store).lists.openai).toEqual(plist(900, 'gpt-newer'))
    })

    test('(F) the file is re-read before every write', async () => {
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        await saveProviderLists('google', plist(T, 'gemini-1'))
        expect(store.reads).toBe(2)
    })
})

describe('saveProviderLists: guarded writes', () => {
    test('(F) with conditional writes the write presents the version it read', async () => {
        store = versionedStore(true)
        pageStore.injected = store
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        await saveProviderLists('google', plist(T, 'gemini-1'))
        expect(store.writes.map(w => w.condition)).toEqual([{ ifVersion: 0 }, { ifVersion: 1 }])
    })

    test('(F) a conflict triggers one re-read, re-merge and retry that keeps the other tab\'s family', async () => {
        store = versionedStore(true)
        pageStore.injected = store
        let injected = false
        store.afterRead = () => {
            if (!injected) {
                injected = true
                store.external({ v: 1, lists: { anthropic: plist(T, 'claude-other-tab') } })
            }
        }
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        expect(store.reads).toBe(2)
        expect(store.writes).toHaveLength(1)
        expect(store.writes[0].condition).toEqual({ ifVersion: 1 })
        const lists = onDisk(store).lists
        expect(lists.openai).toEqual(plist(T, 'gpt-1'))
        expect(lists.anthropic).toEqual(plist(T, 'claude-other-tab'))
        expect(loggedModelData()).toBe(0)
    })

    test('(F) a second conflict gives up, logs once, never rejects and keeps the data to carry', async () => {
        store = versionedStore(true)
        pageStore.injected = store
        let bumps = 0
        store.afterRead = () => {
            bumps++
            store.external({ v: 1, lists: { anthropic: plist(T, 'claude-' + bumps) } })
        }
        await expect(saveProviderLists('openai', plist(T, 'gpt-1'))).resolves.toBeUndefined()
        expect(store.reads).toBe(2)
        expect(store.writes).toHaveLength(0)
        expect(onDisk(store).lists.openai).toBeUndefined()
        expect(loggedModelData()).toBe(1)

        store.afterRead = null
        await saveProviderLists('google', plist(T, 'gemini-1'))
        expect(onDisk(store).lists.openai).toEqual(plist(T, 'gpt-1'))
    })

    test('(F) a store without conditional writes is written once, unconditionally, with no retry', async () => {
        store.writeError = new Error('quota')
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        expect(store.reads).toBe(1)
        expect(loggedModelData()).toBe(1)
    })
})

describe('saveProviderLists: same-tab ordering', () => {
    test('(F) R3 two overlapping saves for different families on a store without conditional writes keep both', async () => {
        store.afterRead = async () => { await flush() }
        store.beforeWrite = async () => { await flush() }
        const first = saveProviderLists('openai', plist(T, 'gpt-1'))
        const second = saveProviderLists('google', plist(T, 'gemini-1'))
        await Promise.all([first, second])
        const lists = onDisk(store).lists
        expect(lists.openai).toEqual(plist(T, 'gpt-1'))
        expect(lists.google).toEqual(plist(T, 'gemini-1'))
        expect(store.writes).toHaveLength(2)
    })

    test('(F) saves run in call order and each sees the file the previous one wrote', async () => {
        const order: string[] = []
        store.beforeWrite = async () => { order.push('write') ; await flush() }
        const results = ['openai', 'google', 'anthropic'].map((family, i) => saveProviderLists(family as 'openai' | 'google' | 'anthropic', plist(T + i, 'id-' + family)))
        await Promise.all(results)
        expect(Object.keys(onDisk(store).lists).sort()).toEqual(['anthropic', 'google', 'openai'])
        expect(order).toHaveLength(3)
    })

    test('(F) N6 a save that never settles is abandoned after 30 seconds, logged once, and later saves still run', async () => {
        vi.useFakeTimers()
        let hang = true
        store.afterRead = () => (hang ? new Promise<void>(() => { }) : undefined)
        const stuck = saveProviderLists('openai', plist(T, 'gpt-1'))
        const next = saveProviderLists('google', plist(T, 'gemini-1'))
        await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1)
        expect(loggedModelData()).toBe(0)
        expect(store.writes).toHaveLength(0)

        hang = false
        await vi.advanceTimersByTimeAsync(1)
        await Promise.all([stuck, next])
        expect(loggedModelData()).toBe(1)
        expect(store.writes).toHaveLength(1)
        // Memory stays authoritative: the abandoned family is rewritten by the next successful save.
        const lists = onDisk(store).lists
        expect(lists.google).toEqual(plist(T, 'gemini-1'))
        expect(lists.openai).toEqual(plist(T, 'gpt-1'))
        expect(vi.getTimerCount()).toBe(0)
    })

    test('(F) F1 a timed-out save whose write lands later does not erase a list carried by a newer failed save', async () => {
        vi.useFakeTimers()
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        let first = true
        store.beforeWrite = async () => {
            if (first) {
                first = false
                await held
            }
        }
        const stuck = saveProviderLists('openai', plist(T, 'gpt-x'))
        const failing = saveProviderLists('openai', plist(T + 1, 'gpt-y'))
        store.writeError = new Error('quota')
        await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS)
        await failing
        expect(store.writes).toHaveLength(0)

        store.writeError = null
        release()
        await stuck
        await vi.advanceTimersByTimeAsync(1)

        await saveProviderLists('google', plist(T + 2, 'gemini-1'))
        expect(onDisk(store).lists.openai).toEqual(plist(T + 1, 'gpt-y'))
        expect(onDisk(store).lists.google).toEqual(plist(T + 2, 'gemini-1'))
    })

    test('(F) F2 an abandoned save that resumes after its time is up makes no write', async () => {
        vi.useFakeTimers()
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        let first = true
        store.afterRead = () => {
            if (first) {
                first = false
                return held
            }
        }
        const stuck = saveProviderLists('openai', plist(T, 'gpt-x'))
        const next = saveProviderLists('google', plist(T, 'gemini-1'))
        await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS)
        await next
        expect(store.writes).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(1000)
        release()
        await stuck
        await vi.advanceTimersByTimeAsync(1)
        expect(store.writes).toHaveLength(1)
        const lists = onDisk(store).lists
        expect(lists.google).toEqual(plist(T, 'gemini-1'))
        expect(lists.openai).toEqual(plist(T, 'gpt-x'))
    })
    test('(F) the save timer is cleared after a normal save', async () => {
        vi.useFakeTimers()
        await saveProviderLists('openai', plist(T, 'gpt-1'))
        expect(vi.getTimerCount()).toBe(0)
    })
})
