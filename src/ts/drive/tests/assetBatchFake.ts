/**
 * Test-only stand-in for the transport functions of
 * `src/ts/storage/tauriAssetBatch.ts`, backed by the page's byte store: a batch
 * write is one `store.write` per entry under the store's own key rules, a batch
 * read is one `store.read` per key, so a restore or export that runs over this
 * fake and over the per-entry path must end in the same store state. It says
 * nothing about the native commands.
 *
 * It is created inside `vi.hoisted` and handed to a `vi.mock` of the transport
 * module (see `backuplocalAssetBatch.test.ts`), so it imports no application
 * module that needs the other mocks of the test.
 */
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import type { ByteStore } from 'src/ts/storage/store/contract'

export interface FakePutEntry { key: string; data: Uint8Array }
export type FakePutResult =
    | { k: 'ok' }
    | { k: 'invalid'; reason: string }
    | { k: 'error'; message: string }
export type FakeReadResult =
    | { status: 'ok'; bytes: Uint8Array }
    | { status: 'missing' }
    | { status: 'invalid'; reason: string }
    | { status: 'error'; message: string }

export interface FakeCall {
    kind: 'batch' | 'single' | 'read'
    keys: string[]
    /** Calls of any kind that were in flight when this one started, not counting itself. */
    inFlightAtStart: number
    /** Whether the call has settled. */
    settled: boolean
}

export function createAssetBatchFake() {
    let getStore: (() => Promise<ByteStore>) | null = null
    const ctl = {
        /** What `isAssetBatchAvailable` answers. */
        available: false,
        calls: [] as FakeCall[],
        inFlight: 0,
        maxInFlight: 0,
        /** Runs when a write call starts; may wait, or throw to make the whole call reject. */
        beforeWrite: null as ((call: FakeCall, index: number) => Promise<void> | void) | null,
        /** Runs when a read call starts; may wait, or throw to make the whole call reject. */
        beforeRead: null as ((call: FakeCall, index: number) => Promise<void> | void) | null,
        /** Answers keys of a batched read with `invalid` instead of reading them. */
        invalidReads: new Set<string>(),
        /** Answers keys of a batched read with `error` instead of reading them. */
        erroredReads: new Set<string>(),
        /** Make `listAssetsSized` reject. */
        failListing: false,
    }

    function store(): Promise<ByteStore> {
        if (getStore === null) {
            throw new Error('the asset batch fake has no store')
        }
        return getStore()
    }

    async function track<T>(kind: FakeCall['kind'], keys: string[], hook: 'beforeWrite' | 'beforeRead', body: () => Promise<T>): Promise<T> {
        const call: FakeCall = { kind, keys, inFlightAtStart: ctl.inFlight, settled: false }
        const index = ctl.calls.length
        ctl.calls.push(call)
        ctl.inFlight += 1
        ctl.maxInFlight = Math.max(ctl.maxInFlight, ctl.inFlight)
        try {
            const before = ctl[hook]
            if (before) {
                await before(call, index)
            }
            return await body()
        } finally {
            ctl.inFlight -= 1
            call.settled = true
        }
    }

    async function writeOne(entry: FakePutEntry): Promise<FakePutResult> {
        try {
            await (await store()).write(entry.key, entry.data, 'unconditional')
            return { k: 'ok' }
        } catch (error) {
            if (error instanceof StoreInvalidKeyError) {
                return { k: 'invalid', reason: error.message }
            }
            return { k: 'error', message: String((error as { message?: unknown })?.message ?? error) }
        }
    }

    const transport = {
        isAssetBatchAvailable: () => ctl.available,
        markAssetBatchUnavailable: () => { ctl.available = false },
        writeAssetBatch: (entries: readonly FakePutEntry[]) => track('batch', entries.map((e) => e.key), 'beforeWrite', async () => {
            const results: FakePutResult[] = []
            for (const entry of entries) {
                results.push(await writeOne(entry))
            }
            return results
        }),
        writeAssetSingle: (entry: FakePutEntry) => track('single', [entry.key], 'beforeWrite', () => writeOne(entry)),
        readAssetBatch: (keys: readonly string[]) => track('read', [...keys], 'beforeRead', async () => {
            const results: FakeReadResult[] = []
            for (const key of keys) {
                if (ctl.invalidReads.has(key)) {
                    results.push({ status: 'invalid', reason: 'refused by the fake' })
                    continue
                }
                if (ctl.erroredReads.has(key)) {
                    results.push({ status: 'error', message: 'failed in the fake' })
                    continue
                }
                try {
                    const read = await (await store()).read(key)
                    results.push(read.bytes === null ? { status: 'missing' } : { status: 'ok', bytes: read.bytes })
                } catch (error) {
                    results.push(error instanceof StoreInvalidKeyError
                        ? { status: 'invalid', reason: error.message }
                        : { status: 'error', message: String((error as { message?: unknown })?.message ?? error) })
                }
            }
            return results
        }),
        listAssetsSized: async () => {
            if (ctl.failListing) {
                throw new Error('listing failed in the fake')
            }
            const current = await store()
            const keys = await current.list('assets/')
            const items: { key: string; size: number }[] = []
            for (const key of keys) {
                let size = 0
                try {
                    size = (await current.read(key)).bytes?.length ?? 0
                } catch {
                    size = 0
                }
                items.push({ key, size })
            }
            return items
        },
    }

    return {
        ctl,
        module: transport,
        /** Names the page's store the fake reads and writes through; call it before each test. */
        useStore(source: () => Promise<ByteStore>) {
            getStore = source
        },
        reset() {
            ctl.available = false
            ctl.calls.length = 0
            ctl.inFlight = 0
            ctl.maxInFlight = 0
            ctl.beforeWrite = null
            ctl.beforeRead = null
            ctl.invalidReads.clear()
            ctl.erroredReads.clear()
            ctl.failListing = false
        },
    }
}
