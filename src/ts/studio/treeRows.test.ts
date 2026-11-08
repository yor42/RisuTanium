import { describe, expect, test } from 'vitest'
import { reuseUnchangedRows } from './treeRows'

interface Row {
    id: string
    label: string
    selected: boolean
    expanded: boolean
    detail?: string
    setSize: number
    posInSet: number
    tags: string[]
}

function rowOf(id: string, overrides: Partial<Row> = {}): Row {
    return { id, label: `label ${id}`, selected: false, expanded: false, setSize: 3, posInSet: 1, tags: ['a', 'b'], ...overrides }
}

function previousOf(rows: Row[]): ReadonlyMap<string, Row> {
    return reuseUnchangedRows(new Map(), rows).byId
}

describe('reuseUnchangedRows', () => {
    test('a row with every field equal keeps the previous object, tags included', () => {
        const first = [rowOf('r1'), rowOf('r2')]
        const second = [rowOf('r1'), rowOf('r2')]
        const { rows } = reuseUnchangedRows(previousOf(first), second)
        expect(rows[0]).toBe(first[0])
        expect(rows[1]).toBe(first[1])
    })

    test.each([
        ['selected', { selected: true }],
        ['expanded', { expanded: true }],
        ['label', { label: 'renamed' }],
        ['detail', { detail: '3 entries' }],
        ['setSize', { setSize: 4 }],
        ['posInSet', { posInSet: 2 }],
    ] satisfies [string, Partial<Row>][])('a changed %s gives the fresh object', (_field, change) => {
        const first = [rowOf('r1')]
        const fresh = rowOf('r1', change)
        const { rows } = reuseUnchangedRows(previousOf(first), [fresh])
        expect(rows[0]).toBe(fresh)
        expect(rows[0]).not.toBe(first[0])
    })

    test('tags of the same length and elements are reused, a different length or element is not', () => {
        const first = [rowOf('r1')]
        const previous = previousOf(first)
        expect(reuseUnchangedRows(previous, [rowOf('r1', { tags: ['a', 'b'] })]).rows[0]).toBe(first[0])
        const longer = rowOf('r1', { tags: ['a', 'b', 'c'] })
        expect(reuseUnchangedRows(previous, [longer]).rows[0]).toBe(longer)
        const other = rowOf('r1', { tags: ['a', 'x'] })
        expect(reuseUnchangedRows(previous, [other]).rows[0]).toBe(other)
    })

    test('a row that was not there before is the fresh object, and ids that are gone drop out of byId', () => {
        const first = [rowOf('r1'), rowOf('r2')]
        const added = rowOf('r3')
        const { rows, byId } = reuseUnchangedRows(previousOf(first), [rowOf('r2'), added])
        expect(rows[0]).toBe(first[1])
        expect(rows[1]).toBe(added)
        expect([...byId.keys()]).toEqual(['r2', 'r3'])
        expect(byId.get('r3')).toBe(added)
    })

    test('the rows come back in the order given', () => {
        const first = [rowOf('r1'), rowOf('r2'), rowOf('r3')]
        const { rows } = reuseUnchangedRows(previousOf(first), [rowOf('r3'), rowOf('r1')])
        expect(rows.map((entry) => entry.id)).toEqual(['r3', 'r1'])
        expect(rows[0]).toBe(first[2])
        expect(rows[1]).toBe(first[0])
    })
})
