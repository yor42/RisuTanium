// The builders of the group member list: each returns what `objEdit` needs, one history step per user action. A builder
// runs synchronously with the write, after every picker or restore await, and reads the live list again then; it finds the
// member by its chaId and never trusts an index captured earlier, so a stale click cannot act on another member.

import type { LiveReader } from '../history/historyModel'
import type { ObjDraft, ObjLabel } from '../history/objectListOps'
import type { ObjBuildResult } from '../history/ownerHistory.svelte'

// The talk value a member added in Studio starts with: classic's `1 / 6 * 4`.
export const DEFAULT_MEMBER_TALK = (1 / 6) * 4

export interface MemberRow {
    chaId: string
    talk?: unknown
    active?: unknown
}

export type MemberBuilder = (id: string, live: LiveReader) => ObjBuildResult

function isMemberRow(value: unknown): value is MemberRow {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { chaId?: unknown }).chaId === 'string'
}

// The live member rows, or null when the list cannot be read (the arrays disagree or are not arrays).
function liveMembers(live: LiveReader): readonly MemberRow[] | null {
    const rows = live.objList?.('members') ?? null
    if (rows === null || !rows.every(isMemberRow)) {
        return null
    }
    return rows
}

function indexesOf(rows: readonly MemberRow[], chaId: string): number[] {
    const found: number[] = []
    rows.forEach((row, index) => {
        if (row.chaId === chaId) {
            found.push(index)
        }
    })
    return found
}

function result(label: ObjLabel, drafts: ObjDraft[], coalesceKey: string | null): ObjBuildResult {
    return { ok: true, label, drafts, coalesceKey }
}

// Adds a member at the end with the default talk and active. Refused when the chaId is already a member or the list
// cannot be read; nothing but the three arrays is touched (no greeting, no chat message).
export function buildAddMember(chaId: string, name: string | null): MemberBuilder {
    return (_id, live) => {
        const rows = liveMembers(live)
        if (rows === null || chaId === '' || indexesOf(rows, chaId).length > 0) {
            return { ok: false, reason: 'precondition' }
        }
        return result(
            { kind: 'obj', list: 'members', action: 'add', name },
            [{ op: 'objInsert', list: 'members', index: rows.length, entry: { chaId, talk: DEFAULT_MEMBER_TALK, active: true } }],
            null,
        )
    }
}

// Removes the member. Refused when the chaId is absent or appears twice (no way to tell which row is meant).
export function buildRemoveMember(chaId: string, name: string | null): MemberBuilder {
    return (_id, live) => {
        const rows = liveMembers(live)
        const found = rows === null ? [] : indexesOf(rows, chaId)
        if (found.length !== 1) {
            return { ok: false, reason: 'precondition' }
        }
        return result({ kind: 'obj', list: 'members', action: 'delete', name, count: 1 }, [{ op: 'objRemove', list: 'members', index: found[0] }], null)
    }
}

function buildSetField(chaId: string, name: string | null, field: 'talk' | 'active', value: number | boolean): MemberBuilder {
    return (_id, live) => {
        const rows = liveMembers(live)
        const found = rows === null ? [] : indexesOf(rows, chaId)
        if (rows === null || found.length !== 1) {
            return { ok: false, reason: 'precondition' }
        }
        if (rows[found[0]][field] === value) {
            return { ok: false, reason: 'unchanged' }
        }
        return result(
            { kind: 'obj', list: 'members', action: 'edit', name, field },
            [{ op: 'objSet', list: 'members', index: found[0], field, after: { had: true, value } }],
            `members:${chaId}:${field}`,
        )
    }
}

// Sets the member's talk (a value of 0..1; the form offers n/6).
export function buildSetTalk(chaId: string, name: string | null, value: number): MemberBuilder {
    return buildSetField(chaId, name, 'talk', value)
}

export function buildSetActive(chaId: string, name: string | null, value: boolean): MemberBuilder {
    return buildSetField(chaId, name, 'active', value)
}

// What the form needs of a character that may hold a member's chaId.
export interface MemberHolder {
    chaId?: string
    name?: string
    coldstorage?: unknown
}

export type MemberTag = 'archived' | 'missing'

export interface MemberRowModel {
    chaId: string
    index: number
    // The holder's own name; null when no character holds the chaId.
    name: string | null
    tag: MemberTag | null
    // The stored talk when it is a number, else null (no level reads as set).
    talk: number | null
    active: boolean
}

// The talk value of level n of 6, written as classic's bar writes it.
export function talkOfLevel(level: number): number {
    return (1 / 6) * level
}

// Whether the stored talk is exactly level n of 6.
export function talkIsLevel(talk: number | null, level: number): boolean {
    return talk !== null && Math.abs(talk - talkOfLevel(level)) < 1e-9
}

// The rows the form lists, from the three parallel arrays as the adapter reads them (null when they disagree) and the
// characters of the database. The first holder of a chaId names the member; a holder with `coldstorage` makes it
// archived and no holder makes it missing. Nothing here restores or drops a member.
export function memberRowModel(arrays: { characters: readonly unknown[]; talks: readonly unknown[]; active: readonly unknown[] } | null, holders: readonly (MemberHolder | null | undefined)[]): MemberRowModel[] | null {
    if (arrays === null) {
        return null
    }
    return arrays.characters.map((chaId, index) => {
        const id = typeof chaId === 'string' ? chaId : ''
        const holder = holders.find((candidate) => candidate?.chaId === id && id !== '') ?? null
        const talk = arrays.talks[index]
        return {
            chaId: id,
            index,
            name: holder === null ? null : typeof holder.name === 'string' ? holder.name : '',
            tag: holder === null ? 'missing' : holder.coldstorage ? 'archived' : null,
            talk: typeof talk === 'number' ? talk : null,
            active: arrays.active[index] === true,
        }
    })
}