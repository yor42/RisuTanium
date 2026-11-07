import { describe, test, expect } from 'vitest'
import {
    RtbSideValueError,
    decodeSideLine,
    decodeSideLines,
    encodeSideLine,
    jsonRoundTrips,
    type SideTagCodec,
} from 'src/ts/drive/rtb/sideLines'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Two tags of a test registry: raw bytes, and any number including -0 and NaN as 8 float bytes. */
const BYTES_TAG: SideTagCodec = {
    tag: 'u8',
    encode: (value) => (value instanceof Uint8Array ? value : null),
    decode: (bytes) => bytes,
}
const NUMBER_TAG: SideTagCodec = {
    tag: 'f64',
    encode: (value) => {
        if (typeof value !== 'number') {
            return null
        }
        const out = new Uint8Array(8)
        new DataView(out.buffer).setFloat64(0, value, true)
        return out
    },
    decode: (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true),
}
const REGISTRY = [BYTES_TAG, NUMBER_TAG]

function lineText(key: string, value: unknown, registry = REGISTRY): string {
    return decoder.decode(encodeSideLine(key, value, registry))
}

describe('jsonRoundTrips (T-line)', () => {
    test.each([
        ['null', null],
        ['true', true],
        ['a finite number', 12.5],
        ['zero', 0],
        ['a string', 'text'],
        ['a lone surrogate string', '\uD800'],
        ['a plain array', [1, 'a', null, [2]]],
        ['a plain object', { a: 1, b: { c: [true] } }],
        ['an empty object', {}],
    ])('%s round-trips', (_name, value) => {
        expect(jsonRoundTrips(value)).toBe(true)
    })

    test.each([
        ['negative zero', -0],
        ['undefined', undefined],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['a typed array', new Uint8Array([1, 2])],
        ['a Date', new Date(0)],
        ['a Map', new Map([[1, 2]])],
        ['a function', () => 1],
        ['a symbol', Symbol('s')],
        ['a bigint', 5n],
        ['a sparse array', [1, , 3]],
        ['an object with an undefined member', { a: undefined }],
        ['an array holding undefined', [undefined]],
        ['an object holding negative zero', { a: -0 }],
        ['a class instance', new (class Box { x = 1 })()],
    ])('%s does not round-trip', (_name, value) => {
        expect(jsonRoundTrips(value)).toBe(false)
    })

    test('a cyclic value does not round-trip and does not throw', () => {
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(jsonRoundTrips(cyclic)).toBe(false)
    })
})

describe('encodeSideLine and decodeSideLine (T-line)', () => {
    test('a JSON value is written as {"k","j"} on one line ending in a newline', () => {
        const text = lineText('a key', { x: [1, 2] })
        expect(text).toBe('{"k":"a key","j":{"x":[1,2]}}\n')
        expect(decodeSideLine(text.trimEnd(), [])).toEqual({ kind: 'value', key: 'a key', value: { x: [1, 2] } })
    })

    test('a string with a newline and a line separator stays on one line', () => {
        const text = lineText('k', 'a\nb c')
        expect(text.indexOf('\n')).toBe(text.length - 1)
        expect(decodeSideLine(text.trimEnd(), [])).toEqual({ kind: 'value', key: 'k', value: 'a\nb c' })
    })

    test('-0 is not written as j but under a tag, and returns as -0', () => {
        const text = lineText('zero', -0)
        expect(text).toContain('"t":"f64"')
        expect(text).not.toContain('"j"')
        const decoded = decodeSideLine(text.trimEnd(), REGISTRY)
        expect(decoded.kind === 'value' && Object.is(decoded.value, -0)).toBe(true)
    })

    test('NaN is written under a tag and returns as NaN', () => {
        const text = lineText('nan', NaN)
        expect(text).not.toContain('"j"')
        const decoded = decodeSideLine(text.trimEnd(), REGISTRY)
        expect(decoded.kind === 'value' && Number.isNaN(decoded.value)).toBe(true)
    })

    test('a typed array is written under its tag as base64 and returns equal', () => {
        const bytes = Uint8Array.from({ length: 300 }, (_, i) => i & 255)
        const text = lineText('vec', bytes)
        expect(text).toMatch(/^\{"k":"vec","t":"u8","b":"[A-Za-z0-9+/]+=*"\}\n$/)
        const decoded = decodeSideLine(text.trimEnd(), REGISTRY)
        expect(decoded.kind === 'value' && Array.from(decoded.value as Uint8Array)).toEqual(Array.from(bytes))
    })

    test('undefined without a codec for it fails the export and names the key', () => {
        expect(() => encodeSideLine('lost', undefined, REGISTRY)).toThrow(RtbSideValueError)
        expect(() => encodeSideLine('lost', undefined, REGISTRY)).toThrow(/lost/)
        expect(() => encodeSideLine('lost', -0, [])).toThrow(RtbSideValueError)
    })

    test('an unknown tag skips the key and names it, even when its payload is not base64', () => {
        expect(decodeSideLine('{"k":"x","t":"future","b":"@@@"}', REGISTRY)).toEqual({ kind: 'skipped', key: 'x', tag: 'future' })
        expect(decodeSideLine('{"k":"x","t":"future"}', REGISTRY)).toEqual({ kind: 'skipped', key: 'x', tag: 'future' })
    })

    test('unknown fields of a line object are ignored', () => {
        expect(decodeSideLine('{"k":"a","j":1,"extra":{"z":1}}', [])).toEqual({ kind: 'value', key: 'a', value: 1 })
        expect(decodeSideLine('{"k":"a","t":"u8","b":"AQI=","extra":1}', REGISTRY)).toMatchObject({ kind: 'value', key: 'a' })
    })

    test('j can be null, and j wins over a tag on the same line', () => {
        expect(decodeSideLine('{"k":"a","j":null}', [])).toEqual({ kind: 'value', key: 'a', value: null })
        expect(decodeSideLine('{"k":"a","j":1,"t":"u8","b":"AQI="}', REGISTRY)).toEqual({ kind: 'value', key: 'a', value: 1 })
    })

    test.each([
        ['text that is not JSON', 'nope'],
        ['a JSON array', '[1]'],
        ['a null line', 'null'],
        ['a missing k', '{"j":1}'],
        ['a k that is not a string', '{"k":1,"j":1}'],
        ['neither j nor t', '{"k":"a"}'],
        ['a known tag without a payload', '{"k":"a","t":"u8"}'],
        ['a known tag with bad base64', '{"k":"a","t":"u8","b":"@@@"}'],
        ['a known tag with base64 of the wrong length', '{"k":"a","t":"u8","b":"AQI"}'],
        ['a known tag with whitespace inside the base64', '{"k":"a","t":"u8","b":"AQ I"}'],
    ])('%s is damaged', (_name, text) => {
        expect(decodeSideLine(text, REGISTRY).kind).toBe('damaged')
    })
})

describe('decodeSideLines (T-line)', () => {
    test('lines are read in order, blank lines and CRLF are tolerated, a last line without a newline is read', () => {
        const text = '{"k":"a","j":1}\r\n\r\n\n{"k":"b","t":"u8","b":"AQI="}\n{"k":"c","t":"later","b":"AA=="}\n{"k":"d","j":[2]}'
        const result = decodeSideLines(encoder.encode(text), REGISTRY)
        expect(result.kind).toBe('ok')
        if (result.kind !== 'ok') {
            return
        }
        expect(result.values.map((v) => v.key)).toEqual(['a', 'b', 'd'])
        expect(Array.from(result.values[1].value as Uint8Array)).toEqual([1, 2])
        expect(result.skipped).toEqual([{ key: 'c', tag: 'later' }])
    })

    test('an empty section has no lines', () => {
        expect(decodeSideLines(new Uint8Array(0), REGISTRY)).toEqual({ kind: 'ok', values: [], skipped: [] })
    })

    test('a damaged line names its number', () => {
        const result = decodeSideLines(encoder.encode('{"k":"a","j":1}\nbroken\n'), REGISTRY)
        expect(result.kind).toBe('damaged')
        expect(result.kind === 'damaged' && result.line).toBe(2)
    })

    test('bytes that are not UTF-8 are damaged', () => {
        const head = encoder.encode('{"k":"a","j":"')
        const bytes = new Uint8Array(head.length + 3)
        bytes.set(head, 0)
        bytes.set([0xFF, 0x22, 0x7D], head.length)
        expect(decodeSideLines(bytes, REGISTRY).kind).toBe('damaged')
    })

    test('written lines read back, whatever mix of j and tagged values', () => {
        const records: { key: string, value: unknown }[] = [
            { key: 'one', value: { a: [1, 2, { b: null }] } },
            { key: 'two', value: -0 },
            { key: 'three', value: Uint8Array.of(9, 8, 7) },
            { key: 'four', value: 'text' },
        ]
        const bytes = encoder.encode(records.map((r) => lineText(r.key, r.value)).join(''))
        const result = decodeSideLines(bytes, REGISTRY)
        expect(result.kind).toBe('ok')
        if (result.kind !== 'ok') {
            return
        }
        expect(result.values.map((v) => v.key)).toEqual(['one', 'two', 'three', 'four'])
        expect(result.values[0].value).toEqual({ a: [1, 2, { b: null }] })
        expect(Object.is(result.values[1].value, -0)).toBe(true)
        expect(Array.from(result.values[2].value as Uint8Array)).toEqual([9, 8, 7])
        expect(result.values[3].value).toBe('text')
    })
})
