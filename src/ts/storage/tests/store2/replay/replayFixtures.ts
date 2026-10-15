/**
 * Shared builders of the replay tests: the two raw rigs (the Node-semantics fake
 * under the real Node backend, and the memory backend), the step records the
 * checker is fed when a test plants state by hand, and the minimal inline actors
 * of the scheduler and checker tests. The full actors are a later stage.
 */
import { crc32 } from 'src/ts/storage/blockFrame'
import { createMemoryBackend, createNodeBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, nextCommitKey, type CommitKeyChange } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, FRAME_FMT, newManifestKey, newShardKey, newStagedKey, newStagedManifestKey, newStagingId, newUnitKey, refOfFrame, stagingPrefix, tailOfKey, UNIT_TYPE,
    type CommitKey, type KeyEnv, type Manifest, type Ref, type UnitType,
} from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { rawOfMemory, rawOfNodeSemantic, type Checker } from './checker'
import { createNodeSemanticStore, type NodeSemanticStore } from './nodeSemanticStore'
import type { ActorContext, RawState, StepInfo } from './scheduler'

export interface NodeRig {
    fake: NodeSemanticStore
    /** The real Node backend directly over the fake, unscheduled. */
    backend: Store2Backend
    raw: () => RawState
}

export function nodeRig(): NodeRig {
    const fake = createNodeSemanticStore()
    return { fake, backend: createNodeBackend(fake.store), raw: rawOfNodeSemantic(fake) }
}

export interface MemoryRig {
    memory: MemoryBackend
    raw: () => RawState
}

export function memoryRig(): MemoryRig {
    const memory = createMemoryBackend()
    return { memory, raw: rawOfMemory(memory) }
}

/** Bytes that parse as nothing: how a damaged key reads. */
export const GARBAGE = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 255, 254, 253, 252, 251, 250])

/** Hands the checker steps the way the scheduler does, for state a test plants by hand. */
export function stepper(checker: Checker): (actor: string, op: string, context?: ActorContext | null, extra?: Partial<StepInfo>) => ReturnType<Checker['observe']> {
    let step = 0
    return (actor, op, context = null, extra = {}) => checker.observe({
        step: ++step, actor, kind: 'call', op, target: '', applied: true, fault: null,
        context, commitExpect: null, fenceExpect: null, ...extra,
    })
}

export async function storedCommit(fake: NodeSemanticStore): Promise<{ key: CommitKey, revision: number }> {
    const read = await fake.store.read(COMMIT_KEY)
    const parsed = classifyCommitRead({ bytes: read.bytes })
    if (parsed.status !== 'parsed') {
        throw new Error(`The commit key is ${parsed.status}.`)
    }
    return { key: parsed.value, revision: read.version ?? 0 }
}

/** Writes the next commit key over the stored one straight into the fake, at the stored revision: a hand-planted write. */
export async function plantNextCommit(fake: NodeSemanticStore, change: CommitKeyChange, env: KeyEnv, override: Partial<CommitKey> = {}): Promise<CommitKey> {
    const stored = await storedCommit(fake)
    const next = { ...nextCommitKey(stored.key, change, env), ...override }
    await fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, next), { ifVersion: stored.revision })
    return next
}

/** The stored commit key with a frame format newer than this build: its header checksum holds, so it reads as too new and not as damaged. */
export async function tooNewCommitBytes(fake: NodeSemanticStore): Promise<Uint8Array> {
    const stored = (await fake.store.read(COMMIT_KEY)).bytes
    if (stored === null) {
        throw new Error('The commit key is absent.')
    }
    const bytes = stored.slice()
    bytes[4] = FRAME_FMT + 1
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(12, crc32(bytes.subarray(0, 12)), true)
    return bytes
}

/** A fence record listing `keys`, written straight into the fake. */
export async function plantFenceKeys(fake: NodeSemanticStore, keys: readonly string[]): Promise<void> {
    const bytes = encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 0, priorCommits: [], keys: keys.map(tailOfKey) })
    await fake.store.write(FENCE_KEY, bytes, 'unconditional')
}

// ---- State planted before a run (through the rig's `prepare`, ahead of the start state) ----

/** Unreferenced units: a collection pass over them takes several batches (the batch is 25 keys). */
export function plantGarbageUnits(plant: (key: string, bytes: Uint8Array) => void, env: KeyEnv, count: number): void {
    for (let i = 0; i < count; i++) {
        plant(newUnitKey(env), encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'garbage', i }))
    }
}

/** What a planted recovery candidate's tree names and lacks. */
export interface CandidateShape {
    /** Asset file names the tree's asset list names. */
    assets?: readonly string[]
    /** Inlay ids the tree's inlay list names. */
    inlays?: readonly string[]
    /** One leaf the manifest names is never stored: the candidate's tree is incomplete. */
    missingUnit?: boolean
    /** Keys are minted inside the staging prefix of this id (the tree of an unfinished bulk); ordinary keys when absent. */
    stagingId?: string
    /** The manifest's `seq`; above the seeded tree's by default. */
    seq?: number
}

/** A complete tree, as `buildTree` builds one, whose asset and inlay lists name what `shape` says. Returns the manifest key. */
export function plantCandidateTree(plant: (key: string, bytes: Uint8Array) => void, env: KeyEnv, shape: CandidateShape = {}): string {
    const { stagingId } = shape
    const unitKey = (): string => (stagingId === undefined ? newUnitKey(env) : newStagedKey(stagingId, 'u', env))
    const shardKey = (): string => (stagingId === undefined ? newShardKey(env) : newStagedKey(stagingId, 's', env))
    const add = (type: UnitType, body: object, key: string, stored = true): Ref => {
        const bytes = encodeUnit(type, body)
        if (stored) {
            plant(key, bytes)
        }
        return refOfFrame(key, bytes)
    }
    const listRef = (type: UnitType, body: object): [string, number, number, number] => {
        const ref = add(type, body, unitKey())
        return [ref[0], ref[1], ref[2], 1]
    }
    const valueRef = add(UNIT_TYPE.pluginStorageValue, { v: 1, tag: 'candidate' }, unitKey())
    const bucketRef = add(UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [{ k: 'a', ref: valueRef }] }, unitKey())
    const body: Manifest = {
        fmt: 1,
        req: [],
        seq: shape.seq ?? 2,
        createdAt: env.now(),
        shardCount: 1,
        shards: [add(UNIT_TYPE.shard, { v: 1, entries: [] }, shardKey())],
        fixed: {
            config: add(UNIT_TYPE.configRoot, { v: 1, tag: 'candidate' }, unitKey()),
            configAl: listRef(UNIT_TYPE.assetList, { v: 1, h: '', l: [...(shape.assets ?? [])] }),
            il: listRef(UNIT_TYPE.inlayList, { v: 1, u: [...(shape.inlays ?? [])], h: '', o: [] }),
            statics: add(UNIT_TYPE.statics, { v: 1 }, unitKey(), shape.missingUnit !== true),
            order: add(UNIT_TYPE.order, { v: 1, tag: 'candidate' }, unitKey()),
            loadouts: add(UNIT_TYPE.loadouts, { v: 1 }, unitKey()),
            moduleIndex: add(UNIT_TYPE.moduleIndex, { v: 1, entries: [] }, unitKey()),
            presets: [],
            plugins: [],
            pluginStorage: { buckets: 1, refs: [bucketRef] },
            legacyKeep: null,
        },
    }
    const manifestKey = stagingId === undefined ? newManifestKey(env) : newStagedManifestKey(stagingId, env)
    plant(manifestKey, encodeUnit(UNIT_TYPE.manifest, body))
    return manifestKey
}

/**
 * Another owner's bulk commit that stopped: the stored commit key keeps its `current` and gains that owner's `bulk` marker,
 * with `units` staged units standing under the marker's prefix. Returns the marker's prefix.
 */
export function plantForeignBulk(
    peek: (key: string) => Uint8Array | null, plant: (key: string, bytes: Uint8Array) => void, env: KeyEnv, owner: string, units: number,
): string {
    const read = classifyCommitRead({ bytes: peek(COMMIT_KEY) })
    if (read.status !== 'parsed') {
        throw new Error('A foreign bulk marker needs the seeded commit key.')
    }
    const stagingId = newStagingId(env)
    const prefix = stagingPrefix(stagingId)
    for (let i = 0; i < units; i++) {
        plant(newStagedKey(stagingId, 'u', env), encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'staged', i }))
    }
    plant(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, nextCommitKey(read.value, { staging: { owner, prefix, startedAt: env.now(), label: 'bulk' } }, env)))
    return prefix
}
