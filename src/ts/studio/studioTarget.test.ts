import { describe, expect, test } from 'vitest'
import { isStudioError, normalizeStudioKind, parseStudioTarget } from './studioTarget'

describe('2a studio target grammar', () => {
    test('owner, kind, item and from are read', () => {
        expect(parseStudioTarget('owner=character:abc&kind=lore&item=abc/lore:3&from=chat')).toEqual({
            owner: { type: 'character', id: 'abc' },
            kind: 'lore',
            item: 'abc/lore:3',
            from: 'chat',
        })
    })

    test('every owner type parses and a leading question mark is allowed', () => {
        for (const type of ['character', 'chat', 'preset', 'module', 'plugin'] as const) {
            expect(parseStudioTarget(`?owner=${type}:x`)).toEqual({ owner: { type, id: 'x' } })
        }
    })

    test('the id keeps further colons and percent escapes are decoded', () => {
        expect(parseStudioTarget('owner=module:a%3Ab:c')).toEqual({ owner: { type: 'module', id: 'a:b:c' } })
    })

    test('the spec aliases map to their kinds and other names stay as written', () => {
        expect(normalizeStudioKind('lua')).toBe('scripts')
        expect(normalizeStudioKind('trigger')).toBe('scripts')
        expect(normalizeStudioKind('plugincode')).toBe('plugin')
        expect(normalizeStudioKind('lore')).toBe('lore')
        expect(parseStudioTarget('owner=character:a&kind=lua')).toEqual({ owner: { type: 'character', id: 'a' }, kind: 'scripts' })
        expect(parseStudioTarget('owner=plugin:p&kind=plugincode')).toEqual({ owner: { type: 'plugin', id: 'p' }, kind: 'plugin' })
        expect(parseStudioTarget('owner=character:a&kind=nonsense')).toEqual({ owner: { type: 'character', id: 'a' }, kind: 'nonsense' })
    })

    test('a kind or item without an owner is ignored', () => {
        expect(parseStudioTarget('kind=lore&item=x&from=library')).toEqual({ from: 'library' })
        expect(parseStudioTarget('')).toEqual({})
    })

    test('an unknown origin and unknown keys are ignored, the first value of a key wins', () => {
        expect(parseStudioTarget('owner=character:a&from=elsewhere&extra=1')).toEqual({ owner: { type: 'character', id: 'a' } })
        expect(parseStudioTarget('owner=character:a&owner=chat:b')).toEqual({ owner: { type: 'character', id: 'a' } })
    })

    test('malformed input is reported, not guessed', () => {
        for (const input of ['owner=character', 'owner=character:', 'owner=widget:1', 'owner=:1', 'owner=character:a&kind=', 'owner=character:a&item=', 'owner=%E0%A4%A', 'owner=character:a%']) {
            const result = parseStudioTarget(input)
            expect(isStudioError(result), input).toBe(true)
            expect(result).toEqual({ error: 'malformed' })
        }
    })
})
