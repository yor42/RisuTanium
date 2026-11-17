import { describe, expect, it } from 'vitest'
import { copyKey, keySlug, keysOfText, ownerStem, suggestKey } from './toggleKeys'
import { crlf } from './toggleDefFixtures.test-helpers'

describe('keySlug', () => {
    it('lower-cases and joins ASCII runs with underscores', () => {
        expect(keySlug('Combat Mode!')).toBe('combat_mode')
        expect(keySlug('  Hello,  World 2 ')).toBe('hello_world_2')
        expect(keySlug('!!!')).toBe('')
        expect(keySlug('')).toBe('')
    })

    it('drops non-ASCII letters instead of keeping them', () => {
        expect(keySlug('Ünï 2')).toBe('n_2')
        expect(keySlug('日本語')).toBe('')
    })
})

describe('suggestKey', () => {
    it('uses the slug when free and numbers from 2 while taken', () => {
        expect(suggestKey('Combat', new Set(), 'hero')).toBe('combat')
        expect(suggestKey('Combat', new Set(['combat']), 'hero')).toBe('combat_2')
        expect(suggestKey('Combat', new Set(['combat', 'combat_2']), 'hero')).toBe('combat_3')
    })

    it('uses the stem with the smallest free number from 1 when the slug is empty', () => {
        expect(suggestKey('!!!', new Set(), 'hero')).toBe('hero_t1')
        expect(suggestKey('', new Set(['hero_t1']), 'hero')).toBe('hero_t2')
        expect(suggestKey('日本', new Set(['hero_t1', 'hero_t2', 'hero_t4']), 'hero')).toBe('hero_t3')
    })

    it('compares keys exactly', () => {
        expect(suggestKey('Combat', new Set(['Combat']), 'hero')).toBe('combat')
    })
})

describe('copyKey', () => {
    it('appends _copy, then _copy_2 and up while taken', () => {
        expect(copyKey('a', new Set())).toBe('a_copy')
        expect(copyKey('a', new Set(['a_copy']))).toBe('a_copy_2')
        expect(copyKey('a', new Set(['a_copy', 'a_copy_2']))).toBe('a_copy_3')
    })
})

describe('ownerStem', () => {
    it('keeps whole words while the stem stays within 16 characters', () => {
        expect(ownerStem('Long Wizard Tower of Doom', 'id')).toBe('long_wizard')
        expect(ownerStem('abcdefg ijklmnop', 'id')).toBe('abcdefg_ijklmnop')
        expect(ownerStem('abcdefgh ijklmnop', 'id')).toBe('abcdefgh')
    })

    it('cuts a single first word longer than 16 characters to 16', () => {
        expect(ownerStem('Supercalifragilistic Name', 'id')).toBe('supercalifragili')
    })

    it('falls back to the id by the same rule, then to owner', () => {
        expect(ownerStem('', 'abc-123')).toBe('abc_123')
        expect(ownerStem('!!', 'longidentifier-12345')).toBe('longidentifier')
        expect(ownerStem('!!', '###')).toBe('owner')
        expect(ownerStem('', '')).toBe('owner')
    })
})

describe('keysOfText', () => {
    it('lists value row keys only', () => {
        const text = 'a=A\nb=B=text\nc=C=select=x,y\n=x=divider\n=n=caption\ng=G=group\nm=M\ng_end=G=groupEnd\njunk\n'
        expect([...keysOfText(text)]).toEqual(['a', 'b', 'c', 'm'])
    })

    it('reads CRLF text the same way and keeps keys exact', () => {
        expect([...keysOfText(crlf('a=A\nb =B\n'))]).toEqual(['a', 'b '])
    })

    it('returns each key once', () => {
        expect([...keysOfText('k=A\nk=B=text\n')]).toEqual(['k'])
    })
})
