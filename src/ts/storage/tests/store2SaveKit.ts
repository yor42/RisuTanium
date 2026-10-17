/**
 * Test-only: a store2 world for the save-loop suites. A tree seeded from a database into an in-memory backend, the
 * committer and save context over it, a backend wrapper that records every write call, a peer double that answers the
 * loop's prompts, and the readers a test needs to say what the store holds. `store2Boot` is the `boot` option of
 * `createWorldKit`: it activates the context in the world's own module graph. A mocked success here is not evidence of
 * native backend behaviour.
 */
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import {
    createMemoryBackend, type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { assembleDatabase, encodeDatabase, previousFrom, type EncodedTree, type ListDerivation } from 'src/ts/storage/store2/codec'
import { createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import {
    encodeUnit, readUnit, UNIT_TYPE, type CommitKey, type KeyEnv, type Manifest,
} from 'src/ts/storage/store2/format'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import type { IdleNetOptions, PeerOffer, PeerParkPrompt, Store2PeerHandler } from 'src/ts/storage/store2/saveLoop'
import type { Database } from 'src/ts/storage/database.svelte'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { World } from './saveLoopWorld'
import { fakeLists } from './store2/codecFixtures'

export { fakeLists }

// The clock, randomness and recording wrapper below are the commit fixtures' own, restated here because
// commitFixtures re-exports Node-only server fixtures that a jsdom suite cannot load.

export interface TestClock {
    now: number
    advance(ms: number): void
}

export function createClock(start = 1_700_000_000_000): TestClock {
    const clock: TestClock = { now: start, advance: (ms) => { clock.now += ms } }
    return clock
}

/** A seeded byte stream: no two draws of a run repeat, and two seeds differ. */
function seededRandom(seed: number): (length: number) => Uint8Array {
    let state = seed >>> 0
    return (length) => Uint8Array.from({ length }, () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) & 0xFF
    })
}

export function testEnv(clock: TestClock, seed: number): KeyEnv {
    return { random: seededRandom(seed), now: () => clock.now }
}

export interface Hooks {
    /** Runs before the named call reaches the inner backend; throwing aborts the call without applying it. count starts at 1. */
    before?: (name: string, count: number) => Promise<void> | void
    /** Runs after the call completed; throwing loses its response after it was applied. */
    after?: (name: string, count: number) => Promise<void> | void
}

/** The backend with every call passing the hooks; everything else is delegated unchanged. */
function hooked(inner: Store2Backend, hooks: Hooks): Store2Backend {
    const started = new Map<string, number>()
    const finished = new Map<string, number>()
    async function run<T>(name: string, body: () => Promise<T>): Promise<T> {
        const begun = (started.get(name) ?? 0) + 1
        started.set(name, begun)
        await hooks.before?.(name, begun)
        const result = await body()
        const done = (finished.get(name) ?? 0) + 1
        finished.set(name, done)
        await hooks.after?.(name, done)
        return result
    }
    return {
        readCommit: () => run('readCommit', () => inner.readCommit()),
        readFence: () => run('readFence', () => inner.readFence()),
        casCommit: (expected, next) => run('casCommit', () => inner.casCommit(expected, next)),
        casFence: (expected, next) => run('casFence', () => inner.casFence(expected, next)),
        readUnits: (keys) => run('readUnits', () => inner.readUnits(keys)),
        listStore2: () => run('listStore2', () => inner.listStore2()),
        countPrefix: (prefix) => run('countPrefix', () => inner.countPrefix(prefix)),
        commitOrdinary: (expectedCommit, units, nextCommit) => run('commitOrdinary', () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => run('putUnit', () => inner.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => run('removeBatch', () => inner.removeBatch(keys, expectedCommit, expectedFence)),
    }
}

function committerOf(backend: Store2Backend, clock: TestClock, seed: number, owner: string): Committer {
    return createCommitter(backend, { owner, env: testEnv(clock, seed) })
}

async function parsedCommit(backend: Store2Backend): Promise<CommitKey> {
    const read = classifyCommitRead(await backend.readCommit())
    if (read.status !== 'parsed') {
        throw new Error(`The commit key is ${read.status}.`)
    }
    return read.value
}

/** One write call a page made to the backend: the call, the key and the bytes it carried. */
export interface WriteRecord {
    call: 'casCommit' | 'commitOrdinary' | 'putUnit' | 'removeBatch'
    key: string
    bytes: number
}

export interface CountedBackend {
    /** What the page uses: every write call is recorded before it reaches the memory backend. */
    backend: Store2Backend
    memory: MemoryBackend
    writes: WriteRecord[]
    /** The write calls so far (a commit is one call whatever the units it carries). */
    writeCalls(): number
    /** The bytes the page wrote so far, units and commit keys. */
    savedBytes(): number
    reset(): void
}

export function countedBackend(options: { hooks?: Hooks } = {}): CountedBackend {
    const memory = createMemoryBackend()
    const inner: Store2Backend = options.hooks === undefined ? memory : hooked(memory, options.hooks)
    const writes: WriteRecord[] = []
    const backend: Store2Backend = {
        readCommit: () => inner.readCommit(),
        readFence: () => inner.readFence(),
        casCommit: (expected, next) => {
            writes.push({ call: 'casCommit', key: COMMIT_KEY, bytes: next.length })
            return inner.casCommit(expected, next)
        },
        casFence: (expected, next) => inner.casFence(expected, next),
        readUnits: keys => inner.readUnits(keys),
        listStore2: () => inner.listStore2(),
        countPrefix: prefix => inner.countPrefix(prefix),
        commitOrdinary: (expected, units, next) => {
            for (const unit of units) {
                writes.push({ call: 'commitOrdinary', key: unit.key, bytes: unit.bytes.length })
            }
            writes.push({ call: 'commitOrdinary', key: COMMIT_KEY, bytes: next.length })
            return inner.commitOrdinary(expected, units, next)
        },
        putUnit: (key, bytes) => {
            writes.push({ call: 'putUnit', key, bytes: bytes.length })
            return inner.putUnit(key, bytes)
        },
        removeBatch: (keys, expectedCommit, expectedFence) => {
            for (const key of keys) {
                writes.push({ call: 'removeBatch', key, bytes: 0 })
            }
            return inner.removeBatch(keys, expectedCommit, expectedFence)
        },
    }
    return {
        backend,
        memory,
        writes,
        writeCalls: () => writes.length,
        savedBytes: () => writes.reduce((sum, write) => sum + write.bytes, 0),
        reset: () => { writes.length = 0 },
    }
}

/** A peer handler that records what it was told and answers every question with `answer`. */
export interface PeerDouble extends Store2PeerHandler {
    clean: PeerParkPrompt[]
    asked: PeerParkPrompt[]
    reloads: number
    exports: string[]
    answer: PeerOffer
    /** While set, `decide` waits for it. */
    hold: Promise<void> | null
    /** Makes the export reject. */
    exportFails: boolean
}

export function createPeerDouble(answer: PeerOffer = 'reload'): PeerDouble {
    const double: PeerDouble = {
        clean: [],
        asked: [],
        reloads: 0,
        exports: [],
        answer,
        hold: null,
        exportFails: false,
        parkedClean(prompt) {
            double.clean.push(prompt)
        },
        async decide(prompt) {
            double.asked.push(prompt)
            if (double.hold !== null) {
                await double.hold
            }
            return double.answer
        },
        async exportThisTab(manifestKey) {
            double.exports.push(manifestKey)
            if (double.exportFails) {
                throw new Error('The export failed.')
            }
        },
        reload() {
            double.reloads += 1
        },
    }
    return double
}

export interface SeededTree {
    tree: EncodedTree
    manifestKey: string
}

/** Writes the encoding of `db` as the first complete tree and the commit key that names it. */
export async function seedTree(backend: Store2Backend, db: Database, env: KeyEnv, lists: ListDerivation = fakeLists): Promise<SeededTree> {
    const tree = encodeDatabase(db, { env, lists, seq: 1, createdAt: env.now() })
    for (const unit of tree.units) {
        await backend.putUnit(unit.key, unit.bytes)
    }
    const first = firstCommitKey({ current: { key: tree.manifestKey, at: env.now() }, staging: null, manifests: [tree.manifest] }, env)
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))
    return { tree, manifestKey: tree.manifestKey }
}

export interface Store2StartOptions {
    /** The database the first tree is seeded from; it is copied, so the live database is the caller's. */
    db: Database
    kind?: AppStoreKind
    hooks?: Hooks
    lists?: ListDerivation
    peer?: PeerDouble
    loadStub?: Store2SaveContext['loadStub']
    /** Off unless named: an idle tick is a pass the suites do not ask for. */
    idleNet?: IdleNetOptions | null
}

export interface Store2Kit {
    counted: CountedBackend
    memory: MemoryBackend
    clock: TestClock
    committer: Committer
    context: Store2SaveContext
    peer: PeerDouble
    seeded: SeededTree
    /** A copy of the database the first tree holds. */
    seedDb: Database
    /** The commit key as the store holds it. */
    commitKey(): Promise<CommitKey>
    /** The database the store's current manifest assembles to. */
    saved(): Promise<Database>
    /** The unit types written since `mark`, sorted, the commit key's own write excluded. */
    writtenSince(mark: Map<string, Uint8Array>): string[]
}

const TYPE_NAME: ReadonlyMap<number, string> = new Map(Object.entries(UNIT_TYPE).map(([name, id]) => [id, name]))

export async function startStore2(options: Store2StartOptions): Promise<Store2Kit> {
    const clock = createClock()
    const counted = countedBackend({ hooks: options.hooks })
    const seedDb = JSON.parse(JSON.stringify(options.db)) as Database
    const lists = options.lists ?? fakeLists
    const seeded = await seedTree(counted.backend, seedDb, testEnv(clock, 4242), lists)
    counted.reset()
    const committer = committerOf(counted.backend, clock, 777, freshOwnerId(testEnv(clock, 778)))
    const peer = options.peer ?? createPeerDouble()
    const context: Store2SaveContext = {
        session: { kind: options.kind ?? 'tauri', committer },
        previous: previousFrom(seeded.tree),
        lists,
        env: testEnv(clock, 99),
        peer,
        loadStub: options.loadStub,
        idleNet: options.idleNet ?? null,
    }
    async function commitKey(): Promise<CommitKey> {
        return parsedCommit(counted.memory)
    }
    return {
        counted,
        memory: counted.memory,
        clock,
        committer,
        context,
        peer,
        seeded,
        seedDb,
        commitKey,
        async saved() {
            const key = await commitKey()
            const entries = counted.memory.snapshot()
            const manifestBytes = entries.get((key.current as { key: string }).key)
            if (manifestBytes === undefined) {
                throw new Error('The current manifest is not stored.')
            }
            const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
            if (manifest.status !== 'ok') {
                throw new Error(`The current manifest is ${manifest.status}.`)
            }
            return assembleDatabase(manifest.value.body as Manifest, { get: unitKey => entries.get(unitKey) })
        },
        writtenSince(mark) {
            const names: string[] = []
            for (const [key, bytes] of counted.memory.snapshot()) {
                if (!mark.has(key)) {
                    names.push(TYPE_NAME.get(bytes[5]) ?? `type-${bytes[5]}`)
                }
            }
            return names.sort()
        },
    }
}

/** A peer page's commit over the store: `edit` is applied to a copy of the seed database and committed whole. */
export async function peerCommit(kit: Store2Kit, edit: (db: Database) => void, seed = 31337): Promise<CommitKey> {
    const peerDb = JSON.parse(JSON.stringify(kit.seedDb)) as Database
    edit(peerDb)
    const peer = committerOf(kit.counted.memory, kit.clock, seed, 'peer-page')
    const encoder = createSaveEncoder({ previous: previousFrom(kit.seeded.tree), lists: fakeLists, env: testEnv(kit.clock, seed + 1) })
    const plan = await encoder.plan(peerDb, { marked: new Set(), modules: true, whole: true })
    const result = await peer.commit(await peer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The peer commit came to ${result.status}.`)
    }
    return result.value
}

/** A peer's pin of the current manifest: the commit key's epoch changes and its `current` does not. */
export async function peerPin(kit: Store2Kit, seed = 4711): Promise<CommitKey> {
    const peer = committerOf(kit.counted.memory, kit.clock, seed, 'peer-page')
    const key = await kit.commitKey()
    const result = await peer.pin(await peer.readCommit(), (key.current as { key: string }).key, 'test pin')
    if (result.status !== 'committed') {
        throw new Error(`The peer pin came to ${result.status}.`)
    }
    return result.value
}

/** The `boot` option of `createWorldKit`: activates the kit's context in the world's own module graph. */
export function store2Boot(kit: Store2Kit): (world: World) => Promise<void> {
    return async (world) => {
        const { activateStore2Save } = await import('src/ts/storage/store2/saveActive')
        activateStore2Save(kit.context)
        world.pageMode.setPageStorageMode({ kind: 'block' })
    }
}
