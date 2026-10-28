import { describe, expect, test } from 'vitest'
import { externalEntryDecorators, placeDisabledMarker } from '../lorebookImportDecorators'

// Unit tests of the pure helpers; the converters' tests pin the whole imported objects.
describe('externalEntryDecorators', () => {
    test('an entry without the mapped fields gives no lines, keeps selective and is enabled', () => {
        expect(externalEntryDecorators({})).toEqual({ lines: [], selective: false, disabled: false })
        expect(externalEntryDecorators({ selective: true })).toEqual({ lines: [], selective: true, disabled: false })
    })

    test('disabled is disable true or enabled false only', () => {
        expect(externalEntryDecorators({ disable: true }).disabled).toBe(true)
        expect(externalEntryDecorators({ enabled: false }).disabled).toBe(true)
        expect(externalEntryDecorators({ disable: false, enabled: true }).disabled).toBe(false)
        expect(externalEntryDecorators({ disable: undefined, enabled: undefined }).disabled).toBe(false)
    })

    test('probability needs useProbability and a finite number other than 100', () => {
        expect(externalEntryDecorators({ useProbability: true, probability: 40 }).lines).toEqual(['@@probability 40'])
        expect(externalEntryDecorators({ useProbability: true, probability: 100 }).lines).toEqual([])
        expect(externalEntryDecorators({ useProbability: true, probability: NaN }).lines).toEqual([])
        expect(externalEntryDecorators({ useProbability: true, probability: Infinity }).lines).toEqual([])
        expect(externalEntryDecorators({ useProbability: true, probability: null }).lines).toEqual([])
        expect(externalEntryDecorators({ useProbability: false, probability: 40 }).lines).toEqual([])
    })

    test('position 1 maps to after_desc; other numbers and strings map to nothing', () => {
        expect(externalEntryDecorators({ position: 1 }).lines).toEqual(['@@position after_desc'])
        for (const position of [0, 2, 3, 5, 6, 7]) {
            expect(externalEntryDecorators({ position, depth: 2, role: 1 }).lines).toEqual([])
        }
        expect(externalEntryDecorators({ position: 'after_char' }).lines).toEqual([])
        expect(externalEntryDecorators({ position: null }).lines).toEqual([])
    })

    test('position 4 maps depth above 0 to reverse_depth and the rest to depth', () => {
        expect(externalEntryDecorators({ position: 4, depth: 2 }).lines).toEqual(['@@reverse_depth 2'])
        expect(externalEntryDecorators({ position: 4, depth: 0 }).lines).toEqual(['@@depth 0'])
        expect(externalEntryDecorators({ position: 4, depth: -3 }).lines).toEqual(['@@depth -3'])
        expect(externalEntryDecorators({ position: 4 }).lines).toEqual(['@@reverse_depth 4'])
        expect(externalEntryDecorators({ position: 4, depth: NaN }).lines).toEqual(['@@reverse_depth 4'])
        expect(externalEntryDecorators({ position: 4, depth: null }).lines).toEqual(['@@reverse_depth 4'])
    })

    test('position 4 adds a role line for 0, 1 and 2 only', () => {
        expect(externalEntryDecorators({ position: 4, depth: 1, role: 0 }).lines).toEqual(['@@reverse_depth 1', '@@role system'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: 1 }).lines).toEqual(['@@reverse_depth 1', '@@role user'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: 2 }).lines).toEqual(['@@reverse_depth 1', '@@role assistant'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: 3 }).lines).toEqual(['@@reverse_depth 1'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: -1 }).lines).toEqual(['@@reverse_depth 1'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: 1.5 }).lines).toEqual(['@@reverse_depth 1'])
        expect(externalEntryDecorators({ position: 4, depth: 1, role: null }).lines).toEqual(['@@reverse_depth 1'])
    })

    test('secondary-key logic 1, 2 and 3 needs selective and keys, and clears selective', () => {
        const base = { selective: true, secondary_keys: ['a', 'b'] }
        expect(externalEntryDecorators({ ...base, selectiveLogic: 1 })).toMatchObject({ lines: ['@@exclude_keys_all a,b'], selective: false })
        expect(externalEntryDecorators({ ...base, selectiveLogic: 2 })).toMatchObject({ lines: ['@@exclude_keys a', '@@exclude_keys b'], selective: false })
        expect(externalEntryDecorators({ ...base, selectiveLogic: 3 })).toMatchObject({ lines: ['@@additional_keys a', '@@additional_keys b'], selective: false })
        expect(externalEntryDecorators({ ...base, selectiveLogic: 0 })).toMatchObject({ lines: [], selective: true })
        expect(externalEntryDecorators({ ...base, selectiveLogic: 4 })).toMatchObject({ lines: [], selective: true })
        expect(externalEntryDecorators({ ...base, selective: false, selectiveLogic: 2 })).toMatchObject({ lines: [], selective: false })
        expect(externalEntryDecorators({ selective: true, secondary_keys: [], selectiveLogic: 2 })).toMatchObject({ lines: [], selective: true })
    })

    test('keysecondary is read when secondary_keys is absent', () => {
        expect(externalEntryDecorators({ selective: true, keysecondary: ['a'], selectiveLogic: 2 }))
            .toMatchObject({ lines: ['@@exclude_keys a'], selective: false })
    })

    test('lines come in the order probability, position, secondary keys', () => {
        expect(externalEntryDecorators({
            useProbability: true, probability: 30, position: 4, depth: 2, role: 1,
            selective: true, secondary_keys: ['a'], selectiveLogic: 3,
        }).lines).toEqual(['@@probability 30', '@@reverse_depth 2', '@@role user', '@@additional_keys a'])
    })
})

describe('placeDisabledMarker', () => {
    test('puts the marker before the first content line', () => {
        expect(placeDisabledMarker('BODY')).toBe('@@dont_activate\nBODY')
        expect(placeDisabledMarker('line one\nline two')).toBe('@@dont_activate\nline one\nline two')
    })

    test('puts the marker last in the leading decorator run', () => {
        expect(placeDisabledMarker('@@activate\nBODY')).toBe('@@activate\n@@dont_activate\nBODY')
        expect(placeDisabledMarker('@@reverse_depth 2\n@@role user\nBODY')).toBe('@@reverse_depth 2\n@@role user\n@@dont_activate\nBODY')
    })

    test('appends the marker as a new last line when every line is a decorator', () => {
        expect(placeDisabledMarker('@@role user\n@@activate')).toBe('@@role user\n@@activate\n@@dont_activate')
        expect(placeDisabledMarker('@@activate')).toBe('@@activate\n@@dont_activate')
    })

    test('an empty or non-string input gives the marker before an empty line', () => {
        expect(placeDisabledMarker('')).toBe('@@dont_activate\n')
        expect(placeDisabledMarker(null as unknown as string)).toBe('@@dont_activate\n')
        expect(placeDisabledMarker(undefined as unknown as string)).toBe('@@dont_activate\n')
    })

    test('a blank line ends the decorator run', () => {
        expect(placeDisabledMarker('@@activate\n\nBODY')).toBe('@@activate\n@@dont_activate\n\nBODY')
    })

    test('leading whitespace of the whole content is dropped, including a blank first line', () => {
        expect(placeDisabledMarker('\n@@activate\nBODY')).toBe('@@activate\n@@dont_activate\nBODY')
        expect(placeDisabledMarker('  \n  BODY')).toBe('@@dont_activate\nBODY')
    })

    test('an indented decorator line counts as a decorator and keeps its indentation', () => {
        expect(placeDisabledMarker('@@a\n  @@activate\nBODY')).toBe('@@a\n  @@activate\n@@dont_activate\nBODY')
    })

    test('carriage returns inside lines are kept', () => {
        expect(placeDisabledMarker('@@activate\r\nBODY\r\nMORE')).toBe('@@activate\r\n@@dont_activate\nBODY\r\nMORE')
    })

    test('@@@ fallback lines are decorator lines', () => {
        expect(placeDisabledMarker('@@depth abc\n@@@activate\nBODY')).toBe('@@depth abc\n@@@activate\n@@dont_activate\nBODY')
    })

    test('a line that only contains @@ later in the text is content', () => {
        expect(placeDisabledMarker('BODY @@activate')).toBe('@@dont_activate\nBODY @@activate')
    })
})
