import { describe, expect, test } from 'vitest'
import { integrationNoteOf, integrationRefs, namespaceUnmatchable, readStored, sharedNamespaceNames } from './moduleNamespaceNotes'

describe('integrationRefs: the engine\'s own trim and comma split', () => {
    test('splits on commas and trims each entry; an empty text has none', () => {
        expect(integrationRefs('a, b ,c')).toEqual(['a', 'b', 'c'])
        expect(integrationRefs('')).toEqual([])
    })
})

describe('sharedNamespaceNames', () => {
    const rows = [{ name: 'A', namespace: 'x' }, { name: 'B', namespace: 'x' }, { name: 'C', namespace: 'y' }, { name: 5, namespace: 'x' }]
    test('lists the other modules with the same non-empty namespace, never the module itself', () => {
        expect(sharedNamespaceNames('x', rows, 0)).toEqual(['B', ''])
        expect(sharedNamespaceNames('y', rows, 2)).toEqual([])
    })
    test('an empty namespace is shared with nothing', () => {
        expect(sharedNamespaceNames('', [{ name: 'A', namespace: '' }, { name: 'B', namespace: '' }], 0)).toEqual([])
    })
})

describe('namespaceUnmatchable', () => {
    test('spaces at the ends or a comma inside make the namespace unfindable through Module Integration', () => {
        expect(namespaceUnmatchable(' x')).toBe(true)
        expect(namespaceUnmatchable('a,b')).toBe(true)
        expect(namespaceUnmatchable('x y')).toBe(false)
        expect(namespaceUnmatchable('')).toBe(false)
    })
})

describe('integrationNoteOf', () => {
    test('no landed write, or no change, gives no note', () => {
        expect(integrationNoteOf(null, 'a', 'a')).toBeNull()
        expect(integrationNoteOf('a', 'a', 'a')).toBeNull()
    })
    test('the new value listed: the module now turns on through it', () => {
        expect(integrationNoteOf('old', 'new', 'x, new')).toEqual({ kind: 'on', after: 'new' })
        expect(integrationNoteOf('old', 'new', 'old,new')).toEqual({ kind: 'on', after: 'new' })
    })
    test('only the old value listed: the module stops turning on through it', () => {
        expect(integrationNoteOf('old', 'new', ' old ')).toEqual({ kind: 'off', before: 'old', after: 'new' })
    })
    test('neither listed, and a foreign old value (none) listed nowhere, give no note', () => {
        expect(integrationNoteOf('old', 'new', 'other')).toBeNull()
        expect(integrationNoteOf('', 'new', 'a,,b')).toBeNull()
    })
})

describe('readStored: the stored (plain JSON) form decides the reading', () => {
    test('typed values read as themselves', () => {
        expect(readStored('a', 'text')).toEqual({ text: 'a', on: false, foreign: null })
        expect(readStored(true, 'bool')).toEqual({ text: '', on: true, foreign: null })
        expect(readStored(false, 'bool')).toEqual({ text: '', on: false, foreign: null })
    })
    test('absent, undefined and a function read as absent', () => {
        for (const raw of [undefined, () => 1]) expect(readStored(raw, 'text')).toEqual({ text: '', on: false, foreign: null })
    })
    test('another type is foreign: empty text, the engine\'s truthiness, and the JSON text', () => {
        expect(readStored(1, 'bool')).toEqual({ text: '', on: true, foreign: '1' })
        expect(readStored(0, 'bool')).toEqual({ text: '', on: false, foreign: '0' })
        expect(readStored(null, 'text')).toEqual({ text: '', on: false, foreign: 'null' })
        expect(readStored('yes', 'bool')).toEqual({ text: '', on: true, foreign: '"yes"' })
        expect(readStored({ x: 1 }, 'bool')).toEqual({ text: '', on: true, foreign: '{"x":1}' })
        // on is the truthiness of the stored value; a text field never reads it.
        expect(readStored(5, 'text')).toEqual({ text: '', on: true, foreign: '5' })
    })
    test('a long foreign value is cut to 80 characters with an ellipsis', () => {
        const read = readStored({ k: 'x'.repeat(200) }, 'text')
        expect(read.foreign).toHaveLength(81)
        expect(read.foreign!.endsWith('…')).toBe(true)
    })
    test('a value the codec cannot store reads as absent', () => {
        expect(readStored(10n, 'text')).toEqual({ text: '', on: false, foreign: null })
    })
})
