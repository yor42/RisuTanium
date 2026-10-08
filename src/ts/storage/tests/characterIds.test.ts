import { describe, expect, test } from 'vitest'
import { characterIdProblem, isCharacterEntry, isMissingCharacterId, isUsableCharacterId } from '../characterIds'

describe('isUsableCharacterId (unit of the new predicate)', () => {
    test.each([
        ['an ordinary string', 'abc-123'],
        ['a uuid', '3f2b8c1e-9d7a-4c55-8e0b-1a2b3c4d5e6f'],
        ['a non-zero number', 5],
        ['a negative number', -3],
        ['a string of 255 bytes', 'x'.repeat(255)],
        ['multi-byte text within the limit', '캐릭터'.repeat(28)],
        ['a string that looks like a block name by case', 'Config'],
        ['a name of the root-like family', 'roots'],
        ['constructor', 'constructor'],
        ['toString', 'toString'],
        ['hasOwnProperty', 'hasOwnProperty'],
        ['a name with spaces', 'my character'],
    ])('accepts %s', (_label, id) => {
        expect(isUsableCharacterId(id)).toBe(true)
    })

    test.each([
        ['an empty string', ''],
        ['undefined', undefined],
        ['null', null],
        ['zero', 0],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['false', false],
        ['an object', {}],
        ['an array', ['a']],
        ['a Symbol', Symbol('a')],
        ['root', 'root'],
        ['config', 'config'],
        ['preset', 'preset'],
        ['modules', 'modules'],
        ['loadouts', 'loadouts'],
        ['plugins', 'plugins'],
        ['pluginStorage', 'pluginStorage'],
        ['__proto__', '__proto__'],
        ['256 bytes', 'x'.repeat(256)],
        ['multi-byte text over the limit', '캐'.repeat(86)],
        ['a lone high surrogate', 'a\ud800'],
        ['a lone low surrogate', '\udc00b'],
    ])('rejects %s', (_label, id) => {
        expect(isUsableCharacterId(id)).toBe(false)
    })
})

describe('characterIdProblem', () => {
    test('every falsy id is missing, a truthy unusable one is unusable', () => {
        for (const id of ['', undefined, null, 0, NaN, false]) {
            expect(isMissingCharacterId(id)).toBe(true)
            expect(characterIdProblem(id)).toBe('missing')
        }
        for (const id of ['preset', 'x'.repeat(300), {}, Symbol('s'), Infinity]) {
            expect(characterIdProblem(id)).toBe('unusable')
        }
        expect(characterIdProblem('fine')).toBeNull()
    })
})

describe('isCharacterEntry', () => {
    test('a non-null object that is not a list', () => {
        expect(isCharacterEntry({})).toBe(true)
        expect(isCharacterEntry({ chaId: 'a' })).toBe(true)
        for (const value of [null, undefined, 5, 'text', [], [1], true]) {
            expect(isCharacterEntry(value)).toBe(false)
        }
    })
})
