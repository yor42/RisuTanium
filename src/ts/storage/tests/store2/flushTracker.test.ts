// @vitest-environment node
/**
 * Flush tracking of the Tauri top-level keys after boot: the session decorates its
 * backend, so the commit key and the fence writes of recovery, the fence and the
 * committer all feed `session.idleReason` and the gate. The backend under test is
 * the memory reference backend with scripted flush reports, because the real Tauri
 * report is covered by the Tauri backend tests; a pass says nothing about a device.
 */
import { describe, expect, test } from 'vitest'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { ByteStore, GuardedOperations } from 'src/ts/storage/store/contract'
import { createFakeStore } from '../blockStoreHarness'
import {
    Store2BackendFailureError, Store2UnknownOutcomeError, createMemoryBackend, type Store2Backend, type Store2WriteResult,
} from 'src/ts/storage/store2/backend'
import { discardFence, fenceExit } from 'src/ts/storage/store2/fence'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, parsedCommit, seedStore, START_TIME, testEnv, treeRequest } from './commitFixtures'
import { plantFence } from './fenceFixtures'

const clock = createClock()
const env = testEnv(clock, 71)

/** What a scripted top-level write does: report this flush status after applying, or throw before applying. */
type Outcome = { flushed: boolean | undefined } | { fail: Error }

interface Script {
    commit: Outcome
    fence: Outcome
}

async function scriptedWrite(outcome: Outcome, apply: () => Promise<Store2WriteResult>): Promise<Store2WriteResult> {
    if ('fail' in outcome) {
        throw outcome.fail
    }
    await apply()
    return { flushed: outcome.flushed }
}

/** The memory backend whose commit-key and fence writes report what `script` says at the time of the call; conflicts come from the memory backend itself. */
function scripted(inner: Store2Backend, script: Script): Store2Backend {
    return {
        ...inner,
        casCommit: (expected, next) => scriptedWrite(script.commit, () => inner.casCommit(expected, next)),
        casFence: (expected, next) => scriptedWrite(script.fence, () => inner.casFence(expected, next)),
        commitOrdinary: (expectedCommit, units, nextCommit) => scriptedWrite(script.commit, () => inner.commitOrdinary(expectedCommit, units, nextCommit)),
    }
}

function flushedScript(): Script {
    return { commit: { flushed: true }, fence: { flushed: true } }
}

/** A Node page needs the server's guarded operations: the open probe reports the full capability set. */
const NODE_GUARDED: GuardedOperations = {
    probe: async () => ({ checkOnly: true, retire: true, pieces: false }),
    writeChecked: async () => { throw new Error('not used') },
    removeChecked: async () => { throw new Error('not used') },
    retireChecked: async () => { throw new Error('not used') },
}

async function openSession(backend: Store2Backend, kind: AppStoreKind = 'tauri'): Promise<Store2Session> {
    const base = createFakeStore({ versioned: false })
    const store: ByteStore = kind === 'node' ? { ...base, guarded: NODE_GUARDED } : base
    return Store2Session.open(store, { kind, backend, env, reflushAttempts: 1, upstreamMainFile: async () => false })
}

function backendOf(session: Store2Session): Store2Backend {
    if (session.backend === null) {
        throw new Error('The session has no backend.')
    }
    return session.backend
}

async function rewriteCommit(backend: Store2Backend): Promise<Store2WriteResult> {
    const read = await backend.readCommit()
    return backend.casCommit(read.token, read.bytes as Uint8Array)
}

function fenceBytes(): Uint8Array {
    return encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: START_TIME, priorCommits: [], keys: [] })
}

async function bootedTauri(script: Script, withFence = false): Promise<{ session: Store2Session, memory: Store2Backend }> {
    const memory = createMemoryBackend()
    await seedStore(memory, env)
    if (withFence) {
        await plantFence(memory, fenceBytes())
    }
    return { session: await openSession(scripted(memory, script)), memory }
}

describe('post-boot commit key writes', () => {
    test('an unflushed commit key write sets the flag, the gate refuses, and a later flushed write clears it', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)
        expect(session.idleReason).toBeNull()
        expect((await session.openGate('gc')).status).toBe('open')

        script.commit = { flushed: false }
        await rewriteCommit(backendOf(session))

        expect(session.idleReason).not.toBeNull()
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'idle' })

        script.commit = { flushed: true }
        await rewriteCommit(backendOf(session))

        expect(session.idleReason).toBeNull()
        expect((await session.openGate('gc')).status).toBe('open')
    })

    test('a write that reports no flush status sets the flag on Tauri', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)

        script.commit = { flushed: undefined }
        await rewriteCommit(backendOf(session))

        expect(session.idleReason).not.toBeNull()
    })

    test('the committer writes through the tracked backend: an unflushed ordinary commit sets the flag', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)
        const committer = session.committer
        expect(committer).not.toBeNull()

        script.commit = { flushed: false }
        const result = await committer?.commit(await committer.readCommit(), treeRequest(0))

        expect(result?.status).toBe('committed')
        expect(session.idleReason).not.toBeNull()
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'idle' })
    })

    test('a commitOrdinary whose commit key write is flushed clears a set flag', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)
        script.commit = { flushed: false }
        await rewriteCommit(backendOf(session))
        expect(session.idleReason).not.toBeNull()

        script.commit = { flushed: true }
        const committer = session.committer
        await committer?.commit(await committer.readCommit(), treeRequest(0))

        expect(session.idleReason).toBeNull()
    })
})

describe('boot re-flush seeds the flags', () => {
    test('a failed commit key re-flush seeds the commit flag and a later flushed commit key write clears it', async () => {
        const script: Script = { commit: { flushed: false }, fence: { flushed: true } }
        const { session } = await bootedTauri(script)

        expect(session.reflush).toEqual({ ok: false, commit: 'failed', fence: 'absent' })
        expect(session.notice?.reason).toBe('reflush-failed')
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'idle' })

        script.commit = { flushed: true }
        await rewriteCommit(backendOf(session))

        expect(session.idleReason).toBeNull()
        expect((await session.openGate('gc')).status).toBe('open')
        // The notice records the boot failure and does not follow the live flag.
        expect(session.notice?.reason).toBe('reflush-failed')
    })

    test('a failed fence re-flush seeds the fence flag: a flushed commit key write leaves it, a flushed fence write clears it', async () => {
        const script: Script = { commit: { flushed: true }, fence: { flushed: false } }
        const { session } = await bootedTauri(script, true)
        expect(session.reflush).toEqual({ ok: false, commit: 'flushed', fence: 'failed' })

        await rewriteCommit(backendOf(session))
        expect(session.idleReason).not.toBeNull()

        script.fence = { flushed: true }
        const read = await backendOf(session).readFence()
        await backendOf(session).casFence(read.token, read.bytes)

        expect(session.idleReason).toBeNull()
    })

    test('each flag is cleared only by its own key: a flushed fence write leaves a seeded commit flag', async () => {
        const script: Script = { commit: { flushed: false }, fence: { flushed: true } }
        const { session } = await bootedTauri(script, true)
        expect(session.reflush?.commit).toBe('failed')

        const read = await backendOf(session).readFence()
        await backendOf(session).casFence(read.token, read.bytes)

        expect(session.idleReason).not.toBeNull()
    })
})

describe('outcomes that leave the flags unchanged or set them', () => {
    test('an unknown outcome sets the flag and rethrows', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)

        script.commit = { fail: new Store2UnknownOutcomeError('The write may or may not have been applied.') }
        await expect(rewriteCommit(backendOf(session))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)

        expect(session.idleReason).not.toBeNull()
    })

    test('an unknown outcome of a fence write sets the flag', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)

        script.fence = { fail: new Store2UnknownOutcomeError('The write may or may not have been applied.') }
        const read = await backendOf(session).readFence()
        await expect(backendOf(session).casFence(read.token, fenceBytes())).rejects.toBeInstanceOf(Store2UnknownOutcomeError)

        expect(session.idleReason).not.toBeNull()
    })

    test('a conflict leaves the flags unchanged, set or clear', async () => {
        const script = flushedScript()
        const { session, memory } = await bootedTauri(script)
        const stale = await backendOf(session).readCommit()
        await memory.casCommit(stale.token, new Uint8Array([1, 2, 3]))
        script.commit = { flushed: false }

        await expect(backendOf(session).casCommit(stale.token, new Uint8Array([4]))).rejects.toMatchObject({ name: 'Store2CommitConflictError' })
        expect(session.idleReason).toBeNull()

        // Set the flag, then a conflicting write that the script would report flushed leaves it set.
        await rewriteCommit(backendOf(session))
        expect(session.idleReason).not.toBeNull()
        script.commit = { flushed: true }
        await expect(backendOf(session).casCommit(stale.token, new Uint8Array([4]))).rejects.toMatchObject({ name: 'Store2CommitConflictError' })
        expect(session.idleReason).not.toBeNull()
    })

    test('a definite failure leaves the flags unchanged, set or clear', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)

        script.commit = { fail: new Store2BackendFailureError('Injected write failure.') }
        await expect(rewriteCommit(backendOf(session))).rejects.toBeInstanceOf(Store2BackendFailureError)
        expect(session.idleReason).toBeNull()

        script.commit = { flushed: false }
        await rewriteCommit(backendOf(session))
        script.commit = { fail: new Store2BackendFailureError('Injected write failure.') }
        await expect(rewriteCommit(backendOf(session))).rejects.toBeInstanceOf(Store2BackendFailureError)
        expect(session.idleReason).not.toBeNull()
    })

    test('a commitOrdinary that fails at a unit write leaves the flags unchanged, set or clear', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)
        const committer = session.committer
        script.commit = { fail: new Store2BackendFailureError('The unit write failed, so the commit key was not written.') }

        const clear = await committer?.commit(await committer.readCommit(), treeRequest(0))
        expect(clear?.status).toBe('failed')
        expect(session.idleReason).toBeNull()

        script.commit = { flushed: false }
        await rewriteCommit(backendOf(session))
        script.commit = { fail: new Store2BackendFailureError('The unit write failed, so the commit key was not written.') }
        const set = await committer?.commit(await committer.readCommit(), treeRequest(0))
        expect(set?.status).toBe('failed')
        expect(session.idleReason).not.toBeNull()
    })
})

describe('fence writes', () => {
    test('a fence exit through session.backend that is not durable sets the flag, and a flushed rewrite clears it', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)

        script.fence = { flushed: false }
        const exited = await fenceExit(backendOf(session), { damagedCommitBytes: null, now: () => START_TIME })

        expect(exited.status).toBe('not-durable')
        expect(session.idleReason).not.toBeNull()

        script.fence = { flushed: true }
        const again = await fenceExit(backendOf(session), { damagedCommitBytes: null, now: () => START_TIME })

        expect(again.status).toBe('written')
        expect(session.idleReason).toBeNull()
    })

    test('a fence delete neither sets nor clears, whatever it reports', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script, true)
        const cleared = await backendOf(session).readFence()

        script.fence = { flushed: false }
        expect((await discardFence(backendOf(session), cleared.token)).status).toBe('discarded')
        expect(session.idleReason).toBeNull()

        script.fence = { flushed: false }
        await backendOf(session).casFence((await backendOf(session).readFence()).token, fenceBytes())
        expect(session.idleReason).not.toBeNull()

        script.fence = { flushed: true }
        const written = await backendOf(session).readFence()
        expect((await discardFence(backendOf(session), written.token)).status).toBe('discarded')
        // An unflushed fence write followed by a discard leaves the deleters idle until the next page load.
        expect(session.idleReason).not.toBeNull()
    })
})

describe('other backends never set a flag', () => {
    test.each(['indexeddb', 'node'] as const)('a %s page whose writes report no flush status stays open', async (kind) => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const session = await openSession(memory, kind)
        expect(session.reflush).toBeNull()

        await rewriteCommit(backendOf(session))
        await plantFence(backendOf(session), fenceBytes())
        await plantFence(backendOf(session), null)
        const committer = session.committer
        await committer?.commit(await committer.readCommit(), treeRequest(0))

        expect(session.idleReason).toBeNull()
        expect(session.backend).toBe(memory)
        expect((await parsedCommit(memory)).seq).toBe(2)
    })

    test('a non-Tauri page does not wrap its backend', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)

        expect((await openSession(memory, 'indexeddb')).backend).toBe(memory)
    })
})

describe('the live state', () => {
    test('the gate reads the flag on every call, not the state at open', async () => {
        const script = flushedScript()
        const { session } = await bootedTauri(script)
        expect((await session.openGate('gc')).status).toBe('open')

        script.commit = { flushed: false }
        await rewriteCommit(backendOf(session))
        const refused = await session.openGate('sweep')

        expect(refused).toMatchObject({ status: 'refused', reason: 'idle' })
        script.commit = { flushed: true }
        await rewriteCommit(backendOf(session))
        expect((await session.openGate('sweep')).status).toBe('open')
    })
})
