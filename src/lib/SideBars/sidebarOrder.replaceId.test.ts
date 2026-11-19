/**
 * NEW-charorder: `replaceOrderedId` puts a new id where the replaced character's id stood. Pure, never mutates its
 * input. Labels: G = guard for the helper's contract (the helper is new, so every row passes only with it).
 */
import { describe, expect, test } from 'vitest'
import { replaceOrderedId, type OrderEntry } from './sidebarOrder'
import type { folder } from 'src/ts/storage/database.svelte'

const f = (id: string, data: string[]): folder => ({ id, name: id, color: '', data })

describe('replaceOrderedId', () => {
    test('G: a top-level id is replaced at its position, other entries kept by reference', () => {
        const kept = f('f', ['x'])
        const order: OrderEntry[] = ['a', 'b', kept]
        const next = replaceOrderedId(order, 'b', 'c')
        expect(next).toEqual(['a', 'c', f('f', ['x'])])
        expect(next[2]).toBe(kept)
        expect(order).toEqual(['a', 'b', f('f', ['x'])])
    })

    test('G: an id inside a folder is replaced in a fresh copy of that folder only', () => {
        const inner = f('f', ['x', 'b', 'y'])
        const order: OrderEntry[] = ['a', inner]
        const next = replaceOrderedId(order, 'b', 'c')
        expect(next).toEqual(['a', f('f', ['x', 'c', 'y'])])
        expect(next[1]).not.toBe(inner)
        expect(inner.data).toEqual(['x', 'b', 'y'])
    })

    test('G: only the first entry naming the old id changes', () => {
        const order: OrderEntry[] = [f('f', ['b']), 'b']
        expect(replaceOrderedId(order, 'b', 'c')).toEqual([f('f', ['c']), 'b'])
    })

    test('G: the same reference is returned when nothing is to change', () => {
        const order: OrderEntry[] = ['a', f('f', ['c'])]
        expect(replaceOrderedId(order, 'missing', 'z')).toBe(order)
        expect(replaceOrderedId(order, 'a', 'c')).toBe(order)
        expect(replaceOrderedId(order, 'a', 'a')).toBe(order)
    })

    test('G: null entries and folders without a data list are passed over and kept', () => {
        const odd = { id: 'odd', name: 'odd', color: '' } as unknown as folder
        const order: OrderEntry[] = [null, odd, 'b']
        const next = replaceOrderedId(order, 'b', 'c')
        expect(next).toEqual([null, odd, 'c'])
        expect(next[1]).toBe(odd)
    })
})
