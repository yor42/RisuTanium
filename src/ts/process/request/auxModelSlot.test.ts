import { describe, expect, test } from 'vitest'
import { auxSlotModel } from './auxModelSlot'

describe('auxSlotModel', () => {
    const slots = { memory: 'm', emotion: 'e', translate: 't', otherAx: 'o' }

    test('a filled slot is returned for each of the four aux modes', () => {
        expect(auxSlotModel(slots, 'memory')).toBe('m')
        expect(auxSlotModel(slots, 'emotion')).toBe('e')
        expect(auxSlotModel(slots, 'translate')).toBe('t')
        expect(auxSlotModel(slots, 'otherAx')).toBe('o')
    })

    test('an empty slot gives an empty string', () => {
        expect(auxSlotModel({ ...slots, memory: '' }, 'memory')).toBe('')
    })

    test('the model and submodel modes and stray keys are never routed', () => {
        const stray = { ...slots, model: 'x', submodel: 'y', other: 'z' } as unknown as Parameters<typeof auxSlotModel>[0]

        expect(auxSlotModel(stray, 'model')).toBe('')
        expect(auxSlotModel(stray, 'submodel')).toBe('')
        expect(auxSlotModel(stray, 'other')).toBe('')
    })

    test('a missing object gives an empty string', () => {
        expect(auxSlotModel(undefined, 'memory')).toBe('')
        expect(auxSlotModel(null, 'memory')).toBe('')
    })

    test('a non-string stored value gives an empty string', () => {
        const odd = { ...slots, memory: 5 } as unknown as Parameters<typeof auxSlotModel>[0]

        expect(auxSlotModel(odd, 'memory')).toBe('')
    })
})
