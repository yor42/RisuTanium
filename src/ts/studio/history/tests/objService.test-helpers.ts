// Shared by the object-list service tests: the classic-producer golden, draft builders shaped like the S7-1 builders
// will emit them, and the live character the service tests write into. Each test file keeps its own `vi.mock` of the
// store and the save-mark counter, because a mock is per file.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DBState } from 'src/ts/stores.svelte'
import type { LiveReader } from '../historyModel'
import type { ObjBuildResult } from '../ownerHistory.svelte'
import type { ObjDraft, ObjEntry, ObjFieldValue } from '../objectListOps'

export interface Golden {
    blank: { globalLore: ObjEntry[]; localLore: ObjEntry[] }
    mixedRows: { globalLore: unknown[] }
    twins: { globalLore: ObjEntry[] }
    folderWithId: { globalLore: ObjEntry[] }
    wrongKinds: { globalLore: ObjEntry[] }
}

export const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))

export interface LiveChat {
    id: string
    note: string
    fmIndex: number
    localLore?: unknown[]
}

export interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
    globalLore?: unknown[]
    loreSettings?: object
    loreExt?: object
}

export function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        firstMessage: 'M',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '', fmIndex: -1 }],
        chatPage: 0,
        ...overrides,
    }
}

export function putCharacter(value: unknown): void {
    DBState.db.characters = [value] as unknown as typeof DBState.db.characters
}

export function liveCharacter(): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[])[0]
}

export function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
}

// `row(n)` is the F1 `addLorebook` entry with a distinct comment and content.
export function row(n: number): ObjEntry {
    return { ...clone(golden.blank.globalLore[0]), comment: `Row ${n}`, content: `body ${n}` }
}

export function rows(count: number): ObjEntry[] {
    return Array.from({ length: count }, (_, i) => row(i))
}

export function build(drafts: ObjDraft[], label: Extract<ObjBuildResult, { ok: true }>['label'], coalesceKey: string | null = null): (id: string, live: LiveReader) => ObjBuildResult {
    return () => ({ ok: true, label, drafts, coalesceKey })
}

const editLabel = (field: string): Extract<ObjBuildResult, { ok: true }>['label'] => ({ kind: 'obj', list: 'lore', action: 'edit', name: null, field })

export function fieldEdit(index: number, field: string, after: ObjFieldValue, coalesceKey: string | null = null): (id: string, live: LiveReader) => ObjBuildResult {
    return build([{ op: 'objSet', list: 'lore', index, field, after }], editLabel(field), coalesceKey)
}

export function textEdit(index: number, field: string, value: string, coalesceKey: string | null = `lore:${index}:${field}`): (id: string, live: LiveReader) => ObjBuildResult {
    return fieldEdit(index, field, { had: true, value }, coalesceKey)
}

export function addRow(index: number, entry: ObjEntry): (id: string, live: LiveReader) => ObjBuildResult {
    return build([{ op: 'objInsert', list: 'lore', index, entry }], { kind: 'obj', list: 'lore', action: 'add', name: null })
}

// A delete tags its removes with one deleted id; a multi-row delete removes the highest index first.
export function deleteRows(indexes: readonly number[], deletedId: string): (id: string, live: LiveReader) => ObjBuildResult {
    const ordered = [...indexes].sort((a, b) => b - a)
    return build(
        ordered.map((index) => ({ op: 'objRemove' as const, list: 'lore' as const, index, deletedId })),
        { kind: 'obj', list: 'lore', action: 'delete', name: null, count: ordered.length },
    )
}
