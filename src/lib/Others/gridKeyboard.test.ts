// @vitest-environment happy-dom

/**
 * `gridKeyboard`: the Grid's tiles as the rail's layout items, and the one-place move of Alt+Left and
 * Alt+Right decided through the rail's `keyboardMove`. Labels: R = the intended behaviour, which fails
 * on the code without the module (the module does not exist there, so these fail by feature absence;
 * the Grid test file carries the behaviour reproducers); F = a guard that may pass before and after.
 */
import { describe, expect, test } from 'vitest'
import type { folder } from '../../ts/storage/database.svelte'
import type { CharacterMatch } from '../../ts/gui/characterSearch'
import { buildItems } from '../SideBars/railLayout'
import { keyboardMove } from '../SideBars/railKeyboard'
import { moveToGap, refKey, type CharRef, type FolderRef, type Gap, type ItemRef, type OrderEntry } from '../SideBars/sidebarOrder'
import { buildGridEntries, type GridEntry } from './charListOrder'
import { directionOfKey, gridKeyMove, gridRailEntries, tileKeyOfRef } from './gridKeyboard'

function makeFolder(id: string, name: string, data: string[]): folder {
    return { id, name, data, color: '' }
}

/** One live character per id, in the order given; the list key is the slot position, never the ref key. */
function matches(ids: string[]): CharacterMatch[] {
    return ids.map((chaId, index) => ({ index, key: `slot-${index}-${chaId}`, chaId }))
}

function tiles(ids: string[], order: OrderEntry[], open: string[] = []): GridEntry[] {
    return buildGridEntries({ live: matches(ids), order, openFolderIds: new Set(open), sort: 'order', searching: false })
}

const visibleOf = (ids: string[]) => (id: string) => ids.includes(id)
const tileOf = (entries: readonly GridEntry[], ref: ItemRef): string => {
    const key = tileKeyOfRef(entries, ref)
    if (key === null) {
        throw new Error('no tile for the ref')
    }
    return key
}
const ch = (id: string, occurrence = 0): CharRef => ({ kind: 'char', id, occurrence })
const fo = (id: string, occurrence = 0): FolderRef => ({ kind: 'folder', id, occurrence })
const shape = (order: readonly OrderEntry[]): string[] =>
    order.map((entry) => (typeof entry === 'string' ? entry : entry === null ? 'null' : `${entry.id}[${entry.data.join(',')}]`))

describe('directionOfKey', () => {
    test('(R) Right is toward the end and Left toward the start; any other key is none', () => {
        expect(directionOfKey('ArrowRight')).toBe('down')
        expect(directionOfKey('ArrowLeft')).toBe('up')
        expect(directionOfKey('ArrowUp')).toBeNull()
        expect(directionOfKey('ArrowDown')).toBeNull()
        expect(directionOfKey('a')).toBeNull()
    })
})

describe('gridRailEntries', () => {
    test('(R) K-2 rail items are keyed by the ref of the order entry, never by the tile key', () => {
        const ids = ['a', 'b', 'c']
        const entries = tiles(ids, ['a', makeFolder('f1', 'F1', ['b']), 'c'], ['f1'])
        const rail = gridRailEntries(entries)
        expect(rail.map((entry) => entry.key)).toEqual([refKey(ch('a')), refKey(fo('f1')), refKey(ch('c'))])
        expect(rail.map((entry) => entry.key)).not.toEqual(entries.filter((entry) => entry.kind === 'char' && entry.folderId === undefined).map((entry) => entry.key))
        expect(rail[1].members.map((member) => member.key)).toEqual([refKey({ kind: 'member', folder: fo('f1'), id: 'b', occurrence: 0 })])
        expect(rail[1].open).toBe(true)
        // The items the layout makes from them are found by `refKey`, which is how `keyboardMove` looks its source up.
        const items = buildItems(rail)
        expect(items.filter((item) => item.ref).map((item) => item.key)).toEqual(items.filter((item) => item.ref).map((item) => refKey(item.ref!)))
    })

    test('(R) K-2 a closed folder carries no member items; an open one carries those with a tile, hidden ids none', () => {
        const closed = gridRailEntries(tiles(['a', 'b', 'c'], [makeFolder('f1', 'F1', ['b', 'c']), 'a']))
        expect(closed[0].open).toBe(false)
        expect(closed[0].members).toEqual([])
        const open = gridRailEntries(tiles(['a', 'b'], [makeFolder('f1', 'F1', ['b', 'ghost']), 'a'], ['f1']))
        expect(open[0].members.map((member) => member.ref.id)).toEqual(['b'])
    })

    test('(R) a tile with no order entry is not an item', () => {
        const entries = tiles(['a', 'b', 'x'], ['a', 'b'])
        expect(entries.map((entry) => entry.ref === null)).toEqual([false, false, true])
        expect(gridRailEntries(entries).map((entry) => entry.ref)).toEqual([ch('a'), ch('b')])
    })

    test('(R) duplicate folder ids and duplicate chaIds keep their occurrences', () => {
        const entries = tiles(['a', 'a', 'b', 'c'], [makeFolder('f', 'First', ['b']), 'a', makeFolder('f', 'Second', ['c']), 'a'], ['f'])
        expect(gridRailEntries(entries).map((entry) => entry.key)).toEqual([
            refKey(fo('f', 0)), refKey(ch('a', 0)), refKey(fo('f', 1)), refKey(ch('a', 1)),
        ])
        // Both folders are open (same id), each with its own member.
        expect(gridRailEntries(entries).filter((entry) => entry.ref.kind === 'folder').map((entry) => entry.members.map((member) => member.ref.id))).toEqual([['b'], ['c']])
    })
})

describe('gridKeyMove', () => {
    test('(R) K-1 one place toward the end and toward the start, with the position', () => {
        const ids = ['a', 'b', 'c', 'd']
        const entries = tiles(ids, ids)
        const right = gridKeyMove(entries, ids, tileOf(entries, ch('b')), 'down', visibleOf(ids))
        expect(right.kind).toBe('move')
        if (right.kind !== 'move') {
            return
        }
        expect(shape(right.order)).toEqual(['a', 'c', 'b', 'd'])
        expect(right.ref).toEqual(ch('b'))
        expect(right.info).toEqual({ position: 3, total: 4 })
        const left = gridKeyMove(entries, ids, tileOf(entries, ch('b')), 'up', visibleOf(ids))
        expect(left.kind === 'move' && shape(left.order)).toEqual(['b', 'a', 'c', 'd'])
    })

    test('(R) K-1 the move writes exactly what moveToGap writes for the same gap', () => {
        const ids = ['a', 'b', 'c', 'd']
        const entries = tiles(ids, ids)
        const result = gridKeyMove(entries, ids, tileOf(entries, ch('a')), 'down', visibleOf(ids))
        const gap: Gap = { in: 'top', after: ch('b') }
        expect(result.kind === 'move' && result.order).toEqual(moveToGap(ids, ch('a'), gap))
    })

    test('(R) K-1 nothing is left past the ends', () => {
        const ids = ['a', 'b']
        const entries = tiles(ids, ids)
        expect(gridKeyMove(entries, ids, tileOf(entries, ch('a')), 'up', visibleOf(ids))).toEqual({ kind: 'edge', dir: 'up' })
        expect(gridKeyMove(entries, ids, tileOf(entries, ch('b')), 'down', visibleOf(ids))).toEqual({ kind: 'edge', dir: 'down' })
    })

    test('(R) K-2 a tile with no order entry, and an unknown tile, are ignored', () => {
        const ids = ['a', 'b', 'x']
        const entries = tiles(ids, ['a', 'b'])
        const orphan = entries[2]
        expect(gridKeyMove(entries, ['a', 'b'], orphan.key, 'up', visibleOf(ids))).toEqual({ kind: 'ignore' })
        expect(gridKeyMove(entries, ['a', 'b'], 'no-such-tile', 'up', visibleOf(ids))).toEqual({ kind: 'ignore' })
    })

    test('(R) K-2 a member leaves its folder at the end of the section and lands among the top-level tiles', () => {
        const ids = ['a', 'b', 'c', 'd']
        const order = ['a', makeFolder('f1', 'F1', ['b', 'c']), 'd']
        const entries = tiles(ids, order, ['f1'])
        const member: ItemRef = { kind: 'member', folder: fo('f1'), id: 'c', occurrence: 0 }
        const result = gridKeyMove(entries, order, tileOf(entries, member), 'down', visibleOf(ids))
        expect(result.kind).toBe('move')
        if (result.kind === 'move') {
            expect(shape(result.order)).toEqual(['a', 'f1[b]', 'c', 'd'])
            expect(result.ref).toEqual(ch('c'))
            expect(result.info).toEqual({ position: 3, total: 4 })
        }
    })

    test('(R) K-2 a member inside an open folder reports its place in the folder', () => {
        const ids = ['a', 'b', 'c']
        const order = [makeFolder('f1', 'F1', ['a', 'b', 'c'])]
        const entries = tiles(ids, order, ['f1'])
        const member: ItemRef = { kind: 'member', folder: fo('f1'), id: 'a', occurrence: 0 }
        const result = gridKeyMove(entries, order, tileOf(entries, member), 'down', visibleOf(ids))
        expect(result.kind).toBe('move')
        if (result.kind === 'move') {
            expect(result.info).toEqual({ position: 2, total: 3, folderName: 'F1' })
        }
    })

    test('(R) K-2 a folder tile passes an open folder as a unit', () => {
        const ids = ['a', 'b', 'c', 'd']
        const order = [makeFolder('f1', 'F1', ['a']), makeFolder('f2', 'F2', ['b', 'c']), 'd']
        const entries = tiles(ids, order, ['f1', 'f2'])
        const result = gridKeyMove(entries, order, tileOf(entries, fo('f1')), 'down', visibleOf(ids))
        expect(result.kind).toBe('move')
        if (result.kind === 'move') {
            expect(shape(result.order)).toEqual(['f2[b,c]', 'f1[a]', 'd'])
            expect(result.ref).toEqual(fo('f1'))
            expect(result.info).toEqual({ position: 2, total: 3 })
        }
    })

    test('(R) K-2 a sole member is refused with the folder tile name, and so is the last visible one', () => {
        const ids = ['a', 'b']
        const sole = [makeFolder('f1', 'F1', ['b']), 'a']
        const entries = tiles(ids, sole, ['f1'])
        const member: ItemRef = { kind: 'member', folder: fo('f1'), id: 'b', occurrence: 0 }
        expect(gridKeyMove(entries, sole, tileOf(entries, member), 'up', visibleOf(ids))).toEqual({ kind: 'refuse-sole', folderName: 'F1' })
        expect(gridKeyMove(entries, sole, tileOf(entries, member), 'down', visibleOf(ids))).toEqual({ kind: 'refuse-sole', folderName: 'F1' })
        // A hidden id keeps the folder in the saved order but not on screen: the visible member is still the sole one.
        const hidden = [makeFolder('f1', 'F1', ['b', 'ghost']), 'a']
        const entriesHidden = tiles(ids, hidden, ['f1'])
        expect(gridKeyMove(entriesHidden, hidden, tileOf(entriesHidden, member), 'down', visibleOf(ids))).toEqual({ kind: 'refuse-sole', folderName: 'F1' })
    })

    test('(R) K-2 passing an identical duplicate asks for focus only', () => {
        const ids = ['a', 'a', 'b']
        const entries = tiles(ids, ids)
        const result = gridKeyMove(entries, ids, tileOf(entries, ch('a', 0)), 'down', visibleOf(ids))
        expect(result).toEqual({ kind: 'focus', ref: ch('a', 1), info: { position: 2, total: 3 } })
    })

    test('(R) K-2 duplicate folder ids: the second folder passes the character before it and keeps its occurrence', () => {
        const ids = ['a', 'b', 'c']
        const order = [makeFolder('f', 'First', ['b']), 'a', makeFolder('f', 'Second', ['c'])]
        const entries = tiles(ids, order)
        const result = gridKeyMove(entries, order, tileOf(entries, fo('f', 1)), 'up', visibleOf(ids))
        expect(result.kind).toBe('move')
        if (result.kind === 'move') {
            expect(shape(result.order)).toEqual(['f[b]', 'f[c]', 'a'])
            expect(result.ref).toEqual(fo('f', 1))
        }
    })

    test('(F) the order and the tiles are not touched', () => {
        const ids = ['a', 'b', 'c']
        const entries = tiles(ids, ids)
        const before = JSON.stringify([ids, entries])
        gridKeyMove(entries, ids, tileOf(entries, ch('a')), 'down', visibleOf(ids))
        expect(JSON.stringify([ids, entries])).toBe(before)
    })

    test('(F) the same move through the rail items built by hand equals the Grid answer', () => {
        const ids = ['a', 'b', 'c']
        const entries = tiles(ids, ids)
        const items = buildItems(ids.map((id) => ({ ref: ch(id), key: refKey(ch(id)), open: false, members: [] })))
        const rail = keyboardMove(ids, items, ch('b'), 'down', visibleOf(ids))
        const grid = gridKeyMove(entries, ids, tileOf(entries, ch('b')), 'down', visibleOf(ids))
        expect(rail?.kind === 'move' && grid.kind === 'move' && grid.order).toEqual(rail?.kind === 'move' ? rail.order : null)
    })
})
