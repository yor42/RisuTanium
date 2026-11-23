import { createCharacterSavedWaiter, type CharacterSavedDeps, type CharacterSavedWaiter } from './characterSaved'
import type { NativeReplyStore, ReplyOutcome } from './store'

/**
 * What this page knows about the records of the replies it is receiving or has pushed: one entry per key, from the
 * grant of a send until the record is consumed or left to the reconcile.
 *
 * `inflight`: the request is running (or the page is about to settle it). `awaiting-save`: the reply is in the chat in
 * memory and the waiter watches the commits. `release`: the record may be removed, and a consume that found Rust still
 * writing it is retried by the next reconcile.
 */

export type HeldState = 'inflight' | 'awaiting-save' | 'release'

/** What the page learned of the record's end from the end stamp or one listing. */
export interface TerminalKnowledge {
    outcome: ReplyOutcome
    stored: boolean
    status?: number
}

export interface HeldReply {
    state: HeldState
    /** A request bound the grant: it carries the blob. */
    bound: boolean
    /** The native request was actually invoked with the owner. */
    invoked: boolean
    /** Rust refused ownership: the request is page-owned and no record is this request's. */
    unowned?: boolean
    /** The request ended by Stop, a caller abort, a delete or a Trash of the chat. */
    pageEnded?: boolean
    terminal?: TerminalKnowledge
    /** `record` when the reply was read from the record: the page saw the stored outcome. */
    bodySource?: 'record' | 'live'
    chaId?: string
    target?: number
}

const held = new Map<string, HeldReply>()

/**
 * The keys whose native end told the person already (an announced stamp, result or listing). It lives outside `held`:
 * a save can consume the held entry before the send's finally reads this, and the fact must survive that.
 */
const announcedKeys = new Set<string>()

/** The native side told the person about `key`'s reply; the send's finally reads it once. */
export function noteAnnounced(key: string): void {
    announcedKeys.add(key)
}

/** True when any of `keys` was announced; every given key is forgotten, so the fact is read once per unit. */
export function takeAnnounced(keys: readonly string[]): boolean {
    let announced = false
    for (const key of keys) {
        if (announcedKeys.delete(key)) {
            announced = true
        }
    }
    return announced
}

export interface PageStateDeps {
    store: Pick<NativeReplyStore, 'consume'>
    waiter: CharacterSavedDeps
    /** A record the page cannot read is kept; the caller reports it once per launch. */
    onUnreadable(key: string, problem: string): void
}

let consumeStore: PageStateDeps['store'] | null = null
let waiter: CharacterSavedWaiter | null = null
let unreadableReporter: PageStateDeps['onUnreadable'] = () => {}
let reconcileTrigger: (() => Promise<void> | void) | null = null

/** Wires the page state to the store and to the save signals; the page does it once at boot. */
export function configurePageState(deps: PageStateDeps): void {
    consumeStore = deps.store
    waiter = createCharacterSavedWaiter(deps.waiter)
    unreadableReporter = deps.onUnreadable
}

/** The reconcile the page runs on its triggers; null before it is installed. */
export function setReconcileTrigger(trigger: (() => Promise<void> | void) | null): void {
    reconcileTrigger = trigger
}

/** Asks for a reconcile pass and resolves when it ends; resolves at once before the reconcile is installed. */
export function requestReconcile(): Promise<void> {
    return Promise.resolve(reconcileTrigger?.())
}

export function resetPageStateForTests(): void {
    held.clear()
    announcedKeys.clear()
    consumeStore = null
    waiter = null
    unreadableReporter = () => {}
    reconcileTrigger = null
}

export function heldReply(key: string): HeldReply | undefined {
    return held.get(key)
}

/**
 * True when this send's request owns a record: the key is held and still `inflight`, the grant was bound, the native
 * request was invoked with the owner and Rust did not refuse it. A key that fails any of these has no record to wait
 * for or consume; settle drops it without an invoke.
 */
export function ownsPushedReply(key: string): boolean {
    const entry = held.get(key)
    return entry !== undefined && entry.state === 'inflight' && entry.bound && entry.invoked && entry.unowned !== true
}

/** A send was granted the right to own `key`; nothing is durable yet. */
export function holdInflight(key: string): void {
    held.set(key, { state: 'inflight', bound: false, invoked: false })
}

export function noteBound(key: string): void {
    const entry = held.get(key)
    if (entry) {
        entry.bound = true
    }
}

export function noteInvoked(key: string): void {
    const entry = held.get(key)
    if (entry) {
        entry.invoked = true
    }
}

/** Rust refused ownership: the entry is dropped without a consume, because no record is this request's. */
export function noteUnowned(key: string): void {
    const entry = held.get(key)
    if (entry) {
        entry.unowned = true
    }
}

export function notePageEnded(key: string): void {
    const entry = held.get(key)
    if (entry) {
        entry.pageEnded = true
    }
}

export function noteTerminal(key: string, terminal: TerminalKnowledge): void {
    const entry = held.get(key)
    if (entry) {
        entry.terminal = terminal
    }
}

export function noteBodySource(key: string, source: 'record' | 'live'): void {
    const entry = held.get(key)
    if (entry) {
        entry.bodySource = source
    }
}

export type ConsumeResult = 'removed' | 'live' | 'unreadable' | 'error'

/**
 * Removes the record of `key`. `removed` and `absent` end the entry. A record Rust still writes (`live:`) keeps the
 * entry as `release` for the next reconcile, without a note; an unreadable one is kept on disk and reported; any other
 * failure is logged and the entry stays `release` so a later pass tries again.
 */
export async function consumeReply(key: string): Promise<ConsumeResult> {
    const store = consumeStore
    if (store === null) {
        return 'error'
    }
    try {
        await store.consume(key)
        held.delete(key)
        return 'removed'
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const entry = held.get(key)
        if (message.startsWith('unreadable:')) {
            held.delete(key)
            unreadableReporter(key, message.slice('unreadable:'.length).trim())
            return 'unreadable'
        }
        if (entry) {
            entry.state = 'release'
        }
        if (message.startsWith('live:')) {
            return 'live'
        }
        console.error(error)
        return 'error'
    }
}

/**
 * The reply of `key` was pushed into the chat in memory. A no-op unless the key's request owns a record
 * (`ownsPushedReply`): an ineligible send, or a grant that was never bound, invoked or was refused, gets no waiter.
 * `target` is the mark count read after the push's own mark.
 */
export function noteReplyPushed(key: string, chaId: string, target: number): void {
    const entry = held.get(key)
    if (!entry || !ownsPushedReply(key)) {
        return
    }
    entry.state = 'awaiting-save'
    entry.chaId = chaId
    entry.target = target
    waiter?.watch(key, chaId, target, (savedKey) => { void consumeReply(savedKey) })
}

/** A recovered reply was pushed by the page: it is awaited the same way, whatever the key held before. */
export function holdRecoveredReply(key: string, chaId: string, target: number): void {
    held.set(key, { state: 'awaiting-save', bound: true, invoked: true, chaId, target })
    waiter?.watch(key, chaId, target, (savedKey) => { void consumeReply(savedKey) })
}

/**
 * The send settled and `key` was never pushed. A key without a request behind it, or whose ownership was refused, is
 * dropped without touching a record. A key whose end the page saw (the reply read from the record, a failed, stopped or
 * not-stored stamp, or the page's own end) is consumed. Any other key is dropped without a consume: the record may still
 * be running or may hold a reply this page never read, and the reconcile decides by presence.
 */
export async function settleNativeReplyInflight(key: string): Promise<void> {
    const entry = held.get(key)
    if (!entry || entry.state !== 'inflight') {
        return
    }
    if (!entry.bound || !entry.invoked || entry.unowned) {
        held.delete(key)
        return
    }
    const sawEnd = entry.bodySource === 'record'
        || (entry.terminal !== undefined && (entry.terminal.outcome !== 'done' || !entry.terminal.stored))
        || entry.pageEnded === true
    if (!sawEnd) {
        held.delete(key)
        // The record can already be terminal and no event will follow; the pass finds it when it runs.
        requestReconcile()
        return
    }
    entry.state = 'release'
    await consumeReply(key)
}
