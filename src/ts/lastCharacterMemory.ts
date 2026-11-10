import { isHiddenSystemCharacter } from './hiddenCharacters'

/**
 * Which character this device was last left in, so a relaunch can open it again. The value lives in
 * `localStorage`, outside the database, the save and the dirty tracker, so it never travels in a backup
 * and a different save on the same device simply names an id that is not there. Only the chaId is kept,
 * never an index. Home is stored as no key at all. Nothing here throws: storage that is blocked, full or
 * holding something unexpected reads as "nothing remembered", a failed write is ignored, and a read never
 * writes or removes, so a value this build cannot read stays as it is.
 */

export const LAST_CHARACTER_KEY = 'risutanium.character.last'

/** A character list entry as far as this module looks at it; anything else is not an entry. */
interface MemoryEntry {
    chaId?: unknown
    trashTime?: unknown
}

function asEntry(value: unknown): MemoryEntry | null {
    return typeof value === 'object' && value !== null ? value as MemoryEntry : null
}

/** The chaId of a stored value, or null unless it is a JSON object whose `chaId` is a non-empty string. Extra fields are ignored. */
export function parseLastCharacter(raw: string | null | undefined): string | null {
    if (!raw) {
        return null
    }
    try {
        const parsed: unknown = JSON.parse(raw)
        const entry = asEntry(parsed)
        return entry && typeof entry.chaId === 'string' && entry.chaId !== '' ? entry.chaId : null
    } catch {
        return null
    }
}

/** The remembered chaId, or null when there is none or it cannot be read. */
export function readLastChaId(): string | null {
    try {
        return parseLastCharacter(localStorage.getItem(LAST_CHARACTER_KEY))
    } catch {
        return null
    }
}

/** Remembers `chaId`; null forgets it (Home). A failure leaves the memory as it was. */
export function writeLastChaId(chaId: string | null): void {
    try {
        if (chaId === null) {
            localStorage.removeItem(LAST_CHARACTER_KEY)
        } else {
            localStorage.setItem(LAST_CHARACTER_KEY, JSON.stringify({ chaId }))
        }
    } catch {
        // Nothing is remembered; the relaunch lands on Home.
    }
}

/**
 * The index of the first character holding `chaId`, or null when it is missing, trashed, hidden or not an
 * entry. An archived stub and a group resolve like any character; the pick path restores them.
 */
export function resolveRestoreIndex(characters: readonly unknown[] | null | undefined, chaId: string): number | null {
    if (!characters) {
        return null
    }
    const index = characters.findIndex((candidate) => asEntry(candidate)?.chaId === chaId)
    if (index === -1) {
        return null
    }
    const holder = asEntry(characters[index])
    if (!holder || holder.trashTime || isHiddenSystemCharacter({ chaId })) {
        return null
    }
    return index
}

/**
 * What a selection means for the memory: `record` a character, `home` for a selection that is not
 * restorable (hidden or trashed), or `skip` for an entry that is missing or malformed, which may only be a
 * transient index and must not erase what is remembered.
 */
export type RecordDecision =
    | { kind: 'record', chaId: string }
    | { kind: 'home' }
    | { kind: 'skip' }

export function recordDecision(entry: unknown): RecordDecision {
    const candidate = asEntry(entry)
    if (!candidate || typeof candidate.chaId !== 'string' || candidate.chaId === '') {
        return { kind: 'skip' }
    }
    if (candidate.trashTime || isHiddenSystemCharacter({ chaId: candidate.chaId })) {
        return { kind: 'home' }
    }
    return { kind: 'record', chaId: candidate.chaId }
}
