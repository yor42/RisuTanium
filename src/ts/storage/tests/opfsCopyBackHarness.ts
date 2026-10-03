/**
 * Test-only: the world `opfsCopyBack.ts` runs in -- an in-memory OPFS root,
 * `fake-indexeddb` behind LocalForage, `localStorage`, and simulated tabs on a
 * fake Web Locks manager. A pass here says nothing about a real browser's OPFS,
 * IndexedDB or lock manager. `fake-indexeddb/auto` must be imported by the test
 * file before this module is used, because LocalForage captures `indexedDB`
 * once when it loads.
 */
import localforage from 'localforage'
import { createEntryProbe } from 'src/ts/storage/store/indexedDbStore'
import {
    OPFS_FLAG_KEY,
    type CopyBackEnvironment,
    type FlagStore,
    type IndexedDbHandle,
} from 'src/ts/storage/opfsCopyBack'
import { FakeLockManagerCore, makeSimulatedTab, type SimulatedTab } from './fakeWebLocks'
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

export const MAIN = 'database/database.bin'

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
export const profile = localforage.createInstance({ name: 'risuai' })

export function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

export function text(value: Uint8Array | null): string | null {
    return value === null ? null : new TextDecoder().decode(value)
}

/** Faults a test injects between the copy and the pinned IndexedDB instance. */
export interface IndexedDbFaults {
    /** Called before the nth `setItem` (1-based); a returned error is thrown instead of writing. */
    beforeSetItem?: (key: string, count: number) => Error | void | Promise<Error | void>
    /** Replaces the bytes actually stored for a key. */
    corruptValue?: (key: string, value: Uint8Array) => Uint8Array
    /** A returned error is thrown instead of removing the key. */
    beforeRemoveItem?: (key: string) => Error | void
}

export function wrapIndexedDb(inner: LocalForage, faults: IndexedDbFaults = {}): IndexedDbHandle {
    let setCount = 0
    return {
        async setItem(key, value) {
            setCount++
            const failure = await faults.beforeSetItem?.(key, setCount)
            if (failure) {
                throw failure
            }
            return inner.setItem(key, faults.corruptValue ? faults.corruptValue(key, value) : value)
        },
        getItem: <T>(key: string) => inner.getItem<T>(key),
        async removeItem(key) {
            const failure = faults.beforeRemoveItem?.(key)
            if (failure) {
                throw failure
            }
            await inner.removeItem(key)
        },
        keys: () => inner.keys(),
    }
}

export interface World {
    root: FakeOpfsRoot
    core: FakeLockManagerCore
}

export function newWorld(): World {
    return { root: new FakeOpfsRoot(), core: new FakeLockManagerCore() }
}

export interface EnvOptions {
    world: World
    /** The tab this page is; defaults to a new tab that recorded its storage epoch, as a booted page has. */
    tab?: SimulatedTab
    /** Exclusive-lock wait before the request is refused; short so refusal tests do not wait 5 seconds. */
    lockTimeoutMs?: number
    estimate?: CopyBackEnvironment['estimate']
    indexedDbSupported?: boolean
    opfsFilesUsable?: boolean
    flags?: FlagStore
    faults?: IndexedDbFaults
    /** Reloads this page asked for through its tab's lock helper. */
    reloads?: string[]
    /** When true the page has no persisted storage-epoch reading. */
    skipEpochRecording?: boolean
}

export interface TestEnv {
    env: CopyBackEnvironment
    tab: SimulatedTab
    reloads: string[]
    /** Progress texts shown, and whether the wait alert is open now. */
    progress: { shown: string[], open: boolean }
}

export function makeEnv(options: EnvOptions): TestEnv {
    const reloads = options.reloads ?? []
    const tab = options.tab ?? makeSimulatedTab(options.world.core, `tab-${Math.random()}`, { reload: () => { reloads.push('reload') } })
    if (!options.skipEpochRecording) {
        tab.locks.recordStorageEpoch()
    }
    const progress = { shown: [] as string[], open: false }
    const env: CopyBackEnvironment = {
        flags: options.flags ?? localStorage,
        opfsFilesUsable: () => options.opfsFilesUsable ?? true,
        getOpfsRoot: async () => options.world.root as unknown as FileSystemDirectoryHandle,
        indexedDbSupported: () => options.indexedDbSupported ?? true,
        openIndexedDb: async () => {
            const instance = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
            await instance.ready()
            return wrapIndexedDb(instance, options.faults)
        },
        createProbe: createEntryProbe,
        acquireLock: () => tab.locks.acquireExclusiveStorageMigrationLock(options.lockTimeoutMs ?? 2000),
        reloadPending: () => reloads.length > 0,
        estimate: options.estimate ?? (async () => undefined),
        showProgress: (done, total) => {
            progress.shown.push(`${done}/${total}`)
            progress.open = true
        },
        clearProgress: () => {
            progress.open = false
        },
    }
    return { env, tab, reloads, progress }
}

/** Puts a file in the OPFS root under the hex name of `key`. */
export function putOpfs(world: World, key: string, value: Uint8Array): void {
    world.root.put(hexName(key), value)
}

/**
 * An OPFS-main profile as the move to OPFS leaves it: the flag, the completion
 * marker, a stale pre-move main file in IndexedDB, and the current files in
 * OPFS (main, two backups, an asset and a hex-named unit).
 */
export async function seedOpfsMainProfile(world: World, options: { staleIndexedDbMain?: boolean, marker?: boolean } = {}): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {
        [MAIN]: bytes('current main file'),
        'database/dbbackup-1.bin': bytes('backup one'),
        'database/dbbackup-2.bin': bytes('backup two'),
        'assets/aaaa.png': bytes('asset bytes'),
        'coldstorage/3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10': bytes('unit bytes'),
    }
    for (const [key, value] of Object.entries(files)) {
        putOpfs(world, key, value)
    }
    localStorage.setItem(OPFS_FLAG_KEY, 'able')
    if (options.marker ?? true) {
        await profile.setItem('migrated', true)
    }
    if (options.staleIndexedDbMain ?? true) {
        await profile.setItem(MAIN, bytes('stale main file'))
    }
    return files
}

export async function indexedDbKeys(): Promise<string[]> {
    return (await profile.keys()).sort()
}

export async function indexedDbText(key: string): Promise<string | null> {
    return text(await profile.getItem<Uint8Array>(key))
}

export async function resetProfile(): Promise<void> {
    await profile.clear()
    localStorage.clear()
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
