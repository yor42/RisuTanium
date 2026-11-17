import type { JsonObject } from '../../blockFrame'
import type { Database, botPreset } from '../../database.svelte'
import { get } from 'svelte/store'
import { plainObject, type ListDerivation } from '../codec'
import type { Store2Backend } from '../backend/types'
import type { Store2Read } from '../backend/types'
import type { CommitKey, KeyEnv } from '../format'
import type { Store2SaveContext } from '../saveActive'
import type { SaveEncoder } from '../saveEncoder'
import type { Store2Snapshot } from '../saveLoop'
import { advancePrevious } from './advancePrevious'
import { realApply, type ApplyResult } from './apply'
import { D1_STATUS_AFTER_MS, D2_BUSY_MAX_MS, settledWhen } from './defer'
import { createGuardB, type GuardB } from './guard'
import { prepareFastForward, type FastForwardHost, type Step } from './prepare'
import { readPeerTree } from './read'
import type { StoredTree } from '../previousOfTree'

export { GUARD_B_MS, type GuardB, type GuardBHit, type GuardEntry } from './guard'
export type { FastForwardHost } from './prepare'

/**
 * The fast-forward: when a peer committed a delta over the tree this page acknowledged, the page takes the peer's
 * changes into its live database and moves its acknowledged encoding to the peer's tree, instead of parking. It runs
 * only inside a save pass, under the write lock, after the loop's judge proved descent (`context.lineage`); everything
 * it cannot take parks with today's prompts. Indexeddb and node sessions only.
 */

/** What the loop gives the fast-forward: the page's own state and one effect, never the whole port. */
export interface FastForwardPort {
    getDatabase(): Database
    replyOwners?(): ReadonlySet<string>
    /** The informational waiting line of a send-class deferral; never a stop. A port without it shows no line. */
    setPeerWaiting?(waiting: boolean): void
    now(): number
}

export interface FastForwardFrame {
    /** The commit key read of this pass. */
    read: Store2Read
    /** The judged key: its `current` names the peer's tree. */
    key: CommitKey
    /** The manifest the encoder acknowledged when the judge compared. */
    baseKey: string
    encoder: SaveEncoder
    port: FastForwardPort
    snapshot: Store2Snapshot | null
}

export type FastForwardOutcome =
    | { kind: 'applied' }
    /** The page commits nothing and keeps its marks until `settled` resolves, which never rejects. */
    | { kind: 'deferred', settled: Promise<void> }
    /** Nothing was written: the loop parks with today's prompt. */
    | { kind: 'park', reason: string }
    /** The peer's tree could not be read now: the pass tries again. */
    | { kind: 'retry', reason: string, detail: string }

export interface FastForward {
    run(frame: FastForwardFrame): Promise<FastForwardOutcome>
    /** Ends any deferral the loop left standing (it parked or unparked): its timers stop acting and its start marks reset. */
    invalidate(): void
    readonly guard: GuardB
}

export interface FastForwardOptions {
    backend: Store2Backend
    kind: Store2SaveContext['session']['kind']
    lists: ListDerivation
    env: KeyEnv
    /** Tests only: replaces the writes' journal and check A. */
    apply?: (steps: readonly Step[]) => ApplyResult
}

let hostOverride: FastForwardHost | null = null

/** Tests only: the page host a test supplies in place of the page modules. `null` restores the real one. */
export function setFastForwardHostForTest(host: FastForwardHost | null): void {
    hostOverride = host
}

function isWorkingDatabase(value: JsonObject): value is JsonObject & Database {
    return typeof value === 'object' && value !== null
}

function isBotPreset(value: JsonObject): value is JsonObject & botPreset {
    return typeof value === 'object' && value !== null
}

/** The page's modules, loaded when the first fast-forward needs them so the boot dispatch imports none of them. */
let realHost: Promise<FastForwardHost> | null = null

function loadRealHost(): Promise<FastForwardHost> {
    realHost ??= (async (): Promise<FastForwardHost> => {
        const [putBack, retained, restored, hook, origin, busy, proc, database] = await Promise.all([
            import('../../../process/memory/characterPutBack'),
            import('../../../process/coldRetained'),
            import('../../../process/memory/restoredBytes'),
            import('../../dbWriteHook'),
            import('../../../process/chatOrigin'),
            import('../../../process/memory/busyActions'),
            import('../../../process/index.svelte'),
            import('../../database.svelte'),
        ])
        return {
            inUse: () => putBack.putBackKeepSet(),
            writing: chaId => origin.isWriting({ chaId }),
            busy: () => busy.isBusy() || busy.anyChokePointInFlight(),
            sending: () => get(proc.doingChat),
            installQuietly: fn => hook.withQuietCharacterInstall(fn),
            forgetLoaded(slot) {
                const record = retained.loadedRecordOf(slot)
                if (record !== undefined) {
                    retained.dropLoaded(record)
                }
                restored.clearRestoredBytes(String(Reflect.get(slot, 'chaId') ?? ''))
            },
            presetOps: () => ({
                saveInto(working, slot) {
                    const copy = structuredClone(working)
                    if (!isWorkingDatabase(copy)) {
                        throw new Error('The working settings are not an object.')
                    }
                    const held = structuredClone(slot)
                    if (!isBotPreset(held)) {
                        throw new Error('The preset record is not an object.')
                    }
                    held.name = String(held.name ?? '')
                    held.image = typeof held.image === 'string' ? held.image : ''
                    return plainObject(database.savedPresetFor(copy, held), 'preset')
                },
                apply(working, slot) {
                    const copy = structuredClone(working)
                    const preset = structuredClone(slot)
                    if (!isWorkingDatabase(copy) || !isBotPreset(preset)) {
                        throw new Error('The preset record is not an object.')
                    }
                    database.setPreset(copy, preset)
                    return plainObject(copy, 'working settings')
                },
            }),
        }
    })()
    return realHost
}

function hostOf(): Promise<FastForwardHost> {
    return hostOverride !== null ? Promise.resolve(hostOverride) : loadRealHost()
}

export function createFastForward(options: FastForwardOptions): FastForward {
    const apply = options.apply ?? realApply
    const guard = createGuardB(() => Date.now())
    let cached: { key: string, tree: StoredTree } | null = null
    /** When a deferral of each class began, so the status line and the stuck-busy cap count from the first one. */
    const deferredSince: { d1: number | null, d2: number | null } = { d1: null, d2: null }
    let statusSet = false

    function clearStatus(port: FastForwardPort): void {
        if (statusSet) {
            statusSet = false
            port.setPeerWaiting?.(false)
        }
    }

    /** Counts the deferrals that ended: a waiting-line timer of an older one never turns the line on. */
    let deferralEpoch = 0

    function forget(port: FastForwardPort): void {
        clearStatus(port)
        invalidate()
    }

    function invalidate(): void {
        deferralEpoch += 1
        deferredSince.d1 = null
        deferredSince.d2 = null
        statusSet = false
    }

    async function run(frame: FastForwardFrame): Promise<FastForwardOutcome> {
        const { encoder, port } = frame
        if (options.kind !== 'indexeddb' && options.kind !== 'node') {
            return { kind: 'park', reason: 'kind' }
        }
        const targetKey = frame.key.current?.key
        if (targetKey === undefined || encoder.pendingKey !== null) {
            return { kind: 'park', reason: 'pending' }
        }
        let tree: StoredTree
        if (cached !== null && cached.key === targetKey) {
            tree = cached.tree
        } else {
            let read = await readPeerTree(options.backend, targetKey, encoder.acknowledged())
            if (read.status === 'moved') {
                read = await readPeerTree(options.backend, targetKey, encoder.acknowledged())
            }
            switch (read.status) {
                case 'park':
                    forget(port)
                    return { kind: 'park', reason: read.reason }
                case 'retry':
                    return { kind: 'retry', reason: 'ff-unreadable', detail: read.detail }
                case 'moved':
                    return { kind: 'retry', reason: 'peer-advanced', detail: 'The peer committed again while its tree was read.' }
                case 'ok':
                    tree = read.tree
                    cached = { key: targetKey, tree }
                    break
            }
        }
        // The read awaited: the base must still be the one the judge compared, and no attempt may be pending.
        if (encoder.manifestKey !== frame.baseKey || encoder.pendingKey !== null) {
            forget(port)
            return { kind: 'park', reason: 'base-moved' }
        }
        let host: FastForwardHost
        try {
            host = await hostOf()
        } catch (error) {
            // A page whose modules cannot be loaded cannot take a peer's tree: it parks as it did before the fast-forward.
            console.error(error)
            realHost = null
            forget(port)
            return { kind: 'park', reason: 'host' }
        }
        if (encoder.manifestKey !== frame.baseKey || encoder.pendingKey !== null) {
            forget(port)
            return { kind: 'park', reason: 'base-moved' }
        }
        const old = encoder.acknowledged()
        const db = port.getDatabase()
        const replyOwners = port.replyOwners?.() ?? new Set<string>()
        let next
        let prepared
        try {
            next = advancePrevious(old, tree)
            prepared = prepareFastForward({ db, old, target: tree, next, host, replyOwners, env: options.env, lists: options.lists })
        } catch (error) {
            console.error(error)
            forget(port)
            return { kind: 'park', reason: 'prepare' }
        }
        if (prepared.kind === 'park') {
            forget(port)
            return { kind: 'park', reason: prepared.reason }
        }
        const now = port.now()
        const sending = (): boolean => host.sending() || replyOwners.size > 0
        if (prepared.defers.has('d1') && sending()) {
            deferredSince.d1 ??= now
            const since = deferredSince.d1
            const epoch = deferralEpoch
            return {
                kind: 'deferred',
                settled: settledWhen(() => !host.sending() && (port.replyOwners?.().size ?? 0) === 0, {
                    now: () => port.now(),
                    slowAfterMs: Math.max(0, D1_STATUS_AFTER_MS - (now - since)),
                    onSlow: () => {
                        if (epoch !== deferralEpoch) {
                            return
                        }
                        statusSet = true
                        port.setPeerWaiting?.(true)
                    },
                }),
            }
        }
        if (prepared.defers.has('d2') && host.busy()) {
            deferredSince.d2 ??= now
            if (now - deferredSince.d2 > D2_BUSY_MAX_MS) {
                forget(port)
                return { kind: 'park', reason: 'busy-stuck' }
            }
            // The send is over: a waiting line a D1 deferral set no longer names what the page waits for.
            clearStatus(port)
            // A busy entry that never ends would keep the wait open forever: the wait also ends at the cap, and the
            // attempt it wakes parks as busy-stuck.
            const since = deferredSince.d2
            return { kind: 'deferred', settled: settledWhen(() => !host.busy() || port.now() - since > D2_BUSY_MAX_MS, { now: () => port.now() }) }
        }
        const result = apply(prepared.steps)
        if (result !== 'applied') {
            forget(port)
            return { kind: 'park', reason: 'check-a' }
        }
        encoder.fastForward(next)
        guard.arm(prepared.guard)
        cached = null
        forget(port)
        return { kind: 'applied' }
    }

    return { run, invalidate, guard }
}
