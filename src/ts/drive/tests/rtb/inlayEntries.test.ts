import { describe, test, expect } from 'vitest'
import type { InlayRecord } from 'src/ts/process/files/inlayStore'
import {
    RTB_INLAY_META_V,
    RtbInlayVersionError,
    decodeInlayMeta,
    encodeInlayMeta,
    pairInlayEntries,
} from 'src/ts/drive/rtb/inlayEntries'
import { inlayEntryName } from 'src/ts/drive/rtb/entryNames'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function record(over: Partial<InlayRecord> = {}): InlayRecord {
    return { v: 1, repr: 'blob', mime: 'image/png', len: 12, body: 'inlays/b-x.0123456789abcdef', fields: { name: 'pic.png', width: 3 }, ...over }
}

function metaBytes(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value))
}

const GOOD_META = { v: 1, repr: 'string', mime: 'text/plain', len: 5, fields: {} }

describe('encodeInlayMeta (T20, T20v)', () => {
    test('the meta is the record without its body key, with v from the codec constant', () => {
        const text = decoder.decode(encodeInlayMeta('id-1', record()))
        expect(JSON.parse(text)).toEqual({ v: 1, repr: 'blob', mime: 'image/png', len: 12, fields: { name: 'pic.png', width: 3 } })
        expect(text).not.toContain('inlays/b-x')
        expect(RTB_INLAY_META_V).toBe(1)
    })

    test('a record whose v is not the codec constant fails the export and names the inlay id', () => {
        const wrongVersion: number = 2
        const odd = { ...record(), v: wrongVersion } as unknown as InlayRecord
        expect(() => encodeInlayMeta('the-inlay', odd)).toThrow(RtbInlayVersionError)
        expect(() => encodeInlayMeta('the-inlay', odd)).toThrow(/the-inlay/)
    })

    test('a v of 1 is written as v 1 whatever else is in the record', () => {
        const text = decoder.decode(encodeInlayMeta('id', record({ repr: 'string16', len: 0 })))
        expect(JSON.parse(text).v).toBe(1)
    })

    test('fields a later app added to the record travel in the meta', () => {
        const later = { ...record(), futureField: { a: 1 } } as InlayRecord
        const meta = decodeInlayMeta(encodeInlayMeta('id', later))
        expect(meta.kind === 'ok' && meta.meta.unknown).toEqual({ futureField: { a: 1 } })
    })
})

describe('decodeInlayMeta (T20)', () => {
    test.each<[InlayRecord['repr']]>([['blob'], ['string'], ['string16']])('repr %s round-trips with its fields', (repr) => {
        const original = record({ repr, mime: repr === 'blob' ? 'image/webp' : 'text/plain', len: 7, fields: { a: [1, { b: null }], c: 'x' } })
        const decoded = decodeInlayMeta(encodeInlayMeta('id', original), 7)
        expect(decoded.kind).toBe('ok')
        if (decoded.kind !== 'ok') {
            return
        }
        expect(decoded.meta).toEqual({ v: 1, repr, mime: original.mime, len: 7, fields: original.fields, unknown: {} })
    })

    test('unknown top-level fields are kept', () => {
        const decoded = decodeInlayMeta(metaBytes({ ...GOOD_META, later: [1], other: 'x' }))
        expect(decoded.kind === 'ok' && decoded.meta.unknown).toEqual({ later: [1], other: 'x' })
    })

    test('meta v 2 is damaged, and so is any v other than the number 1', () => {
        for (const v of [2, 0, '1', null, 1.5]) {
            expect(decodeInlayMeta(metaBytes({ ...GOOD_META, v })).kind).toBe('damaged')
        }
    })

    test('a len that differs from the body size is damaged, and one that matches is accepted', () => {
        expect(decodeInlayMeta(metaBytes(GOOD_META), 6).kind).toBe('damaged')
        expect(decodeInlayMeta(metaBytes(GOOD_META), 4).kind).toBe('damaged')
        expect(decodeInlayMeta(metaBytes(GOOD_META), 5).kind).toBe('ok')
        expect(decodeInlayMeta(metaBytes(GOOD_META)).kind).toBe('ok')
    })

    test.each([
        ['not JSON', encoder.encode('{')],
        ['not an object', metaBytes([1])],
        ['not UTF-8', Uint8Array.of(0xFF)],
        ['a repr outside the three', metaBytes({ ...GOOD_META, repr: 'file' })],
        ['a missing repr', metaBytes({ ...GOOD_META, repr: undefined })],
        ['a mime that is not a string', metaBytes({ ...GOOD_META, mime: 1 })],
        ['a negative len', metaBytes({ ...GOOD_META, len: -1 })],
        ['a fractional len', metaBytes({ ...GOOD_META, len: 1.5 })],
        ['a len that is a string', metaBytes({ ...GOOD_META, len: '5' })],
        ['fields that are not an object', metaBytes({ ...GOOD_META, fields: [] })],
        ['missing fields', metaBytes({ ...GOOD_META, fields: undefined })],
    ])('%s is damaged', (_name, bytes) => {
        expect(decodeInlayMeta(bytes).kind).toBe('damaged')
    })
})

describe('pairInlayEntries (T20)', () => {
    const metaName = (id: string) => inlayEntryName(id, 'meta') as string
    const bodyName = (id: string) => inlayEntryName(id, 'body') as string

    test('one meta and one body per id pair up, in any order, with the body size', () => {
        const result = pairInlayEntries([
            { name: bodyName('b'), size: 9 },
            { name: metaName('a'), size: 40 },
            { name: metaName('b'), size: 41 },
            { name: bodyName('a'), size: 3 },
        ])
        expect(result.kind).toBe('ok')
        if (result.kind !== 'ok') {
            return
        }
        expect(result.pairs.map((p) => [p.id, p.bodySize]).sort()).toEqual([['a', 3], ['b', 9]])
        expect(result.pairs.find((p) => p.id === 'a')).toMatchObject({ metaName: metaName('a'), bodyName: bodyName('a') })
    })

    test('ids with characters outside the plain set pair through their canonical encoding', () => {
        const id = 'Ünï code/1'
        expect(pairInlayEntries([{ name: metaName(id), size: 1 }, { name: bodyName(id), size: 1 }]).kind).toBe('ok')
    })

    test('a meta without a body is damaged, and so is a body without a meta', () => {
        expect(pairInlayEntries([{ name: metaName('a'), size: 1 }]).kind).toBe('damaged')
        expect(pairInlayEntries([{ name: bodyName('a'), size: 1 }]).kind).toBe('damaged')
        expect(pairInlayEntries([{ name: metaName('a'), size: 1 }, { name: bodyName('a'), size: 1 }, { name: bodyName('b'), size: 1 }]).kind).toBe('damaged')
    })

    test('two entries of the same name are damaged', () => {
        expect(pairInlayEntries([
            { name: metaName('a'), size: 1 },
            { name: metaName('a'), size: 1 },
            { name: bodyName('a'), size: 1 },
        ]).kind).toBe('damaged')
    })

    test.each([
        ['an uppercase letter in the encoding', 'i/Abc'],
        ['a lowercase percent escape', 'i/a%2fb'],
        ['a dot inside the encoding', 'i/a.b'],
        ['an empty id', 'i/'],
        ['a name outside i/', 'x/abc'],
    ])('a complete pair with %s is damaged', (_name, stem) => {
        expect(pairInlayEntries([{ name: `${stem}.meta`, size: 1 }, { name: `${stem}.body`, size: 1 }]).kind).toBe('damaged')
    })

    test.each([
        ['an unknown suffix', 'i/abc.txt'],
        ['no suffix', 'i/abc'],
    ])('%s is damaged beside a good pair', (_name, name) => {
        expect(pairInlayEntries([
            { name: metaName('a'), size: 1 },
            { name: bodyName('a'), size: 1 },
            { name, size: 1 },
        ]).kind).toBe('damaged')
    })

    test('no entries pair to nothing', () => {
        expect(pairInlayEntries([])).toEqual({ kind: 'ok', pairs: [] })
    })
})
