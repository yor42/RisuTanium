import { describe, expect, test } from 'vitest'
import { createGreetingRowKeys, type GreetingRow } from './greetingRowKeys'

const ids = (rows: readonly GreetingRow[]): number[] => rows.map((row) => row.id)
const texts = (rows: readonly GreetingRow[]): string[] => rows.map((row) => row.text)

describe('H1 a delete keeps every other id', () => {
    test.each([
        ['front', 0],
        ['middle', 2],
        ['end', 4],
    ])('delete at the %s', (_name, at) => {
        const keys = createGreetingRowKeys()
        const list = ['a', 'b', 'c', 'd', 'e']
        const before = keys.rows(list)
        const after = keys.rows(list.filter((_item, i) => i !== at))
        expect(ids(after)).toEqual(ids(before).filter((_id, i) => i !== at))
        expect(texts(after)).toEqual(list.filter((_item, i) => i !== at))
    })
})

describe('H2 an insert mints exactly one new id', () => {
    test.each([
        ['front', 0],
        ['middle', 2],
        ['end', 4],
    ])('insert at the %s', (_name, at) => {
        const keys = createGreetingRowKeys()
        const list = ['a', 'b', 'c', 'd']
        const before = keys.rows(list)
        const grown = [...list.slice(0, at), 'new', ...list.slice(at)]
        const after = keys.rows(grown)
        const fresh = ids(after).filter((id) => !ids(before).includes(id))
        expect(fresh).toHaveLength(1)
        expect(ids(after).filter((_id, i) => i !== at)).toEqual(ids(before))
        expect(texts(after)).toEqual(grown)
    })
})

describe('H3 the same list returns the same array', () => {
    test('an identical list and an equal-content copy', () => {
        const keys = createGreetingRowKeys()
        const first = keys.rows(['a', 'b'])
        expect(keys.rows(['a', 'b'])).toBe(first)
        expect(keys.rows(['a', 'b'])).toBe(first)
    })

    test('the empty list before any rows and after an emptying', () => {
        const keys = createGreetingRowKeys()
        const empty = keys.rows([])
        expect(empty).toHaveLength(0)
        expect(keys.rows([])).toBe(empty)
        keys.rows(['a'])
        expect(keys.rows([])).toHaveLength(0)
    })
})

describe('H4 a deleted string that comes back gets a fresh id', () => {
    test('delete then reinsert', () => {
        const keys = createGreetingRowKeys()
        const before = keys.rows(['a', 'b', 'c'])
        keys.rows(['b', 'c'])
        const back = keys.rows(['a', 'b', 'c'])
        expect(ids(back).slice(1)).toEqual(ids(before).slice(1))
        expect(ids(before)).not.toContain(back[0].id)
    })
})

describe('H5 an in-row edit keeps the id', () => {
    test('one row edited', () => {
        const keys = createGreetingRowKeys()
        const before = keys.rows(['a', 'b', 'c'])
        const after = keys.rows(['a', 'b edited', 'c'])
        expect(ids(after)).toEqual(ids(before))
        expect(texts(after)).toEqual(['a', 'b edited', 'c'])
    })

    test('an equal-length list with several changes keeps every id', () => {
        const keys = createGreetingRowKeys()
        const before = keys.rows(['a', 'b', 'c', 'd'])
        const after = keys.rows(['a', 'x', 'y', 'd'])
        expect(ids(after)).toEqual(ids(before))
        expect(texts(after)).toEqual(['a', 'x', 'y', 'd'])
    })

    test('a row edited to equal a neighbour keeps its id', () => {
        const keys = createGreetingRowKeys()
        const before = keys.rows(['x', 'y'])
        expect(ids(keys.rows(['x', 'x']))).toEqual(ids(before))
        expect(ids(keys.rows(['y', 'x']))).toEqual(ids(before))
    })
})

describe('H6 duplicates and empty strings stay separate rows', () => {
    test('equal strings keep distinct ids and the count', () => {
        const keys = createGreetingRowKeys()
        const rows = keys.rows(['x', 'x', '', '', 'y'])
        expect(new Set(ids(rows)).size).toBe(5)
        const after = keys.rows(['x', '', '', 'y'])
        expect(texts(after)).toEqual(['x', '', '', 'y'])
        expect(new Set(ids(after)).size).toBe(4)
    })
})

describe('H7 unchanged rows are the same objects', () => {
    test('after an edit elsewhere', () => {
        const keys = createGreetingRowKeys()
        const before = keys.rows(['a', 'b', 'c'])
        const after = keys.rows(['a', 'b edited', 'c'])
        expect(after).not.toBe(before)
        expect(after[0]).toBe(before[0])
        expect(after[2]).toBe(before[2])
        expect(after[1]).not.toBe(before[1])
    })
})

// A small seeded generator, so a failing sequence replays.
function seeded(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
}

describe('H8 random splices and sets', () => {
    test('length, unique ids and order hold; one splice of distinct strings keeps untouched ids', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const random = seeded(seed)
            const pick = (n: number): number => Math.floor(random() * n)
            const keys = createGreetingRowKeys()
            let tag = 0
            // Even seeds draw from three values, which forces duplicates; odd seeds never repeat a string.
            const fresh = (): string => (seed % 2 === 0 ? `dup${pick(3)}` : `s${tag++}`)
            let list: string[] = Array.from({ length: pick(6) }, fresh)
            let rows = keys.rows(list)
            for (let step = 0; step < 60; step++) {
                const before = rows
                const kind = pick(3)
                let removedAt = -1
                let insertedAt = -1
                if (kind === 0 && list.length > 0) {
                    removedAt = pick(list.length)
                    list = list.filter((_item, i) => i !== removedAt)
                } else if (kind === 1) {
                    insertedAt = pick(list.length + 1)
                    list = [...list.slice(0, insertedAt), fresh(), ...list.slice(insertedAt)]
                } else if (list.length > 0) {
                    const at = pick(list.length)
                    list = list.map((item, i) => (i === at ? fresh() : item))
                }
                rows = keys.rows(list)
                expect(rows).toHaveLength(list.length)
                expect(texts(rows)).toEqual(list)
                expect(new Set(ids(rows)).size).toBe(rows.length)
                // Surviving ids keep their relative order.
                const survivors = ids(rows).filter((id) => ids(before).includes(id))
                expect(survivors).toEqual(ids(before).filter((id) => survivors.includes(id)))
                // Odd seeds use distinct strings only, so a single splice must keep every untouched id.
                if (seed % 2 === 1 && removedAt >= 0) {
                    expect(ids(rows)).toEqual(ids(before).filter((_id, i) => i !== removedAt))
                }
                if (seed % 2 === 1 && insertedAt >= 0) {
                    expect(ids(rows).filter((_id, i) => i !== insertedAt)).toEqual(ids(before))
                }
            }
        }
    })
})

describe('H9 the stored strings follow every reconcile', () => {
    test('a list that goes back to an earlier shape is reconciled against the latest one', () => {
        const keys = createGreetingRowKeys()
        const first = keys.rows(['a', 'b', 'c'])
        keys.rows(['a', 'b'])
        const third = keys.rows(['a', 'b', 'c'])
        expect(ids(third).slice(0, 2)).toEqual(ids(first).slice(0, 2))
        expect(third[2].id).not.toBe(first[2].id)
    })
})
