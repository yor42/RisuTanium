/**
 * The IndexedDB rig of the store2 replay: every actor is a tab with a connection of its own, the real
 * `createIndexedDbBackend`, over one `fake-indexeddb` factory made for the run. Nothing of the protocol is
 * re-implemented here. The actors, the start states, the holds and the checker are those of `actors.ts`.
 *
 * Rules the rig keeps, so that a run is deterministic and the checker can judge it:
 *  - scheduling is at the `Store2Backend` layer: a tab's backend is wrapped by the scheduler, and every call of
 *    the adapter is one step that runs to completion (its transaction commits before the next step is chosen), so
 *    the adapter's own compare-and-set is the atomicity the replay exercises;
 *  - the adapter reads units as a pool of per-key transactions, so the rig splits `readUnits` into one scheduled
 *    request per key (`splitReadUnits`), and shuffles every `listStore2` answer by a seed of its own
 *    (`shuffleListing`), because the adapter happens to sort and nothing may rely on that;
 *  - the factory is installed as the global `indexedDB`, because the adapter opens the shared database by that
 *    name; a rig therefore owns the global until the next rig replaces it, and rigs of one process run one after
 *    the other, never side by side;
 *  - the raw state, the planting of a start state, the damage and the loss of a unit go straight to the fake
 *    database's own records, with no request and no transaction: the checker reads them between steps. A silent
 *    damage changes the bytes, which the adapter's byte-for-byte compare sees, so unlike a Node revision it can
 *    not be written over by a page that holds the old value;
 *  - IndexedDB reports no flush status and has no restart here: a write never claims `flushed`, and no step of
 *    this rig drops state.
 *
 * Faults are the scheduler's: a lost response applies the write and then fails with the adapter's own
 * unknown-outcome error (`Store2UnknownOutcomeError`), a lost request fails with it without applying, a crash
 * applies and retires the tab. The adapter's watchdog timer never fires, because every transaction settles inside
 * its step.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { syncBytesOfStoredValue } from 'src/ts/storage/store/indexedDbStore'
import { createIndexedDbBackend } from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createClock, seedStore, testEnv } from '../commitFixtures'
import { assembleRig, seededStart, type ReplayRig, type ReplayRigOptions, type RigParts } from './actors'
import { createRng, shuffleListing, splitReadUnits, type RawEntry, type RawState } from './scheduler'

const DATABASE = 'risuai'
const OBJECT_STORE = 'keyvaluepairs'

/** The salt of the listing shuffle's stream: it never shares draws with the scheduler's own. */
const SHUFFLE_SALT = 0x5851F42D

export type IdbReplayRig = ReplayRig & {
    /** The factory the run's tabs open their connections on. */
    readonly factory: IDBFactory
    /** How many connections to the shared database are open now: one per tab that has made a call. */
    openConnections(): number
}

function openConnectionsOf(factory: IDBFactory): number {
    const connections = member(inMap(factory, '_databases', DATABASE), 'connections')
    if (!Array.isArray(connections)) {
        throw new Error('The fake IndexedDB connection list is not an array.')
    }
    return connections.filter((connection) => member(connection, '_closed') !== true).length
}

// ---- The fake database's records, read and written without a transaction ----

/** What the rig uses of the fake's object store: the records the connections' transactions work on. */
interface RawObjectStore {
    /** Every string key with the stored bytes themselves (not copies): a stored value is never changed in place, a write replaces it. */
    entries(): Array<[string, Uint8Array | null]>
    keys(): string[]
    get(key: string): Uint8Array | null
    put(key: string, bytes: Uint8Array): void
    remove(key: string): void
}

function member(owner: unknown, name: string): unknown {
    if (typeof owner !== 'object' || owner === null) {
        throw new Error(`The fake IndexedDB has no ${name}: its internal layout is not the one this rig reads.`)
    }
    return Reflect.get(owner, name)
}

function method(owner: unknown, name: string): (...args: unknown[]) => unknown {
    const found = member(owner, name)
    if (typeof found !== 'function') {
        throw new Error(`The fake IndexedDB object store has no ${name}(): its internal layout is not the one this rig reads.`)
    }
    return (...args) => Reflect.apply(found, owner, args)
}

function inMap(owner: unknown, name: string, key: string): unknown {
    const map = member(owner, name)
    if (!(map instanceof Map)) {
        throw new Error(`The fake IndexedDB ${name} is not a map: its internal layout is not the one this rig reads.`)
    }
    const found: unknown = map.get(key)
    if (found === undefined) {
        throw new Error(`The fake IndexedDB has no ${key} in ${name}.`)
    }
    return found
}

function bytesOfStored(value: unknown): Uint8Array | null {
    const decoded = syncBytesOfStoredValue(value)
    if (decoded === undefined) {
        throw new Error('A stored value is not binary.')
    }
    return decoded === null ? null : new Uint8Array(decoded)
}

function rawObjectStoreOf(factory: IDBFactory): RawObjectStore {
    const database = inMap(factory, '_databases', DATABASE)
    const objects = inMap(database, 'rawObjectStores', OBJECT_STORE)
    const getAllKeys = method(objects, 'getAllKeys')
    const getValue = method(objects, 'getValue')
    const records = member(objects, 'records')
    const recordValues = method(records, 'values')
    const putRecord = method(records, 'put')
    const deleteRecord = method(records, 'delete')
    return {
        entries: () => {
            const out: Array<[string, Uint8Array | null]> = []
            const walked = recordValues()
            if (typeof walked !== 'object' || walked === null || !(Symbol.iterator in walked)) {
                throw new Error('The fake IndexedDB did not answer its records as an iterable.')
            }
            for (const record of walked as Iterable<unknown>) {
                const key = member(record, 'key')
                if (typeof key === 'string') {
                    const decoded = syncBytesOfStoredValue(member(record, 'value'))
                    if (decoded === undefined) {
                        throw new Error('A stored value is not binary.')
                    }
                    out.push([key, decoded])
                }
            }
            return out
        },
        keys: () => {
            const found = getAllKeys()
            if (!Array.isArray(found)) {
                throw new Error('The fake IndexedDB did not answer a key list.')
            }
            return found.filter((key): key is string => typeof key === 'string')
        },
        get: (key) => bytesOfStored(getValue(key)),
        put: (key, bytes) => {
            putRecord({ key, value: new Uint8Array(bytes) })
        },
        remove: (key) => {
            deleteRecord(key)
        },
    }
}

/** The raw state of the database: every string key, no revision, and the commit key and the fence always have an entry. */
export function rawOfIdb(objects: RawObjectStore): () => RawState {
    return () => {
        const out = new Map<string, RawEntry>()
        for (const [key, bytes] of objects.entries()) {
            out.set(key, { bytes, revision: null })
        }
        for (const key of [COMMIT_KEY, FENCE_KEY]) {
            if (!out.has(key)) {
                out.set(key, { bytes: null, revision: null })
            }
        }
        return out
    }
}

// ---- The database ----

function installFactory(factory: IDBFactory): void {
    Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true, enumerable: true })
}

/** What LocalForage does in the app: the database and its object store exist before any store2 backend opens. */
function createDatabase(factory: IDBFactory): Promise<void> {
    return new Promise((resolve, reject) => {
        const opening = factory.open(DATABASE, 1)
        opening.onupgradeneeded = () => {
            opening.result.createObjectStore(OBJECT_STORE)
        }
        opening.onsuccess = () => {
            opening.result.close()
            resolve()
        }
        opening.onerror = () => reject(opening.error)
    })
}

/** A byte store no tab ever calls: the session of a backend-layer rig is given a backend, so it opens nothing on the store. */
const UNUSED_STORE: ByteStore = (() => {
    const refuse = (): never => {
        throw new Error('The IndexedDB rig schedules at the backend layer: the byte store is not used.')
    }
    return { capabilities: { conditionalWrites: false }, read: refuse, write: refuse, delete: refuse, deleteMany: refuse, list: refuse, has: refuse }
})()

export interface IdbReplayRigOptions extends ReplayRigOptions {}

export async function createIdbReplayRig(options: IdbReplayRigOptions): Promise<IdbReplayRig> {
    const factory = new IDBFactory()
    installFactory(factory)
    await createDatabase(factory)
    const clock = createClock()
    const start = options.start ?? 'healthy'
    // The seeding backend is unscheduled and has a connection of its own, closed before the first tab opens.
    const seeder = createIndexedDbBackend()
    const seedManifest = seededStart(start) ? await seedStore(seeder, testEnv(clock, 1)) : null
    seeder.close()
    const objects = rawObjectStoreOf(factory)
    const listing = createRng(options.scheduler.seed ^ SHUFFLE_SALT)
    const parts: RigParts = {
        variant: 'indexeddb',
        raw: rawOfIdb(objects),
        hooks: {
            peek: (key) => objects.get(key),
            plant: (key, bytes) => objects.put(key, bytes),
            list: (prefix) => objects.keys().filter((key) => key.startsWith(prefix)),
            remove: (key) => objects.remove(key),
        },
        deviceOwner: false,
        pageStore: () => UNUSED_STORE,
        // The holds sit under the split, so a held read is one key's.
        openBackend: async (_store, scheduling) => shuffleListing(splitReadUnits(scheduling.hold(scheduling.handle.backend(createIndexedDbBackend()))), listing),
        probe: () => undefined,
    }
    return Object.assign(assembleRig({ parts, clock, seedManifest, options }), { factory, openConnections: () => openConnectionsOf(factory) })
}
