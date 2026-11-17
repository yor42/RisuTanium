import { describe, test, expect } from 'vitest'
import { decodeSideLine, encodeSideLine, RtbSideValueError, type SideLine } from 'src/ts/drive/rtb/sideLines'
import { prepareSideValue, RTB_SIDE_TAGS, SV1_TAG } from 'src/ts/drive/rtb/sideTags'

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function lineText(value: unknown, key = 'k'): string {
    return textDecoder.decode(encodeSideLine(key, value, RTB_SIDE_TAGS)).slice(0, -1)
}

function decode(text: string): SideLine {
    return decodeSideLine(text, RTB_SIDE_TAGS)
}

function roundTrip(value: unknown): unknown {
    const line = decode(lineText(value))
    if (line.kind !== 'value') {
        throw new Error(`not a value: ${JSON.stringify(line)}`)
    }
    return line.value
}

function bytesToBase64(bytes: Uint8Array): string {
    let text = ''
    for (const byte of bytes) {
        text += String.fromCharCode(byte)
    }
    return btoa(text)
}

/** A hand-built sv1 line: u32 `J`, the JSON of `tree`, then `region`. */
function sv1Line(tree: unknown, region: Uint8Array = new Uint8Array(0), jsonLength?: number): string {
    const json = textEncoder.encode(JSON.stringify(tree))
    const head = new Uint8Array(4)
    new DataView(head.buffer).setUint32(0, jsonLength ?? json.length, true)
    const payload = new Uint8Array(4 + json.length + region.length)
    payload.set(head, 0)
    payload.set(json, 4)
    payload.set(region, 4 + json.length)
    return JSON.stringify({ k: 'x', t: SV1_TAG, b: bytesToBase64(payload) })
}

function own(value: unknown, key: string): unknown {
    return Object.getOwnPropertyDescriptor(value, key)?.value
}

describe('sv1 round trips (T1, R)', () => {
    test('every non-JSON-exact value comes back equal', () => {
        const sparse = [1, , 3]
        const cases: unknown[] = [
            undefined,
            NaN,
            Infinity,
            -Infinity,
            -0,
            123456789012345678901234567890n,
            -5n,
            new Date(1700000000000),
            new Date(NaN),
            /a+b/gi,
            new Map<unknown, unknown>([['a', 1], [{ x: undefined }, new Set([1, 2])]]),
            new Set([1, 'two', undefined]),
            new Uint8Array([1, 2, 3]).buffer,
            new Int8Array([-1, 2]),
            new Uint8Array([1, 2]),
            new Uint8ClampedArray([1, 255]),
            new Int16Array([-2, 3]),
            new Uint16Array([2, 65535]),
            new Int32Array([-7, 8]),
            new Uint32Array([7, 4294967295]),
            new Float32Array([1.5, -0, NaN]),
            new Float64Array([Math.PI, Infinity]),
            new BigInt64Array([-1n, 2n]),
            new BigUint64Array([1n, 18446744073709551615n]),
            new DataView(new Uint8Array([9, 8, 7, 6]).buffer),
            sparse,
            { $: 'o', v: 1, '\ud800': 'lone', plain: undefined },
            ['\ud800', '\udc00x'],
        ]
        for (const value of cases) {
            expect(roundTrip(value)).toStrictEqual(value)
        }
    })

    test('an identity encoder cannot satisfy the round trip: a value with undefined is not written as j', () => {
        expect(lineText({ a: undefined })).toContain(`"t":"${SV1_TAG}"`)
        expect(lineText({ a: undefined })).not.toContain('"j"')
    })
})

describe('typed array views (T2, guard)', () => {
    test('a view at an offset into a larger buffer keeps only its own elements', () => {
        const buffer = new Float32Array([9, 1, 2, 3, 9, 9]).buffer
        const view = new Float32Array(buffer, 4, 3)
        const back = roundTrip(view) as Float32Array
        expect(Array.from(back)).toEqual([1, 2, 3])
        expect(back.buffer.byteLength).toBe(12)
    })
})

describe('values the encoder refuses (T3, guard)', () => {
    test('each is refused with the key named', () => {
        const cycle: Record<string, unknown> = { u: undefined }
        cycle.self = cycle
        const extra = Object.assign([1, 2], { extra: true })
        const cases: unknown[] = [cycle, { u: undefined, e: new Error('x') }, new Number(3), extra, 10n ** 4096n, -(10n ** 4097n), () => 1, Symbol('s')]
        for (const value of cases) {
            let caught: unknown
            try {
                encodeSideLine('the-key', { v: value, u: undefined }, RTB_SIDE_TAGS)
            } catch (error) {
                caught = error
            }
            expect(caught).toBeInstanceOf(RtbSideValueError)
            expect((caught as RtbSideValueError).key).toBe('the-key')
        }
    })

    test('a bounds failure has its own reason text', () => {
        let caught: unknown
        try {
            encodeSideLine('big', 10n ** 4096n, RTB_SIDE_TAGS)
        } catch (error) {
            caught = error
        }
        expect((caught as Error).message).toMatch(/over the line bounds/)
        expect((caught as Error).message).not.toMatch(/neither JSON-exact/)
    })
})

describe('hostile or malformed payloads (T4, guard)', () => {
    test('each is damaged and decodeSideLine never throws', () => {
        const lines = [
            sv1Line({ $: 'u' }, new Uint8Array(0), 999),
            sv1Line({ $: 'ab', o: 0, n: 10 }, new Uint8Array(2)),
            sv1Line({ $: 'zz' }),
            sv1Line({ bare: 1 }),
            sv1Line({ $: 're', s: '(', f: '' }),
            sv1Line({ $: 're', s: 'a', f: 'zz' }),
            sv1Line({ $: 'n', v: 'x' }),
            sv1Line({ $: 'bi', v: '12x' }),
            sv1Line({ $: 'bi', v: '' }),
            sv1Line({ $: 'd', v: 9e15 }),
            sv1Line({ $: 'h' }),
            sv1Line({ $: 'blob', t: 5, o: 0, n: 0 }),
            sv1Line({ $: 'file', t: 't', nm: 5, lm: 0, o: 0, n: 0 }),
            sv1Line({ $: 'ta', c: 'Float16Array', o: 0, n: 0 }),
            sv1Line({ $: 'ta', c: 'Int16Array', o: 0, n: 1 }, new Uint8Array(1)),
            sv1Line({ $: 'ab', o: -1, n: 0 }),
            sv1Line({ $: 'm', v: [[1]] }),
            JSON.stringify({ k: 'x', t: SV1_TAG, b: bytesToBase64(new Uint8Array([1, 0])) }),
        ]
        for (const text of lines) {
            expect(decode(text).kind).toBe('damaged')
        }
    })
})

describe('what travels as j and as sv1 (T5, guard)', () => {
    test('a hypa number[] is j; a Float32Array and an embedding record are sv1', () => {
        expect(lineText([0.5, -1, 2])).toContain('"j"')
        expect(lineText(new Float32Array([0.5, 1]))).toContain(`"t":"${SV1_TAG}"`)
        const record = { content: 'text', embedding: new Float32Array([0.25, 0.5]) }
        expect(lineText(record)).toContain(`"t":"${SV1_TAG}"`)
        expect(roundTrip(record)).toStrictEqual(record)
    })
})

describe('bigint bound (B4, guard)', () => {
    test('4096 digits decode, with or without a sign; 4097 are damaged', () => {
        const digits = (count: number): string => `1${'0'.repeat(count - 1)}`
        expect(decode(sv1Line({ $: 'bi', v: digits(4096) })).kind).toBe('value')
        expect(decode(sv1Line({ $: 'bi', v: `-${digits(4096)}` })).kind).toBe('value')
        expect(decode(sv1Line({ $: 'bi', v: digits(4097) })).kind).toBe('damaged')
        expect(decode(sv1Line({ $: 'bi', v: `-${digits(4097)}` })).kind).toBe('damaged')
    })
})

describe('contiguous ranges (T21, guard)', () => {
    const four = new Uint8Array([1, 2, 3, 4])
    test('overlap, a gap, a reversed order and a trailing byte are damaged', () => {
        const ab = (o: number, n: number): unknown => ({ $: 'ab', o, n })
        const arr = (...nodes: unknown[]): unknown[] => nodes
        expect(decode(sv1Line(arr(ab(0, 4), ab(0, 4)), four)).kind).toBe('damaged')
        expect(decode(sv1Line(arr(ab(1, 3)), four)).kind).toBe('damaged')
        expect(decode(sv1Line(arr(ab(2, 2), ab(0, 2)), four)).kind).toBe('damaged')
        expect(decode(sv1Line(arr(ab(0, 3)), four)).kind).toBe('damaged')
        expect(decode(sv1Line(arr(ab(0, 2), ab(2, 2)), four)).kind).toBe('value')
    })
})

describe('own keys only (T23, guard)', () => {
    test('__proto__, constructor and prototype stay data under j', () => {
        const text = '{"k":"a","j":{"__proto__":{"x":1},"constructor":2,"prototype":3}}'
        const line = decode(text)
        expect(line.kind).toBe('value')
        const value = (line as { value: object }).value
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
        expect(Object.keys(value)).toEqual(['__proto__', 'constructor', 'prototype'])
        expect(({} as Record<string, unknown>).x).toBeUndefined()
    })

    test('and under sv1, in both directions', () => {
        const source = JSON.parse('{"__proto__":{"a":1},"constructor":2,"prototype":3}') as Record<string, unknown>
        source.u = undefined
        const back = roundTrip(source) as object
        expect(Object.getPrototypeOf(back)).toBe(Object.prototype)
        expect(Object.keys(back)).toEqual(['__proto__', 'constructor', 'prototype', 'u'])
        expect(own(back, '__proto__')).toEqual({ a: 1 })
        expect(({} as Record<string, unknown>).a).toBeUndefined()
    })

    test('a hostile handcrafted sv1 object does not pollute', () => {
        const text = sv1Line({ $: 'o', v: JSON.parse('{"__proto__":{"$":"o","v":{"x":1}}}') })
        const line = decode(text)
        expect(line.kind).toBe('value')
        expect(({} as Record<string, unknown>).x).toBeUndefined()
        const value = (line as { value: object }).value
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
        expect(own(value, '__proto__')).toEqual({ x: 1 })
    })
})

describe('sv1 goldens (T20, guard)', () => {
    // Built by hand from the grammar, not by the encoder, so a renamed kind or reordered field fails here.
    const goldens: [string, unknown][] = [
        ['{"k":"g1","t":"sv1","b":"CQAAAHsiJCI6InUifQ=="}', undefined],
        ['{"k":"g2","t":"sv1","b":"JgAAAHsiJCI6Im8iLCJ2Ijp7ImEiOnsiJCI6Im4iLCJ2IjoiLTAifX19"}', { a: -0 }],
        ['{"k":"g3","t":"sv1","b":"KQAAAHsiJCI6InRhIiwiYyI6IkZsb2F0MzJBcnJheSIsIm8iOjAsIm4iOjh9AADAPwAAIEA="}', new Float32Array([1.5, 2.5])],
    ]

    test('the encoder writes the golden bytes and the decoder reads them back', () => {
        for (const [text, value] of goldens) {
            const key = JSON.parse(text).k as string
            expect(lineText(value, key)).toBe(text)
            const line = decode(text)
            expect(line.kind).toBe('value')
            expect((line as { value: unknown }).value).toStrictEqual(value)
        }
    })
})

describe('alignment (T26, guard)', () => {
    test('a Float32Array after a one-byte Uint8Array decodes', () => {
        const value = [new Uint8Array([7]), new Float32Array([1.5, 2.5])]
        expect(roundTrip(value)).toStrictEqual(value)
    })
})

describe('Blob and File (T18, guard)', () => {
    test('nested in an object and in a Map, type, bytes, name and lastModified survive', async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        const file = new File([new Uint8Array([4, 5])], 'a.txt', { type: 'text/plain', lastModified: 1234 })
        const value = { deep: { blob }, map: new Map<unknown, unknown>([[file, blob]]), n: 1 }
        const prepared = await prepareSideValue(value)
        expect(prepared).not.toBe(value)
        const back = roundTrip(prepared) as { deep: { blob: Blob }, map: Map<File, Blob> }
        expect(back.deep.blob.type).toBe('image/png')
        expect(Array.from(new Uint8Array(await back.deep.blob.arrayBuffer()))).toEqual([1, 2, 3])
        const [[backFile, backBlob]] = Array.from(back.map.entries())
        expect(backFile.name).toBe('a.txt')
        expect(backFile.lastModified).toBe(1234)
        expect(backFile.type).toBe('text/plain')
        expect(Array.from(new Uint8Array(await backFile.arrayBuffer()))).toEqual([4, 5])
        expect(Array.from(new Uint8Array(await backBlob.arrayBuffer()))).toEqual([1, 2, 3])
    })

    test('a value that holds none comes back as the same object', async () => {
        const value = { a: [1, { b: 2 }], m: new Map([[1, 2]]) }
        expect(await prepareSideValue(value)).toBe(value)
    })
})
