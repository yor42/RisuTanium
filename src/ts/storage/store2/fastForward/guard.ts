import type { JsonValue } from '../../blockFrame'
import { sameJsonValue } from '../codec'

/**
 * Guard B of the fast-forward: after a record is taken from a peer, a later plan of this page must not write it back to
 * what it was before the take (a stale writer that still holds a pre-take copy). Every fast-forward arms entries for what
 * it took theirs; the loop asks `check` before it builds a commit request, and a hit skips the commit and parks the page
 * with the matched entries pinned, so the question is asked once and never loops.
 *
 * Coverage: the entries are database fields and units (records and bodies). The moved fields of a shard entry
 * (`trashTime`, `lastInteraction`, `chatPage`, `firstMsgIndex`) belong to the entry, a parent, and get no entry here: a
 * stale writer that writes an old moved-field value back explicitly is not caught, and the write lands in the live slot
 * that every holder of it sees.
 */

/** How long an entry lives after its fast-forward, unless a park pins it. */
export const GUARD_B_MS = 5 * 60_000

export type GuardEntry =
    /** A unit identity the peer changed and this page took: a plan that writes it with the pre-take digest is a revert. */
    | { kind: 'unit', identity: string, digest: string }
    /** A top-level database field taken: the live value at plan end equals `before` and differs from `expected`. */
    | { kind: 'field', path: string, before: JsonValue | undefined, expected: JsonValue | undefined }

interface Armed {
    entry: GuardEntry
    armedAt: number
    pinned: boolean
}

export interface GuardBHit {
    entries: readonly GuardEntry[]
}

export interface GuardB {
    /** Arms `entries`; an entry for an identity or path that is already armed replaces it. */
    arm(entries: readonly GuardEntry[]): void
    /** The entries a plan that writes `written` and ends with `live` fields would revert, or null. Expired, unpinned entries are dropped first. */
    check(written: ReadonlyMap<string, string>, live: (path: string) => JsonValue | undefined): GuardBHit | null
    /** Keeps `entries` past their expiry while a park stands. */
    pin(entries: readonly GuardEntry[]): void
    /** Removes `entries`, pinned or not: the person chose Save mine. */
    disarm(entries: readonly GuardEntry[]): void
    size(): number
}

function sameEntry(a: GuardEntry, b: GuardEntry): boolean {
    if (a.kind === 'unit' && b.kind === 'unit') {
        return a.identity === b.identity
    }
    return a.kind === 'field' && b.kind === 'field' && a.path === b.path
}

export function createGuardB(now: () => number, ttlMs: number = GUARD_B_MS): GuardB {
    let armed: Armed[] = []

    function sweep(): void {
        const at = now()
        armed = armed.filter(item => item.pinned || at - item.armedAt < ttlMs)
    }

    return {
        arm(entries) {
            const at = now()
            armed = armed.filter(item => !entries.some(entry => sameEntry(entry, item.entry)))
            for (const entry of entries) {
                armed.push({ entry, armedAt: at, pinned: false })
            }
        },
        check(written, live) {
            sweep()
            const hits: GuardEntry[] = []
            for (const { entry } of armed) {
                if (entry.kind === 'unit') {
                    if (written.get(entry.identity) === entry.digest) {
                        hits.push(entry)
                    }
                } else {
                    const value = live(entry.path)
                    if (sameJsonValue(value, entry.before) && !sameJsonValue(value, entry.expected)) {
                        hits.push(entry)
                    }
                }
            }
            return hits.length === 0 ? null : { entries: hits }
        },
        pin(entries) {
            for (const item of armed) {
                if (entries.some(entry => sameEntry(entry, item.entry))) {
                    item.pinned = true
                }
            }
        },
        disarm(entries) {
            armed = armed.filter(item => !entries.some(entry => sameEntry(entry, item.entry)))
        },
        size: () => armed.length,
    }
}
