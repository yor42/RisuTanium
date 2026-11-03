import { describe, expect, test } from 'vitest'
import { wavespeedLorasToWrite } from './wavespeedLoraSync'

const stored = [{ path: 'a', scale: 1 }, { path: 'b', scale: 2 }]

describe('wavespeedLorasToWrite', () => {
    test('a scale-only change is written', () => {
        const slots = [{ path: 'a', scale: 1 }, { path: 'b', scale: 3 }]
        expect(wavespeedLorasToWrite(slots, stored)).toEqual(slots)
    })

    test('a path-only change is written', () => {
        const slots = [{ path: 'a', scale: 1 }, { path: 'c', scale: 2 }]
        expect(wavespeedLorasToWrite(slots, stored)).toEqual(slots)
    })

    test('an equal list is not written, empty slots notwithstanding', () => {
        const slots = [{ path: 'a', scale: 1 }, { path: '', scale: 1 }, { path: 'b', scale: 2 }, { path: '  ', scale: 1 }]
        expect(wavespeedLorasToWrite(slots, stored)).toBeNull()
    })

    test('a stored undefined is always written', () => {
        expect(wavespeedLorasToWrite([], undefined)).toEqual([])
        expect(wavespeedLorasToWrite([{ path: 'a', scale: 1 }], undefined)).toEqual([{ path: 'a', scale: 1 }])
    })

    test('a length change is written', () => {
        expect(wavespeedLorasToWrite([{ path: 'a', scale: 1 }], stored)).toEqual([{ path: 'a', scale: 1 }])
        expect(wavespeedLorasToWrite([...stored, { path: 'c', scale: 1 }], stored)).toEqual([...stored, { path: 'c', scale: 1 }])
    })

    test('clearing every slot over a non-empty stored list writes an empty list', () => {
        expect(wavespeedLorasToWrite([{ path: '', scale: 1 }], stored)).toEqual([])
    })

    test('empty-path slots are filtered out of the written list and the result is a fresh copy', () => {
        const slots = [{ path: '', scale: 5 }, { path: 'x', scale: 4 }]
        const written = wavespeedLorasToWrite(slots, undefined)
        expect(written).toEqual([{ path: 'x', scale: 4 }])
        expect(written![0]).not.toBe(slots[1])
    })
})
