/**
 * Backends the fence and commit-key policy tests run against: the memory
 * reference backend and the Node backend against the real server process. A
 * pass says nothing about a real browser's durability or the Tauri commands.
 */
import {
    Store2BackendFailureError, createMemoryBackend, createNodeBackend,
    type Store2Backend, type Store2Read, type Store2WriteResult,
} from 'src/ts/storage/store2/backend'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { startNodeServer } from '../nodeServerFixture'

export interface OpenedBackend {
    backend: Store2Backend
    close(): Promise<void>
}

export interface FenceBackendFixture {
    name: string
    open(): Promise<OpenedBackend>
}

export const FENCE_BACKENDS: readonly FenceBackendFixture[] = [
    {
        name: 'memory',
        open: async () => ({ backend: createMemoryBackend(), close: async () => {} }),
    },
    {
        name: 'node',
        open: async () => {
            const fixture = await startNodeServer()
            const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
            return { backend: createNodeBackend(store), close: () => fixture.stop() }
        },
    },
]

/** Writes `bytes` (or deletes, for null) as the fence at a fresh read's token: how a test plants a foreign, damaged or newer fence through only the backend interface. */
export async function plantFence(backend: Store2Backend, bytes: Uint8Array | null): Promise<void> {
    await backend.casFence((await backend.readFence()).token, bytes)
}

/** Writes `bytes` as the commit key at a fresh read's token. */
export async function plantCommit(backend: Store2Backend, bytes: Uint8Array): Promise<void> {
    await backend.casCommit((await backend.readCommit()).token, bytes)
}

/** Writes `bytes` as the unit `key`; a unit is never overwritten, so a key is planted once. */
export async function plantUnit(backend: Store2Backend, key: string, bytes: Uint8Array): Promise<void> {
    await backend.putUnit(key, bytes)
}

export interface TraceOptions {
    /** Runs after the named call has completed and before its result is returned; `count` is how many calls of that name have completed, starting at 1. */
    after?: (name: string, count: number) => Promise<void> | void
    /** Makes every fence write report this flush status instead of the backend's own. */
    fenceFlushed?: boolean | undefined
    /** Makes `listStore2` fail with a definite backend failure. */
    failList?: boolean
    /** Makes `readFence` fail with a definite backend failure. */
    failReadFence?: boolean
}

export interface Traced {
    backend: Store2Backend
    /** Every backend call in order, by method name. */
    log: string[]
}

/** The backend with every call recorded, and optional faults and interleavings; it delegates everything else unchanged. */
export function traced(inner: Store2Backend, options: TraceOptions = {}): Traced {
    const log: string[] = []
    const counts = new Map<string, number>()

    async function run<T>(name: string, body: () => Promise<T>): Promise<T> {
        log.push(name)
        const result = await body()
        const count = (counts.get(name) ?? 0) + 1
        counts.set(name, count)
        await options.after?.(name, count)
        return result
    }

    const backend: Store2Backend = {
        readCommit: () => run('readCommit', () => inner.readCommit()),
        readFence: () => run('readFence', async (): Promise<Store2Read> => {
            if (options.failReadFence) {
                throw new Store2BackendFailureError('Injected readFence failure.')
            }
            return inner.readFence()
        }),
        casCommit: (expected, next) => run('casCommit', () => inner.casCommit(expected, next)),
        casFence: (expected, next) => run('casFence', async (): Promise<Store2WriteResult> => {
            const result = await inner.casFence(expected, next)
            return 'fenceFlushed' in options ? { flushed: options.fenceFlushed } : result
        }),
        readUnits: (keys) => run('readUnits', () => inner.readUnits(keys)),
        listStore2: () => run('listStore2', async () => {
            if (options.failList) {
                throw new Store2BackendFailureError('Injected listing failure.')
            }
            return inner.listStore2()
        }),
        countPrefix: (prefix) => run('countPrefix', () => inner.countPrefix(prefix)),
        commitOrdinary: (expectedCommit, units, nextCommit) => run('commitOrdinary', () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => run('putUnit', () => inner.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => run('removeBatch', () => inner.removeBatch(keys, expectedCommit, expectedFence)),
    }
    return { backend, log }
}
