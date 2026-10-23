/**
 * `splitLoreKeys` (`../loreKeys`): how a lorebook entry's key text becomes its
 * list of keys. Outside regex mode it is a plain comma split. In regex mode a
 * key that opens with `/` runs to the first closing `/flags` that is followed
 * by a comma or the end of the text, so a comma inside `/pattern/flags` stays
 * part of the pattern; a key that cannot be closed splits at its next comma.
 * Pieces are returned untrimmed, as a plain comma split returns them.
 *
 * Titles beginning "regression reproducer:" fail against a plain
 * `raw.split(',')`; titles beginning "guard:" pass before and after.
 */
import { describe, expect, test } from 'vitest'
import { splitLoreKeys } from '../loreKeys'

describe('splitLoreKeys outside regex mode', () => {
    test.each([
        ['a,b', ['a', 'b']],
        ['/a,b/', ['/a', 'b/']],
        ['', ['']],
        ['a,', ['a', '']],
    ])('guard: %j is a plain comma split', (raw, expected) => {
        expect(splitLoreKeys(raw, false)).toEqual(expected)
    })
})

describe('splitLoreKeys in regex mode', () => {
    test.each([
        ['/dragon{1,2}/', ['/dragon{1,2}/']],
        ['/a,b/i', ['/a,b/i']],
        ['/a,/i', ['/a,/i']],
        ['/a{1,2}/,/b{3,4}/i', ['/a{1,2}/', '/b{3,4}/i']],
        [' /a,b/', [' /a,b/']],
        ['/a/ , /b/', ['/a/ ', ' /b/']],
        ['/path, /other/', ['/path, /other/']],
        ['/a\\/,b/', ['/a\\/,b/']],
        ['/[/],x/', ['/[/],x/']],
        ['/[a/,b]/,c', ['/[a/,b]/', 'c']],
        ['/[\\]/],x/', ['/[\\]/],x/']],
        ['/a/i/', ['/a/i/']],
        ['/x/,y,/z,1/', ['/x/', 'y', '/z,1/']],
    ])('regression reproducer: %j keeps a comma inside /pattern/flags', (raw, expected) => {
        expect(splitLoreKeys(raw, true)).toEqual(expected)
    })

    test.each([
        ['/x/, /y/', ['/x/', ' /y/']],
        ['/dragon/,wolf', ['/dragon/', 'wolf']],
        ['wolf,/dragon/', ['wolf', '/dragon/']],
        ['/a/gi,b', ['/a/gi', 'b']],
        ['a,', ['a', '']],
        ['/a/,', ['/a/', '']],
        ['', ['']],
        ['/', ['/']],
        ['//', ['//']],
        ['and/or', ['and/or']],
        ['and/or,x', ['and/or', 'x']],
        ['http://a.b/c,d', ['http://a.b/c', 'd']],
    ])('guard: %j splits as a plain comma split would', (raw, expected) => {
        expect(splitLoreKeys(raw, true)).toEqual(expected)
        expect(splitLoreKeys(raw, true)).toEqual(raw.split(','))
    })

    test.each([
        ['/abc,def', ['/abc', 'def']],
        ['/a/z,b', ['/a/z', 'b']],
        ['/[abc/,x', ['/[abc/', 'x']],
    ])('guard: an unclosable key %j splits at its comma', (raw, expected) => {
        expect(splitLoreKeys(raw, true)).toEqual(expected)
    })

    test('guard: a list of complete comma-free /pattern/flags keys splits exactly as a comma split does', () => {
        for (const raw of ['/a/', '/a/,/b/i', '/a/gi, /b+/ ,/c[d]/s', '/^x$/,/y\\d/u,/(z|w)/m,/[a-c]{2}/d', '/a/v,/b/y']) {
            expect(splitLoreKeys(raw, true)).toEqual(raw.split(','))
        }
    })
})
