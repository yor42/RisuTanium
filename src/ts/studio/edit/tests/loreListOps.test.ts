// The lorebook builders at drafts level: what each user action hands to `objEdit`. The service-level behaviour (steps,
// undo, restore) is in `loreListOps.service.svelte.test.ts`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { LiveReader } from '../../history/historyModel'
import type { ObjBuildResult } from '../../history/ownerHistory.svelte'
import {
    loreAddEntry,
    loreAddFolder,
    loreAlwaysActive,
    loreBulkActive,
    loreDelete,
    loreDeleteFolder,
    loreDuplicate,
    loreFieldEdit,
    loreMove,
    loreMoveLegacyIntoLine,
    loreNewId,
    loreTypingKey,
    type LoreIds,
    type LoreOp,
} from '../loreListOps'
import { trackedOf } from '../loreListModel'

type Row = Record<string, unknown>
const golden: { blank: { globalLore: Row[] } } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../history/tests/fixtures/loreClassic.golden.json'), 'utf8'))
const CLASSIC_ENTRY = golden.blank.globalLore[0]
const CLASSIC_FOLDER = golden.blank.globalLore[1]

function entry(comment: string, extra: Row = {}): Row {
    return { ...CLASSIC_ENTRY, comment, content: `body ${comment}`, ...extra }
}
function folder(key: string, comment: string, extra: Row = {}): Row {
    return { ...CLASSIC_FOLDER, key, comment, ...extra }
}

// A builder reads the live rows through `objList` and nothing else.
function liveOf(rows: readonly unknown[]): LiveReader {
    return { objList: () => rows } as unknown as LiveReader
}

function run(op: LoreOp, rows: readonly unknown[]): Extract<ObjBuildResult, { ok: true }> {
    const built = op.build('step-1', liveOf(rows))
    if (built.ok === false) throw new Error(`refused: ${built.reason}`)
    return built
}

function refusal(op: LoreOp, rows: readonly unknown[]): string {
    const built = op.build('step-1', liveOf(rows))
    return built.ok === false ? built.reason : 'ok'
}

function at(rows: readonly unknown[], index: number) {
    const tracked = trackedOf(rows, index)
    if (tracked === null) throw new Error('no row')
    return { tracked, hint: index }
}

function ids(newIds: string[], folderKeys: string[] = []): LoreIds {
    const idQueue = [...newIds]
    const keyQueue = [...folderKeys]
    return { newId: () => idQueue.shift() ?? `spare-${idQueue.length}`, newFolderKey: () => keyQueue.shift() ?? 'spare-key' }
}

// The order a move produces: the rows after replaying removes then inserts on the draft list, as the planner does.
function replayMove(rows: readonly unknown[], built: Extract<ObjBuildResult, { ok: true }>): unknown[] {
    const list = rows.map((r) => (r !== null && typeof r === 'object' ? { ...(r as Row) } : r))
    for (const draft of built.drafts) {
        if (draft.op === 'objSet') {
            const target = list[draft.index] as Row
            if (draft.after.had) target[draft.field] = draft.after.value
            else delete target[draft.field]
        } else if (draft.op === 'objRemove') list.splice(draft.index, 1)
        else if (draft.op === 'objInsert') list.splice(draft.index, 0, draft.entry)
    }
    return list
}

const commentsOf = (rows: readonly unknown[]): unknown[] => rows.map((r) => (r as Row).comment)

describe('T13: add entry, add folder, duplicate shapes', () => {
    test('a new entry has a fresh unique id, version 2, an empty name and no folder key at top level', () => {
        const rows = [entry('a', { id: 'taken' })]
        const op = loreAddEntry(null, ids(['taken', 'fresh']))
        const built = run(op, rows)
        expect(built.label).toEqual({ kind: 'obj', list: 'lore', action: 'add', name: null })
        expect(built.drafts).toEqual([
            {
                op: 'objInsert',
                list: 'lore',
                index: 1,
                entry: { key: '', comment: '', content: '', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2, id: 'fresh' },
            },
        ])
        expect(op.landed()).toEqual({ index: 1, newId: 'fresh' })
    })

    test('a new folder has an empty name (MC-4190), no id and a key with the classic prefix', () => {
        const op = loreAddFolder(ids([], ['uuid-1']))
        const built = run(op, [entry('a')])
        const created = (built.drafts[0] as { entry: Row }).entry
        expect(created).toEqual({ key: '\uf000folder:uuid-1', comment: '', content: '', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2 })
        expect(created.id).toBeUndefined()
        expect(built.label).toEqual({ kind: 'obj', list: 'lore', action: 'folderCreate', name: null })
    })

    test('a folder key already held is regenerated', () => {
        const rows = [folder('\uf000folder:one', 'F')]
        const built = run(loreAddFolder(ids([], ['one', 'two'])), rows)
        expect((built.drafts[0] as { entry: Row }).entry.key).toBe('\uf000folder:two')
    })

    test('a duplicate gets a fresh id; a character copy is migrated, a chat copy is verbatim', () => {
        const old = entry('old', { content: 'hi <user> @@end', bookVersion: 1, activationPercent: 40 })
        const rows = [old]
        const source = at(rows, 0)
        const forCharacter = run(loreDuplicate('character', source.tracked, source.hint, ids(['d1'])), rows)
        const copy = (forCharacter.drafts[0] as { entry: Row }).entry
        expect(copy).toMatchObject({ id: 'd1', bookVersion: 2, activationPercent: null, content: '@@probability 40\nhi {{user}} @@depth 0' })
        const forChat = run(loreDuplicate('chat', source.tracked, source.hint, ids(['d2'])), rows)
        expect((forChat.drafts[0] as { entry: Row }).entry).toEqual({ ...old, id: 'd2' })
        expect(old.bookVersion).toBe(1)
    })

    test('a folder and a child link cannot be duplicated', () => {
        const rows = [folder('K', 'F'), { ...entry('l'), mode: 'child' }]
        const target0 = at(rows, 0)
        const target1 = at(rows, 1)
        expect(refusal(loreDuplicate('character', target0.tracked, 0), rows)).toBe('precondition')
        expect(refusal(loreDuplicate('character', target1.tracked, 1), rows)).toBe('precondition')
    })
})

describe('T13b: add in a folder lands after its non-contiguous subtree', () => {
    test('at the highest index of the subtree plus one, with the folder key', () => {
        const rows = [folder('K1', 'F'), entry('x'), entry('c', { folder: 'K1' }), entry('y')]
        const op = loreAddEntry('K1', ids(['n']))
        const built = run(op, rows)
        expect(built.drafts[0]).toMatchObject({ op: 'objInsert', index: 3, entry: { folder: 'K1', id: 'n' } })
        expect(op.landed()).toEqual({ index: 3, newId: 'n' })
        expect(refusal(loreAddEntry('GONE'), rows)).toBe('precondition')
    })
})

describe('T17a: where a move lands (spec 2.6)', () => {
    // [A, F(K1){c1, c2 later}, B, c1(K1), C, c2(K1)]: F's block is {1, 3, 5}; the siblings of the top level are A, F, B, C.
    const rows = [entry('A'), folder('K1', 'F'), entry('B'), entry('c1', { folder: 'K1' }), entry('C'), entry('c2', { folder: 'K1' })]

    test('up lands before the previous sibling, down after the next sibling block, top and bottom at the ends', () => {
        const b = at(rows, 2)
        expect(commentsOf(replayMove(rows, run(loreMove(b.tracked, 2, 'up'), rows)))).toEqual(['A', 'B', 'F', 'c1', 'C', 'c2'])
        expect(commentsOf(replayMove(rows, run(loreMove(b.tracked, 2, 'top'), rows)))).toEqual(['B', 'A', 'F', 'c1', 'C', 'c2'])
        expect(commentsOf(replayMove(rows, run(loreMove(b.tracked, 2, 'down'), rows)))).toEqual(['A', 'F', 'c1', 'C', 'B', 'c2'])
        expect(commentsOf(replayMove(rows, run(loreMove(b.tracked, 2, 'bottom'), rows)))).toEqual(['A', 'F', 'c1', 'C', 'B', 'c2'])
    })

    test('a folder moves as one contiguous block', () => {
        const f = at(rows, 1)
        const built = run(loreMove(f.tracked, 1, 'down'), rows)
        expect(commentsOf(replayMove(rows, built))).toEqual(['A', 'B', 'F', 'c1', 'c2', 'C'])
    })

    test('there is nothing to do at the end of a container', () => {
        expect(refusal(loreMove(at(rows, 0).tracked, 0, 'up'), rows)).toBe('unchanged')
        expect(refusal(loreMove(at(rows, 0).tracked, 0, 'top'), rows)).toBe('unchanged')
        expect(refusal(loreMove(at(rows, 4).tracked, 4, 'down'), rows)).toBe('unchanged')
        expect(refusal(loreMove(at(rows, 4).tracked, 4, 'bottom'), rows)).toBe('unchanged')
    })

    test('into a folder lands after its subtree with the new folder key; out lands after the former folder block', () => {
        const a = at(rows, 0)
        const into = run(loreMove(a.tracked, 0, { to: 'K1' }), rows)
        expect(into.drafts[0]).toMatchObject({ op: 'objSet', index: 0, field: 'folder', after: { had: true, value: 'K1' } })
        expect(commentsOf(replayMove(rows, into))).toEqual(['F', 'B', 'c1', 'C', 'c2', 'A'])
        const c1 = at(rows, 3)
        const out = run(loreMove(c1.tracked, 3, 'out'), rows)
        expect(commentsOf(replayMove(rows, out))).toEqual(['A', 'F', 'B', 'C', 'c2', 'c1'])
        expect((replayMove(rows, out)[5] as Row).folder).toBeUndefined()
    })

    test('the landed index is the moved row, also when the folder row is not first in its block', () => {
        const lateFolder = [entry('c', { folder: 'K1' }), folder('K1', 'F'), entry('X')]
        const op = loreMove(at(lateFolder, 1).tracked, 1, 'down')
        const result = replayMove(lateFolder, run(op, lateFolder))
        expect(commentsOf(result)).toEqual(['X', 'c', 'F'])
        expect((result[op.landed()!.index as number] as Row).comment).toBe('F')
    })

    test('a folder is never moved into its own subtree; a missing folder is only left', () => {
        const nested = [folder('K1', 'F'), folder('K2', 'G', { folder: 'K1' })]
        expect(refusal(loreMove(at(nested, 0).tracked, 0, { to: 'K2' }), nested)).toBe('precondition')
        expect(refusal(loreMove(at(nested, 0).tracked, 0, { to: 'K1' }), nested)).toBe('precondition')
        const lost = [entry('a', { folder: 'GONE' })]
        const built = run(loreMove(at(lost, 0).tracked, 0, 'out'), lost)
        expect(built.drafts).toEqual([{ op: 'objSet', list: 'lore', index: 0, field: 'folder', after: { had: false } }])
    })

    test('a move to the top level from a folder removes the key from the row only; the inserted copy is taken after the set', () => {
        const nested = [folder('K1', 'F'), entry('c', { folder: 'K1' })]
        const built = run(loreMove(at(nested, 1).tracked, 1, { to: null }), nested)
        const insert = built.drafts.find((d) => d.op === 'objInsert') as { entry: Row }
        expect(insert.entry.folder).toBeUndefined()
        expect(built.drafts[0]).toMatchObject({ op: 'objSet', field: 'folder', after: { had: false } })
    })
})

describe('T37b: the older probability value moves into the line in one step', () => {
    test('drafts content first, then the field to null; only for a truthy number and no existing line', () => {
        const rows = [entry('a', { activationPercent: 30 }), entry('b', { activationPercent: 0 }), entry('c', { activationPercent: 30, content: '@@probability 10\nx' })]
        const built = run(loreMoveLegacyIntoLine(at(rows, 0).tracked, 0), rows)
        expect(built.drafts).toEqual([
            { op: 'objSet', list: 'lore', index: 0, field: 'content', after: { had: true, value: '@@probability 30\nbody a' } },
            { op: 'objSet', list: 'lore', index: 0, field: 'activationPercent', after: { had: true, value: null } },
        ])
        expect(refusal(loreMoveLegacyIntoLine(at(rows, 1).tracked, 1), rows)).toBe('precondition')
        expect(refusal(loreMoveLegacyIntoLine(at(rows, 2).tracked, 2), rows)).toBe('precondition')
    })
})

describe('field edits and delete', () => {
    test('a folder rename is labelled as one, a non-finite number is unchanged, and the coalesce key is passed through', () => {
        const rows = [folder('K', 'F'), entry('a')]
        const rename = run(loreFieldEdit(at(rows, 0).tracked, 0, 'comment', { had: true, value: 'New' }, null), rows)
        expect(rename.label).toEqual({ kind: 'obj', list: 'lore', action: 'folderRename', name: 'New' })
        expect(refusal(loreFieldEdit(at(rows, 1).tracked, 1, 'insertorder', { had: true, value: Number.NaN }, null), rows)).toBe('unchanged')
        const typed = run(loreFieldEdit(at(rows, 1).tracked, 1, 'comment', { had: true, value: 'x' }, loreTypingKey('id:a', 'comment')), rows)
        expect(typed.coalesceKey).toBe('lore:id:a:comment')
    })

    test('delete and folder delete tag every remove with the step id, highest index first', () => {
        const rows = [folder('K', 'F'), entry('x'), entry('c', { folder: 'K' })]
        const single = run(loreDelete(at(rows, 1).tracked, 1), rows)
        expect(single.drafts).toEqual([{ op: 'objRemove', list: 'lore', index: 1, deletedId: 'step-1' }])
        const op = loreDeleteFolder(at(rows, 0).tracked, 0)
        const whole = run(op, rows)
        expect(whole.drafts.map((d) => [d.op, (d as { index: number }).index])).toEqual([['objRemove', 2], ['objRemove', 0]])
        expect(whole.label).toMatchObject({ action: 'folderDelete', count: 1 })
        expect(op.landed()).toEqual({ index: null, deletedId: 'step-1' })
        expect(refusal(loreDelete(at(rows, 0).tracked, 0), rows)).toBe('precondition')
    })
})

describe('always active and bulk (MC-4191)', () => {
    test('a folder sets itself and its direct children, skipping a malformed child and a link', () => {
        const rows = [
            folder('K1', 'F'),
            entry('c', { folder: 'K1' }),
            entry('bad', { folder: 'K1', alwaysActive: 'true' }),
            { ...entry('l', { folder: 'K1' }), mode: 'child' },
            folder('K2', 'G', { folder: 'K1' }),
            entry('grand', { folder: 'K2' }),
        ]
        const built = run(loreAlwaysActive(at(rows, 0).tracked, 0, true), rows)
        expect(built.drafts.map((d) => (d as { index: number }).index)).toEqual([0, 1, 4])
        expect(built.label).toMatchObject({ action: 'folderActive' })
    })

    test('a row that is a link takes no toggle', () => {
        const rows = [{ ...entry('l'), mode: 'child' }]
        expect(refusal(loreAlwaysActive(at(rows, 0).tracked, 0, true), rows)).toBe('precondition')
    })

    test('bulk covers folders, skips links and malformed rows, and rows that already match', () => {
        const rows = [entry('a'), entry('b', { alwaysActive: true }), folder('K', 'F'), { ...entry('l'), mode: 'child' }, entry('bad', { alwaysActive: 'true' })]
        const on = run(loreBulkActive(true), rows)
        expect(on.drafts.map((d) => (d as { index: number }).index)).toEqual([0, 2])
        expect(on.label).toMatchObject({ action: 'bulkActive', count: 2 })
        const off = run(loreBulkActive(false), rows)
        expect(off.drafts.map((d) => (d as { index: number }).index)).toEqual([1])
        expect(refusal(loreBulkActive(false), [entry('a')])).toBe('unchanged')
    })
})

describe('new id', () => {
    test('only an id that two rows hold; remove and insert at the same index, the fresh id regenerated until unique', () => {
        const rows = [entry('a', { id: 'X' }), entry('b', { id: 'X' }), entry('c')]
        const op = loreNewId(at(rows, 0).tracked, 0, ids(['X', 'fresh']))
        const built = run(op, rows)
        expect(built.drafts).toEqual([
            { op: 'objRemove', list: 'lore', index: 0 },
            { op: 'objInsert', list: 'lore', index: 0, entry: { ...rows[0], id: 'fresh' } },
        ])
        expect(op.landed()).toEqual({ index: 0, newId: 'fresh' })
        expect(refusal(loreNewId(at(rows, 2).tracked, 2), rows)).toBe('precondition')
        expect(refusal(loreNewId(at(rows, 0).tracked, 0, ids(Array(8).fill('X'))), rows)).toBe('precondition')
    })
})

describe('a refused target', () => {
    test('a tracked entry that no longer resolves writes nothing', () => {
        const rows = [entry('a')]
        const target = at(rows, 0)
        expect(refusal(loreDelete(target.tracked, 0), [])).toBe('precondition')
        expect(refusal(loreDelete(target.tracked, 0), [null])).toBe('precondition')
    })
})
