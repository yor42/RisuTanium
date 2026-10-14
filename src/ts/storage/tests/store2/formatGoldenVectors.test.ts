import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import {
    decodeFrame, encodeUnit, parseCommitKey, readUnit, UNIT_TYPE_IDS, type CommitKey, type UnitType,
} from '../../store2/format'
import { bytesToHex, GOLDEN_VECTORS, hexToBytes, oracleFrame, type GoldenVector } from './goldenVectors'

/** The JSON inside a frame, cut out by offset: no code under test. */
function payloadJson(bytes: Uint8Array): JsonObject {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(16, bytes.length - 4))) as JsonObject
}

const byId = (id: string): GoldenVector => {
    const found = GOLDEN_VECTORS.find(vector => vector.id === id)
    if (!found) {
        throw new Error(`No golden vector ${id}.`)
    }
    return found
}

describe('golden vector set', () => {
    test('ids are unique and every promised vector is present', () => {
        const ids = GOLDEN_VECTORS.map(vector => vector.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const type of UNIT_TYPE_IDS) {
            expect(ids.some(id => id.startsWith(`type-${String(type).padStart(2, '0')}-`))).toBe(true)
        }
        for (let n = 1; n <= 12; n++) {
            expect(ids.some(id => id.startsWith(`commit-${String(n).padStart(2, '0')}-`))).toBe(true)
        }
        for (let n = 1; n <= 6; n++) {
            expect(ids.some(id => id.startsWith(`fence-F${n}-`))).toBe(true)
        }
        for (const id of ['manifest-fmt-2', 'unit-frame-fmt-2', 'manifest-unknown-req', 'asset-list-v2']) {
            expect(ids).toContain(id)
        }
    })

    test('the committed hex is what the independent oracle builds from the committed payload', () => {
        for (const vector of GOLDEN_VECTORS) {
            const built = oracleFrame(vector.type, vector.payload, { fmt: vector.fmt, codec: vector.codec, reserved: vector.reserved })
            expect(bytesToHex(built), vector.id).toBe(vector.hex)
        }
    })
})

describe.each(GOLDEN_VECTORS.map(vector => [vector.id, vector] as const))('vector %s', (_id, vector) => {
    const bytes = hexToBytes(vector.hex)

    test('decode and parse give the expected classification', () => {
        const read = readUnit(bytes)
        expect(read.status).toBe(vector.expect)
        if (read.status === 'ok') {
            expect(read.value.type).toBe(vector.type)
        }
    })

    test('the frame result matches the header bytes', () => {
        const frame = decodeFrame(bytes)
        const headerForeign = vector.fmt !== 1 || vector.codec !== 0 || vector.reserved !== 0 || vector.type > 23
        if (headerForeign) {
            expect(frame.status).toBe('too-new')
        } else {
            expect(frame.status).toBe('ok')
        }
    })

    test.runIf(vector.encodable)('the encoder reproduces the stored bytes', () => {
        const encoded = encodeUnit(vector.type as UnitType, payloadJson(bytes))
        expect(bytesToHex(encoded)).toBe(vector.hex)
    })
})

describe('vector contents that carry meaning', () => {
    test('commit key vectors 1 to 4, 7, 11 and 12 parse with their labels and counts', () => {
        const parse = (id: string): CommitKey => {
            const read = readUnit(hexToBytes(byId(id).hex), 1)
            if (read.status !== 'ok') {
                throw new Error(`${id} did not parse: ${read.status}`)
            }
            return read.value.body as CommitKey
        }
        expect(parse('commit-01-current-req-empty')).toMatchObject({ req: [], staging: null })
        expect(parse('commit-01-current-req-empty').current).not.toBeNull()
        expect(parse('commit-02-null-current-recovery')).toMatchObject({ current: null, staging: { label: 'recovery' } })
        expect(parse('commit-03-null-current-convert')).toMatchObject({ current: null, staging: { label: 'convert' } })
        expect(parse('commit-04-null-current-no-staging')).toMatchObject({ current: null, staging: null })
        expect(parse('commit-07-20-retained-2-pins').retained).toHaveLength(20)
        expect(parse('commit-07-20-retained-2-pins').pins).toHaveLength(2)
        expect(parse('commit-11-null-current-import').staging?.label).toBe('import')
        expect(parse('commit-12-null-current-seed').staging?.label).toBe('seed')
    })

    test('fence vector F1 keeps the prior commit key verbatim and it still parses; F5 keeps the damaged fence bytes', () => {
        const f1 = payloadJson(hexToBytes(byId('fence-F1-one-prior-commit').hex)) as { priorCommits: { bytes: string }[] }
        const kept = new Uint8Array(Buffer.from(f1.priorCommits[0].bytes, 'base64url'))
        expect(bytesToHex(kept)).toBe(byId('commit-01-current-req-empty').hex)
        const parsed = parseCommitKey(payloadJson(kept))
        expect(parsed.status).toBe('ok')
        const f5 = payloadJson(hexToBytes(byId('fence-F5-exit-over-unparsable').hex)) as { priorFences: { bytes: string }[], keys: string[] }
        expect(Buffer.from(f5.priorFences[0].bytes, 'base64url').toString('utf8')).toBe('{"at":1,')
        expect(f5.keys).toHaveLength(2)
    })

    test('fence vector F6 is the unparsable bytes themselves: frame intact, payload not JSON', () => {
        const bytes = hexToBytes(byId('fence-F6-unparsable-fence-bytes').hex)
        expect(decodeFrame(bytes).status).toBe('ok')
        expect(readUnit(bytes).status).toBe('damaged')
    })
})
