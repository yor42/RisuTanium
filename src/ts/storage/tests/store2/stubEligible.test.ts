import { describe, expect, test } from 'vitest'
import { stubEligible } from '../../store2/codec/split'
import { ENTRY_FIELDS_VERSION, moduleHandles, uniqueIdHandles } from '../../store2/codec/modules'
import type { ModuleEntry } from '../../store2/format'

const VERSIONS = { asset: 3, inlay: 2 }

function entry(over: Partial<ModuleEntry> = {}): ModuleEntry {
    return {
        id: 'm1',
        name: 'Module one',
        description: '',
        hasToggle: false,
        dsp: true,
        unit: ['u-m1', 10, 1, ENTRY_FIELDS_VERSION],
        al: ['a-m1', 5, 2, VERSIONS.asset],
        il: ['i-m1', 5, 3, VERSIONS.inlay],
        ...over,
    }
}

const handlesOf = (...ids: string[]) => uniqueIdHandles(ids.map(id => ({ id })))

describe('stubEligible', () => {
    test('all five clauses true is eligible', () => {
        expect(stubEligible(entry(), handlesOf('m1'), VERSIONS)).toBe(true)
    })

    test('the handle clause: an id outside the unique-handle set is not eligible', () => {
        expect(stubEligible(entry(), handlesOf('other'), VERSIONS)).toBe(false)
        expect(stubEligible(entry(), new Set(), VERSIONS)).toBe(false)
    })

    test('the versions clause: a derivation without list versions is not eligible', () => {
        expect(stubEligible(entry(), handlesOf('m1'), undefined)).toBe(false)
    })

    test('the asset list clause: a stale or newer version is not eligible', () => {
        expect(stubEligible(entry({ al: ['a-m1', 5, 2, VERSIONS.asset - 1] }), handlesOf('m1'), VERSIONS)).toBe(false)
        expect(stubEligible(entry({ al: ['a-m1', 5, 2, VERSIONS.asset + 1] }), handlesOf('m1'), VERSIONS)).toBe(false)
    })

    test('the inlay list clause: no inlay list, or a version that is not current, is not eligible', () => {
        expect(stubEligible(entry({ il: null }), handlesOf('m1'), VERSIONS)).toBe(false)
        expect(stubEligible(entry({ il: ['i-m1', 5, 3, VERSIONS.inlay - 1] }), handlesOf('m1'), VERSIONS)).toBe(false)
    })

    test('the entry-fields clause: the tag absent, or not 1, is not eligible', () => {
        expect(stubEligible(entry({ unit: ['u-m1', 10, 1] }), handlesOf('m1'), VERSIONS)).toBe(false)
        expect(stubEligible(entry({ unit: ['u-m1', 10, 1, ENTRY_FIELDS_VERSION + 1] }), handlesOf('m1'), VERSIONS)).toBe(false)
    })

    test('an empty id is not eligible', () => {
        expect(stubEligible(entry({ id: '' }), handlesOf(''), VERSIONS)).toBe(false)
    })

    test('an id that starts with the positional prefix is not eligible', () => {
        expect(stubEligible(entry({ id: '~3' }), handlesOf('~3'), VERSIONS)).toBe(false)
    })

    test('a current list ref with a trailing element it does not know is eligible', () => {
        expect(stubEligible(entry({ il: ['i-m1', 5, 3, VERSIONS.inlay, 'future'] }), handlesOf('m1'), VERSIONS)).toBe(true)
    })

    test('a duplicate added later removes the id from the unique-handle set and so the eligibility', () => {
        expect(stubEligible(entry(), handlesOf('m1'), VERSIONS)).toBe(true)
        expect(stubEligible(entry(), handlesOf('m1', 'm1'), VERSIONS)).toBe(false)
    })

    test('the handle set of a list is built from the entries as moduleEntryFields reads them', () => {
        expect(moduleHandles([{ id: 'a' }, { id: 'a' }])).toEqual(['a#0', 'a#1'])
        expect([...uniqueIdHandles([{ id: 'a' }, { id: 'b' }, { id: 'b' }])]).toEqual(['a#0'])
    })
})
