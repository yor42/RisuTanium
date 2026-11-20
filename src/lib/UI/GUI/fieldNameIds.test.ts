import { describe, expect, test } from 'vitest'
import { fieldNameIds } from './fieldNameIds'

describe('fieldNameIds', () => {
    test('labelId names the field, lists itself first and needs no span', () => {
        expect(fieldNameIds('u', 'x', 'Lbl', 'h')).toEqual({ nameId: 'x', describedIds: 'x h', srOnly: false })
    })

    test('label alone derives a span id from the uid', () => {
        expect(fieldNameIds('u', undefined, 'Lbl', undefined)).toEqual({ nameId: 'u-label', describedIds: 'u-label', srOnly: true })
    })

    test('describedBy alone is kept and a blank label names nothing', () => {
        expect(fieldNameIds('u', undefined, '  ', 'h')).toEqual({ nameId: undefined, describedIds: 'h', srOnly: false })
        expect(fieldNameIds('u', undefined, '', undefined)).toEqual({ nameId: undefined, describedIds: undefined, srOnly: false })
    })
})
