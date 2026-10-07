// @vitest-environment node
/**
 * The asset route's key rule is written twice, once for the server
 * (`server/node/assetRoute.cjs`, CommonJS) and once for the client
 * (`nodeAssetRouteViolation` in `src/ts/storage/store/keyRules.ts`). The route
 * serves a key exactly when `urlFor` gives it a URL, so both predicates run the
 * same table here and must agree on every row.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { nodeAssetRouteViolation } from 'src/ts/storage/store/keyRules'

interface AssetRoute {
    assetKeyFromHex(hex: string): string | null
    isRouteServedKey(key: string): boolean
}

const assetRoute = createRequire(import.meta.url)('../../../../server/node/assetRoute.cjs') as AssetRoute

const HASH = 'a'.repeat(64)
const TOKEN = '0123456789abcdef'

const TABLE: Array<[label: string, key: string, served: boolean]> = [
    ['a hash-named asset', `assets/${HASH}.png`, true],
    ['an asset with no extension', 'assets/abc', true],
    ['an asset in a nested folder', 'assets/sub/dir/x.png', true],
    ['an asset with a non-ASCII name', 'assets/é한.png', true],
    ['an asset with a control character in the name', 'assets/x.jpg\u0001', true],
    ['an asset whose name holds a backslash', 'assets/x.v2\\smile', false],
    ['a dot-dot segment', 'assets/../database/database.bin', false],
    ['a trailing dot-dot segment', 'assets/..', false],
    ['a dot segment', 'assets/./x', false],
    ['an empty segment', 'assets//x', false],
    ['an empty last segment', 'assets/', false],
    ['the bare folder name', 'assets', false],
    ['the server password file', '__password', false],
    ['the main file', 'database/database.bin', false],
    ['a numbered backup', 'database/dbbackup-1700000000.bin', false],
    ['a remote block', 'remotes/abc.risuchar', false],
    ['a cold-storage unit', 'coldstorage/abc', false],
    ['an upper-case folder name', 'Assets/x.png', false],
    ['a leading space', ' assets/x.png', false],
    ['a lone surrogate', 'assets/a\uD800b', false],
    ['an inlay body key', `inlays/b-abc.${TOKEN}`, true],
    ['an inlay body key of an id with escapes', `inlays/b-%E3%81%82.${TOKEN}`, true],
    ['an inlay body key at the longest key length', `inlays/b-${'a'.repeat(117 - 'inlays/b-'.length - 17)}.${TOKEN}`, true],
    ['an inlay body key one byte over the longest key length', `inlays/b-${'a'.repeat(117 - 'inlays/b-'.length - 16)}.${TOKEN}`, false],
    ['an inlay metadata key', 'inlays/m-abc', false],
    ['the bare inlay body prefix', 'inlays/b-', false],
    ['an unknown key under inlays', 'inlays/x', false],
    ['the inlay folder', 'inlays/', false],
    ['an inlay body key with a dot-dot id', `inlays/b-../x.${TOKEN}`, false],
    ['an inlay body key with a path in the id', `inlays/b-a/b.${TOKEN}`, false],
    ['an inlay body key with a short token', `inlays/b-abc.${TOKEN.slice(1)}`, false],
    ['an inlay body key with a long token', `inlays/b-abc.${TOKEN}0`, false],
    ['an inlay body key with an upper-case token', `inlays/b-abc.${TOKEN.toUpperCase()}`, false],
    ['an inlay body key with a lower-case escape', `inlays/b-%e3.${TOKEN}`, false],
    ['an inlay body key with an upper-case letter in the id', `inlays/b-ABC.${TOKEN}`, false],
    ['an inlay body key with no id', `inlays/b-.${TOKEN}`, false],
    ['an inlay body key with a backslash', `inlays/b-a\\b.${TOKEN}`, false],
    ['an inlay body key with a lone surrogate', `inlays/b-a\uD800.${TOKEN}`, false],
    ['an inlay body key with a trailing newline', `inlays/b-abc.${TOKEN}\n`, false],
    ['an upper-case inlay folder name', `Inlays/b-abc.${TOKEN}`, false],
]

describe('the asset route key rule, server twin and client twin', () => {
    test.each(TABLE)('both twins agree on %s', (_label, key, served) => {
        expect(assetRoute.isRouteServedKey(key), `server: ${JSON.stringify(key)}`).toBe(served)
        expect(nodeAssetRouteViolation(key) === null, `client: ${JSON.stringify(key)}`).toBe(served)
    })
})

describe('the route decodes the URL hex into a key', () => {
    const hexOf = (key: string) => Buffer.from(key, 'utf-8').toString('hex')

    test('a lower-case hex of a served key decodes to that key', () => {
        expect(assetRoute.assetKeyFromHex(hexOf(`assets/${HASH}.png`))).toBe(`assets/${HASH}.png`)
    })

    test('a lower-case hex of an inlay body key decodes to that key, and the hex of an inlay metadata key is refused', () => {
        expect(assetRoute.assetKeyFromHex(hexOf(`inlays/b-%E3%81%82.${TOKEN}`))).toBe(`inlays/b-%E3%81%82.${TOKEN}`)
        expect(assetRoute.assetKeyFromHex(hexOf('inlays/m-abc'))).toBeNull()
    })

    test('an upper-case hex decodes to the same key as its lower-case form', () => {
        expect(assetRoute.assetKeyFromHex(hexOf('assets/x.png').toUpperCase())).toBe('assets/x.png')
    })

    test.each([
        ['an odd-length hex', hexOf('assets/x.png') + 'a'],
        ['a non-hex character', hexOf('assets/x.png').slice(0, -1) + 'g'],
        ['an empty string', ''],
        ['the password file name', '__password'],
        ['a hex with a dot', 'aa.bb'],
        ['hex bytes that are not UTF-8', hexOf('assets/x') + 'ff'],
        ['the hex of a key outside assets', hexOf('database/database.bin')],
        ['the hex of a dot-dot key', hexOf('assets/../x')],
    ])('refuses %s', (_label, hex) => {
        expect(assetRoute.assetKeyFromHex(hex)).toBeNull()
    })
})
