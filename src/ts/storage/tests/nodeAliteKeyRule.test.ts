// @vitest-environment node
/**
 * The A-lite prefix, the scope of the Node server's retire operation, is held
 * twice: on the server (`server/node/aliteKeys.cjs`, CommonJS) and in the client
 * (`ALITE_PREFIX` and `isAliteKey` in `src/ts/storage/store/keyRules.ts`). A
 * retire the client allows must be one the server accepts and the other way
 * round, so both predicates run the same table here. These are agreement
 * checks of new code; there is no earlier behaviour to compare with.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { ALITE_PREFIX, isAliteKey } from 'src/ts/storage/store/keyRules'

interface AliteKeys {
    ALITE_PREFIX: string
    aliteKeyFromHex(hex: string): string | null
}

const server = createRequire(import.meta.url)('../../../../server/node/aliteKeys.cjs') as AliteKeys

const hex = (key: string) => Buffer.from(key, 'utf-8').toString('hex')

const TABLE: Array<[label: string, key: string, accepted: boolean]> = [
    ['a key under the prefix', 'alite/x', true],
    ['a nested key under the prefix', 'alite/ab/cd', true],
    ['a non-ASCII key under the prefix', 'alite/é한', true],
    ['a key of the longest allowed size', `alite/${'x'.repeat(111)}`, true],
    ['the bare prefix', 'alite/', false],
    ['the prefix without its slash', 'alite', false],
    ['a different case', 'Alite/x', false],
    ['a sibling prefix', 'alite2/x', false],
    ['a block key', 'blocks/head', false],
    ['the main file', 'database/database.bin', false],
    ['an asset', 'assets/x.png', false],
    ['the prefix in the middle', 'x/alite/y', false],
]

describe('the A-lite prefix is held identically by the server and the client', () => {
    test('the two constants are equal', () => {
        expect(server.ALITE_PREFIX).toBe(ALITE_PREFIX)
    })

    test.each(TABLE)('%s', (_label, key, accepted) => {
        expect(isAliteKey(key)).toBe(accepted)
        expect(server.aliteKeyFromHex(hex(key)) !== null).toBe(accepted)
        if (accepted) {
            expect(server.aliteKeyFromHex(hex(key))).toBe(key)
        }
    })

    test('the server reads the hex case-insensitively and refuses malformed hex', () => {
        expect(server.aliteKeyFromHex(hex('alite/x').toUpperCase())).toBe('alite/x')
        expect(server.aliteKeyFromHex('')).toBeNull()
        expect(server.aliteKeyFromHex(`${hex('alite/x')}0`)).toBeNull()
        expect(server.aliteKeyFromHex('zz')).toBeNull()
        expect(server.aliteKeyFromHex('__password')).toBeNull()
        expect(server.aliteKeyFromHex(`${hex('alite/')}ff`)).toBeNull()
    })

    test('the client refuses a key a lone surrogate would alias', () => {
        expect(isAliteKey('alite/a\uD800b')).toBe(false)
    })
})
