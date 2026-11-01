import { describe, expect, test } from 'vitest'
import { importableTaskPresets, validateTaskPreset } from '../taskPreset'

/**
 * `importableTaskPresets` hands the page's live list to a `.bin` import. The list is a `$state` proxy, which
 * `structuredClone` refuses, so the helper must return plain copies that neither follow later edits nor lose a key.
 */

describe('importableTaskPresets', () => {
    test('regression reproducer: a $state list comes back as structured-cloneable plain objects that keep an unknown key', () => {
        const live = $state([
            { id: 'a', name: 'one', instructions: 'i', model: 'm', futureKey: { n: [1] } },
            { id: 'b', name: 'two', instructions: 'j', model: 'm' },
        ])

        const copy = importableTaskPresets(live)

        expect(() => structuredClone(copy)).not.toThrow()
        expect(copy).toEqual([
            { id: 'a', name: 'one', instructions: 'i', model: 'm', futureKey: { n: [1] } },
            { id: 'b', name: 'two', instructions: 'j', model: 'm' },
        ])
        expect(() => structuredClone(live)).toThrow()
    })

    test('regression reproducer: a later edit of the live list does not change the copy', () => {
        const live = $state([{ id: 'a', name: 'one', instructions: 'i', model: 'm' }])

        const copy = importableTaskPresets(live)
        live[0].name = 'edited'
        live.push({ id: 'c', name: 'new', instructions: 'k', model: 'm' })

        expect(copy).toEqual([{ id: 'a', name: 'one', instructions: 'i', model: 'm' }])
    })

    test('an absent or non-list value gives none, and an item that is not an object is left out', () => {
        expect(importableTaskPresets(undefined)).toEqual([])
        expect(importableTaskPresets(null)).toEqual([])
        expect(importableTaskPresets('x')).toEqual([])
        expect(importableTaskPresets({ id: 'a' })).toEqual([])
        expect(importableTaskPresets([1, null, 'x', [1], { id: 'a' }, undefined])).toEqual([{ id: 'a' }])
    })
})

describe('validateTaskPreset', () => {
    const good = { id: 'a', name: 'n', instructions: 'i', model: 'm' }

    test('a preset with the required fields is usable, with or without the optional ones', () => {
        expect(validateTaskPreset(good)).toEqual([])
        expect(validateTaskPreset({ ...good, temperature: 0, maxTokens: 1 })).toEqual([])
        expect(validateTaskPreset({ ...good, temperature: 2, maxTokens: 4096, futureKey: true })).toEqual([])
    })

    test.each([
        ['not an object', 'x'],
        ['a list', []],
        ['a missing name', { ...good, name: undefined }],
        ['a temperature above 2', { ...good, temperature: 2.1 }],
        ['a negative temperature', { ...good, temperature: -0.1 }],
        ['a temperature that is not a number', { ...good, temperature: '1' }],
        ['a fractional max token count', { ...good, maxTokens: 1.5 }],
        ['a zero max token count', { ...good, maxTokens: 0 }],
    ])('%s is reported', (_name, value) => {
        expect(validateTaskPreset(value).length).toBeGreaterThan(0)
    })

    test('the check reads only and never builds a new object, so an unknown key cannot be dropped by it', () => {
        const preset = { ...good, futureKey: { n: 1 } }
        validateTaskPreset(preset)
        expect(preset).toEqual({ ...good, futureKey: { n: 1 } })
    })
})
