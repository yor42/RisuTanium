// @vitest-environment node
// The manifest.json rules of a v1 theme pack: discriminator first, version gate second, then the display and licence fields.
import { describe, expect, it } from 'vitest'
import { parseManifest, type ManifestResult, type PackManifest } from './manifest'
import { manifestText } from './fixtures/packBuilder'

function parse(overrides: Readonly<Record<string, unknown>> = {}, removed: readonly string[] = []): ManifestResult {
    return parseManifest(manifestText(overrides, removed))
}

function refusalOf(result: ManifestResult): unknown {
    return result.ok === false ? result.refusal : null
}

const FIELD = (field: string) => ({ code: 'manifestField', field })
const ABSENT_TILE = { main: { kind: 'absent' }, secondary: { kind: 'absent' }, icon: { kind: 'absent' } } as const

// A required key is one an object literal may not omit: `{}` is not assignable to the type picked from it.
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T]
// pnpm check fails here if `packId` becomes optional: `'packId' extends never` is false.
const packIdRequired: 'packId' extends RequiredKeys<PackManifest> ? true : false = true

describe('T1-25 manifest fields', () => {
    it('a complete manifest parses with every member written', () => {
        const result = parse({ id: 'author.pack-1', fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1', attribution: 'A. Author' }, { file: 'fonts/b.woff2', license: 'OFL-1.1' }] })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.manifest).toStrictEqual({
            format: 1,
            packId: 'author.pack-1',
            name: 'Test Pack',
            version: '1.0.0',
            license: 'MIT',
            attribution: 'Test author',
            modes: ['dark'],
            fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1', attribution: 'A. Author' }, { file: 'fonts/b.woff2', license: 'OFL-1.1' }],
            tile: ABSENT_TILE,
        })
    })

    it('an absent id gives an own packId key holding undefined', () => {
        const result = parse()
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(Object.hasOwn(result.manifest, 'packId')).toBe(true)
        expect(result.manifest).toStrictEqual({ format: 1, packId: undefined, name: 'Test Pack', version: '1.0.0', license: 'MIT', attribution: 'Test author', modes: ['dark'], fonts: [], tile: ABSENT_TILE })
    })

    it('the type-level guard holds: packId is a required key', () => {
        expect(packIdRequired).toBe(true)
    })

    it('each required field is named when missing, empty, whitespace-only or over-long', () => {
        const limits: Record<string, number> = { name: 80, version: 32, license: 4000, attribution: 4000 }
        for (const [key, limit] of Object.entries(limits)) {
            expect(refusalOf(parse({}, [key])), `${key} missing`).toEqual(FIELD(key))
            expect(refusalOf(parse({ [key]: '' })), `${key} empty`).toEqual(FIELD(key))
            expect(refusalOf(parse({ [key]: ' \t ' })), `${key} blank`).toEqual(FIELD(key))
            expect(refusalOf(parse({ [key]: 7 })), `${key} number`).toEqual(FIELD(key))
            expect(refusalOf(parse({ [key]: 'x'.repeat(limit + 1) })), `${key} long`).toEqual(FIELD(key))
            expect(parse({ [key]: 'x'.repeat(limit) }).ok, `${key} at the limit`).toBe(true)
        }
    })

    it('kind is judged before format', () => {
        expect(refusalOf(parse({ format: 2 }, ['kind']))).toEqual({ code: 'notThisKind' })
        expect(refusalOf(parse({ kind: 'other', format: 2 }))).toEqual({ code: 'notThisKind' })
    })

    it('format must be a safe integer of at least 1; a larger one is a newer format', () => {
        for (const format of ['1', 1.5, 0, -1, null, true]) {
            expect(refusalOf(parse({ format })), JSON.stringify(format)).toEqual(FIELD('format'))
        }
        expect(refusalOf(parse({}, ['format']))).toEqual(FIELD('format'))
        expect(refusalOf(parse({ format: 2 }))).toEqual({ code: 'newerFormat' })
        expect(refusalOf(parse({ format: 3 }))).toEqual({ code: 'newerFormat' })
    })

    it('an inherited kind does not count: only an own property is read', () => {
        const text = '{"__proto__":{"kind":"risutheme","format":1,"name":"n","version":"1","license":"l","attribution":"a","modes":["dark"]}}'
        expect(refusalOf(parseManifest(text))).toEqual({ code: 'notThisKind' })
    })

    it('unknown keys are ignored', () => {
        const result = parse({ colour: 'red', extra: { deep: true } })
        expect(result.ok).toBe(true)
        if (result.ok) expect(Object.keys(result.manifest).sort()).toEqual(['attribution', 'fonts', 'format', 'license', 'modes', 'name', 'packId', 'tile', 'version'])
    })

    describe('the optional tile fields (colors, icon)', () => {
        const tileOf = (overrides: Readonly<Record<string, unknown>>) => {
            const result = parse(overrides)
            expect(result.ok).toBe(true)
            return result.ok ? result.manifest.tile : ABSENT_TILE
        }

        it('colours are stored lower-case #rrggbb whatever their case or length', () => {
            expect(tileOf({ colors: { main: '#3366FF', secondary: '#36f' } })).toEqual({ main: { kind: 'ok', value: '#3366ff' }, secondary: { kind: 'ok', value: '#3366ff' }, icon: { kind: 'absent' } })
            expect(tileOf({ colors: { secondary: '#ABCDEF' } })).toEqual({ main: { kind: 'absent' }, secondary: { kind: 'ok', value: '#abcdef' }, icon: { kind: 'absent' } })
            expect(tileOf({ colors: {} })).toEqual(ABSENT_TILE)
            expect(tileOf({})).toEqual(ABSENT_TILE)
        })

        it('a colour written any other way is invalid and names its field, and parsing still succeeds', () => {
            for (const value of ['rgb(1,2,3)', '#3366ff80', '#3366f', 'red', 7, null, '', '3366ff']) {
                expect(tileOf({ colors: { main: value } }).main, JSON.stringify(value)).toEqual({ kind: 'invalid', field: 'colors.main' })
                expect(tileOf({ colors: { secondary: value } }).secondary, JSON.stringify(value)).toEqual({ kind: 'invalid', field: 'colors.secondary' })
            }
            for (const colors of ['#fff', 5, null, ['#fff'], true]) {
                const tile = tileOf({ colors })
                expect(tile.main, JSON.stringify(colors)).toEqual({ kind: 'invalid', field: 'colors' })
                expect(tile.secondary).toEqual({ kind: 'invalid', field: 'colors' })
            }
        })

        it('an icon is a string of 1 to 255 characters; anything else is invalid', () => {
            expect(tileOf({ icon: 'images/a.png' }).icon).toEqual({ kind: 'ok', value: 'images/a.png' })
            expect(tileOf({ icon: 'x'.repeat(255) }).icon.kind).toBe('ok')
            for (const icon of ['', 'x'.repeat(256), 7, null, ['a'], {}]) {
                expect(tileOf({ icon }).icon, JSON.stringify(icon)).toEqual({ kind: 'invalid', field: 'icon' })
            }
        })

        it('an inherited colors key does not count', () => {
            const text = '{"kind":"risutheme","format":1,"name":"n","version":"1","license":"l","attribution":"a","modes":["dark"],"__proto__":{"colors":{"main":"#fff"}}}'
            const result = parseManifest(text)
            expect(result.ok && result.manifest.tile).toEqual(ABSENT_TILE)
        })
    })

    it('a valid id becomes packId and an invalid one is named', () => {
        for (const id of ['a', 'risutanium.origin-navy', '0x', `a${'b'.repeat(63)}`]) {
            const result = parse({ id })
            expect(result.ok && result.manifest.packId, id).toBe(id)
        }
        for (const id of ['A', '', 7, null, '-a', '.a', 'a b', `a${'b'.repeat(64)}`]) {
            expect(refusalOf(parse({ id })), JSON.stringify(id)).toEqual(FIELD('id'))
        }
    })

    it('modes must be a non-empty list of light and dark without repeats', () => {
        expect(refusalOf(parse({ modes: [] }))).toEqual(FIELD('modes'))
        expect(refusalOf(parse({ modes: ['dark', 'dark'] }))).toEqual(FIELD('modes'))
        expect(refusalOf(parse({ modes: ['sepia'] }))).toEqual(FIELD('modes'))
        expect(refusalOf(parse({ modes: 'dark' }))).toEqual(FIELD('modes'))
        expect(refusalOf(parse({}, ['modes']))).toEqual(FIELD('modes'))
        const both = parse({ modes: ['light', 'dark'] })
        expect(both.ok && both.manifest.modes).toEqual(['light', 'dark'])
    })

    it('fonts entries are checked member by member', () => {
        expect(refusalOf(parse({ fonts: 'x' }))).toEqual(FIELD('fonts'))
        expect(refusalOf(parse({ fonts: [7] }))).toEqual(FIELD('fonts[0]'))
        expect(refusalOf(parse({ fonts: [{ license: 'OFL' }] }))).toEqual(FIELD('fonts[0].file'))
        expect(refusalOf(parse({ fonts: [{ file: 'fonts/a.woff2' }] }))).toEqual(FIELD('fonts[0].license'))
        expect(refusalOf(parse({ fonts: [{ file: 'f', license: 'OFL' }, { file: 'g', license: 'OFL', attribution: '' }] }))).toEqual(FIELD('fonts[1].attribution'))
        expect(refusalOf(parse({ fonts: Array.from({ length: 513 }, (_, i) => ({ file: `f${i}`, license: 'OFL' })) }))).toEqual(FIELD('fonts'))
        expect(parse({ fonts: Array.from({ length: 512 }, (_, i) => ({ file: `f${i}`, license: 'OFL' })) }).ok).toBe(true)
    })

    it('a manifest that is not an object is unreadable', () => {
        for (const text of ['[]', 'null', '"x"', '7', '{', '', '[[[[']) {
            expect(refusalOf(parseManifest(text)), text).toEqual({ code: 'manifestUnreadable' })
        }
    })

    it('a leading BOM is left to the caller: the text parser sees it as unreadable JSON', () => {
        expect(refusalOf(parseManifest(String.fromCharCode(0xFEFF) + manifestText()))).toEqual({ code: 'manifestUnreadable' })
    })

    it('name and version refuse control, line-end and bidi characters', () => {
        for (const bad of ['a\nb', 'a\u0007b', 'a\u007Fb', 'a\u0085b', `a${String.fromCharCode(0x2028)}b`, `a${String.fromCharCode(0x202E)}b`, `a${String.fromCharCode(0x2066)}b`]) {
            expect(refusalOf(parse({ name: bad })), `name ${JSON.stringify(bad)}`).toEqual(FIELD('name'))
        }
        for (const bad of ['1\t0', `1${String.fromCharCode(0x2069)}0`]) {
            expect(refusalOf(parse({ version: bad })), `version ${JSON.stringify(bad)}`).toEqual(FIELD('version'))
        }
    })

    it('every forbidden code point is refused in name and version, and its allowed neighbours are not', () => {
        const forbidden: number[] = []
        for (let c = 0x00; c <= 0x1F; c++) forbidden.push(c)
        for (let c = 0x7F; c <= 0x9F; c++) forbidden.push(c)
        for (const c of [0x2028, 0x2029]) forbidden.push(c)
        for (let c = 0x202A; c <= 0x202E; c++) forbidden.push(c)
        for (let c = 0x2066; c <= 0x2069; c++) forbidden.push(c)
        const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`
        for (const c of forbidden) {
            const bad = `a${String.fromCodePoint(c)}b`
            expect(refusalOf(parse({ name: bad })), `name ${hex(c)}`).toEqual(FIELD('name'))
            expect(refusalOf(parse({ version: bad })), `version ${hex(c)}`).toEqual(FIELD('version'))
        }
        const allowed = [0x20, 0xA0, 0x202F, 0x2065, 0x206A, 0x200E, 0x200B]
        for (const c of allowed) {
            const good = `a${String.fromCodePoint(c)}b`
            expect(parse({ name: good, version: good }).ok, hex(c)).toBe(true)
        }
    })

    it('license and attribution may hold line ends', () => {
        expect(parse({ license: 'line one\nline two', attribution: 'a\r\nb' }).ok).toBe(true)
        expect(parse({ fonts: [{ file: 'fonts/a.woff2', license: 'first\nsecond' }] }).ok).toBe(true)
    })
})

describe('T1-15 manifest limits', () => {
    it('64 KiB of nested arrays is unreadable, not a stack overflow', () => {
        expect(refusalOf(parseManifest('['.repeat(64 * 1024)))).toEqual({ code: 'manifestUnreadable' })
    })
})
