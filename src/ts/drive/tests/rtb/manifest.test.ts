import { describe, test, expect } from 'vitest'
import { DEFAULT_MANIFEST_CAP, parseManifest, peekNewerRtb } from 'src/ts/drive/rtb/manifest'

const encoder = new TextEncoder()
const ALPHABET = '0123456789abcdefghijklmnopqrstuv'
const ID_A = 'a'.repeat(26)

function bytesOf(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value))
}

function valid(): Record<string, unknown> {
    return {
        rtb: 1,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        createdAt: 1700000000000,
        snapshot: { id: ID_A, parent: null, lineage: [] },
        source: { device: { label: 'pc', platform: 'web' }, committedAt: 1699999999000, unsavedExcluded: false },
        sections: [{ id: 'store2', v: 1, required: true, prefix: 'u/', entries: 0, bytes: 0 }],
        omitted: [],
    }
}

function without(key: string): Record<string, unknown> {
    const value = valid()
    delete value[key]
    return value
}

describe('a valid manifest', () => {
    test('is accepted and its fields are returned', () => {
        const result = parseManifest(bytesOf(valid()))
        expect(result.kind).toBe('ok')
        if (result.kind !== 'ok') {
            return
        }
        expect(result.manifest.rtb).toBe(1)
        expect(result.manifest.createdAt).toBe(1700000000000)
        expect(result.manifest.snapshot).toEqual({ id: ID_A, parent: null, lineage: [] })
        expect(result.manifest.source).toEqual({ device: { label: 'pc', platform: 'web' }, committedAt: 1699999999000, unsavedExcluded: false })
        expect(result.manifest.sections.length).toBe(1)
        expect(result.manifest.omitted).toEqual([])
    })
})

describe('T-rtb the version number decides first', () => {
    test('rtb above 1 is newer and names rtb', () => {
        expect(parseManifest(bytesOf({ ...valid(), rtb: 2 }))).toEqual({ kind: 'newer', rtb: 2 })
        expect(parseManifest(bytesOf({ ...valid(), rtb: 1000000 }))).toEqual({ kind: 'newer', rtb: 1000000 })
    })

    test('rtb 2 is newer whatever else the manifest holds', () => {
        const cases: unknown[] = [
            { rtb: 2 },
            { rtb: 2, sections: 'not a list' },
            { rtb: 2, writer: 5, snapshot: 'x', source: null, omitted: 7, createdAt: 'x' },
            { ...without('sections'), rtb: 2 },
            { ...without('snapshot'), rtb: 2 },
            { ...valid(), rtb: 2, writer: 5 },
            { ...valid(), rtb: 2, sections: [{ id: 'Not Valid', v: 0 }] },
        ]
        for (const manifest of cases) {
            expect(parseManifest(bytesOf(manifest))).toEqual({ kind: 'newer', rtb: 2 })
        }
    })

    test.each([
        ['0', 0],
        ['-1', -1],
        ['1.5', 1.5],
        ['a string', '1'],
        ['a boolean', true],
        ['null', null],
    ])('rtb %s is damaged', (_label, rtb) => {
        expect(parseManifest(bytesOf({ ...valid(), rtb })).kind).toBe('damaged')
    })

    test('an absent rtb is damaged', () => {
        expect(parseManifest(bytesOf(without('rtb'))).kind).toBe('damaged')
    })

    test('a 2-row manifest over the cap is damaged even when rtb says newer', () => {
        const manifest = bytesOf({ ...valid(), rtb: 2, sections: [{ id: 'a' }, { id: 'b' }] })
        expect(parseManifest(manifest, { maxBytes: manifest.length })).toEqual({ kind: 'newer', rtb: 2 })
        expect(parseManifest(manifest, { maxBytes: manifest.length - 1 }).kind).toBe('damaged')
    })

    test('peekNewerRtb returns the number only for an integer above 1 in an object', () => {
        expect(peekNewerRtb(bytesOf({ rtb: 2 }))).toBe(2)
        expect(peekNewerRtb(bytesOf({ rtb: 1 }))).toBeNull()
        expect(peekNewerRtb(bytesOf({ rtb: 1.5 }))).toBeNull()
        expect(peekNewerRtb(bytesOf({ rtb: '2' }))).toBeNull()
        expect(peekNewerRtb(bytesOf({}))).toBeNull()
        expect(peekNewerRtb(bytesOf([2]))).toBeNull()
        expect(peekNewerRtb(encoder.encode('not json'))).toBeNull()
        expect(peekNewerRtb(bytesOf({ rtb: 2 }), 3)).toBeNull()
    })
})

describe('the manifest must be a JSON object', () => {
    test.each([
        ['text that is not JSON', encoder.encode('{"rtb":')],
        ['a JSON array', encoder.encode('[1]')],
        ['JSON null', encoder.encode('null')],
        ['a JSON string', encoder.encode('"x"')],
        ['bytes that are not UTF-8', new Uint8Array([0x7B, 0xFF, 0x7D])],
        ['nothing', new Uint8Array(0)],
    ])('%s is damaged', (_label, bytes) => {
        expect(parseManifest(bytes).kind).toBe('damaged')
    })
})

describe('the schema of a version 1 manifest', () => {
    test.each([
        ['no writer', without('writer')],
        ['writer a list', { ...valid(), writer: [] }],
        ['createdAt a string', { ...valid(), createdAt: '1700000000000' }],
        ['createdAt missing', without('createdAt')],
        ['no snapshot', without('snapshot')],
        ['no source', without('source')],
        ['source.committedAt a string', { ...valid(), source: { ...(valid().source as object), committedAt: 'x' } }],
        ['source.unsavedExcluded a number', { ...valid(), source: { ...(valid().source as object), unsavedExcluded: 1 } }],
        ['no source.device', { ...valid(), source: { committedAt: 1, unsavedExcluded: false } }],
        ['device.label a number', { ...valid(), source: { ...(valid().source as object), device: { label: 5, platform: 'web' } } }],
        ['device.platform missing', { ...valid(), source: { ...(valid().source as object), device: { label: 'x' } } }],
        ['sections missing', without('sections')],
        ['sections a string', { ...valid(), sections: 'x' }],
        ['omitted missing', without('omitted')],
        ['omitted an object', { ...valid(), omitted: {} }],
        ['an omitted entry that is a string', { ...valid(), omitted: ['x'] }],
        ['an omitted entry without a name', { ...valid(), omitted: [{ kind: 'asset', reason: 'oversize' }] }],
        ['an omitted entry whose kind is a number', { ...valid(), omitted: [{ kind: 3, name: 'x', reason: 'oversize' }] }],
    ])('%s is damaged', (_label, manifest) => {
        expect(parseManifest(bytesOf(manifest)).kind).toBe('damaged')
    })
})

describe('T12m unknown fields and values a later writer may add', () => {
    test('unknown top-level and nested fields, an unknown platform and unknown omitted kind and reason are accepted', () => {
        const manifest = {
            ...valid(),
            extraTop: { anything: [1, 2] },
            writer: { app: 'x', version: '1', build: 'b', extra: true },
            snapshot: { id: ID_A, parent: null, lineage: [], extra: 1 },
            source: { device: { label: 'pc', platform: 'x-test', extra: 1 }, committedAt: 1, unsavedExcluded: true, extra: 1 },
            omitted: [
                { kind: 'unit', name: 'u-aaaa', reason: 'damaged', extra: 1 },
                { kind: 'x-test', name: 'thing', reason: 'x-test' },
            ],
        }
        const result = parseManifest(bytesOf(manifest))
        expect(result.kind).toBe('ok')
        if (result.kind === 'ok') {
            expect(result.manifest.source.device.platform).toBe('x-test')
            expect(result.manifest.omitted.length).toBe(2)
            expect(result.manifest.omitted[1]).toMatchObject({ kind: 'x-test', name: 'thing', reason: 'x-test' })
        }
    })
})

describe('T-cap the manifest size cap', () => {
    function padded(size: number): Uint8Array {
        const base = JSON.stringify({ ...valid(), pad: '' })
        const filler = 'x'.repeat(size - base.length)
        const text = JSON.stringify({ ...valid(), pad: filler })
        expect(text.length).toBe(size)
        return encoder.encode(text)
    }

    test('the default cap is 64 MiB', () => {
        expect(DEFAULT_MANIFEST_CAP).toBe(64 * 1024 * 1024)
    })

    test('1,024 bytes at a cap of 1,024 is accepted and 1,025 is damaged', () => {
        expect(parseManifest(padded(1024), { maxBytes: 1024 }).kind).toBe('ok')
        expect(parseManifest(padded(1025), { maxBytes: 1024 }).kind).toBe('damaged')
    })
})

describe('T-snap the snapshot grammar', () => {
    function withSnapshot(snapshot: unknown): Uint8Array {
        return bytesOf({ ...valid(), snapshot })
    }

    test('ids of 26 alphabet characters are accepted, including a first character past the digit range of a 128-bit id', () => {
        expect(parseManifest(withSnapshot({ id: ALPHABET.slice(0, 26), parent: null, lineage: [] })).kind).toBe('ok')
        expect(parseManifest(withSnapshot({ id: 'v'.repeat(26), parent: 'v'.repeat(26), lineage: [] })).kind).toBe('ok')
    })

    test.each([
        ['25 characters', 'a'.repeat(25)],
        ['27 characters', 'a'.repeat(27)],
        ['an upper-case letter', 'A' + 'a'.repeat(25)],
        ['the letter w', 'w' + 'a'.repeat(25)],
        ['a dash', '-' + 'a'.repeat(25)],
        ['a number', 5],
        ['empty', ''],
    ])('an id with %s is damaged', (_label, id) => {
        expect(parseManifest(withSnapshot({ id, parent: null, lineage: [] })).kind).toBe('damaged')
        expect(parseManifest(withSnapshot({ id: ID_A, parent: id, lineage: [] })).kind).toBe('damaged')
        expect(parseManifest(withSnapshot({ id: ID_A, parent: null, lineage: [id] })).kind).toBe('damaged')
    })

    test('a lineage of any length is accepted: 0, 33 and 1,000 ids', () => {
        for (const count of [0, 33, 1000]) {
            const lineage = Array.from({ length: count }, () => ID_A)
            expect(parseManifest(withSnapshot({ id: ID_A, parent: ID_A, lineage })).kind).toBe('ok')
        }
    })

    test('a missing parent, or a lineage that is not a list, is damaged', () => {
        expect(parseManifest(withSnapshot({ id: ID_A, lineage: [] })).kind).toBe('damaged')
        expect(parseManifest(withSnapshot({ id: ID_A, parent: null, lineage: 'x' })).kind).toBe('damaged')
        expect(parseManifest(withSnapshot({ id: ID_A, parent: null })).kind).toBe('damaged')
    })
})
