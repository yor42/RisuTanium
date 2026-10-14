/**
 * Shared builders of the replay tests: the two raw rigs (the Node-semantics fake
 * under the real Node backend, and the memory backend), the step records the
 * checker is fed when a test plants state by hand, and the minimal inline actors
 * of the scheduler and checker tests. The full actors are a later stage.
 */
import { crc32 } from 'src/ts/storage/blockFrame'
import { createMemoryBackend, createNodeBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, nextCommitKey, type CommitKeyChange } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, FRAME_FMT, tailOfKey, UNIT_TYPE, type CommitKey, type KeyEnv } from 'src/ts/storage/store2/format'
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
