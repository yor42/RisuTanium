/**
 * What a restore does with one side store, decided from the manifest alone (A3.4).
 * It is pure: it reads no store and no entry.
 *
 * An `omitted` entry matches a side id when its kind is `side` and its name is the id,
 * whatever its reason. Rules, in order:
 * 1. A row plus a match, at any `v`, is a conflict: the store is left alone and named.
 * 2. A row at `v` 1 is restored.
 * 3. A row at a `v` above 1 clears the store and is named as newer.
 * 4. A match alone leaves the store alone and names it.
 * 5. Otherwise the file holds nothing for the store, and it is cleared.
 *
 * `leave` is the decision; applying it to `side.plugin-permissions` still clears that
 * store (MC-2047), so every restored plugin asks for its permissions again.
 */
import type { SideSectionId } from './entryNames'
import { SIDE_SECTION_IDS } from './entryNames'
import type { OmittedEntry } from './manifest'
import type { SectionRow } from './sections'

export type SideAction =
    | { kind: 'restore', id: SideSectionId, row: SectionRow }
    | { kind: 'leave', id: SideSectionId, status: 'omitted', reason: string }
    | { kind: 'leave', id: SideSectionId, status: 'conflict' }
    | { kind: 'clear', id: SideSectionId, status: 'newer', v: number }
    | { kind: 'clear', id: SideSectionId, status: 'absent' }

const KNOWN_V = 1

export function decideSideSection(id: SideSectionId, rows: readonly SectionRow[], omitted: readonly OmittedEntry[]): SideAction {
    const row = rows.find((candidate) => candidate.id === id)
    const match = omitted.find((entry) => entry.kind === 'side' && entry.name === id)
    if (row !== undefined && match !== undefined) {
        return { kind: 'leave', id, status: 'conflict' }
    }
    if (row !== undefined) {
        return row.v === KNOWN_V
            ? { kind: 'restore', id, row }
            : { kind: 'clear', id, status: 'newer', v: row.v }
    }
    if (match !== undefined) {
        return { kind: 'leave', id, status: 'omitted', reason: match.reason }
    }
    return { kind: 'clear', id, status: 'absent' }
}

/** One action per side section, in `SIDE_SECTION_IDS` order. */
export function decideSideSections(rows: readonly SectionRow[], omitted: readonly OmittedEntry[]): SideAction[] {
    return (SIDE_SECTION_IDS as readonly SideSectionId[]).map((id) => decideSideSection(id, rows, omitted))
}
