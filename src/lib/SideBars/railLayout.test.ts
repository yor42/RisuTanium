import { describe, expect, test } from 'vitest'
import type { folder } from '../../ts/storage/database.svelte'
import { CENTRE_ZONE_FRACTION, DEFAULT_HEIGHTS, FOLDER_BLOCK_MARGIN_PX } from './railConstants'
import { PLUS_KEY, buildItems, centreZone, computeLayout, folderBackground, folderHeadKey, folderTailKey, gapKey, locate } from './railLayout'
import { charKey, folderKey, memberKey, railEntries, railItems } from './railTestKit'

const folderOf = (id: string, data: string[]): folder => ({ id, name: id, color: '', data }) as folder

const layoutOf = (order: Array<string | folder>, open: string[] = [], measured: Map<string, number> = new Map()) =>
    computeLayout(railItems(order, { open }), measured)

describe('buildItems', () => {
    test('a closed list is gap, row, gap per entry and ends with the plus block', () => {
        const items = railItems(['A', 'B'])
        expect(items.map((i) => i.kind)).toEqual(['gap', 'char', 'gap', 'char', 'gap', 'plus'])
        expect(items[0].gap).toEqual({ in: 'top', after: null })
        expect(items[2].gap).toEqual({ in: 'top', after: { kind: 'char', id: 'A', occurrence: 0 } })
        expect(items.at(-1)!.key).toBe(PLUS_KEY)
    })

    test('an open folder has a head, a gap before each member and after it, and a tail before its own gap', () => {
        const items = railItems([folderOf('f1', ['B', 'C']), 'D'], { open: ['f1'] })
        expect(items.map((i) => i.kind)).toEqual([
            'gap', 'folder', 'folderHead', 'gap', 'member', 'gap', 'member', 'gap', 'folderTail', 'gap', 'char', 'gap', 'plus',
        ])
        const memberGaps = items.filter((i) => i.gap?.in === 'folder')
        expect(memberGaps.map((i) => (i.gap!.in === 'folder' ? i.gap!.after?.id ?? null : 'x'))).toEqual([null, 'B', 'C'])
        // head, three gaps, two members and the tail
        expect(items.filter((i) => i.owner === folderKey('f1')).length).toBe(7)
    })

    test('a closed folder contributes only its row', () => {
        const items = railItems([folderOf('f1', ['B', 'C'])])
        expect(items.map((i) => i.kind)).toEqual(['gap', 'folder', 'gap', 'plus'])
    })

    test('every key in a list with duplicate characters and duplicate folder ids is unique', () => {
        const items = railItems(['A', 'A', folderOf('f', ['B', 'B']), folderOf('f', ['B'])], { open: ['f'] })
        expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
    })

    test('gap keys tell apart top and folder gaps that follow rows with the same id', () => {
        const top = gapKey({ in: 'top', after: { kind: 'char', id: 'A', occurrence: 0 } })
        const member = gapKey({
            in: 'folder',
            folder: { kind: 'folder', id: 'f', occurrence: 0 },
            after: { kind: 'member', folder: { kind: 'folder', id: 'f', occurrence: 0 }, id: 'A', occurrence: 0 },
        })
        expect(top).not.toBe(member)
    })
})

describe('computeLayout', () => {
    test('offsets are prefix sums of the kind defaults when nothing is measured', () => {
        const layout = layoutOf(['A', 'B'])
        const { gap, char, plus } = DEFAULT_HEIGHTS
        expect(Array.from(layout.offsets)).toEqual([0, gap, gap + char, 2 * gap + char, 2 * gap + 2 * char, 3 * gap + 2 * char, 3 * gap + 2 * char + plus])
        expect(layout.total).toBe(3 * gap + 2 * char + plus)
    })

    test('a folder row uses the folder default and an open folder adds head and tail spacers', () => {
        const closed = layoutOf([folderOf('f1', ['B'])])
        const open = layoutOf([folderOf('f1', ['B'])], ['f1'])
        const d = DEFAULT_HEIGHTS
        expect(closed.heights[closed.indexByKey.get(folderKey('f1'))!]).toBe(d.folder)
        expect(open.total - closed.total).toBe(d.folderHead + d.gap + d.member + d.gap + d.folderTail)
    })

    test('a measured height replaces the default for that item only', () => {
        const measured = new Map([[charKey('A'), 70]])
        const layout = layoutOf(['A', 'B'], [], measured)
        expect(layout.heights[layout.indexByKey.get(charKey('A'))!]).toBe(70)
        expect(layout.heights[layout.indexByKey.get(charKey('B'))!]).toBe(DEFAULT_HEIGHTS.char)
        expect(layout.offsets[layout.indexByKey.get(charKey('B'))! ]).toBe(DEFAULT_HEIGHTS.gap + 70 + DEFAULT_HEIGHTS.gap)
    })

    test('zero, negative and non-finite measurements are ignored', () => {
        for (const bad of [0, -5, NaN, Infinity]) {
            const layout = layoutOf(['A'], [], new Map([[charKey('A'), bad]]))
            expect(layout.heights[layout.indexByKey.get(charKey('A'))!]).toBe(DEFAULT_HEIGHTS.char)
        }
    })

    test('the layout of an empty order is the first gap and the plus block', () => {
        const layout = computeLayout(buildItems([]), new Map())
        expect(layout.items.map((i) => i.kind)).toEqual(['gap', 'plus'])
    })
})

describe('locate', () => {
    const layout = layoutOf(['A', 'B'])
    const at = (key: string) => layout.indexByKey.get(key)!

    test('above the list is the first item and at or below the end is the last', () => {
        expect(locate(layout, -20)).toBe(0)
        expect(locate(layout, NaN)).toBe(0)
        expect(locate(layout, layout.total)).toBe(layout.items.length - 1)
        expect(locate(layout, layout.total + 500)).toBe(layout.items.length - 1)
    })

    test('a position on an item boundary belongs to the item that starts there', () => {
        for (let i = 0; i < layout.items.length; i++) {
            expect(locate(layout, layout.offsets[i])).toBe(i)
            expect(locate(layout, layout.offsets[i + 1] - 0.001)).toBe(i)
        }
    })

    test('a position inside a row finds the row', () => {
        const row = at(charKey('B'))
        expect(locate(layout, layout.offsets[row] + layout.heights[row] / 2)).toBe(row)
    })

    test('an empty list has no item', () => {
        const empty = { ...layout, items: [], offsets: new Float64Array(1), heights: new Float64Array(0), total: 0, indexByKey: new Map<string, number>() }
        expect(locate(empty, 10)).toBe(-1)
    })

    test('a measured height moves the boundaries of every item after it', () => {
        const measured = layoutOf(['A', 'B'], [], new Map([[charKey('A'), 100]]))
        const b = measured.indexByKey.get(charKey('B'))!
        expect(locate(measured, DEFAULT_HEIGHTS.gap + 99)).toBe(measured.indexByKey.get(charKey('A')))
        expect(locate(measured, measured.offsets[b])).toBe(b)
    })
})

describe('centreZone', () => {
    test('is the middle half of the row, 28 px of a 56 px row and 29 px of a 58 px row', () => {
        const layout = layoutOf(['A', folderOf('f1', ['B'])])
        const a = layout.indexByKey.get(charKey('A'))!
        const f = layout.indexByKey.get(folderKey('f1'))!
        const za = centreZone(layout, a)
        const zf = centreZone(layout, f)
        expect(za.bottom - za.top).toBe(DEFAULT_HEIGHTS.char * CENTRE_ZONE_FRACTION)
        expect(zf.bottom - zf.top).toBe(DEFAULT_HEIGHTS.folder * CENTRE_ZONE_FRACTION)
        expect(za.top - layout.offsets[a]).toBe((DEFAULT_HEIGHTS.char * (1 - CENTRE_ZONE_FRACTION)) / 2)
    })

    test('follows a measured row height', () => {
        const layout = layoutOf(['A'], [], new Map([[charKey('A'), 80]]))
        const zone = centreZone(layout, layout.indexByKey.get(charKey('A'))!)
        expect(zone.bottom - zone.top).toBe(40)
    })
})

describe('folderBackground', () => {
    test('spans from below the block margin to the end of the tail spacer', () => {
        const layout = layoutOf([folderOf('f1', ['B', 'C'])], ['f1'])
        const head = layout.indexByKey.get(folderHeadKey(folderKey('f1')))!
        const tail = layout.indexByKey.get(folderTailKey(folderKey('f1')))!
        const bg = folderBackground(layout, folderKey('f1'))!
        expect(bg.top).toBe(layout.offsets[head] + FOLDER_BLOCK_MARGIN_PX)
        expect(bg.top + bg.height).toBe(layout.offsets[tail + 1])
    })

    test('a closed folder has none, and the members stay inside the background', () => {
        expect(folderBackground(layoutOf([folderOf('f1', ['B'])]), folderKey('f1'))).toBeNull()
        const open = layoutOf([folderOf('f1', ['B'])], ['f1'])
        const bg = folderBackground(open, folderKey('f1'))!
        const member = open.indexByKey.get(memberKey('f1', 'B'))!
        expect(open.offsets[member]).toBeGreaterThanOrEqual(bg.top)
        expect(open.offsets[member + 1]).toBeLessThanOrEqual(bg.top + bg.height)
    })

    test('the entries helper agrees with listRows on which folders are open', () => {
        const entries = railEntries([folderOf('a', ['B']), folderOf('b', ['C'])], { open: ['b'] })
        expect(entries.map((e) => e.open)).toEqual([false, true])
    })
})
