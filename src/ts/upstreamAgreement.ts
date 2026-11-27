import { writable, type Readable } from "svelte/store"
import { alertStore } from "./stores.svelte"

/**
 * The `localStorage` key for the one shared acceptance covering both
 * upstream's Terms of Service and Privacy Policy (MC-086, MC-087 #3c).
 * Holding `'accepted'` means the user agreed once, on any tab. The older
 * `tos4`/`tos2` keys are never read or written here.
 */
export const UPSTREAM_AGREEMENT_KEY = 'upstreamServicesAgreement'

/**
 * The exact `msg` values `AlertComp.svelte`'s `'tos'` block writes for an
 * explicit answer. Only these two values resolve a pending prompt; anything
 * else that lands on `alertStore` while the prompt is up re-posts it.
 */
export const UPSTREAM_AGREEMENT_ACCEPT = 'upstream-agreement-accept'
export const UPSTREAM_AGREEMENT_DECLINE = 'upstream-agreement-decline'

/**
 * True for the rest of this page's life once `localStorage.setItem` has
 * thrown on an otherwise-successful Accept, so a storage failure never costs
 * the user a repeated prompt in the same session.
 */
let memoryAccepted = false

/** A pure re-read: true when the key holds `'accepted'`, or when this page
 * already accepted and the write itself failed. Never reads the store below,
 * so another tab's acceptance is always seen. */
function readAccepted(): boolean {
    return memoryAccepted || localStorage.getItem(UPSTREAM_AGREEMENT_KEY) === 'accepted'
}

const upstreamAcceptedStore = writable<boolean>(readAccepted(), (set) => {
    // This start function runs only when the first subscriber attaches (0 ->
    // 1); a later subscriber just gets the store's current cached value.
    // That value is kept current by the `storage` listener below, which is
    // why deciding "already accepted" from this store, rather than from
    // `isUpstreamAccepted()`'s own fresh re-read, would miss another tab's
    // acceptance until a `storage` event happens to arrive first.
    set(readAccepted())
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return
    }
    const onStorage = (event: StorageEvent) => {
        // event.key is null for a whole-storage clear() from another tab,
        // which removes this key too, so that case must also trigger a re-read.
        if (event.key === UPSTREAM_AGREEMENT_KEY || event.key === null) {
            set(readAccepted())
        }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
})

/**
 * Reflects acceptance for templates and effects. Only `askUpstreamAgreement()`,
 * this store's own `storage` listener, its start function (on the first
 * subscriber), `publishUpstreamAccepted()`, `verifyUpstreamAccepted()` and
 * `resetUpstreamAgreementForTests()` ever write to it -- never read it to decide "already accepted", since a
 * store already subscribed elsewhere would otherwise hand back a stale
 * cached value instead of re-reading storage (use `isUpstreamAccepted()` for
 * that decision). A write that leaves the store's value unchanged raises no
 * notification (Svelte `writable`'s own equality check), so a consumer whose
 * `$effect` depends on this store reruns only on a genuine transition.
 */
export const upstreamAccepted: Readable<boolean> = upstreamAcceptedStore

/** A pure re-read of current acceptance, ignoring any cached store value. */
export function isUpstreamAccepted(): boolean {
    return readAccepted()
}

/**
 * Writes a fresh read of storage into `upstreamAccepted`, for a caller elsewhere in the app that
 * just made its own `isUpstreamAccepted()` check and wants the shared store to agree with what it
 * found, in either direction. `getRisuHub` and `getRealmInfo` (`src/ts/characterCards.ts`) call
 * this at the same point they act on that check, so a store a view cached `true` before either
 * function found no acceptance on a fresh read is corrected rather than left to disagree with it.
 *
 * The rule this gives is scoped: a caller that finds no acceptance on its own fresh read and then
 * calls this function turns the store false (the Realm list and info requests do this on their
 * no-acceptance branch). Two other fresh reads never call it and so
 * never publish: `askUpstreamAgreement()`'s own `isUpstreamAccepted()` check while its prompt is
 * still up, and `RealmFrame.svelte`'s read on init.
 *
 * This function writes to a Svelte store and must never be called from inside a `$derived` or a
 * template expression -- either would raise Svelte's `state_unsafe_mutation`, since both forbid
 * writes reachable from their own evaluation. Call it from an event handler, an `$effect`, or an
 * async continuation instead, exactly as `askUpstreamAgreement()` itself does.
 */
export function publishUpstreamAccepted(): void {
    upstreamAcceptedStore.set(readAccepted())
}

/** Checks storage at the point of use. Call from a handler, effect or async continuation because this can publish a refusal. */
export function verifyUpstreamAccepted(): boolean {
    const accepted = isUpstreamAccepted()
    if (!accepted) upstreamAcceptedStore.set(false)
    return accepted
}

let pending: Promise<boolean> | null = null
let cancelPending: (() => void) | null = null

/**
 * Resolves `true` once the user has accepted the shared upstream-services
 * agreement, `false` if they decline. Already-accepted callers resolve at
 * once, with no prompt. A call made while a prompt from an earlier call is
 * still pending joins that same promise instead of posting a second prompt.
 * While a prompt is pending, anything on `alertStore` other than this
 * prompt's own Accept/Decline value re-posts it, so at most one instance of
 * this prompt is ever showing.
 */
export function askUpstreamAgreement(): Promise<boolean> {
    if (isUpstreamAccepted()) {
        upstreamAcceptedStore.set(true)
        return Promise.resolve(true)
    }
    if (!import.meta.env.VITE_RISU_LEGAL_CONFIGURED) {
        return Promise.resolve(false)
    }
    if (pending) {
        return pending
    }
    pending = new Promise<boolean>((resolve) => {
        const post = () => alertStore.set({ type: 'tos', msg: 'tos' })
        let settled = false
        // Post this prompt's own value before subscribing, so the subscriber
        // callback's synchronous first call (svelte's contract: `subscribe`
        // invokes it at once with the current value) always observes this
        // prompt's own post rather than whatever answer -- Accept, Decline,
        // or anything else -- an earlier, already-settled prompt left behind.
        // A stale value already on the store can therefore never resolve a
        // prompt it wasn't posted for.
        post()
        const unsubscribe = alertStore.subscribe((v) => {
            if (settled) {
                return
            }
            if (v.type === 'none' && v.msg === UPSTREAM_AGREEMENT_ACCEPT) {
                settled = true
                pending = null
                cancelPending = null
                try {
                    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
                } catch {
                    memoryAccepted = true
                }
                upstreamAcceptedStore.set(true)
                resolve(true)
                unsubscribe()
            } else if (v.type === 'none' && v.msg === UPSTREAM_AGREEMENT_DECLINE) {
                settled = true
                pending = null
                cancelPending = null
                // Declining never grants access, but the store may still be caching a `true` this
                // page picked up before this prompt was even posted (a same-tab removal of the
                // key raises no `storage` event, since that event fires only in other tabs) --
                // republish the current fresh read so a view that cached that stale `true` is not
                // left trusting it.
                upstreamAcceptedStore.set(readAccepted())
                resolve(false)
                unsubscribe()
            } else if (v.type !== 'tos') {
                post()
            }
        })
        cancelPending = unsubscribe
    })
    return pending
}

/**
 * Test-only: drops any in-memory acceptance and abandons a still-pending,
 * unanswered prompt (its promise is left to dangle, never resolved), then
 * re-reads storage into the store so an already-attached subscriber sees the
 * fresh value.
 */
export function resetUpstreamAgreementForTests(): void {
    memoryAccepted = false
    pending = null
    cancelPending?.()
    cancelPending = null
    upstreamAcceptedStore.set(readAccepted())
}
