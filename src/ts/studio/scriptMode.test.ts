import { describe, expect, test } from 'vitest'
import { scriptModeOf } from './scriptMode'

describe('3f script mode', () => {
    test('triggerlua and triggercode read as lua', () => {
        expect(scriptModeOf([{ effect: [{ type: 'triggerlua' }] }])).toBe('lua')
        expect(scriptModeOf([{ effect: [{ type: 'triggercode' }] }])).toBe('lua')
    })

    test('a v2Header first effect reads as v2', () => {
        expect(scriptModeOf([{ effect: [{ type: 'v2Header' }, { type: 'v2SetVar' }] }])).toBe('v2')
    })

    test('any other first effect reads as v1', () => {
        expect(scriptModeOf([{ effect: [{ type: 'setvar' }] }])).toBe('v1')
        expect(scriptModeOf([{ effect: [] }])).toBe('v1')
        expect(scriptModeOf([{}])).toBe('v1')
    })

    test('a missing or empty list is empty, not v1', () => {
        expect(scriptModeOf([])).toBe('empty')
        expect(scriptModeOf(undefined)).toBe('empty')
        expect(scriptModeOf(null)).toBe('empty')
    })

    test('only the first trigger decides', () => {
        expect(scriptModeOf([{ effect: [{ type: 'setvar' }] }, { effect: [{ type: 'triggerlua' }] }])).toBe('v1')
    })
})
