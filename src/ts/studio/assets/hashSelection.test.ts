import { describe, expect, test } from 'vitest'
import type { StoredSize } from './assetSizes'
import { selectForHashing, type HashRow } from './hashSelection'

let rowCounter = 0

/** A row with a path of its own: two rows of one name are two stored files. */
function rowOf(name: string): HashRow {
    rowCounter += 1
    return { name, path: 'assets/' + rowCounter + '-' + name }
}

function sizesOf(entries: [HashRow, StoredSize][]): Map<string, StoredSize> {
    return new Map(entries.map(([row, size]) => [row.path, size]))
}

function selectedNames(rows: HashRow[], sizes: Map<string, StoredSize>): HashRow[] | 'pending' {
    const selection = selectForHashing(rows, sizes)
    return selection.kind === 'pending' ? 'pending' : selection.rows
}

describe('selectForHashing', () => {
    test('selects rows of a shared name and rows of a shared known size, and nothing else', () => {
        const a = rowOf('a'), b = rowOf('b'), c = rowOf('c'), d1 = rowOf('d'), d2 = rowOf('d'), e = rowOf('e')
        const sizes = sizesOf([[a, 10], [b, 10], [c, 12], [d1, null], [d2, null], [e, null]])
        const selected = selectedNames([a, b, c, d1, d2, e], sizes)
        expect(selected).toEqual([a, b, d1, d2])
        expect(selected).not.toContain(c)
        expect(selected).not.toContain(e)
    })

    test('a row of another array never pulls a row in: selection sees one array', () => {
        const a = rowOf('a'), b = rowOf('b'), c = rowOf('c')
        const other = rowOf('z')
        const first = selectedNames([a, b, c], sizesOf([[a, 10], [b, 11], [c, 12], [other, 10]]))
        expect(first).toEqual([])
        const second = selectedNames([other], sizesOf([[a, 10], [other, 10]]))
        expect(second).toEqual([])
    })

    test('a same-name group is selected whatever the sizes', () => {
        const x1 = rowOf('x'), x2 = rowOf('x'), y = rowOf('y')
        expect(selectedNames([x1, x2, y], sizesOf([[x1, 5], [x2, 7], [y, 9]]))).toEqual([x1, x2])
    })

    test('names compare exactly, so a differently cased name is a different name', () => {
        const lower = rowOf('Smile.png'), upper = rowOf('smile.png')
        expect(selectedNames([lower, upper], sizesOf([[lower, 1], [upper, 2]]))).toEqual([])
    })

    test('size-unknown rows are hashed within their name groups only, never across names', () => {
        const x1 = rowOf('x'), x2 = rowOf('x'), y = rowOf('y'), z = rowOf('z')
        expect(selectedNames([x1, y, x2, z], sizesOf([[x1, null], [x2, null], [y, null], [z, null]]))).toEqual([x1, x2])
    })

    test('a size-unknown row does not pair with a known-size row of another name', () => {
        const u = rowOf('u'), k = rowOf('k')
        expect(selectedNames([u, k], sizesOf([[u, null], [k, 10]]))).toEqual([])
    })

    test('equal known sizes across different names are selected', () => {
        const smile = rowOf('smile.png'), smile2 = rowOf('smile2.png'), other = rowOf('other.png')
        expect(selectedNames([smile, smile2, other], sizesOf([[smile, 64], [smile2, 64], [other, 65]]))).toEqual([smile, smile2])
    })

    test('a pending size selects nothing and is not read as unknown', () => {
        const smile = rowOf('smile.png'), smile2 = rowOf('smile2.png')
        // Unique names: read as "unknown" the rows would select nothing, so only the pending kind tells them apart.
        expect(selectForHashing([smile, smile2], sizesOf([[smile, undefined], [smile2, undefined]]))).toEqual({ kind: 'pending' })
        expect(selectForHashing([smile, smile2], sizesOf([[smile, 64], [smile2, undefined]]))).toEqual({ kind: 'pending' })
        expect(selectForHashing([smile, smile2], new Map())).toEqual({ kind: 'pending' })
        expect(selectedNames([smile, smile2], sizesOf([[smile, 64], [smile2, 64]]))).toEqual([smile, smile2])
    })

    test('an empty array selects nothing', () => {
        expect(selectForHashing([], new Map())).toEqual({ kind: 'selected', rows: [] })
    })
})
