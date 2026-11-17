// The Studio save chip's state machine: when may a Studio edit be called "saved". An edit is saved
// only after a commit whose snapshot covers its save mark, for a character the store can encode and
// the legacy loop does not hold frozen. A module ack asks the commit's module verdict instead: the module must be
// stored by a commit that did not carry the module set whole. Every dependency is injected, as in
// hiddenReplySaveGuard.ts; `productionSaveAckDeps()` builds them from the existing exports.

import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
    afterNextSaveCommit,
    getCommittedSaveMarkCount,
    getPeerSaveCount,
    getSaveMarkCount,
    isCharacterUnsavable,
    isSavingStopped,
    moduleCommitVerdict,
    onSavingStopped,
    requestSaveNow,
    saving,
} from '../../globalApi.svelte'
import { saveFailureStore, type SaveFailureState } from '../../storage/store2/saveFailure'
import { frozenSaveKeysStore } from '../../stores.svelte'
import type { HistoryClock } from '../history/historyModel'

// No confirmation and no failure within this long of page time: the chip stops claiming progress.
export const ACK_BOUND_MS = 30_000
// No commit at all within this long: the same, whatever the passes do in between.
export const ACK_CEILING_MS = 120_000
export const PEER_POLL_MS = 2_000
// "Saving..." is shown only for a save that takes longer than this.
export const PENDING_DELAY_MS = 300

export type AckState = 'idle' | 'pending' | 'saved' | 'failed' | 'unconfirmed'
// What the chip shows, by precedence: changed elsewhere, failed, unconfirmed, pending, saved, idle.
export type AckDisplay = 'changedElsewhere' | 'failed' | 'unconfirmed' | 'pending' | 'saved' | 'idle'

export interface SaveAckDeps {
    getMarkCount(): number
    getCommittedMarkCount(): number
    afterNextCommit(callback: () => void): void
    requestSaveNow(): void
    getPeerSaveCount(): number
    // Calls back on every stop; the returned function unsubscribes.
    onStopped(callback: () => void): () => void
    isStopped(): boolean
    // Calls back with each new failure value (not with the current one at subscription).
    subscribeFailure(callback: (value: SaveFailureState | null) => void): () => void
    currentFailure(): SaveFailureState | null
    frozenKeys(): ReadonlySet<string>
    isCharacterUnsavable(chaId: string): boolean
    // Calls back on each false-to-true change of a pass's running state; the returned function stops it.
    onPassStart(callback: () => void): () => void
    visible(): boolean
    // Calls back on each visibility change; the returned function removes the listener.
    onVisibilityChange(callback: () => void): () => void
    clock: HistoryClock
}

// What the latest reported commit says about one module: `saved` (stored), `blocked` (the module set was carried whole
// for another cause, so the change is not in the store yet) or `unsavable` (the module itself is refused or cannot be
// encoded, and its saved copy is kept).
export type ModuleCommitVerdict = 'saved' | 'unsavable' | 'blocked'

// What an ack is for. A character ack is judged by the character rules; a module ack by the module's commit verdict.
export type AckSubject = { readonly kind: 'character' } | { readonly kind: 'module', verdict(moduleId: string): ModuleCommitVerdict }

export interface SaveAck {
    readonly state: AckState
    readonly changedElsewhere: boolean
    readonly display: AckDisplay
    // The id of the subject of the latest edit (a chaId, or a module id for a module ack); null before the first one.
    readonly chaId: string | null
    canRetry(): boolean
    noteEdit(chaId: string, before: number): void
    retry(): boolean
    dispose(): void
}

export function productionSaveAckDeps(clock: HistoryClock): SaveAckDeps {
    return {
        getMarkCount: getSaveMarkCount,
        getCommittedMarkCount: getCommittedSaveMarkCount,
        afterNextCommit: afterNextSaveCommit,
        requestSaveNow,
        getPeerSaveCount,
        onStopped: onSavingStopped,
        isStopped: isSavingStopped,
        subscribeFailure(callback) {
            let first = true
            return saveFailureStore.subscribe((value) => {
                // A store calls its subscriber at once with the current value; that one is not news.
                if (first) {
                    first = false
                    return
                }
                callback(value)
            })
        },
        currentFailure: () => get(saveFailureStore),
        frozenKeys: () => new Set(get(frozenSaveKeysStore).map((entry) => entry.chaId)),
        isCharacterUnsavable,
        onPassStart(callback) {
            return $effect.root(() => {
                let was = false
                $effect(() => {
                    const now = saving.state
                    if (now && !was) {
                        untrack(callback)
                    }
                    was = now
                })
            })
        },
        visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
        onVisibilityChange(callback) {
            if (typeof document === 'undefined') {
                return () => {}
            }
            document.addEventListener('visibilitychange', callback)
            return () => document.removeEventListener('visibilitychange', callback)
        },
        clock,
    }
}

// The subject of a module ack in production: the module verdict of the latest commit the loop reported.
export function productionModuleAckSubject(): AckSubject {
    return { kind: 'module', verdict: moduleCommitVerdict }
}

class SaveAckImpl implements SaveAck {
    state = $state<AckState>('idle')
    changedElsewhere = $state(false)
    chaId = $state<string | null>(null)
    // Whether the pending state has lasted long enough to be shown.
    private pendingShown = $state(false)
    // What a not-yet-shown pending state looks like: the state before it.
    private calm = $state<'idle' | 'saved'>('idle')
    // A failed state that only a commit storing the module ends: Retry cannot help, the module itself is refused.
    // Only a `unsavable` verdict sets it; every other entry into a sticky state clears it.
    private permanent = $state(false)

    private target = 0
    private peerBase: number
    private failureAtEdit: SaveFailureState | null = null
    private disposed = false
    private boundHandle: unknown = null
    private ceilingHandle: unknown = null
    private pollHandle: unknown = null
    private pendingHandle: unknown = null
    private readonly stops: (() => void)[] = []
    private readonly onCommit = (): void => this.handleCommit()

    constructor(private readonly deps: SaveAckDeps, private readonly subject: AckSubject) {
        this.peerBase = deps.getPeerSaveCount()
        this.stops.push(deps.onPassStart(() => this.handlePassStart()))
        this.stops.push(deps.subscribeFailure((value) => this.handleFailure(value)))
        this.stops.push(deps.onStopped(() => this.handleStopped()))
        this.stops.push(deps.onVisibilityChange(() => this.handleVisibility()))
        this.schedulePoll()
    }

    get display(): AckDisplay {
        if (this.changedElsewhere) {
            return 'changedElsewhere'
        }
        if (this.state === 'failed' || this.state === 'unconfirmed') {
            return this.state
        }
        if (this.state === 'pending') {
            return this.pendingShown ? 'pending' : this.calm
        }
        return this.state
    }

    canRetry(): boolean {
        return (
            (this.state === 'failed' || this.state === 'unconfirmed') &&
            !this.permanent &&
            !this.changedElsewhere &&
            !this.deps.isStopped()
        )
    }

    noteEdit(chaId: string, before: number): void {
        if (this.disposed) {
            return
        }
        this.chaId = chaId
        const n = this.deps.getMarkCount()
        // The mark was not counted (marks not installed, or a read-only page), or saving is stopped: nothing
        // will save it.
        if (n === before || this.deps.isStopped()) {
            this.enterSticky('failed')
            this.pollPeers()
            return
        }
        this.target = Math.max(this.target, n)
        if (this.state !== 'failed' && this.state !== 'unconfirmed') {
            if (this.state !== 'pending') {
                this.enterPending()
            }
        }
        this.armCommit()
        this.pollPeers()
    }

    retry(): boolean {
        if (this.disposed || !this.canRetry()) {
            return false
        }
        this.deps.requestSaveNow()
        this.target = this.deps.getMarkCount()
        this.enterPending()
        this.armCommit()
        return true
    }

    dispose(): void {
        this.disposed = true
        this.clearBound()
        this.clearCeiling()
        this.clearPendingDelay()
        this.clearPoll()
        for (const stop of this.stops.splice(0)) {
            stop()
        }
    }

    // ---------------------------------------------------------------- state changes

    private enterPending(): void {
        if (this.state === 'saved' || this.state === 'idle') {
            this.calm = this.state
        }
        this.state = 'pending'
        this.permanent = false
        this.pendingShown = false
        this.failureAtEdit = this.deps.currentFailure()
        this.startBound()
        this.startCeiling()
        this.clearPendingDelay()
        this.pendingHandle = this.deps.clock.setTimeout(() => {
            this.pendingHandle = null
            if (this.state === 'pending') {
                this.pendingShown = true
            }
        }, PENDING_DELAY_MS)
    }

    private enterSticky(next: 'failed' | 'unconfirmed', permanent = false): void {
        this.state = next
        this.permanent = permanent
        this.pendingShown = false
        this.clearBound()
        this.clearCeiling()
        this.clearPendingDelay()
    }

    private enterSaved(): void {
        this.state = 'saved'
        this.permanent = false
        this.calm = 'saved'
        this.pendingShown = false
        this.clearBound()
        this.clearCeiling()
        this.clearPendingDelay()
    }

    private armCommit(): void {
        // One stable reference: the callback set holds it once, however often it is armed.
        this.deps.afterNextCommit(this.onCommit)
    }

    private handleCommit(): void {
        if (this.disposed) {
            return
        }
        const chaId = this.chaId
        if (this.state === 'pending') {
            // Any commit is progress, so continuous typing never reaches the ceiling while commits land.
            this.startBound()
            this.startCeiling()
        }
        const covered = chaId !== null && this.deps.getCommittedMarkCount() >= this.target && this.target > 0
        if (covered && chaId !== null && this.subject.kind === 'module') {
            this.settleModuleCommit(this.subject.verdict(chaId))
        } else if (covered && chaId !== null) {
            const blocked = this.deps.isCharacterUnsavable(chaId) || this.deps.frozenKeys().has(chaId)
            if (this.state === 'pending') {
                if (blocked) {
                    this.enterSticky('failed')
                } else {
                    this.enterSaved()
                    this.peerBase = this.deps.getPeerSaveCount()
                    this.changedElsewhere = false
                }
            } else if (!blocked && (this.state === 'failed' || this.state === 'unconfirmed')) {
                // A sticky state stays until Retry, but a covering save still ends "changed elsewhere".
                this.peerBase = this.deps.getPeerSaveCount()
                this.changedElsewhere = false
            }
        } else {
            this.pollPeers()
        }
        if (this.state === 'pending' || this.state === 'failed' || this.state === 'unconfirmed') {
            this.armCommit()
        }
    }

    // A covering commit for a module ack, by the commit's verdict for the module. A permanent failed ends only when a
    // commit stores the module; a later `blocked` verdict leaves it a refusal, never a "not confirmed" that Retry could
    // not help. Any other sticky state stays until Retry, as for a character.
    private settleModuleCommit(verdict: ModuleCommitVerdict): void {
        if (this.state === 'pending') {
            if (verdict === 'unsavable') {
                this.enterSticky('failed', true)
            } else if (verdict === 'blocked') {
                this.enterSticky('unconfirmed')
            } else {
                this.enterSaved()
                this.peerBase = this.deps.getPeerSaveCount()
                this.changedElsewhere = false
            }
        } else if (this.state === 'failed' && this.permanent) {
            if (verdict === 'saved') {
                this.enterSaved()
                this.peerBase = this.deps.getPeerSaveCount()
                this.changedElsewhere = false
            }
        } else if (verdict === 'saved' && (this.state === 'failed' || this.state === 'unconfirmed')) {
            this.peerBase = this.deps.getPeerSaveCount()
            this.changedElsewhere = false
        }
    }

    private handlePassStart(): void {
        if (!this.disposed && this.state === 'pending') {
            this.startBound()
        }
    }

    private handleFailure(value: SaveFailureState | null): void {
        if (this.disposed || this.state !== 'pending') {
            return
        }
        if (value !== null) {
            if (value !== this.failureAtEdit) {
                this.enterSticky('failed')
            }
        } else if (this.failureAtEdit !== null) {
            // The failure that was current at the edit cleared: the next pass is a fresh chance.
            this.failureAtEdit = null
            this.startBound()
        }
    }

    private handleStopped(): void {
        if (!this.disposed && this.state === 'pending') {
            this.enterSticky('failed')
        }
    }

    private handleVisibility(): void {
        if (this.disposed) {
            return
        }
        if (this.deps.visible()) {
            this.pollPeers()
            this.schedulePoll()
        } else {
            this.clearPoll()
        }
    }

    // ---------------------------------------------------------------- timers

    private startBound(): void {
        this.clearBound()
        this.boundHandle = this.deps.clock.setTimeout(() => {
            this.boundHandle = null
            this.expire()
        }, ACK_BOUND_MS)
    }

    private startCeiling(): void {
        this.clearCeiling()
        this.ceilingHandle = this.deps.clock.setTimeout(() => {
            this.ceilingHandle = null
            this.expire()
        }, ACK_CEILING_MS)
    }

    private expire(): void {
        if (!this.disposed && this.state === 'pending') {
            this.enterSticky('unconfirmed')
        }
    }

    private clearBound(): void {
        if (this.boundHandle !== null) {
            this.deps.clock.clearTimeout(this.boundHandle)
            this.boundHandle = null
        }
    }

    private clearCeiling(): void {
        if (this.ceilingHandle !== null) {
            this.deps.clock.clearTimeout(this.ceilingHandle)
            this.ceilingHandle = null
        }
    }

    private clearPendingDelay(): void {
        if (this.pendingHandle !== null) {
            this.deps.clock.clearTimeout(this.pendingHandle)
            this.pendingHandle = null
        }
    }

    private clearPoll(): void {
        if (this.pollHandle !== null) {
            this.deps.clock.clearTimeout(this.pollHandle)
            this.pollHandle = null
        }
    }

    // ---------------------------------------------------------------- changed elsewhere

    private pollPeers(): void {
        if (!this.disposed && this.deps.getPeerSaveCount() > this.peerBase) {
            this.changedElsewhere = true
        }
    }

    // The peer count is read every PEER_POLL_MS while the page is visible, and on each edit and commit.
    private schedulePoll(): void {
        this.clearPoll()
        if (this.disposed || !this.deps.visible()) {
            return
        }
        this.pollHandle = this.deps.clock.setTimeout(() => {
            this.pollHandle = null
            this.pollPeers()
            this.schedulePoll()
        }, PEER_POLL_MS)
    }
}

// One ack per Studio visit; `dispose()` at visit close ends every timer, listener and effect.
export function createSaveAck(deps: SaveAckDeps, subject: AckSubject = { kind: 'character' }): SaveAck {
    return new SaveAckImpl(deps, subject)
}
