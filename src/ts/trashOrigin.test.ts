/**
 * The pure trash-origin module: what is recorded when a character is trashed, where a record puts it back, and how
 * records are matched and pruned. Every helper is total over any JSON a profile can hold. Titles beginning "guard:"
 * pin rules that have no earlier behaviour to fail against (the module is new).
 */
import { describe, expect, test } from 'vitest'
import type { folder } from './storage/database.svelte'
import {
    captureOrigin, findOrigin, folderIdCount, placeRestored, pruneOrigins, recordTrashOrigins, releaseTrashOrigin,
    withOrigin, withoutOrigin, type TrashOrigin,
} from './trashOrigin'

type OrderEntry = string | folder

const F = (id: string, ...data: string[]): folder => ({ id, name: id, color: '', data })

/** Entries a profile can hold that are neither an id nor a folder with a list. */
const junk = (): OrderEntry[] => [null, 5, { id: 'bad', data: 5 }, undefined] as unknown as OrderEntry[]

const placed = (order: OrderEntry[], record: TrashOrigin): OrderEntry[] => {
    placeRestored(order, record.chaId, record)
    return order
}

describe('guard: captureOrigin', () => {
    test('a top-level character records the entry before it', () => {
        expect(captureOrigin(['x', 'C', 'y'], 'C', 7)).toEqual({ chaId: 'C', t: 7, after: { char: 'x' } })
    })

    test('the first top-level character records no anchor', () => {
        expect(captureOrigin(['C', 'x'], 'C', 7)).toEqual({ chaId: 'C', t: 7 })
    })

    test('a top-level character after a folder records the folder id', () => {
        expect(captureOrigin([F('f1', 'a'), 'C'], 'C', 7)).toEqual({ chaId: 'C', t: 7, after: { folder: 'f1' } })
    })

    test('after a folder whose id is shared or empty, no record is made', () => {
        expect(captureOrigin([F('f1', 'a'), F('f1', 'b'), 'C'], 'C', 7)).toBeUndefined()
        expect(captureOrigin([F('', 'a'), 'C'], 'C', 7)).toBeUndefined()
    })

    test('inside a folder it records the folder and the member before it', () => {
        expect(captureOrigin(['x', F('f1', 'a', 'C', 'b')], 'C', 7)).toEqual({ chaId: 'C', t: 7, folder: 'f1', after: { char: 'a' } })
    })

    test('the first member of a folder records the folder and no anchor', () => {
        expect(captureOrigin([F('f1', 'C', 'b')], 'C', 7)).toEqual({ chaId: 'C', t: 7, folder: 'f1' })
    })

    test('a folder whose id is shared or empty gets no record', () => {
        expect(captureOrigin([F('f1', 'a', 'C'), F('f1', 'b')], 'C', 7)).toBeUndefined()
        expect(captureOrigin([F('', 'a', 'C')], 'C', 7)).toBeUndefined()
    })

    test('a folder the caller is about to dissolve gets no record, a top-level character still does', () => {
        const dissolving = F('f1', 'a', 'C')
        const order: OrderEntry[] = ['x', dissolving, 'C2']
        expect(captureOrigin(order, 'C', 7, [dissolving])).toBeUndefined()
        expect(captureOrigin(order, 'C2', 7, [dissolving])).toEqual({ chaId: 'C2', t: 7, after: { folder: 'f1' } })
    })

    test('an id that is not ordered gets no record', () => {
        expect(captureOrigin(['x'], 'C', 7)).toBeUndefined()
        expect(captureOrigin(undefined, 'C', 7)).toBeUndefined()
    })

    test('only the first occurrence of an id counts', () => {
        expect(captureOrigin(['x', 'C', F('f1', 'a', 'C')], 'C', 7)).toEqual({ chaId: 'C', t: 7, after: { char: 'x' } })
    })

    test('a non-finite t or an empty id gets no record', () => {
        expect(captureOrigin(['x', 'C'], 'C', Number.NaN)).toBeUndefined()
        expect(captureOrigin(['x', 'C'], 'C', Number.POSITIVE_INFINITY)).toBeUndefined()
        expect(captureOrigin(['x', 'C'], 'C', '7' as unknown as number)).toBeUndefined()
        expect(captureOrigin(['', 'x'], '', 7)).toBeUndefined()
    })

    test('entries that are neither an id nor a folder with a list are skipped, never read through', () => {
        const order: OrderEntry[] = [...junk(), 'x', ...junk(), 'C']
        expect(captureOrigin(order, 'C', 7)).toEqual({ chaId: 'C', t: 7, after: { char: 'x' } })
        expect(captureOrigin([...junk(), 'C'], 'C', 7)).toEqual({ chaId: 'C', t: 7 })
        expect(captureOrigin([F('f1', 'a', 'C'), ...junk()], 'C', 7)).toEqual({ chaId: 'C', t: 7, folder: 'f1', after: { char: 'a' } })
    })

    test('a member of a folder whose list holds other values still finds the id and its text predecessor', () => {
        const odd = { id: 'f1', name: 'f1', color: '', data: [3, 'a', null, 'C'] } as unknown as folder
        expect(captureOrigin([odd], 'C', 7)).toEqual({ chaId: 'C', t: 7, folder: 'f1', after: { char: 'a' } })
    })
})

describe('guard: folderIdCount', () => {
    test('counts folders with the id and nothing else', () => {
        expect(folderIdCount([F('f1', 'a'), F('f1', 'b'), F('f2', 'c'), 'f1', ...junk()], 'f1')).toBe(2)
        expect(folderIdCount(undefined, 'f1')).toBe(0)
    })
})

describe('guard: placeRestored', () => {
    test('after the anchor inside the recorded folder', () => {
        expect(placed(['x', F('f1', 'a', 'b')], { chaId: 'C', t: 1, folder: 'f1', after: { char: 'a' } })).toEqual(['x', F('f1', 'a', 'C', 'b')])
    })

    test('first in the folder when it was first', () => {
        expect(placed([F('f1', 'a', 'b')], { chaId: 'C', t: 1, folder: 'f1' })).toEqual([F('f1', 'C', 'a', 'b')])
    })

    test('folder present, anchor gone: the end of that folder', () => {
        expect(placed([F('f1', 'b')], { chaId: 'C', t: 1, folder: 'f1', after: { char: 'a' } })).toEqual([F('f1', 'b', 'C')])
    })

    test('folder gone: the top-level end', () => {
        expect(placed(['x', F('f2', 'a')], { chaId: 'C', t: 1, folder: 'f1', after: { char: 'a' } })).toEqual(['x', F('f2', 'a'), 'C'])
    })

    test('a folder id that is now shared, or empty: the top-level end, no folder edited', () => {
        expect(placed([F('f1', 'a'), F('f1', 'b')], { chaId: 'C', t: 1, folder: 'f1', after: { char: 'a' } })).toEqual([F('f1', 'a'), F('f1', 'b'), 'C'])
        expect(placed([F('', 'a')], { chaId: 'C', t: 1, folder: '', after: { char: 'a' } })).toEqual([F('', 'a'), 'C'])
    })

    test('top level: after the anchor character, after the anchor folder, first, or the end', () => {
        expect(placed(['x', 'y'], { chaId: 'C', t: 1, after: { char: 'x' } })).toEqual(['x', 'C', 'y'])
        expect(placed([F('f1', 'a'), 'y'], { chaId: 'C', t: 1, after: { folder: 'f1' } })).toEqual([F('f1', 'a'), 'C', 'y'])
        expect(placed(['x', 'y'], { chaId: 'C', t: 1 })).toEqual(['C', 'x', 'y'])
        expect(placed(['x', 'y'], { chaId: 'C', t: 1, after: { char: 'gone' } })).toEqual(['x', 'y', 'C'])
    })

    test('a top-level anchor that has since moved into a folder does not pull the id into it', () => {
        expect(placed([F('f1', 'x'), 'y'], { chaId: 'C', t: 1, after: { char: 'x' } })).toEqual([F('f1', 'x'), 'y', 'C'])
    })

    test('an anchor folder whose id is now shared sends the id to the end', () => {
        expect(placed([F('f1', 'a'), F('f1', 'b'), 'y'], { chaId: 'C', t: 1, after: { folder: 'f1' } })).toEqual([F('f1', 'a'), F('f1', 'b'), 'y', 'C'])
    })

    test('an id that is already ordered anywhere is not inserted again', () => {
        const topLevel: OrderEntry[] = ['x', 'C']
        expect(placed(topLevel, { chaId: 'C', t: 1, after: { char: 'x' } })).toEqual(['x', 'C'])
        const inside: OrderEntry[] = ['x', F('f1', 'C')]
        expect(placed(inside, { chaId: 'C', t: 1, after: { char: 'x' } })).toEqual(['x', F('f1', 'C')])
    })

    test('entries of an unexpected shape are skipped and a record of an unexpected shape sends the id to the end', () => {
        expect(placed([...junk(), 'x'], { chaId: 'C', t: 1, after: { char: 'x' } })).toEqual([...junk(), 'x', 'C'])
        const garbled = { chaId: 'C', t: 1, folder: 5, after: 'x' } as unknown as TrashOrigin
        expect(placed(['x', F('f1', 'a')], garbled)).toEqual(['x', F('f1', 'a'), 'C'])
        const hollow = { chaId: 'C', t: 1, after: null } as unknown as TrashOrigin
        expect(placed(['x'], hollow)).toEqual(['x', 'C'])
    })

    test('twins: forward-order restores of a bulk-trashed run keep their order', () => {
        const order: OrderEntry[] = [F('f1', 'a', 'b')]
        const a = captureOrigin([F('f1', 'a', 'A', 'B', 'b')], 'A', 1)!
        const b = captureOrigin([F('f1', 'a', 'A', 'B', 'b')], 'B', 1)!
        placed(order, a)
        placed(order, b)
        expect(order).toEqual([F('f1', 'a', 'A', 'B', 'b')])
    })
})

describe('guard: findOrigin, withOrigin, withoutOrigin', () => {
    const rec = (chaId: string, t: number): TrashOrigin => ({ chaId, t, after: { char: 'x' } })

    test('a record is found only by its chaId and its t', () => {
        const list = [rec('C', 1), rec('C', 2), rec('D', 1)]
        expect(findOrigin(list, 'C', 2)).toBe(list[1])
        expect(findOrigin(list, 'C', 3)).toBeUndefined()
        expect(findOrigin(list, 'E', 1)).toBeUndefined()
    })

    test('an undefined, non-number or non-finite t matches nothing, not even a record without t', () => {
        const list = [{ chaId: 'C' }, { chaId: 'C', t: Number.NaN }, rec('C', 1)] as unknown as TrashOrigin[]
        expect(findOrigin(list, 'C', undefined)).toBeUndefined()
        expect(findOrigin(list, 'C', Number.NaN)).toBeUndefined()
        expect(findOrigin(list, 'C', '1')).toBeUndefined()
    })

    test('a list that is not an array, or holds null and primitives, is read without a throw', () => {
        expect(findOrigin({}, 'C', 1)).toBeUndefined()
        expect(findOrigin('x', 'C', 1)).toBeUndefined()
        expect(findOrigin(undefined, 'C', 1)).toBeUndefined()
        expect(findOrigin([null, 5, 'x', rec('C', 1)], 'C', 1)).toEqual(rec('C', 1))
    })

    test('withOrigin replaces the record of the same chaId and t and keeps the rest, malformed entries included', () => {
        const list = [rec('C', 1), rec('C', 2), null, { foo: 1 }] as unknown as TrashOrigin[]
        const next = withOrigin(list, { chaId: 'C', t: 2, folder: 'f1' })
        expect(next).toEqual([rec('C', 1), null, { foo: 1 }, { chaId: 'C', t: 2, folder: 'f1' }])
        expect(list).toHaveLength(4)
    })

    test('withoutOrigin removes only the record of that chaId and t', () => {
        const list = [rec('C', 1), rec('C', 2), null, { foo: 1 }, { chaId: 'C' }] as unknown as TrashOrigin[]
        expect(withoutOrigin(list, 'C', 1)).toEqual([rec('C', 2), null, { foo: 1 }, { chaId: 'C' }])
    })
})

describe('guard: pruneOrigins', () => {
    const rec = (chaId: string, t: number): TrashOrigin => ({ chaId, t })

    test('drops well-formed records that no slot matches and keeps the ones that match', () => {
        const slots = [{ chaId: 'C', trashTime: 5 }, { chaId: 'D' }, { chaId: 'E', trashTime: 9 }]
        const next = pruneOrigins([rec('C', 5), rec('C', 4), rec('D', 5), rec('E', 9), rec('Z', 1)], slots)
        expect(next).toEqual([rec('C', 5), rec('E', 9)])
    })

    test('keeps records of an unexpected shape untouched', () => {
        const odd = [{ foo: 1 }, null, 5, 'x', { chaId: 'C' }, { chaId: 'C', t: '1' }, { chaId: 'C', t: Number.NaN }, { chaId: 7, t: 1 }] as unknown as TrashOrigin[]
        expect(pruneOrigins(odd, [])).toEqual(odd)
    })

    test('slots that are not objects, or carry no trashTime, are ignored', () => {
        expect(pruneOrigins([rec('C', 5)], [null, 5, 'x', { chaId: 'C' }, { trashTime: 5 }] as unknown[])).toEqual([])
    })

    test('returns a new array', () => {
        const list = [rec('C', 5)]
        expect(pruneOrigins(list, [{ chaId: 'C', trashTime: 5 }])).not.toBe(list)
    })
})

describe('guard: recordTrashOrigins and releaseTrashOrigin', () => {
    type Host = Parameters<typeof recordTrashOrigins>[0]
    const host = (over: { characters?: unknown, characterOrder?: unknown, trashOrigins?: unknown }): Host => ({
        characters: [], characterOrder: [], ...over,
    }) as unknown as Host

    test('records every trashed character against the unedited order and writes a new array', () => {
        const db = host({
            characterOrder: ['x', F('f1', 'a', 'A', 'B', 'b')],
            characters: [{ chaId: 'A', trashTime: 3 }, { chaId: 'B', trashTime: 3 }] as unknown as Host['characters'],
        })
        recordTrashOrigins(db, [{ chaId: 'A' }, { chaId: 'B' }], 3)
        expect(db.trashOrigins).toEqual([
            { chaId: 'A', t: 3, folder: 'f1', after: { char: 'a' } },
            { chaId: 'B', t: 3, folder: 'f1', after: { char: 'A' } },
        ])
    })

    test('the field is not created when nothing is recorded', () => {
        const db = host({ characterOrder: ['x'] })
        recordTrashOrigins(db, [{ chaId: 'gone' }], 3)
        expect('trashOrigins' in db).toBe(false)
    })

    test('a trashOrigins that is not an array is never read or written, by record or release', () => {
        for (const value of [{}, 'x', 5, null, true]) {
            const db = host({ characterOrder: ['x', 'C'], characters: [{ chaId: 'C', trashTime: 3 }] as unknown as Host['characters'], trashOrigins: value })
            recordTrashOrigins(db, [{ chaId: 'C' }], 3)
            releaseTrashOrigin(db, 'C', 3)
            expect(db.trashOrigins).toBe(value)
        }
    })

    test('recording prunes the records of characters that are no longer trashed, and keeps malformed ones', () => {
        const db = host({
            characterOrder: ['x', 'C'],
            characters: [{ chaId: 'C', trashTime: 3 }, { chaId: 'D' }] as unknown as Host['characters'],
            trashOrigins: [{ chaId: 'D', t: 1 }, { foo: 1 }, null, 5],
        })
        recordTrashOrigins(db, [{ chaId: 'C' }], 3)
        expect(db.trashOrigins).toEqual([{ foo: 1 }, null, 5, { chaId: 'C', t: 3, after: { char: 'x' } }])
    })

    test('a record for the same chaId and t is replaced, not doubled (twins trashed together share it)', () => {
        const db = host({
            characterOrder: ['x', 'C'],
            characters: [{ chaId: 'C', trashTime: 3 }, { chaId: 'C', trashTime: 3 }] as unknown as Host['characters'],
        })
        recordTrashOrigins(db, [{ chaId: 'C' }, { chaId: 'C' }], 3)
        expect(db.trashOrigins).toEqual([{ chaId: 'C', t: 3, after: { char: 'x' } }])
    })

    test('release removes the matched record and prunes; a twin trashed at another time keeps its record', () => {
        const db = host({
            characters: [{ chaId: 'C', trashTime: 2 }] as unknown as Host['characters'],
            trashOrigins: [{ chaId: 'C', t: 1 }, { chaId: 'C', t: 2 }, { chaId: 'Z', t: 9 }, { foo: 1 }],
        })
        releaseTrashOrigin(db, 'C', 1)
        expect(db.trashOrigins).toEqual([{ chaId: 'C', t: 2 }, { foo: 1 }])
    })

    test('release with no trashOrigins writes nothing', () => {
        const db = host({})
        releaseTrashOrigin(db, 'C', 1)
        expect('trashOrigins' in db).toBe(false)
    })
})
