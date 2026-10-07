/**
 * The names and headers of the inlay entries of a local backup. Synthetic ids
 * only.
 */
import { describe, expect, test } from 'vitest'
import { getColdStorageBackupKey } from 'src/ts/process/coldstorageData'
import {
    FIRST_PART_BODY_MAX,
    MAX_HEADER_BYTES,
    PART_DATA_MAX,
    encodeInlayHeader,
    headerLengthOf,
    inlayEntryName,
    inlayIdHash,
    parseInlayEntryName,
    parseInlayHeader,
    partsFor,
    type InlayEntryHeader,
} from '../inlayBackupCodec'

/** Upstream's cold-storage entry-name test, as it reads a backup entry. */
const UPSTREAM_COLD_NAME = /^(?:coldstorage[/_])?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/

const IDS = [
    '11111111-2222-3333-4444-555555555555',
    `assets/${'a'.repeat(64)}.png`,
    '\ud800',
    '\udc00',
    '�',
    'x'.repeat(4000),
    'Abc',
    'abc',
    'a/b\\c',
    'database.risudat',
    '.hidden',
    'name with spaces ',
    '',
]

describe('inlay entry names', () => {
    test('every id maps to a flat name of lowercase letters, digits, hyphens and dots that no reader mistakes for another kind of entry', async () => {
        for (const id of IDS) {
            for (const index of [0, 1, 12, 999]) {
                const name = inlayEntryName(await inlayIdHash(id), index)
                expect(name).toMatch(/^[a-z0-9.-]+$/)
                expect(name).not.toMatch(/(^\.|[. ]$)/)
                expect(name).not.toMatch(/^risu-write-[0-9a-f]{16}\.tmp$/)
                expect(name).not.toMatch(/^[0-9a-f]{64}\.[a-z0-9]+$/)
                expect(getColdStorageBackupKey(name)).toBeNull()
                expect(UPSTREAM_COLD_NAME.test(name)).toBe(false)
                expect(['database.risudat', 'encryption.risudat']).not.toContain(name)
                expect(name.length).toBeLessThan(255)
            }
        }
    })

    test('distinct ids and distinct part numbers give distinct names, lone surrogates and case differences included', async () => {
        const names = new Set<string>()
        for (const id of IDS) {
            for (const index of [0, 1, 2]) {
                names.add(inlayEntryName(await inlayIdHash(id), index))
            }
        }
        expect(names.size).toBe(IDS.length * 3)
    })

    test('a name parses back to its hash and part number, and a near miss does not parse', async () => {
        const hash = await inlayIdHash('some-id')
        expect(parseInlayEntryName(inlayEntryName(hash, 0))).toEqual({ hash, index: 0 })
        expect(parseInlayEntryName(inlayEntryName(hash, 1234567))).toEqual({ hash, index: 1234567 })
        for (const bad of [
            inlayEntryName(hash.toUpperCase(), 0),
            `risu-inlay-${hash}-01.part`,
            `risu-inlay-${hash}-12345678.part`,
            `risu-inlay-${hash}-0.part `,
            `risu-inlay-${hash.slice(1)}-0.part`,
            `${hash}.part`,
            `assets/${inlayEntryName(hash, 0)}`,
        ]) {
            expect(parseInlayEntryName(bad)).toBeNull()
        }
    })

    test('the hash is over UTF-16 code units: a lone surrogate and its replacement character differ', async () => {
        expect(await inlayIdHash('\ud800')).not.toBe(await inlayIdHash('�'))
        expect(await inlayIdHash('\ud800')).not.toBe(await inlayIdHash('\udc00'))
    })
})

describe('inlay entry headers', () => {
    const header: InlayEntryHeader = { v: 1, id: 'i', repr: 'blob', mime: 'image/png', fields: { name: 'n', ext: 'png', type: 'image' }, len: 10, parts: 1 }

    test('a header survives the trip through bytes, unknown extra fields included', () => {
        const withExtra: InlayEntryHeader = { ...header, fields: { ...header.fields, custom: { deep: [1, 2] } } }
        const bytes = encodeInlayHeader(withExtra)!
        expect(parseInlayHeader(bytes)).toEqual(withExtra)
    })

    test('a header that is too large for part 0 is not encoded', () => {
        expect(encodeInlayHeader({ ...header, fields: { blob: 'x'.repeat(MAX_HEADER_BYTES) } })).toBeNull()
    })

    test.each([
        ['an unknown version', { ...header, v: 2 }],
        ['no id', { ...header, id: undefined }],
        ['an unknown representation', { ...header, repr: 'bytes' }],
        ['fields that are not an object', { ...header, fields: [] }],
        ['a negative length', { ...header, len: -1 }],
        ['a fractional length', { ...header, len: 1.5 }],
        ['fewer parts than the length needs', { ...header, len: FIRST_PART_BODY_MAX + 1, parts: 1 }],
        ['no parts', { ...header, parts: 0 }],
        ['an absurd number of parts', { ...header, parts: 1e9 }],
    ])('%s is refused', (_title, value) => {
        expect(parseInlayHeader(new TextEncoder().encode(JSON.stringify(value)))).toBeNull()
    })

    test('bytes that are not JSON, or not UTF-8, are refused', () => {
        expect(parseInlayHeader(new TextEncoder().encode('{oops'))).toBeNull()
        expect(parseInlayHeader(new Uint8Array([0xff, 0xfe, 0x7b]))).toBeNull()
    })

    test('the length of a header is read from the first four bytes and refused when it cannot fit part 0', () => {
        expect(headerLengthOf(new Uint8Array([5, 0, 0, 0]))).toBe(5)
        expect(headerLengthOf(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull()
        expect(headerLengthOf(new Uint8Array([1, 0]))).toBeNull()
    })
})

describe('splitting a body into parts', () => {
    test('a body that fits part 0 is one part, and every further part holds at most PART_DATA_MAX bytes', () => {
        expect(partsFor(0)).toBe(1)
        expect(partsFor(FIRST_PART_BODY_MAX)).toBe(1)
        expect(partsFor(FIRST_PART_BODY_MAX + 1)).toBe(2)
        expect(partsFor(FIRST_PART_BODY_MAX + PART_DATA_MAX)).toBe(2)
        expect(partsFor(FIRST_PART_BODY_MAX + PART_DATA_MAX + 1)).toBe(3)
        expect(partsFor(200 * 1024 * 1024)).toBe(4)
    })

    test('part 0 leaves room for its length field and a header of the largest size', () => {
        expect(4 + MAX_HEADER_BYTES + FIRST_PART_BODY_MAX).toBeLessThanOrEqual(PART_DATA_MAX)
    })
})
