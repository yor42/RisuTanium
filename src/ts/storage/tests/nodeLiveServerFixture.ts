/**
 * Machinery of the live-server test of the store2 protocol: store2 clients over
 * the real Node server process, a workload of committers, a restorer and a
 * collection loop, an observer that judges I1 from outside every client, and the
 * extraction of earlier server builds from git history. Import it only from a
 * test that runs in the Vitest `node` environment.
 *
 * The observer is a second client with its own store and no injected faults. It
 * reads the commit key, walks the trees it names, lists `store2/`, and reads the
 * commit key again: only a snapshot whose two commit-key reads carry the same
 * revision is evidence, because while the commit key stands every unit it names
 * must exist (a commit that lands during the walk may legitimately let collection
 * remove a unit the older key named). Units are immutable, so the walk of a
 * manifest is cached once complete and later snapshots cost one listing.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { STORE2_PREFIX } from 'src/ts/storage/store/keyRules'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createNodeBackend, Store2BackendError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { ADMISSION_INTERVAL_MS, createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    defaultKeyEnv, encodeUnit, keyOfTail, newUnitKey, readUnit, refsOf, UNIT_TYPE,
    type CommitKey, type KeyEnv, type UnitType,
} from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createReplyDropper, hexOfKey, type NodeServerFixture, type ReplyDropper } from './nodeServerFixture'
import { seedStore, treeRequest } from './store2/commitFixtures'

// ---- small utilities ----

/** A seeded stream of numbers in [0, 1). */
export function seededRng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Counts keyed by a label; a report is the sorted record. */
export class Tally {
    private readonly counts = new Map<string, number>()

    add(key: string, amount = 1): void {
        this.counts.set(key, (this.counts.get(key) ?? 0) + amount)
    }

    get(key: string): number {
        return this.counts.get(key) ?? 0
    }

    record(): Record<string, number> {
        return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
    }
}

/**
 * A key environment whose clock moves one admission interval at every reading, so every
 * commit is admitted to `retained`, retention overflows and collection has garbage.
 */
export function steppedEnv(): KeyEnv {
    let readings = 0
    const base = Date.now()
    return { ...defaultKeyEnv, now: () => base + readings++ * ADMISSION_INTERVAL_MS }
}

function pick<T>(rng: () => number, weighted: readonly (readonly [T, number])[]): T {
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0)
    let at = rng() * total
    for (const [value, weight] of weighted) {
        at -= weight
        if (at < 0) {
            return value
        }
    }
    return weighted[weighted.length - 1][0]
}

function outcomeOf(result: { status: string }): string {
    return 'reason' in result && typeof result.reason === 'string' ? `${result.status}:${result.reason}` : result.status
}

// ---- clients ----

export interface LiveClient {
    name: string
    owner: string
    store: ByteStore
    backend: Store2Backend
    committer: Committer
    dropper: ReplyDropper | null
}

/** The kind a reply-drop rule counts: a commit-key write apart from a unit write, every other route by its name. */
export function guardedKindOf(url: string, init: RequestInit | undefined): string {
    const route = new URL(url).pathname.replace(/^\/api\//, '')
    if (route === 'write-checked') {
        return new Headers(init?.headers).get('file-path') === hexOfKey(COMMIT_KEY) ? 'commit-write' : 'unit-write'
    }
    return route
}

export function openLiveClient(
    fixture: NodeServerFixture,
    name: string,
    env: KeyEnv,
    drops?: Readonly<Record<string, (nth: number) => boolean>>,
): LiveClient {
    const dropper = drops === undefined ? null : createReplyDropper({ kindOf: guardedKindOf, drops })
    const store = createNodeHttpStore({
        baseUrl: fixture.baseUrl,
        authHeader: () => fixture.authHeader(),
        fetch: dropper === null ? undefined : dropper.fetch,
    })
    const backend = createNodeBackend(store)
    const owner = freshOwnerId(env)
    return { name, owner, store, backend, committer: createCommitter(backend, { owner, env }), dropper }
}

// ---- the observer ----

/** Marks the batches of a multi-key retire that are in flight, so the observer can tell which walks overlapped one. */
export class RetireWindow {
    active = 0
    started = 0
}

export interface ObserverViolation {
    label: string
    kind: 'missing' | 'damaged' | 'commit-unparsable' | 'commit-removed'
    revision: number | null
    detail: string[]
}

export interface LiveSnapshot {
    revision: number
    commit: CommitKey
    /** Every key of the trees the commit key names. */
    wanted: Set<string>
    listing: Set<string>
    missing: string[]
    damaged: string[]
}

export type SnapshotOutcome =
    | { status: 'stable', snapshot: LiveSnapshot }
    | { status: 'absent' }
    | { status: 'unparsable', detail: string, revision: number }
    | { status: 'moved' }

export interface Observer {
    /** Judges I1 once, retrying a snapshot that a commit moved. Never throws for an unreachable server. */
    check(label: string): Promise<void>
    /** One snapshot, for the end state; throws `Error` when the server cannot be read. */
    snapshot(): Promise<SnapshotOutcome>
    readonly violations: readonly ObserverViolation[]
    /** The time, in milliseconds since the epoch, of each check that could not read the server. */
    readonly unavailableAt: readonly number[]
}

class Unavailable extends Error {}

const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

const SNAPSHOT_ATTEMPTS = 5

function manifestsNamed(key: CommitKey): string[] {
    return [
        ...(key.current === null ? [] : [key.current.key]),
        ...key.retained.map((entry) => entry.key),
        ...key.pins.map((pin) => pin.key),
    ]
}

export function createObserver(store: ByteStore, window: RetireWindow, tally: Tally): Observer {
    const violations: ObserverViolation[] = []
    const unavailableAt: number[] = []
    const trees = new Map<string, string[]>()
    let sawCommit = false

    const read = async (key: string) => {
        try {
            return await store.read(key)
        } catch (error) {
            throw new Unavailable(error instanceof Error ? error.message : String(error))
        }
    }

    async function treeOf(manifestKey: string): Promise<{ keys: string[], missing: string[], damaged: string[] }> {
        const cached = trees.get(manifestKey)
        if (cached !== undefined) {
            return { keys: cached, missing: [], damaged: [] }
        }
        const keys = [manifestKey]
        const missing: string[] = []
        const damaged: string[] = []
        const manifestBytes = (await read(manifestKey)).bytes
        if (manifestBytes === null) {
            return { keys, missing: [manifestKey], damaged }
        }
        const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
        if (manifest.status !== 'ok' && manifest.status !== 'stale') {
            return { keys, missing, damaged: [manifestKey] }
        }
        const children: { key: string, type: UnitType | undefined }[] = []
        for (const target of refsOf(UNIT_TYPE.manifest, manifest.value.body)) {
            const key = keyOfTail(target.tail)
            keys.push(key)
            children.push({ key, type: DESCENT[target.path] })
        }
        await Promise.all(children.map(async (child) => {
            if (child.type === undefined) {
                return
            }
            const bytes = (await read(child.key)).bytes
            if (bytes === null) {
                missing.push(child.key)
                return
            }
            const unit = readUnit(bytes, child.type)
            if (unit.status !== 'ok' && unit.status !== 'stale') {
                damaged.push(child.key)
                return
            }
            for (const leaf of refsOf(child.type, unit.value.body)) {
                keys.push(keyOfTail(leaf.tail))
            }
        }))
        if (missing.length === 0 && damaged.length === 0) {
            trees.set(manifestKey, keys)
        }
        return { keys, missing, damaged }
    }

    async function snapshot(): Promise<SnapshotOutcome> {
        const first = await read(COMMIT_KEY)
        if (first.version === null) {
            throw new Unavailable('The store reported no revision for the commit key.')
        }
        const parsed = classifyCommitRead(first)
        if (parsed.status === 'absent') {
            return { status: 'absent' }
        }
        if (parsed.status !== 'parsed') {
            return { status: 'unparsable', detail: parsed.reason, revision: first.version }
        }
        const wanted = new Set<string>()
        const missing = new Set<string>()
        const damaged = new Set<string>()
        for (const manifestKey of manifestsNamed(parsed.value)) {
            const tree = await treeOf(manifestKey)
            tree.keys.forEach((key) => wanted.add(key))
            tree.missing.forEach((key) => missing.add(key))
            tree.damaged.forEach((key) => damaged.add(key))
        }
        let listing: Set<string>
        try {
            listing = new Set(await store.list(STORE2_PREFIX))
        } catch (error) {
            throw new Unavailable(error instanceof Error ? error.message : String(error))
        }
        for (const key of wanted) {
            if (!listing.has(key)) {
                missing.add(key)
            }
        }
        const second = await read(COMMIT_KEY)
        if (second.version !== first.version) {
            return { status: 'moved' }
        }
        return {
            status: 'stable',
            snapshot: { revision: first.version, commit: parsed.value, wanted, listing, missing: [...missing].sort(), damaged: [...damaged].sort() },
        }
    }

    function record(label: string, outcome: Exclude<SnapshotOutcome, { status: 'moved' }>): void {
        switch (outcome.status) {
            case 'absent':
                if (sawCommit) {
                    violations.push({ label, kind: 'commit-removed', revision: null, detail: ['The commit key was present before and is absent now.'] })
                } else {
                    tally.add('observer:no-commit-yet')
                }
                return
            case 'unparsable':
                violations.push({ label, kind: 'commit-unparsable', revision: outcome.revision, detail: [outcome.detail] })
                return
            case 'stable': {
                sawCommit = true
                const { snapshot: found } = outcome
                if (found.missing.length > 0) {
                    violations.push({ label, kind: 'missing', revision: found.revision, detail: found.missing })
                } else if (found.damaged.length > 0) {
                    violations.push({ label, kind: 'damaged', revision: found.revision, detail: found.damaged })
                } else {
                    tally.add('observer:ok')
                }
            }
        }
    }

    return {
        violations,
        unavailableAt,
        snapshot,
        async check(label) {
            const startedBefore = window.started
            const activeBefore = window.active
            try {
                for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
                    const outcome = await snapshot()
                    if (outcome.status === 'moved') {
                        tally.add('observer:moved')
                        continue
                    }
                    record(label, outcome)
                    return
                }
                tally.add('observer:inconclusive')
            } catch (error) {
                if (!(error instanceof Unavailable)) {
                    throw error
                }
                unavailableAt.push(Date.now())
                tally.add('observer:unavailable')
            } finally {
                if (activeBefore > 0 || window.active > 0 || window.started !== startedBefore) {
                    tally.add('observer:walks-during-retire')
                }
            }
        },
    }
}

/** Concurrent listings that watch one retire batch. */
const RETIRE_SAMPLERS = 3

/**
 * Wraps a backend so that every multi-key `removeBatch` is a window the observer can see, and samples
 * the batch while it is in flight with listings of `store2/` through `probe`: the server removes a batch
 * file by file, so a listing that holds some of the batch's keys and not all of them is a partly applied
 * retire seen by a reader.
 */
export function instrumentRetires(backend: Store2Backend, window: RetireWindow, probe: ByteStore, tally: Tally): Store2Backend {
    return {
        ...backend,
        async removeBatch(keys, expectedCommit, expectedFence) {
            if (keys.length < 2) {
                return backend.removeBatch(keys, expectedCommit, expectedFence)
            }
            window.started++
            window.active++
            tally.add('retire:batches')
            let stop = false
            let partial = false
            const sampler = async (): Promise<void> => {
                try {
                    while (!stop && !partial) {
                        // One listing is one reader's view of the directory: some of the batch gone and some still there is a partly applied retire.
                        const listing = new Set(await probe.list(STORE2_PREFIX))
                        const left = keys.filter((key) => listing.has(key)).length
                        partial = left > 0 && left < keys.length
                    }
                } catch {
                    // A probe that cannot reach the server shows nothing.
                }
            }
            const samplers = Promise.all(Array.from({ length: RETIRE_SAMPLERS }, sampler))
            try {
                return await backend.removeBatch(keys, expectedCommit, expectedFence)
            } finally {
                stop = true
                window.active--
                await samplers
                tally.add(partial ? 'retire:partial-seen' : 'retire:no-partial-seen')
            }
        },
    }
}

// ---- the workload ----

export interface LiveOptions {
    seconds: number
    seed: number
    /** 2 to 4 committer clients. */
    committers: number
    /** The fraction of the run after which the server restarts once. */
    restartAt: number
}

export interface EndState {
    commit: { staging: boolean, pins: number, retained: number, current: string | null }
    lastGc: GcResult | null
    /** The keys of every tree the commit key names. */
    wanted: string[]
    /** What the backend lists under `store2/`. */
    listing: string[]
    /** Every key the server's save directory holds, from its file names. */
    serverKeys: string[]
    missing: string[]
    damaged: string[]
    snapshot: SnapshotOutcome['status']
}

export interface LiveReport {
    options: LiveOptions
    elapsedMs: number
    /** The shared tally: the main run and every observer check; collection and retire counts of the retire phase are in phaseCounts. */
    counts: Record<string, number>
    /** What the main run counted with the writers active, taken before the retire phase began. */
    mainCounts: Record<string, number>
    /** What the writer-free retire phase counted for its own collection passes and retires. */
    phaseCounts: Record<string, number>
    /** The span of the one server restart: from just before the call until the server answered again. */
    restartWindow: { from: number, to: number } | null
    /** The time of each observer check that could not read the server. */
    unavailableAt: number[]
    requestsSeen: Record<string, number>
    repliesDropped: Record<string, number>
    violations: ObserverViolation[]
    /** Errors that no outcome category covers: something other than a backend error escaped an operation. */
    unexpected: string[]
    partialRetireRounds: number
    endState: EndState
}

const PARTIAL_RETIRE_TARGET = 3
const PARTIAL_RETIRE_MAX_ROUNDS = 60
/** How long after the server answers again a check that began during the restart may still report an unreachable server. */
export const RESTART_MARGIN_MS = 3000

/** Each round clears a marker or removes a pin; the run leaves a few dozen pins at most. */
const CLEANUP_ROUNDS = 200
const FINAL_GC_PASSES = 6

function describeThrown(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
}

function tallyGc(tally: Tally, result: GcResult): void {
    if (result.status === 'refused') {
        tally.add(`gc:refused:${result.reason}`)
        return
    }
    tally.add(result.stopped === undefined ? 'gc:done' : `gc:done:${result.stopped}`)
    tally.add('gc:keys-deleted', result.deleted)
    tally.add('gc:batches-applied', result.batches)
}

function gcDepsOf(client: LiveClient, backend: Store2Backend) {
    const guarded = client.store.guarded
    if (guarded === undefined) {
        throw new Error('The Node store offers no guarded operations.')
    }
    return { backend, kind: 'node' as const, idleReason: () => null, probe: () => guarded.probe() }
}

async function serverKeysOf(fixture: NodeServerFixture): Promise<string[]> {
    const keys: string[] = []
    for (const name of await readdir(fixture.saveDir)) {
        if (/^(?:[0-9a-f]{2})+$/i.test(name)) {
            keys.push(Buffer.from(name, 'hex').toString('utf8'))
        }
    }
    return keys.sort()
}

/**
 * Runs the committers, the restorer and the collection loop against `fixture` for `options.seconds`,
 * restarts the server once, then drives a short phase of multi-key retires under observation, cleans the
 * store to its quiet state and reports. The observer judges I1 after every operation of every worker.
 */
export async function runLiveWorkload(fixture: NodeServerFixture, options: LiveOptions): Promise<LiveReport> {
    const startedAt = Date.now()
    const env = steppedEnv()
    const tally = new Tally()
    const unexpected: string[] = []
    const window = new RetireWindow()
    const observerStore = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    const observer = createObserver(observerStore, window, tally)

    const seeder = openLiveClient(fixture, 'seed', env)
    await seedStore(seeder.backend, env)
    await observer.check('seed')

    const committers = Array.from({ length: options.committers }, (_, index) => openLiveClient(fixture, `committer-${index}`, env, {
        'unit-write': (nth) => nth % (23 + 4 * index) === 0,
        'commit-write': (nth) => nth % (7 + 2 * index) === 0,
    }))
    const restorer = openLiveClient(fixture, 'restorer', env, { 'commit-write': (nth) => nth % 5 === 0 })
    const collector = openLiveClient(fixture, 'collector', env, { 'remove-checked': (nth) => nth % 4 === 0 })
    const collectorBackend = instrumentRetires(collector.backend, window, observerStore, tally)
    const clients = [...committers, restorer, collector]

    let running = true

    async function guarded(label: string, run: () => Promise<void>): Promise<void> {
        try {
            await run()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                tally.add(`${label}:threw:${error.name}`)
            } else {
                unexpected.push(`${label}: ${describeThrown(error)}`)
            }
        }
    }

    async function committerOperation(client: LiveClient, op: string, rng: () => number, tag: string): Promise<void> {
        const read = await client.committer.readCommit()
        const classified = classifyCommitRead(read)
        if (classified.status !== 'parsed') {
            tally.add(`${op}:base-${classified.status}`)
            return
        }
        const value = classified.value
        if (value.staging !== null && value.staging.owner === client.owner) {
            // The page's own marker is cleared the way the start-up clear does.
            const cleared = await client.committer.clearMarker(read)
            tally.add(`clear-own-marker:${cleared.cleared === null ? cleared.decision.decision : outcomeOf(cleared.cleared)}`)
            return
        }
        switch (op) {
            case 'commit':
                tally.add(`commit:${outcomeOf(await client.committer.commit(read, treeRequest(Math.floor(rng() * 9), { tag })))}`)
                return
            case 'bulk':
                tally.add(`bulk:${outcomeOf(await client.committer.commit(read, treeRequest(50, { tag })))}`)
                return
            case 'pin': {
                const named = [...(value.current === null ? [] : [value.current.key]), ...value.retained.map((entry) => entry.key)]
                const candidates = named.filter((key) => !value.pins.some((pin) => pin.key === key))
                if (candidates.length === 0) {
                    tally.add('pin:no-candidate')
                    return
                }
                tally.add(`pin:${outcomeOf(await client.committer.pin(read, candidates[Math.floor(rng() * candidates.length)], 'live-test'))}`)
                return
            }
            default:
                if (value.pins.length === 0) {
                    tally.add('unpin:no-pin')
                    return
                }
                tally.add(`unpin:${outcomeOf(await client.committer.unpin(read, value.pins[Math.floor(rng() * value.pins.length)].key))}`)
        }
    }

    async function committerLoop(client: LiveClient, index: number): Promise<void> {
        const rng = seededRng(options.seed * 1000 + index)
        for (let n = 1; running; n++) {
            const op = pick(rng, [['commit', 10], ['bulk', 1], ['pin', 2], ['unpin', 2]] as const)
            await guarded(`${client.name}:${op}`, () => committerOperation(client, op, rng, `${client.name}-${n}`))
            await observer.check(`${client.name}#${n}:${op}`)
            await pause(rng() * 15)
        }
    }

    async function restorerLoop(): Promise<void> {
        const rng = seededRng(options.seed * 1000 + 100)
        for (let n = 1; running; n++) {
            await guarded('restore', async () => {
                const read = await restorer.committer.readCommit()
                const classified = classifyCommitRead(read)
                if (classified.status !== 'parsed' || classified.value.retained.length === 0) {
                    tally.add('restore:nothing-retained')
                    return
                }
                const retained = classified.value.retained
                tally.add(`restore:${outcomeOf(await restorer.committer.restore(read, retained[Math.floor(rng() * retained.length)].key))}`)
            })
            await observer.check(`restorer#${n}`)
            await pause(20 + rng() * 60)
        }
    }

    async function collectorLoop(): Promise<void> {
        const rng = seededRng(options.seed * 1000 + 200)
        for (let n = 1; running; n++) {
            await guarded('gc', async () => {
                tallyGc(tally, await gcPass(gcDepsOf(collector, collectorBackend)))
            })
            await observer.check(`collector#${n}`)
            await pause(10 + rng() * 40)
        }
    }

    let restartWindow: { from: number, to: number } | null = null

    async function restartOnce(): Promise<void> {
        await pause(options.seconds * 1000 * options.restartAt)
        const from = Date.now()
        await fixture.restart()
        restartWindow = { from, to: Date.now() }
        tally.add('server:restart')
    }

    const loops = [
        ...committers.map((client, index) => committerLoop(client, index)),
        restorerLoop(),
        collectorLoop(),
    ]
    const restart = restartOnce()
    await pause(options.seconds * 1000)
    running = false
    await Promise.all([...loops, restart])
    const mainCounts = tally.record()

    // Multi-key retires under observation: plant a batch of orphans, collect it with the observer walking.
    const phase = openLiveClient(fixture, 'retire-phase', env)
    const phaseTally = new Tally()
    const phaseBackend = instrumentRetires(phase.backend, window, observerStore, phaseTally)
    let rounds = 0
    while (rounds < PARTIAL_RETIRE_MAX_ROUNDS && (mainCounts['retire:partial-seen'] ?? 0) + phaseTally.get('retire:partial-seen') < PARTIAL_RETIRE_TARGET) {
        rounds++
        for (let i = 0; i < 25; i++) {
            await phase.backend.putUnit(newUnitKey(env), encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'orphan', rounds, i }))
        }
        let collecting = true
        const walker = (async () => {
            while (collecting) {
                await observer.check(`retire-phase#${rounds}`)
            }
        })()
        try {
            tallyGc(phaseTally, await gcPass(gcDepsOf(phase, phaseBackend)))
        } finally {
            collecting = false
            await walker
        }
    }

    // The quiet state: no marker, no pin, nothing collectable.
    const cleaner = phase
    for (let round = 0; round < CLEANUP_ROUNDS; round++) {
        const read = await cleaner.committer.readCommit()
        const classified = classifyCommitRead(read)
        if (classified.status !== 'parsed') {
            break
        }
        const value = classified.value
        if (value.staging !== null) {
            const owning = clients.find((client) => client.owner === value.staging?.owner) ?? cleaner
            await owning.committer.clearMarker(read)
            continue
        }
        if (value.pins.length > 0) {
            await cleaner.committer.unpin(read, value.pins[0].key)
            continue
        }
        break
    }
    let lastGc: GcResult | null = null
    for (let pass = 0; pass < FINAL_GC_PASSES; pass++) {
        lastGc = await gcPass(gcDepsOf(phase, phase.backend))
        if (lastGc.status === 'done' && lastGc.deleted === 0 && lastGc.stopped === undefined) {
            break
        }
    }

    let final: SnapshotOutcome = { status: 'moved' }
    for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS && final.status === 'moved'; attempt++) {
        final = await observer.snapshot()
    }
    const stable = final.status === 'stable' ? final.snapshot : null
    const endState: EndState = {
        commit: {
            staging: stable !== null && stable.commit.staging !== null,
            pins: stable?.commit.pins.length ?? -1,
            retained: stable?.commit.retained.length ?? -1,
            current: stable?.commit.current?.key ?? null,
        },
        lastGc,
        wanted: stable === null ? [] : [...stable.wanted].sort(),
        listing: stable === null ? [] : [...stable.listing].sort(),
        serverKeys: await serverKeysOf(fixture),
        missing: stable?.missing ?? [],
        damaged: stable?.damaged ?? [],
        snapshot: final.status,
    }

    const seen: Record<string, number> = {}
    const dropped: Record<string, number> = {}
    for (const client of clients) {
        for (const [kind, count] of client.dropper?.seen ?? []) {
            seen[kind] = (seen[kind] ?? 0) + count
        }
        for (const [kind, count] of client.dropper?.dropped ?? []) {
            dropped[kind] = (dropped[kind] ?? 0) + count
        }
    }
    return {
        options,
        elapsedMs: Date.now() - startedAt,
        counts: tally.record(),
        mainCounts,
        phaseCounts: phaseTally.record(),
        restartWindow,
        unavailableAt: [...observer.unavailableAt],
        requestsSeen: seen,
        repliesDropped: dropped,
        violations: [...observer.violations],
        unexpected,
        partialRetireRounds: rounds,
        endState,
    }
}

// ---- earlier server builds ----

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SERVER_DIRECTORY = 'server/node/'

function git(...args: string[]) {
    return spawnSync('git', ['-C', REPO_ROOT, ...args], { maxBuffer: 256 * 1024 * 1024 })
}

/** Why earlier server builds cannot be extracted from git history here, or `null` when they can. */
export function gitHistoryUnavailable(hashes: readonly string[]): string | null {
    const version = git('--version')
    if (version.error !== undefined || version.status !== 0) {
        return 'git is not available'
    }
    for (const hash of hashes) {
        const found = git('cat-file', '-e', `${hash}^{commit}`)
        if (found.status !== 0) {
            return `commit ${hash} is not in this repository's history`
        }
    }
    return null
}

export interface ExtractedServer {
    /** The extracted `server.cjs`; its sibling modules sit beside it. */
    script: string
    dispose(): Promise<void>
}

/** Extracts the `.cjs` files of `server/node/` as of `hash` into a fresh temporary directory, read-only from git: nothing is checked out. */
export async function extractServer(hash: string): Promise<ExtractedServer> {
    const dir = await mkdtemp(join(tmpdir(), `risu-live-server-${hash}-`))
    const dispose = () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    try {
        const listed = git('ls-tree', '--name-only', hash, SERVER_DIRECTORY)
        if (listed.status !== 0) {
            throw new Error(`git ls-tree ${hash} failed: ${listed.stderr.toString('utf8')}`)
        }
        for (const path of listed.stdout.toString('utf8').split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.cjs'))) {
            const shown = git('show', `${hash}:${path}`)
            if (shown.status !== 0) {
                throw new Error(`git show ${hash}:${path} failed: ${shown.stderr.toString('utf8')}`)
            }
            await writeFile(join(dir, path.slice(SERVER_DIRECTORY.length)), shown.stdout)
        }
        return { script: join(dir, 'server.cjs'), dispose }
    } catch (error) {
        await dispose()
        throw error
    }
}

/** The files under the server's save directory other than its own (`__`-prefixed) ones, by name, as base64 contents. */
export async function saveDirectoryContents(fixture: NodeServerFixture): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const name of (await readdir(fixture.saveDir)).sort()) {
        if (!name.startsWith('__')) {
            out[name] = (await readFile(join(fixture.saveDir, name))).toString('base64')
        }
    }
    return out
}
