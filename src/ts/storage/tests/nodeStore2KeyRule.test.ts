// @vitest-environment node
/**
 * The A-lite prefix, the scope of the Node server's retire operation, is held
 * twice: on the server (`server/node/store2Keys.cjs`, CommonJS) and in the client
 * (`STORE2_PREFIX` and `isStore2Key` in `src/ts/storage/store/keyRules.ts`). A
 * retire the client allows must be one the server accepts and the other way
 * round, so both predicates run the same table here. These are agreement
 * checks of new code; there is no earlier behaviour to compare with.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { NODE_MAX_WRITE_KEY_BYTES, STORE2_PREFIX, isStore2Key } from 'src/ts/storage/store/keyRules'

interface Store2Keys {
    STORE2_PREFIX: string
    store2KeyFromHex(hex: string): string | null
}

const server = createRequire(import.meta.url)('../../../../server/node/store2Keys.cjs') as Store2Keys

const hex = (key: string) => Buffer.from(key, 'utf-8').toString('hex')

const TABLE: Array<[label: string, key: string, accepted: boolean]> = [
    ['a key under the prefix', 'store2/x', true],
    ['a nested key under the prefix', 'store2/ab/cd', true],
    ['a non-ASCII key under the prefix', 'store2/é한', true],
    ['a key of the longest allowed size', `store2/${'x'.repeat(110)}`, true],
    ['the bare prefix', 'store2/', false],
    ['the top-level commit key', 'store2-commit', false],
    ['the top-level sweep key', 'store2-sweep', false],
    ['the top-level fence key', 'store2-fence', false],
    ['the prefix without its slash', 'store2', false],
    ['a different case', 'Store2/x', false],
    ['a sibling prefix', 'store22/x', false],
    ['a block key', 'blocks/head', false],
    ['the main file', 'database/database.bin', false],
    ['an asset', 'assets/x.png', false],
    ['the prefix in the middle', 'x/store2/y', false],
]

describe('the A-lite prefix is held identically by the server and the client', () => {
    test('the two constants are equal', () => {
        expect(server.STORE2_PREFIX).toBe(STORE2_PREFIX)
    })

    test.each(TABLE)('%s', (_label, key, accepted) => {
        expect(isStore2Key(key)).toBe(accepted)
        expect(server.store2KeyFromHex(hex(key)) !== null).toBe(accepted)
        if (accepted) {
            expect(server.store2KeyFromHex(hex(key))).toBe(key)
        }
    })

    test('the server reads the hex case-insensitively and refuses malformed hex', () => {
        expect(server.store2KeyFromHex(hex('store2/x').toUpperCase())).toBe('store2/x')
        expect(server.store2KeyFromHex('')).toBeNull()
        expect(server.store2KeyFromHex(`${hex('store2/x')}0`)).toBeNull()
        expect(server.store2KeyFromHex('zz')).toBeNull()
        expect(server.store2KeyFromHex('__password')).toBeNull()
        expect(server.store2KeyFromHex(`${hex('store2/')}ff`)).toBeNull()
    })

    test('the longest allowed key is exactly the write limit', () => {
        expect(Buffer.byteLength(`store2/${'x'.repeat(110)}`)).toBe(NODE_MAX_WRITE_KEY_BYTES)
    })

    test('the client refuses a key a lone surrogate would alias', () => {
        expect(isStore2Key('store2/a\uD800b')).toBe(false)
    })
})
