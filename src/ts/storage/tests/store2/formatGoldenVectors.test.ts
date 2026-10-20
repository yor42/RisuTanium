import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import {
    decodeFrame, encodeUnit, parseCommitKey, parseDeletionSnapshot, readUnit, refsOf, snapshotCountMatches, UNIT_TYPE, UNIT_TYPE_IDS,
    UNITS_WITHOUT_REFS, type CommitKey, type UnitType,
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
        for (let n = 1; n <= 14; n++) {
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
        const headerForeign = vector.fmt !== 1 || vector.codec !== 0 || vector.reserved !== 0 || vector.type > Math.max(...UNIT_TYPE_IDS)
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

    test('new behaviour: the snapshot-pointer vector parses with its pointer; the malformed one parses as a normal key with none', () => {
        const parse = (id: string): CommitKey => {
            const read = readUnit(hexToBytes(byId(id).hex), 1)
            if (read.status !== 'ok') {
                throw new Error(`${id} did not parse: ${read.status}`)
            }
            return read.value.body as CommitKey
        }
        expect(parse('commit-13-snapshot-pointer').snapshot).toEqual({
            key: 'store2/g-abcdefghijklmnop-u0123456789abcdef', digest: '0123456789abcdef0123456789abcdef', count: 3,
        })
        const malformed = parse('commit-14-snapshot-pointer-malformed')
        expect(malformed.snapshot).toBeUndefined()
        expect(Object.hasOwn(malformed, 'snapshot')).toBe(false)
        expect(malformed).toMatchObject({ seq: 1, staging: null })
        expect(malformed.current).not.toBeNull()
    })

    test('guard: every vector that predates the pointer keeps its committed bytes (SHA-256 prefix taken before the field existed) and holds no pointer', () => {
        const committed: Record<string, string> = {
            'type-01-commit': '4ecb092cc27f66e7',
            'commit-01-current-req-empty': '4ecb092cc27f66e7',
            'commit-02-null-current-recovery': '401fcdec2770e53b',
            'commit-03-null-current-convert': '441befed8cde3b6b',
            'commit-04-null-current-no-staging': '0f6e9b3dcdabc3a4',
            'commit-05-fmt-2': '1e30b69999ca08ea',
            'commit-05b-body-fmt-2': '15bf1cd56acc3825',
            'commit-06-unknown-req': '2844dfc0d1c8debb',
            'commit-07-20-retained-2-pins': '90465200d10d363e',
            'commit-08-codec-1': '86d05910a112b31c',
            'commit-09-reserved-1': '0f1f4779957f0a62',
            'commit-10-unknown-type': 'c8492de3233d7e36',
            'commit-11-null-current-import': 'fa248dd61b5e972c',
            'commit-12-null-current-seed': 'e700fa94a304ced1',
        }
        for (const [id, prefix] of Object.entries(committed)) {
            const bytes = Buffer.from(byId(id).hex, 'hex')
            expect(createHash('sha256').update(bytes).digest('hex').startsWith(prefix), id).toBe(true)
            expect(bytes.includes('snapshot'), id).toBe(false)
        }
        const commitIds = GOLDEN_VECTORS.map(vector => vector.id).filter(id => id.startsWith('commit-') && !id.startsWith('commit-13-') && !id.startsWith('commit-14-'))
        expect(commitIds.sort()).toEqual(Object.keys(committed).filter(id => id.startsWith('commit-')).sort())
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

describe('type 24, the deletion snapshot', () => {
    const BODY = {
        v: 1,
        kind: 'fork-only',
        upstream: { main: false, backups: [] as string[] },
        keys: ['coldstorage/00000000-0000-4000-8000-000000000000', 'blocks/head'],
    }
    const statusOf = (payload: object): string => readUnit(oracleFrame(24, JSON.stringify(payload))).status

    test('new behaviour: the golden vector round trips its body, extra members included, and re-encodes to the committed bytes', () => {
        const bytes = hexToBytes(byId('type-24-deletion-snapshot').hex)
        const read = readUnit(bytes, UNIT_TYPE.deletionSnapshot)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        expect(read.value.body).toEqual({
            v: 1,
            kind: 'exclusion',
            upstream: { main: true, backups: ['database/dbbackup-1.bin'] },
            keys: ['coldstorage/00000000-0000-4000-8000-000000000000', 'blocks/head'],
        })
        expect(bytesToHex(encodeUnit(UNIT_TYPE.deletionSnapshot, read.value.body))).toBe(byId('type-24-deletion-snapshot').hex)
        const withExtras = { ...BODY, later: { n: 1 }, upstream: { ...BODY.upstream, laterToo: [2] } }
        const carried = readUnit(oracleFrame(24, JSON.stringify(withExtras)))
        expect(carried.status === 'ok' ? JSON.parse(JSON.stringify(carried.value.body)) : null).toEqual(withExtras)
    })

    test('new behaviour: a body version above this build\'s is too-new, never damaged; below 1 is damaged', () => {
        expect(statusOf({ ...BODY, v: 2 })).toBe('too-new')
        expect(statusOf({ ...BODY, v: 0 })).toBe('damaged')
        expect(statusOf(BODY)).toBe('ok')
    })

    test.each([
        ['an unknown kind', { ...BODY, kind: 'everything' }],
        ['a missing kind', { ...BODY, kind: undefined }],
        ['a duplicate key', { ...BODY, keys: ['blocks/head', 'blocks/head'] }],
        ['a key outside the allowlist: the upstream main file', { ...BODY, keys: ['database/database.bin'] }],
        ['a key outside the allowlist: a numbered backup', { ...BODY, keys: ['database/dbbackup-1.bin'] }],
        ['a key outside the allowlist: an asset', { ...BODY, keys: ['assets/x'] }],
        ['a key outside the allowlist: the commit key', { ...BODY, keys: ['store2-commit'] }],
        ['a key outside the allowlist: a traversal spelling', { ...BODY, keys: ['blocks/../assets/x'] }],
        ['keys that is not a list', { ...BODY, keys: 'blocks/head' }],
        ['a non-string key', { ...BODY, keys: [5] }],
        ['a missing upstream', { ...BODY, upstream: undefined }],
        ['an upstream main that is not a boolean', { ...BODY, upstream: { main: 'yes', backups: [] } }],
        ['upstream backups that is not a list', { ...BODY, upstream: { main: false, backups: 'x' } }],
    ])('new behaviour: %s reads as damaged and never throws, so the pass that needs the list deletes nothing', (_name, payload) => {
        expect(statusOf(payload)).toBe('damaged')
    })

    test('new behaviour: the unit names no other unit (refsOf is empty) and the type is on the no-refs list', () => {
        expect(refsOf(UNIT_TYPE.deletionSnapshot, BODY)).toEqual([])
        expect(UNITS_WITHOUT_REFS).toContain(UNIT_TYPE.deletionSnapshot)
    })

    test('new behaviour: the pointer count is checked against the number of keys', () => {
        const digest = '0123456789abcdef0123456789abcdef'
        const parsed = parseDeletionSnapshot(BODY)
        expect(parsed.status).toBe('ok')
        if (parsed.status !== 'ok') {
            return
        }
        expect(snapshotCountMatches({ key: 'store2/u-0123456789abcdefghijklmnop', digest, count: 2 }, parsed.value)).toBe(true)
        expect(snapshotCountMatches({ key: 'store2/u-0123456789abcdefghijklmnop', digest, count: 3 }, parsed.value)).toBe(false)
    })
})
