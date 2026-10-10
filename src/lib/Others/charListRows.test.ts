// @vitest-environment happy-dom

/**
 * `charListRows.ts`: the row model of the windowed character lists. Pure functions over keys and
 * heights, so nothing here is mounted.
 *
 * Test labels: every test here is a feature test. The module does not exist before the windowed
 * lists, so on the earlier base each one fails at the import and proves nothing about a defect.
 * The Grid tab helpers (`gridColumns`, `gridRows`, the card anchors) are feature tests too: before
 * them the functions are missing and each call throws.
 */
import { describe, expect, test } from 'vitest'
import { anchorAt, buildRowLayout, cardAnchorAt, gridColumns, gridRowKey, gridRows, gridSectionRows, heightDeltaAbove, listRowKey, listRows, scrollTopFor, scrollTopForCard } from './charListRows'
import type { FolderTile, GridEntry } from './charListOrder'

const keys = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i))

describe('listRows', () => {
    test('one row per card, keyed so that no key equals a spacer key of the window', () => {
        const rows = listRows(keys(3))
        expect(rows.map((row) => row.cards)).toEqual([['0'], ['1'], ['2']])
        expect(new Set(rows.map((row) => row.key)).size).toBe(3)
        for (const row of rows) {
            expect(row.key).toBe(listRowKey(row.cards[0]))
            expect(Array.isArray(JSON.parse(row.key))).toBe(true)
            expect(row.key === 'top' || row.key === 'bottom' || row.key.startsWith('gap-after:')).toBe(false)
        }
    })
})

describe('buildRowLayout', () => {
    test('a row without a measurement takes the fallback height, a measured one its own', () => {
        const rows = listRows(keys(3))
        const layout = buildRowLayout(rows, new Map([[rows[1].key, 200]]), 100)
        expect(Array.from(layout.heights)).toEqual([100, 200, 100])
        expect(Array.from(layout.offsets)).toEqual([0, 100, 300, 400])
        expect(layout.total).toBe(400)
    })

    test('a measurement that is not a positive finite number counts as unmeasured', () => {
        const rows = listRows(keys(3))
        const layout = buildRowLayout(rows, new Map([[rows[0].key, 0], [rows[1].key, Number.NaN], [rows[2].key, -5]]), 100)
        expect(Array.from(layout.heights)).toEqual([100, 100, 100])
    })

    test('an empty list has no height', () => {
        expect(buildRowLayout([], new Map(), 100).total).toBe(0)
    })
})

describe('scroll anchors', () => {
    const rows = listRows(keys(5))
    const measured = new Map([[rows[0].key, 50], [rows[1].key, 300]])
    const layout = buildRowLayout(rows, measured, 100)

    test('the anchor names the row at the viewport top and how far into it', () => {
        expect(anchorAt(layout, 0)).toEqual({ key: rows[0].key, offset: 0 })
        expect(anchorAt(layout, 120)).toEqual({ key: rows[1].key, offset: 70 })
        expect(anchorAt(layout, 350)).toEqual({ key: rows[2].key, offset: 0 })
    })

    test('an empty list has no anchor', () => {
        expect(anchorAt(buildRowLayout([], new Map(), 100), 10)).toBeNull()
    })

    test('an anchor is restored against changed heights to the same row and offset', () => {
        const anchor = anchorAt(layout, 120)!
        const taller = buildRowLayout(rows, new Map([[rows[0].key, 80], [rows[1].key, 300]]), 100)
        expect(scrollTopFor(taller, anchor)).toBe(80 + 70)
    })

    test('an anchor whose row is gone, or whose offset is past the row, lands at the top or the row end', () => {
        expect(scrollTopFor(layout, { key: listRowKey('99'), offset: 10 })).toBe(0)
        expect(scrollTopFor(layout, { key: rows[0].key, offset: 500 })).toBe(50)
    })
})

describe('gridColumns', () => {
    // At 16 px per rem a tile is 56 px and a gap 8 px: n tiles need 64 n - 8 px, and one pixel is held back.
    test('(F) counts the tiles that fit, one pixel short of the reported width', () => {
        expect(gridColumns(624, 16)).toBe(9)
        expect(gridColumns(569, 16)).toBe(9)
        expect(gridColumns(568, 16)).toBe(8)
        expect(gridColumns(121, 16)).toBe(2)
        expect(gridColumns(120, 16)).toBe(1)
    })

    test('(F) a container narrower than one tile, or with no width, still has one column', () => {
        expect(gridColumns(63, 16)).toBe(1)
        expect(gridColumns(55, 16)).toBe(1)
        expect(gridColumns(0, 16)).toBe(1)
        expect(gridColumns(Number.NaN, 16)).toBe(1)
    })

    test('(F) the tile and the gap scale with the root font size', () => {
        // 20 px per rem: a tile is 70 px, a gap 10 px, five tiles need 390 px.
        expect(gridColumns(391, 20)).toBe(5)
        expect(gridColumns(390, 20)).toBe(4)
        expect(gridColumns(624, 20)).toBe(7)
        expect(gridColumns(624, 20)).toBeLessThan(gridColumns(624, 16))
    })

    test('(F) a fractional width counts against its own value', () => {
        expect(gridColumns(568.5, 16)).toBe(8)
        expect(gridColumns(569.5, 16)).toBe(9)
    })
})

describe('gridRows', () => {
    test('(F) fills each row to the column count and leaves the rest in the last one', () => {
        const rows = gridRows(keys(7), 3)
        expect(rows.map((row) => row.cards)).toEqual([['0', '1', '2'], ['3', '4', '5'], ['6']])
    })

    test('(F) a row is named by its first card, in a form no spacer key of the window can take', () => {
        const rows = gridRows(keys(7), 3)
        expect(rows.map((row) => row.key)).toEqual([gridRowKey('0'), gridRowKey('3'), gridRowKey('6')])
        expect(new Set(rows.map((row) => row.key)).size).toBe(3)
        for (const row of rows) {
            expect(Array.isArray(JSON.parse(row.key))).toBe(true)
            expect(row.key === 'top' || row.key === 'bottom' || row.key.startsWith('gap-after:')).toBe(false)
        }
        expect(gridRowKey('0')).not.toBe(listRowKey('0'))
    })

    test('(F) no cards give no rows, and a column count below one gives one card per row', () => {
        expect(gridRows([], 4)).toEqual([])
        expect(gridRows(keys(2), 0).map((row) => row.cards)).toEqual([['0'], ['1']])
    })
})

describe('card anchors across a change of columns', () => {
    const wide = gridRows(keys(20), 5)
    const wideLayout = buildRowLayout(wide, new Map(), 64)
    const wideByKey = new Map(wide.map((row) => [row.key, row] as const))

    test('(F) names the first card of the row at the top and how far into the row', () => {
        expect(cardAnchorAt(wideLayout, wideByKey, 2 * 64 + 10)).toEqual({ card: '10', offset: 10 })
        expect(cardAnchorAt(buildRowLayout([], new Map(), 64), new Map(), 10)).toBeNull()
    })

    test('(F) the anchor lands in the row that holds its card after the columns change', () => {
        const anchor = cardAnchorAt(wideLayout, wideByKey, 2 * 64 + 10)!
        const narrow = gridRows(keys(20), 3)
        const narrowLayout = buildRowLayout(narrow, new Map(), 64)
        const narrowByCard = new Map(narrow.flatMap((row) => row.cards.map((card) => [card, row] as const)))
        // Card 10 sits in the row 9..11, the fourth row.
        expect(scrollTopForCard(narrowLayout, narrowByCard, anchor)).toBe(3 * 64 + 10)
    })

    test('(F) a card that is no longer listed lands at the top', () => {
        const narrow = gridRows(keys(5), 3)
        const narrowLayout = buildRowLayout(narrow, new Map(), 64)
        const narrowByCard = new Map(narrow.flatMap((row) => row.cards.map((card) => [card, row] as const)))
        expect(scrollTopForCard(narrowLayout, narrowByCard, { card: '10', offset: 10 })).toBe(0)
    })
})

describe('heightDeltaAbove', () => {
    const rows = listRows(keys(6))
    const layout = buildRowLayout(rows, new Map(), 100)

    test('sums new minus modelled height over the rows wholly above the viewport top', () => {
        // The viewport top is inside row 3 (300..400).
        const delta = heightDeltaAbove(layout, 350, [[rows[0].key, 140], [rows[2].key, 90]])
        expect(delta).toBe(40 - 10)
    })

    test('the row at the viewport top and the rows below it move nothing on screen', () => {
        expect(heightDeltaAbove(layout, 350, [[rows[3].key, 400], [rows[5].key, 400]])).toBe(0)
    })

    test('a key the layout does not hold is ignored', () => {
        expect(heightDeltaAbove(layout, 350, [[listRowKey('99'), 400]])).toBe(0)
    })

    test('at the top of the list there is nothing above', () => {
        expect(heightDeltaAbove(layout, 0, [[rows[0].key, 400]])).toBe(0)
    })
})

//#region gridSectionRows

const charEntry = (key: string, folderId?: string): GridEntry => ({ kind: 'char', key, index: 0, ref: null, ...(folderId === undefined ? {} : { folderId, folderName: folderId }) })
const folderEntry = (id: string, open: boolean, color = ''): FolderTile => ({
    kind: 'folder',
    key: `folder-${id}`,
    id,
    name: id,
    color,
    imgFile: '',
    count: 0,
    open,
    ref: { kind: 'folder', id, occurrence: 0 },
})

const cardsOf = (rows: ReturnType<typeof gridSectionRows>): string[][] => rows.map((row) => [...row.cards])

describe('gridSectionRows', () => {
    test('entries without an open folder are rows of the flow, as gridRows makes them', () => {
        const entries = [charEntry('a'), folderEntry('f', false), charEntry('b'), charEntry('c'), charEntry('d')]
        const rows = gridSectionRows(entries, 3)
        expect(rows).toEqual(gridRows(entries.map((entry) => entry.key), 3))
        expect(rows.every((row) => row.folderId === undefined && row.className === undefined)).toBe(true)
    })

    test('an open folder ends the flow row before it, even a partial one, and the flow resumes in a new row', () => {
        const entries = [charEntry('a'), charEntry('b'), folderEntry('f', true), charEntry('m1', 'f'), charEntry('m2', 'f'), charEntry('x'), charEntry('y'), charEntry('z'), charEntry('w')]
        const rows = gridSectionRows(entries, 3)
        expect(cardsOf(rows)).toEqual([['a', 'b'], ['folder-f', 'm1', 'm2'], ['x', 'y', 'z'], ['w']])
        expect(rows.map((row) => row.folderId)).toEqual([undefined, 'f', undefined, undefined])
        expect(rows[0].className).toBeUndefined()
        expect(rows[2].className).toBeUndefined()
    })

    test('a section of several rows has a first row rounded on top and a last row rounded at the bottom', () => {
        const members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((key) => charEntry(key, 'f'))
        const rows = gridSectionRows([folderEntry('f', true), ...members], 3)
        expect(cardsOf(rows)).toEqual([['folder-f', 'm1', 'm2'], ['m3', 'm4', 'm5'], ['m6']])
        expect(rows.every((row) => row.folderId === 'f')).toBe(true)
        expect(rows[0].className).toContain('rounded-t-lg')
        expect(rows[0].className).not.toContain('rounded-b-lg')
        expect(rows[1].className).not.toContain('rounded')
        expect(rows[2].className).toContain('rounded-b-lg')
        expect(rows[2].className).not.toContain('rounded-t-lg')
    })

    test('a one-row section is rounded at both ends', () => {
        const rows = gridSectionRows([charEntry('a'), folderEntry('f', true), charEntry('m1', 'f')], 4)
        expect(cardsOf(rows)).toEqual([['a'], ['folder-f', 'm1']])
        expect(rows[1].className).toContain('rounded-t-lg')
        expect(rows[1].className).toContain('rounded-b-lg')
    })

    test('two open folders in a row make two sections with no flow row between them', () => {
        const entries = [folderEntry('f', true, 'red'), charEntry('m1', 'f'), folderEntry('g', true), charEntry('n1', 'g'), charEntry('n2', 'g')]
        const rows = gridSectionRows(entries, 4)
        expect(cardsOf(rows)).toEqual([['folder-f', 'm1'], ['folder-g', 'n1', 'n2']])
        expect(rows.map((row) => row.folderId)).toEqual(['f', 'g'])
        expect(rows[0].className).toContain('bg-red-700/20')
        expect(rows[1].className).not.toContain('bg-red-700/20')
    })

    test('an open folder first and an open folder last leave no empty row', () => {
        const first = gridSectionRows([folderEntry('f', true), charEntry('m1', 'f'), charEntry('a')], 2)
        expect(cardsOf(first)).toEqual([['folder-f', 'm1'], ['a']])
        const last = gridSectionRows([charEntry('a'), folderEntry('f', true), charEntry('m1', 'f'), charEntry('m2', 'f')], 2)
        expect(cardsOf(last)).toEqual([['a'], ['folder-f', 'm1'], ['m2']])
        expect(gridSectionRows([], 3)).toEqual([])
    })

    test('a member of another folder does not extend the section, and a closed folder stays a flow tile', () => {
        const entries = [folderEntry('f', true), charEntry('m1', 'f'), charEntry('stray', 'other'), folderEntry('g', false), charEntry('a')]
        const rows = gridSectionRows(entries, 4)
        expect(cardsOf(rows)).toEqual([['folder-f', 'm1'], ['stray', 'folder-g', 'a']])
        expect(rows.map((row) => row.folderId)).toEqual(['f', undefined])
    })

    test('row keys are unique and are the first card, whatever the column count', () => {
        const entries = [charEntry('a'), charEntry('b'), folderEntry('f', true), ...Array.from({ length: 9 }, (_, i) => charEntry(`m${i}`, 'f')), folderEntry('g', true), charEntry('n', 'g'), charEntry('c'), folderEntry('h', false)]
        for (const columns of [1, 2, 3, 4, 5, 7, 0, 2.9]) {
            const rows = gridSectionRows(entries, columns)
            expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
            expect(rows.every((row) => row.key === gridRowKey(row.cards[0]))).toBe(true)
            expect(rows.flatMap((row) => row.cards)).toEqual(entries.map((entry) => entry.key))
            expect(rows.every((row) => row.cards.length <= Math.max(1, Math.floor(columns)))).toBe(true)
        }
    })
})

//#endregion
