/**
 * Labels: (G) compatibility guard over a new module; backed by scratch mutants.
 */
import { describe, test, expect } from 'vitest'
import { usagePurposeOf } from './usagePurpose'

describe('usagePurposeOf (G)', () => {
    test('an explicit purpose wins over mainSend and the mode', () => {
        expect(usagePurposeOf({ usagePurpose: 'utility', mainSend: true }, 'model')).toBe('utility')
        expect(usagePurposeOf({ usagePurpose: 'plugin' }, 'memory')).toBe('plugin')
    })

    test('mainSend without an explicit purpose is chat', () => {
        expect(usagePurposeOf({ mainSend: true }, 'model')).toBe('chat')
    })

    test('otherwise the mode code', () => {
        for (const mode of ['model', 'submodel', 'memory', 'emotion', 'otherAx', 'translate'] as const) {
            expect(usagePurposeOf({}, mode)).toBe(mode)
            expect(usagePurposeOf({ mainSend: false }, mode)).toBe(mode)
        }
    })
})
