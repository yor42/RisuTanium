// The pure lorebook list model: row identity, nesting and keys, the selection planner (TU1) and the surface rules (C.7).
// Rows are the shapes the classic producers wrote (the golden of `loreClassic.fixtures.test.ts`), with ids and folder
// links set the way the classic editor sets them.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
    ancestorFolderKeys,
    displayNameOf,
    duplicateIds,
    focusAfterRemoval,
    folderDeleteCounts,
    loreListRows,
    moveTargets,
    planOwnLanding,
    planReconcile,
    resolveTracked,
    rowKeyAt,
    subtreeIndexes,
    surfaceLive,
    surfaceTokenOpen,
    trackedOf,
    type LoreOpen,
    type LoreSurface,
} from '../loreListModel'

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
function link(id: string): Row {
    return { key: '', comment: '', content: '', mode: 'child', insertorder: 100, alwaysActive: true, secondkey: '', selective: false, id }
}

const OWNER = 'A'
const itemId = (index: number): string => `${OWNER}/lore:${index}`
function openOf(rows: readonly unknown[], index: number, formToken = 1): LoreOpen {
    const tracked = trackedOf(rows, index)
    if (tracked === null) throw new Error('no row')
    return { itemId: itemId(index), tracked, formToken }
}

describe('trackedOf and resolveTracked', () => {
    test('a unique id is the identity and survives a reorder', () => {
        const rows = [entry('a'), entry('b', { id: 'X' }), entry('c')]
        const tracked = trackedOf(rows, 1)
        expect(tracked?.id).toBe('X')
        const moved = [rows[2], rows[0], rows[1]]
        expect(resolveTracked(moved, tracked!, 1)).toBe(2)
    })

    test('an id-less row is tracked by its element, at the hint or elsewhere', () => {
        const rows = [entry('a'), entry('b')]
        const tracked = trackedOf(rows, 1)!
        expect(tracked.id).toBeNull()
        expect(resolveTracked(rows, tracked, 1)).toBe(1)
        expect(resolveTracked([entry('z'), ...rows], tracked, 1)).toBe(2)
        expect(resolveTracked([entry('z')], tracked, 1)).toBeNull()
    })

    test('two holders of an id fall back to the element; an absent row is no identity', () => {
        const a = entry('a', { id: 'X' })
        const b = entry('b', { id: 'X' })
        const rows = [a, b]
        expect(trackedOf(rows, 0)).toEqual({ id: null, object: a })
        expect(resolveTracked(rows, trackedOf(rows, 1)!, 1)).toBe(1)
        expect(trackedOf(rows, 5)).toBeNull()
    })
})

describe('loreListRows', () => {
    test('nests folders, hides the children of a collapsed one and counts what is inside', () => {
        const rows = [entry('top'), folder('K1', 'F1'), entry('c1', { folder: 'K1' }), folder('K2', 'F2', { folder: 'K1' }), entry('c2', { folder: 'K2' }), entry('after')]
        const collapsed = loreListRows(rows, new Set())
        expect(collapsed.map((r) => r.index)).toEqual([0, 1, 5])
        expect(collapsed[1]).toMatchObject({ kind: 'folder', entryCount: 2, expanded: false, depth: 0 })
        const open = loreListRows(rows, new Set(['K1', 'K2']))
        expect(open.map((r) => [r.index, r.depth])).toEqual([[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 0]])
    })

    test('keys: a unique id, a unique folder key, else the index; an entry text never changes a key', () => {
        const rows = [entry('a', { id: 'X' }), entry('b', { id: 'X' }), folder('K1', 'F'), entry('c', { key: 'K1' })]
        expect(loreListRows(rows, new Set()).map((r) => r.key)).toEqual(['@0', '@1', 'f:K1', '@3'])
        expect(rowKeyAt(rows, 0)).toBe('@0')
        expect(rowKeyAt([rows[0], entry('z')], 0)).toBe('id:X')
        expect(rowKeyAt(rows, 2)).toBe('f:K1')
    })

    test('a missing folder or a cycle puts the row at top level; non-objects are inert rows', () => {
        const rows = [entry('lost', { folder: 'GONE' }), folder('A', 'FA', { folder: 'B' }), folder('B', 'FB', { folder: 'A' }), null, 'x']
        const shown = loreListRows(rows, new Set())
        expect(shown.map((r) => [r.index, r.kind, r.folderMissing, r.depth])).toEqual([
            [0, 'entry', true, 0],
            [1, 'folder', true, 0],
            [2, 'folder', true, 0],
            [3, 'nonEntry', false, 0],
            [4, 'nonEntry', false, 0],
        ])
    })

    test('T30a: the duplicate-id marker counts the rows that are not child links', () => {
        const rows = [entry('a', { id: 'X' }), link('X'), entry('b', { id: 'Y' }), entry('c', { id: 'Y' })]
        expect(duplicateIds(rows)).toEqual(new Set(['Y']))
        expect(loreListRows(rows, new Set()).map((r) => r.duplicateId)).toEqual([false, false, true, true])
    })

    test('a folder-mode row without a key is inert, never a container', () => {
        const rows = [{ ...CLASSIC_FOLDER, key: '' }]
        expect(loreListRows(rows, new Set())[0].kind).toBe('nonEntry')
    })
})

describe('subtrees, ancestors and targets', () => {
    const rows = [folder('K1', 'F1'), entry('x'), entry('c1', { folder: 'K1' }), folder('K2', 'F2', { folder: 'K1' }), entry('y'), entry('c2', { folder: 'K2' })]

    test('a folder subtree is non-contiguous and counted by kind', () => {
        expect(subtreeIndexes(rows, 0)).toEqual([0, 2, 3, 5])
        expect(subtreeIndexes(rows, 1)).toEqual([1])
        expect(folderDeleteCounts(rows, 0)).toEqual({ entries: 2, folders: 1 })
    })

    test('a cycle terminates', () => {
        const cyclic = [folder('A', 'FA', { folder: 'B' }), folder('B', 'FB', { folder: 'A' })]
        expect(subtreeIndexes(cyclic, 0)).toEqual([0, 1])
        expect(ancestorFolderKeys(cyclic, 0)).toEqual([])
    })

    test('ancestors are outermost first', () => {
        expect(ancestorFolderKeys(rows, 5)).toEqual(['K1', 'K2'])
        expect(ancestorFolderKeys(rows, 1)).toEqual([])
    })

    test('the move targets never offer the row or its descendants', () => {
        expect(moveTargets(rows, 0)).toEqual([null])
        expect(moveTargets(rows, 3)).toEqual([null, 'K1'])
        expect(moveTargets(rows, 1)).toEqual([null, 'K1', 'K2'])
        expect(moveTargets(rows, 9)).toEqual([])
    })
})

describe('displayNameOf', () => {
    test('entries fall back to their key, folders to nothing, and the cap never splits a pair', () => {
        expect(displayNameOf(entry('', { key: 'k' }))).toBe('k')
        expect(displayNameOf(folder('K', ''))).toBeNull()
        expect(displayNameOf(null)).toBeNull()
        const long = displayNameOf(entry('a'.repeat(119) + '😀'))
        expect(long).toBe('a'.repeat(119))
        expect(displayNameOf(entry('a'.repeat(300)))?.length).toBe(120)
    })
})

describe('focusAfterRemoval', () => {
    const rows = [entry('a'), folder('K1', 'F'), entry('c', { folder: 'K1' }), entry('b'), folder('K2', 'G'), entry('d', { folder: 'K2' })]

    test('the next visible row, so a collapsed folder is the neighbour and its hidden children are not', () => {
        const visible = loreListRows(rows, new Set())
        expect(focusAfterRemoval(visible, new Set([0]))?.index).toBe(1)
        expect(focusAfterRemoval(visible, new Set([3]))?.index).toBe(4)
    })

    test('a folder delete takes the next visible row after the whole subtree; the last row falls back to the previous', () => {
        const visible = loreListRows(rows, new Set(['K1']))
        expect(focusAfterRemoval(visible, new Set([1, 2]))?.index).toBe(3)
        expect(focusAfterRemoval(loreListRows(rows, new Set()), new Set([4, 5]))?.index).toBe(3)
        expect(focusAfterRemoval(loreListRows([entry('only')], new Set()), new Set([0]))).toBeNull()
    })
})

describe('TU1: planOwnLanding and planReconcile', () => {
    const e1 = entry('e1')
    const x = entry('x')

    test('(a) a form op with the open token retracks to the landing, and the reconcile then follows the move', () => {
        const before = [x, e1]
        const open = openOf(before, 1)
        const after = [e1, x]
        const plan = planOwnLanding(open, 1, 0, after)
        expect(plan).toEqual({ kind: 'retrack', tracked: { id: null, object: e1 } })
        const refreshed = { ...open, tracked: (plan as { tracked: LoreOpen['tracked'] }).tracked }
        expect(planReconcile(refreshed, after, OWNER, open.itemId)).toEqual({ kind: 'follow', itemId: itemId(0) })
    })

    test('(b) an element replaced by a copy at the same index retracks to the copy and reconciles to none', () => {
        const open = openOf([x, e1], 1)
        const copy = { ...e1 }
        const after = [x, copy]
        const plan = planOwnLanding(open, 1, 1, after)
        expect(plan.kind === 'retrack' && plan.tracked.object === copy).toBe(true)
        const refreshed = { ...open, tracked: (plan as { tracked: LoreOpen['tracked'] }).tracked }
        expect(planReconcile(refreshed, after, OWNER, open.itemId)).toEqual({ kind: 'none' })
    })

    test('(c) a new id at the same index retracks with that id and reconciles to none', () => {
        const open = openOf([x, e1], 1)
        const after = [x, { ...e1, id: 'n1' }]
        const plan = planOwnLanding(open, 1, 1, after)
        expect(plan).toMatchObject({ kind: 'retrack', tracked: { id: 'n1' } })
        const refreshed = { ...open, tracked: (plan as { tracked: LoreOpen['tracked'] }).tracked }
        expect(planReconcile(refreshed, after, OWNER, open.itemId)).toEqual({ kind: 'none' })
    })

    test('(c-prime) the id becoming shared, or the only other holder leaving, is none: the key is no input', () => {
        const withId = [entry('a'), entry('e', { id: 'X' })]
        const open = openOf(withId, 1)
        expect(open.tracked.id).toBe('X')
        const shared = [{ ...entry('s'), id: 'X' }, withId[1]]
        expect(planReconcile(open, shared, OWNER, open.itemId)).toEqual({ kind: 'none' })
        const e = entry('e', { id: 'X' })
        const s = entry('s', { id: 'X' })
        const sharedOpen = openOf([e, s], 0)
        expect(sharedOpen.tracked).toEqual({ id: null, object: e })
        expect(planReconcile(sharedOpen, [e], OWNER, sharedOpen.itemId)).toEqual({ kind: 'none' })
    })

    test('(d) a list op with nothing open asks to focus the landed row and expand its folders, outermost first', () => {
        const rows = [folder('K1', 'F1'), folder('K2', 'F2', { folder: 'K1' }), entry('e', { folder: 'K2' })]
        const plan = planOwnLanding(null, null, 2, rows)
        expect(plan).toEqual({ kind: 'focusRow', target: trackedOf(rows, 2), hint: 2, expand: ['K1', 'K2'] })
    })

    test('(e) a list op while an entry is open, (f) no landing, (g) a token of another form: none', () => {
        const rows = [entry('a'), entry('b')]
        const open = openOf(rows, 0)
        expect(planOwnLanding(open, null, 1, rows)).toEqual({ kind: 'none' })
        expect(planOwnLanding(null, null, null, rows)).toEqual({ kind: 'none' })
        expect(planOwnLanding(null, null, 9, rows)).toEqual({ kind: 'none' })
        expect(planOwnLanding(open, 2, 1, rows)).toEqual({ kind: 'none' })
        expect(planOwnLanding(null, 1, 1, rows)).toEqual({ kind: 'none' })
    })

    test('(h) an outside push is none; (i) an outside removal above or a reorder follows; (j) a second holder is never gone', () => {
        const a = entry('a')
        const b = entry('b')
        const c = entry('c')
        const open = openOf([a, b, c], 2)
        expect(planReconcile(open, [a, b, c, entry('d')], OWNER, open.itemId)).toEqual({ kind: 'none' })
        expect(planReconcile(open, [a, c], OWNER, open.itemId)).toEqual({ kind: 'follow', itemId: itemId(1) })
        expect(planReconcile(open, [c, a, b], OWNER, open.itemId)).toEqual({ kind: 'follow', itemId: itemId(0) })
        const idOpen = openOf([a, entry('e', { id: 'X' })], 1)
        const dupes = [{ ...entry('z'), id: 'X' }, a, idOpen.tracked.object]
        expect(planReconcile(idOpen, dupes, OWNER, idOpen.itemId).kind).not.toBe('gone')
    })

    test('(k) an unresolvable entry is gone; (l) the selection naming another item is none', () => {
        const a = entry('a')
        const b = entry('b')
        const open = openOf([a, b], 1)
        expect(planReconcile(open, [a], OWNER, open.itemId)).toEqual({ kind: 'gone' })
        expect(planReconcile(open, [b, a], OWNER, itemId(0))).toEqual({ kind: 'none' })
        expect(planReconcile(open, [b, a], OWNER, null)).toEqual({ kind: 'none' })
    })
})

describe('TU1: surfaces', () => {
    const rows = [entry('a'), entry('b')]
    const open = openOf(rows, 0, 7)

    test('(s1 to s4) a form token passes only for the open form, a list token only in list mode for the current list', () => {
        expect(surfaceTokenOpen(open, 3, { from: 'form', n: 7 })).toBe(true)
        expect(surfaceTokenOpen(open, 3, { from: 'form', n: 8 })).toBe(false)
        expect(surfaceTokenOpen(null, 3, { from: 'form', n: 7 })).toBe(false)
        expect(surfaceTokenOpen(null, 3, { from: 'list', n: 3 })).toBe(true)
        expect(surfaceTokenOpen(open, 3, { from: 'list', n: 3 })).toBe(false)
        expect(surfaceTokenOpen(null, 3, { from: 'list', n: 2 })).toBe(false)
    })

    test('(s5 to s8) a surface is live while its view is open and its target resolves; the bulk menu has no target', () => {
        const target = trackedOf(rows, 1)!
        const live: LoreSurface = { token: { from: 'list', n: 3 }, target, hint: 1 }
        expect(surfaceLive(null, 3, rows, live)).toBe(true)
        expect(surfaceLive(null, 3, [rows[0]], live)).toBe(false)
        expect(surfaceLive(open, 3, rows, live)).toBe(false)
        expect(surfaceLive(null, 3, [], { token: { from: 'list', n: 3 }, target: null, hint: -1 })).toBe(true)
    })
})
