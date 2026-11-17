import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    decodeSideLine,
    encodeSideLine,
    RtbSideValueError,
    scanSideJson,
    SIDE_LINE_MAX_BYTES,
    SIDE_VALUE_MAX_DEPTH,
    SIDE_VALUE_MAX_NODES,
} from 'src/ts/drive/rtb/sideLines'
import { SideLineSplitter } from 'src/ts/drive/rtb/sideStream'
import { RTB_SIDE_TAGS, SV1_TAG } from 'src/ts/drive/rtb/sideTags'

const encoder = new TextEncoder()

/** `{"k":"a","j":` + nested arrays + `}`: the line's JSON depth is `levels` + 1. */
function nestedLine(levels: number): string {
    return `{"k":"a","j":${'['.repeat(levels)}${']'.repeat(levels)}}`
}

function nestedValue(levels: number): unknown {
    let value: unknown = []
    for (let i = 1; i < levels; i++) {
        value = [value]
    }
    return value
}

function sv1Tree(tree: unknown): string {
    const json = encoder.encode(JSON.stringify(tree))
    const payload = new Uint8Array(4 + json.length)
    new DataView(payload.buffer).setUint32(0, json.length, true)
    payload.set(json, 4)
    let text = ''
    for (const byte of payload) {
        text += String.fromCharCode(byte)
    }
    return JSON.stringify({ k: 'x', t: SV1_TAG, b: btoa(text) })
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('frozen constants', () => {
    test('the bounds are the frozen numbers', () => {
        expect(SIDE_LINE_MAX_BYTES).toBe(67_108_864)
        expect(SIDE_VALUE_MAX_DEPTH).toBe(256)
        expect(SIDE_VALUE_MAX_NODES).toBe(1_048_576)
    })
})

describe('line length (T22, guard)', () => {
    test('a line over the cap is damaged at its number and the splitter stops buffering', () => {
        const splitter = new SideLineSplitter(RTB_SIDE_TAGS, { maxLineBytes: 1024 })
        const first = splitter.push(encoder.encode('{"k":"a","j":1}\n'))
        expect(first.map((l) => l.decoded.kind)).toEqual(['value'])
        let peak = 0
        let damaged = null as null | { line: number, kind: string }
        const chunk = encoder.encode('x'.repeat(100))
        for (let i = 0; i < 20; i++) {
            for (const line of splitter.push(chunk)) {
                damaged = { line: line.line, kind: line.decoded.kind }
            }
            peak = Math.max(peak, splitter.bufferedBytes)
        }
        expect(damaged).toEqual({ line: 2, kind: 'damaged' })
        expect(splitter.stopped).toBe(true)
        expect(peak).toBeLessThanOrEqual(1024 + 100)
        expect(splitter.bufferedBytes).toBe(0)
        expect(splitter.push(encoder.encode('{"k":"b","j":2}\n'))).toEqual([])
        expect(splitter.end()).toEqual([])
    })

    test('a complete line one byte over is damaged; exactly the cap is accepted', () => {
        const make = (bytes: number): Uint8Array => {
            const head = '{"k":"a","j":"'
            const tail = '"}'
            return encoder.encode(`${head}${'p'.repeat(bytes - head.length - tail.length)}${tail}\n`)
        }
        const over = new SideLineSplitter(RTB_SIDE_TAGS, { maxLineBytes: 1024 })
        const overLines = over.push(make(1025))
        expect(overLines).toHaveLength(1)
        expect(overLines[0].decoded.kind).toBe('damaged')
        const exact = new SideLineSplitter(RTB_SIDE_TAGS, { maxLineBytes: 1024 })
        expect(exact.push(make(1024))[0].decoded.kind).toBe('value')
    })

    test('decodeSideLine refuses a line over the default cap before parsing it', () => {
        const parse = vi.spyOn(JSON, 'parse')
        const line = decodeSideLine('x'.repeat(SIDE_LINE_MAX_BYTES + 1), RTB_SIDE_TAGS)
        expect(line.kind).toBe('damaged')
        expect(parse).not.toHaveBeenCalled()
    })
})

describe('depth, counted over the whole line (T24, guard)', () => {
    test('line depth 256 is accepted and 257 is damaged on read, for j', () => {
        expect(decodeSideLine(nestedLine(255), RTB_SIDE_TAGS).kind).toBe('value')
        expect(decodeSideLine(nestedLine(256), RTB_SIDE_TAGS).kind).toBe('damaged')
    })

    test('the sv1 JSON is counted separately: 256 accepted, 257 damaged', () => {
        const nest = (levels: number): unknown => {
            let tree: unknown = 1
            for (let i = 0; i < levels; i++) {
                tree = [tree]
            }
            return tree
        }
        expect(decodeSideLine(sv1Tree(nest(256)), RTB_SIDE_TAGS).kind).toBe('value')
        expect(decodeSideLine(sv1Tree(nest(257)), RTB_SIDE_TAGS).kind).toBe('damaged')
    })

    test('the writer refuses a deeper line with RtbSideValueError, not RangeError', () => {
        expect(() => encodeSideLine('k', nestedValue(255), RTB_SIDE_TAGS)).not.toThrow()
        expect(() => encodeSideLine('k', nestedValue(256), RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
        expect(() => encodeSideLine('k', nestedValue(100_000), RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
        let deepUndefined: unknown = undefined
        for (let i = 0; i < 255; i++) {
            deepUndefined = [deepUndefined]
        }
        expect(() => encodeSideLine('k', deepUndefined, RTB_SIDE_TAGS)).not.toThrow()
        deepUndefined = [deepUndefined]
        expect(() => encodeSideLine('k', deepUndefined, RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
        let veryDeep: unknown = undefined
        for (let i = 0; i < 100_000; i++) {
            veryDeep = [veryDeep]
        }
        expect(() => encodeSideLine('k', veryDeep, RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
    })
})

describe('nodes, counted over the whole line (T25, guard)', () => {
    // `{"k":"a","j":[0,...]}` holds m + 3 nodes: 1, the `{`, the `[` and m - 1 commas, plus the comma after k.
    const lineOf = (count: number): string => `{"k":"a","j":[${'0,'.repeat(count - 1)}0]}`

    test('the count at the bound is accepted, one more is damaged before any parse', () => {
        const at = SIDE_VALUE_MAX_NODES - 3
        expect(scanSideJson(lineOf(at)).ok).toBe(true)
        expect(scanSideJson(lineOf(at + 1)).ok).toBe(false)
        expect(decodeSideLine(lineOf(at), RTB_SIDE_TAGS).kind).toBe('value')
        const parse = vi.spyOn(JSON, 'parse')
        expect(decodeSideLine(lineOf(at + 1), RTB_SIDE_TAGS).kind).toBe('damaged')
        expect(parse).not.toHaveBeenCalled()
    })

    test('the writer counts nodes during the walk and refuses a sparse array with a huge length', () => {
        const sparse: unknown[] = []
        sparse.length = 5_000_000
        const stringify = vi.spyOn(JSON, 'stringify')
        expect(() => encodeSideLine('k', sparse, RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
        // Only the key is stringified for the message; the value tree never is.
        expect(stringify.mock.calls.every(([argument]) => typeof argument === 'string')).toBe(true)
        stringify.mockRestore()
        expect(() => encodeSideLine('k', new Array<number>(SIDE_VALUE_MAX_NODES).fill(0), RTB_SIDE_TAGS)).toThrow(RtbSideValueError)
    })

    test('brackets inside a string do not count, even after an escaped quote', () => {
        expect(scanSideJson('{"k":"[[[[{{{,,,\\"[[["}').ok).toBe(true)
        // Without escape handling the string would close at the escaped quote and the
        // brackets after it would be counted past the depth bound.
        expect(scanSideJson(`{"k":"a\\"${'['.repeat(SIDE_VALUE_MAX_DEPTH + 50)}"}`).ok).toBe(true)
        expect(scanSideJson(`{"k":"a\\"${',['.repeat(100)}","j":1}`).ok).toBe(true)
    })

    test('an escaped backslash does not escape the closing quote', () => {
        // The string ends at the quote after `\\`, so the nesting after it is counted.
        const text = `{"k":"a\\\\","j":${'['.repeat(SIDE_VALUE_MAX_DEPTH)}${']'.repeat(SIDE_VALUE_MAX_DEPTH)}}`
        expect(scanSideJson(text).ok).toBe(false)
    })

    test('the node count across an escaped quote is exact', () => {
        const commas = (count: number): string => `{"k":"a\\",","j":[${'0,'.repeat(count - 1)}0]}`
        const at = SIDE_VALUE_MAX_NODES - 3
        expect(scanSideJson(commas(at)).ok).toBe(true)
        expect(scanSideJson(commas(at + 1)).ok).toBe(false)
    })
})
