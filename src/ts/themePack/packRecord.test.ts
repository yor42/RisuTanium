// The stored record of an installed theme pack and its reader (`packRecord.ts`). The reader is never stricter than the
// intake, never mutates what it reads, and refuses an `archive` that is not the one key form an install writes.
import { describe, expect, test } from 'vitest'
import { listThemePacks, readPackRecord, type PackReadResult } from './packRecord'

const HEX = 'ab'.repeat(32)
const ARCHIVE = `assets/tp-${HEX}.risutheme`

type Slot = Record<string, unknown>

/** A record as `installThemePack` writes it, written out by hand. */
function record(extra: Slot = {}): Slot {
    return {
        v: 1, id: 'pack-1', packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }, { file: 'fonts/b.woff2', license: 'OFL-1.1', attribution: 'B. Fonts' }],
        archive: ARCHIVE, bytes: 4096, installedAt: 1_700_000_000_000, ...extra,
    }
}

function without(...keys: string[]): Slot {
    const copy = record()
    for (const key of keys) {
        delete copy[key]
    }
    return copy
}

function failure(value: unknown): { reason: string, field?: string } {
    const result: PackReadResult = readPackRecord(value)
    expect(result.ok).toBe(false)
    if (result.ok === true) {
        throw new Error('The record was read.')
    }
    return { reason: result.reason, field: result.field }
}

describe('readPackRecord of a good record', () => {
    test('T2-20: the fixture reads ok and the result is a new object equal to it', () => {
        const stored = record()
        const result = readPackRecord(stored)

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.record).toStrictEqual(stored)
            expect(result.record).not.toBe(stored)
            expect(result.record.fonts[0]).not.toBe((stored.fonts as unknown[])[0])
        }
    })

    test('keys outside the record are ignored by the reader and stay in what it read from', () => {
        const stored = record({ futureKey: { n: [1] } })
        const before = JSON.stringify(stored)
        const result = readPackRecord(stored)

        expect(result.ok).toBe(true)
        expect(result.ok && Object.hasOwn(result.record, 'futureKey')).toBe(false)
        expect(JSON.stringify(stored)).toBe(before)
    })

    test('T2-20 undefined: an own undefined packId and an own undefined font attribution read as absent', () => {
        const stored = record({ packId: undefined, fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1', attribution: undefined }] })

        const result = readPackRecord(stored)

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(Object.hasOwn(result.record, 'packId')).toBe(false)
            expect(Object.hasOwn(result.record.fonts[0], 'attribution')).toBe(false)
            expect(result.record).toStrictEqual({
                v: 1, id: 'pack-1', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author', modes: ['light', 'dark'],
                fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive: ARCHIVE, bytes: 4096, installedAt: 1_700_000_000_000,
            })
        }
    })

    test('a record without a packId reads ok and has no packId key', () => {
        const result = readPackRecord(without('packId'))

        expect(result.ok).toBe(true)
        expect(result.ok && Object.hasOwn(result.record, 'packId')).toBe(false)
    })

    test('T2-20 lax id: a packId outside the intake\'s pattern still reads ok (the reader is never stricter than the intake)', () => {
        const result = readPackRecord(record({ packId: 'Upper_Case ID' }))

        expect(result.ok).toBe(true)
        expect(result.ok && result.record.packId).toBe('Upper_Case ID')
    })

    test('a record with no fonts and one mode reads ok', () => {
        const result = readPackRecord(record({ fonts: [], modes: ['dark'], bytes: 0, installedAt: 0 }))

        expect(result.ok).toBe(true)
    })

    test('the reader works on a reactive proxy of the record and does not change it', () => {
        const stored = record()
        const proxied = new Proxy(stored, {})

        expect(readPackRecord(proxied).ok).toBe(true)
        expect(stored).toStrictEqual(record())
    })
})

describe('readPackRecord of something that is not a good record', () => {
    test.each([
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
        ['a string', 'x'],
        ['a list', [record()]],
    ])('T2-20: %s is not an object', (_label, value) => {
        expect(failure(value)).toEqual({ reason: 'notAnObject', field: undefined })
    })

    test.each([
        ['an absent version', without('v')],
        ['version 2', record({ v: 2 })],
        ['version 0', record({ v: 0 })],
        ['a string version', record({ v: '1' })],
    ])('T2-20: %s is an unknown version, whatever else the entry holds', (_label, value) => {
        expect(failure(value)).toEqual({ reason: 'unknownVersion', field: undefined })
    })

    test.each([
        ['id', { id: '' }], ['id', { id: 5 }], ['id', { id: undefined }],
        ['name', { name: '' }], ['name', { name: 7 }],
        ['version', { version: '' }], ['license', { license: '' }], ['attribution', { attribution: '' }], ['attribution', { attribution: null }],
        ['packId', { packId: '' }], ['packId', { packId: 5 }], ['packId', { packId: null }],
        ['modes', { modes: [] }], ['modes', { modes: ['light', 'light'] }], ['modes', { modes: ['sepia'] }], ['modes', { modes: 'light' }], ['modes', { modes: undefined }],
        ['fonts', { fonts: 'fonts/a.woff2' }], ['fonts', { fonts: [null] }], ['fonts', { fonts: [{ file: 'a.woff2', license: 'OFL-1.1' }] }],
        ['fonts', { fonts: [{ file: 'fonts/a.woff2', license: '' }] }], ['fonts', { fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1', attribution: 3 }] }], ['fonts', { fonts: undefined }],
        ['bytes', { bytes: -1 }], ['bytes', { bytes: 1.5 }], ['bytes', { bytes: Number.MAX_SAFE_INTEGER + 2 }], ['bytes', { bytes: '4096' }], ['bytes', { bytes: Number.NaN }],
        ['installedAt', { installedAt: Number.NaN }], ['installedAt', { installedAt: Number.POSITIVE_INFINITY }], ['installedAt', { installedAt: '1' }],
    ])('T2-20: a bad %s (%j) names that field', (field, bad) => {
        expect(failure(record(bad))).toEqual({ reason: 'badField', field })
    })

    test.each([
        ['a user asset', 'assets/user-photo.png'],
        ['another extension', `assets/tp-${HEX}.png`],
        ['upper-case hex', `assets/tp-${HEX.toUpperCase()}.risutheme`],
        ['a sub-directory', `assets/sub/tp-${HEX}.risutheme`],
        ['a path above assets', `../assets/tp-${HEX}.risutheme`],
        ['a bare file name', `tp-${HEX}.risutheme`],
        ['a short hex', `assets/tp-${HEX.slice(1)}.risutheme`],
        ['an empty string', ''],
        ['a number', 5],
        ['nothing', undefined],
    ])('T2-20: an archive that is %s is refused, so a crafted record cannot point at an asset it did not install', (_label, archive) => {
        expect(failure(record({ archive }))).toEqual({ reason: 'badField', field: 'archive' })
    })
})

describe('listThemePacks', () => {
    test('every entry in order, readable or not, with its index and the value as stored', () => {
        const readable = record()
        const unreadable = { v: 99, future: true }
        const list = [readable, 'junk', unreadable, null]

        const entries = listThemePacks(list)

        expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3])
        expect(entries.map((entry) => entry.read.ok)).toEqual([true, false, false, false])
        expect(entries[0].entry).toBe(readable)
        expect(entries[2].entry).toBe(unreadable)
        expect(entries[2].read).toEqual({ ok: false, reason: 'unknownVersion' })
    })

    test.each([['absent', undefined], ['null', null], ['an object', {}], ['a string', 'x']])('%s gives no entries', (_label, value) => {
        expect(listThemePacks(value)).toEqual([])
    })
})
