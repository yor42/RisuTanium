import type { OwnerKey } from './history/ownerPhase'

/**
 * The pending carry question of one toggle-definition owner (device-local; never in a profile, backup or `.bin`).
 *
 * Stored value: `{"v":1,"baseline":<definition text>}` under `PENDING_PREFIX` + owner key. Anything else is
 * `unreadable`: malformed JSON, another `v` (a later build's record), an extra or missing field. An unreadable record is
 * never overwritten: it is copied once, byte-exact, to `UNREADABLE_PREFIX` + owner key before the main key is rewritten,
 * and when that key is taken nothing is written and the question is held in memory only.
 *
 * A module-level session map holds the questions that could not be stored (or that must not be: `holdSession`). It
 * lives for the page, wins over storage on read, and is dropped by `clearPending`.
 */

export const PENDING_PREFIX = 'risuStudio.toggleCarry:'
export const UNREADABLE_PREFIX = 'risuStudio.toggleCarry.unreadable:'
const FORMAT_VERSION = 1

export type PendingRead =
    | { readonly status: 'absent' }
    | { readonly status: 'ok', readonly baseline: string, readonly kept: 'stored' | 'session' }
    | { readonly status: 'unreadable' }

export type PendingWrite = 'stored' | 'memoryOnly'

const session = new Map<string, string>()

/** Test only: empties the page-lifetime session map. */
export function resetToggleCarrySessionForTests(): void {
    session.clear()
}

type ParsedPending = { readonly status: 'absent' } | { readonly status: 'ok', readonly baseline: string } | { readonly status: 'unreadable' }

export function parsePending(raw: string | null): ParsedPending {
    if (raw === null) {
        return { status: 'absent' }
    }
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return { status: 'unreadable' }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2) {
        return { status: 'unreadable' }
    }
    if (!('v' in value) || value.v !== FORMAT_VERSION || !('baseline' in value) || typeof value.baseline !== 'string') {
        return { status: 'unreadable' }
    }
    return { status: 'ok', baseline: value.baseline }
}

export function serializePending(baseline: string): string {
    return JSON.stringify({ v: FORMAT_VERSION, baseline })
}

/** The session entry first, then the stored record. Unavailable device storage reads as absent. */
export function readPending(owner: OwnerKey): PendingRead {
    const held = session.get(owner)
    if (held !== undefined) {
        return { status: 'ok', baseline: held, kept: 'session' }
    }
    try {
        const parsed = parsePending(localStorage.getItem(PENDING_PREFIX + owner))
        return parsed.status === 'ok' ? { status: 'ok', baseline: parsed.baseline, kept: 'stored' } : parsed
    } catch {
        return { status: 'absent' }
    }
}

/**
 * Stores the window baseline. An existing session entry is updated and nothing is stored. Otherwise the record is
 * stored, after the byte-exact aside copy when the stored bytes are unreadable; when that copy is impossible or storage
 * fails, the baseline is held in the session map and the stored bytes stay as they were.
 */
export function writePending(owner: OwnerKey, baseline: string): PendingWrite {
    if (session.has(owner)) {
        session.set(owner, baseline)
        return 'memoryOnly'
    }
    try {
        const raw = localStorage.getItem(PENDING_PREFIX + owner)
        if (raw !== null && parsePending(raw).status === 'unreadable') {
            if (localStorage.getItem(UNREADABLE_PREFIX + owner) !== null) {
                session.set(owner, baseline)
                return 'memoryOnly'
            }
            localStorage.setItem(UNREADABLE_PREFIX + owner, raw)
        }
        localStorage.setItem(PENDING_PREFIX + owner, serializePending(baseline))
        return 'stored'
    } catch {
        session.set(owner, baseline)
        return 'memoryOnly'
    }
}

/** Keeps the question for this page only; the stored record is never touched. */
export function holdSession(owner: OwnerKey, baseline: string): void {
    session.set(owner, baseline)
}

/**
 * Drops the session entry and a readable stored record. Unreadable bytes and the aside copy stay. Returns whether no
 * readable stored record remains (a throwing storage gives false); the session entry is dropped either way.
 */
export function clearPending(owner: OwnerKey): boolean {
    session.delete(owner)
    try {
        if (parsePending(localStorage.getItem(PENDING_PREFIX + owner)).status === 'ok') {
            localStorage.removeItem(PENDING_PREFIX + owner)
        }
        return true
    } catch {
        return false
    }
}
