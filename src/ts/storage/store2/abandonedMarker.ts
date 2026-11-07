import type { AppStoreKind } from '../store/appStore'
import { STORAGE_TAB_LOCK_NAME, tabLockSnapshotShowsOthers } from '../storageTabLocks'
import type { Store2Read } from './backend/types'
import type { AbandonResult, Committer } from './commit'
import { classifyCommitRead } from './commitKey'
import { decideClear, type Staging } from './owner'

/**
 * What this page can prove about the page that owns a standing bulk marker.
 * - 'gone': proven that no page that could own the marker is alive.
 * - 'alive': another tab or an exclusive storage operation is visible.
 * - 'unknown': no proof is available on this page.
 */
export type MarkerLiveness = 'gone' | 'alive' | 'unknown'

/** Answers whether the owner of a foreign marker is gone; it never writes. */
export type MarkerOwnerProbe = (marker: Staging) => Promise<MarkerLiveness>

/** What `clearAbandonedMarker` judged and did: the marker it judged, the probe's answer and the clear's outcome. */
export interface AbandonedMarkerOutcome {
    /** The marker the read carried; null when none stands. */
    marker: Staging | null
    /** The marker is this page load's own. */
    own: boolean
    /** The probe's answer for a foreign marker; null when no probe ran (no marker, an own marker, or no probe). */
    liveness: MarkerLiveness | null
    /** The clear's outcome; null when no clear ran or it threw. */
    result: AbandonResult | null
}

/**
 * Clears the bulk marker on `read` when it is this page load's own, or when `probe` proves its owner gone. A foreign
 * marker whose owner may be alive, or with no probe, is left and nothing is written. The clear is `abandonClear`, which
 * re-judges every conflict on a fresh read and refuses any other owner or prefix.
 */
export async function clearAbandonedMarker(
    committer: Pick<Committer, 'owner' | 'abandonClear'>,
    read: Store2Read,
    probe: MarkerOwnerProbe | null,
): Promise<AbandonedMarkerOutcome> {
    const classified = classifyCommitRead(read)
    const staging = classified.status === 'parsed' ? classified.value.staging : null
    let liveness: MarkerLiveness | null = null
    // decideClear awaits the hook without a catch, so a probe that throws is answered here.
    const hook = probe === null
        ? null
        : async (marker: Staging): Promise<boolean> => {
            try {
                liveness = await probe(marker)
            } catch (error) {
                console.error(error)
                liveness = 'unknown'
            }
            return liveness === 'gone'
        }
    const decision = await decideClear(committer.owner, staging, hook)
    if (decision.decision === 'none') {
        return { marker: null, own: false, liveness: null, result: null }
    }
    if (decision.decision === 'leave') {
        return { marker: decision.marker, own: false, liveness, result: null }
    }
    try {
        const result = await committer.abandonClear(read, decision.marker.owner, decision.marker.prefix)
        return { marker: decision.marker, own: decision.own, liveness, result }
    } catch (error) {
        console.error(error)
        return { marker: decision.marker, own: decision.own, liveness, result: null }
    }
}

/** The probe of a host that can never prove a peer gone: it answers 'unknown' so that the person is asked instead. */
const UNPROVABLE: MarkerOwnerProbe = async () => 'unknown'

/** What the page offers the probe: the lock manager's query, and whether this tab holds its own presence lock. */
export interface MarkerProbeDeps {
    /** `navigator.locks.query`, bound; undefined without the lock API or outside a secure context. */
    query: (() => Promise<LockManagerSnapshot>) | undefined
    /** This tab holds its own shared presence lock right now. */
    holdsOwnPresence: () => boolean
}

/**
 * The probe for a host kind. Tauri and the read-only transitional store get none: no foreign marker is judged there.
 * Node never proves a peer gone, because its devices do not share Web Locks. On the web the proof is the tab-lock rule
 * of the superseded-unit sweep plus this tab's own hold: exactly one presence holder and no exclusive operation.
 */
export function markerOwnerProbeFor(kind: AppStoreKind, deps: MarkerProbeDeps): MarkerOwnerProbe | null {
    switch (kind) {
        case 'tauri':
        case 'opfs-transitional':
            return null
        case 'node':
            return UNPROVABLE
        case 'indexeddb': {
            const query = deps.query
            if (typeof query !== 'function') {
                return UNPROVABLE
            }
            return async () => {
                if (!deps.holdsOwnPresence()) {
                    return 'unknown'
                }
                let snapshot: LockManagerSnapshot
                try {
                    snapshot = await query()
                } catch (error) {
                    return 'unknown'
                }
                if (tabLockSnapshotShowsOthers(snapshot)) {
                    return 'alive'
                }
                const holders = (snapshot.held ?? []).filter((lock) => lock.name === STORAGE_TAB_LOCK_NAME).length
                return holders === 1 ? 'gone' : 'unknown'
            }
        }
    }
}
