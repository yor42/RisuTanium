import { describe, expect, test } from 'vitest'
import { orderAfterDrop } from './rowReorder'

describe('orderAfterDrop', () => {
    test('a row dropped after a mounted row lands right after it, past unmounted rows', () => {
        // rows 40..44 mounted of 100; row 40 dragged to the end of the mounted run
        expect(orderAfterDrop(100, 40, [null, 41, 42, 43, 44, 40, null])?.slice(38, 46)).toEqual([38, 39, 41, 42, 43, 44, 40, 45])
    })

    test('a row dropped at the top of the mounted run lands before the first mounted row', () => {
        expect(orderAfterDrop(100, 44, [null, 44, 40, 41, 42, 43, null])?.slice(38, 46)).toEqual([38, 39, 44, 40, 41, 42, 43, 45])
    })

    test('a plain list (no spacers) reorders as the DOM reads', () => {
        expect(orderAfterDrop(4, 0, [1, 2, 0, 3])).toEqual([1, 2, 0, 3])
    })

    test('a drop the DOM does not describe is refused', () => {
        expect(orderAfterDrop(4, 9, [0, 1, 2, 3])).toBeNull()
        expect(orderAfterDrop(4, 1, [null, 1, null])).toBeNull()
    })

    test('the result is a permutation', () => {
        const order = orderAfterDrop(100, 41, [null, 40, 42, 41, 43, null])!
        expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i))
    })
})
