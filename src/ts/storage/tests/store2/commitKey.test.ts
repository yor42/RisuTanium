import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import {
    classifyCommitRead, firstCommitKey, nextCommitKey, RETAINED_MAX, type CommitRead,
} from '../../store2/commitKey'
import { digits26, encodeUnit, UNIT_TYPE, type CommitKey } from '../../store2/format'
import { GOLDEN_VECTORS, hexToBytes } from './goldenVectors'

const KEY_A = 'store2/m-0000001aaaaaaaaaaaaaaaaaaa'
const KEY_B = 'store2/m-0000002bbbbbbbbbbbbbbbbbbb'
const KEY_P = 'store2/m-0000003ppppppppppppppppppp'
const EPOCH_BASE = '00000000000000000000000001'

function sequentialRandom(first: number): (length: number) => Uint8Array {
    let next = first
    return (length) => Uint8Array.from({ length }, () => next++ & 0xFF)
}

function baseKey(over: Partial<CommitKey> = {}): CommitKey {
    return {
        fmt: 1,
        req: [],
        seq: 7,
        epoch: EPOCH_BASE,
        current: { key: KEY_A, at: 1000 },
        retained: [],
        pins: [],
        staging: null,
        convertedFrom: null,
        convertedAt: null,
        ...over,
    }
}

function parsedOf(read: CommitRead): CommitKey {
    if (read.status !== 'parsed') {
        throw new Error(`Expected a parsed commit key, got ${read.status}.`)
    }
    return read.value
}

/** The commit key as it travels: framed, then read back. */
function roundTrip(key: CommitKey): CommitKey {
    return parsedOf(classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, key) }))
}

describe('classifyCommitRead', () => {
    test('a null read is absent', () => {
        expect(classifyCommitRead({ bytes: null })).toEqual({ status: 'absent' })
    })

    test('golden vectors 1 to 12 classify as the vector set says, none of them absent', () => {
        const numbered = new Set<number>()
        for (const vector of GOLDEN_VECTORS.filter(entry => entry.id.startsWith('commit-'))) {
            const read = classifyCommitRead({ bytes: hexToBytes(vector.hex) })
            const wanted = vector.expect === 'ok' ? 'parsed' : vector.expect
            expect(read.status, vector.id).toBe(wanted)
            numbered.add(Number(vector.id.slice('commit-'.length, 'commit-'.length + 2)))
        }
        for (let n = 1; n <= 12; n++) {
            expect(numbered.has(n), `vector ${n}`).toBe(true)
        }
    })

    test('too-new covers fmt 2, an unknown req token, a codec, a reserved byte and a type outside the known set', () => {
        const byPrefix = (prefix: string) => GOLDEN_VECTORS.filter(entry => entry.id.startsWith(prefix))
        for (const prefix of ['commit-05-', 'commit-06-', 'commit-08-', 'commit-09-', 'commit-10-']) {
            const found = byPrefix(prefix)
            expect(found.length, prefix).toBeGreaterThan(0)
            for (const vector of found) {
                expect(classifyCommitRead({ bytes: hexToBytes(vector.hex) }).status, vector.id).toBe('too-new')
            }
        }
    })

    test('a parsed vector carries the labels the plan names (vectors 2, 3, 11, 12)', () => {
        const label = (prefix: string): string | undefined => {
            const vector = GOLDEN_VECTORS.find(entry => entry.id.startsWith(prefix))
            expect(vector, prefix).toBeDefined()
            return parsedOf(classifyCommitRead({ bytes: hexToBytes(vector!.hex) })).staging?.label
        }
        expect(label('commit-02-')).toBe('recovery')
        expect(label('commit-03-')).toBe('convert')
        expect(label('commit-11-')).toBe('import')
        expect(label('commit-12-')).toBe('seed')
    })

    test('a bad magic, a flipped payload byte, a cut-off frame and a non-JSON payload are damaged', () => {
        const good = encodeUnit(UNIT_TYPE.commit, baseKey())
        const badMagic = good.slice()
        badMagic[0] ^= 0xFF
        const badPayload = good.slice()
        badPayload[20] ^= 0xFF
        expect(classifyCommitRead({ bytes: badMagic }).status).toBe('damaged')
        expect(classifyCommitRead({ bytes: badPayload }).status).toBe('damaged')
        expect(classifyCommitRead({ bytes: good.slice(0, 10) }).status).toBe('damaged')
        expect(classifyCommitRead({ bytes: new Uint8Array(0) }).status).toBe('damaged')
    })

    test('a framed body that fails the schema is damaged, and a body of fmt 2 is too-new', () => {
        const shortEpoch = encodeUnit(UNIT_TYPE.commit, { ...baseKey(), epoch: 'abc' })
        const noSeq: JsonObject = { ...baseKey() } as unknown as JsonObject
        delete noSeq.seq
        expect(classifyCommitRead({ bytes: shortEpoch }).status).toBe('damaged')
        expect(classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, noSeq) }).status).toBe('damaged')
        expect(classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, { ...baseKey(), fmt: 2 }) }).status).toBe('too-new')
        expect(classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, { ...baseKey(), req: ['unknown-feature'] }) }).status).toBe('too-new')
    })

    test('a frame of another unit type under the commit key is damaged, not a commit key', () => {
        const asShard = encodeUnit(UNIT_TYPE.shard, { v: 1, entries: [] })
        expect(classifyCommitRead({ bytes: asShard }).status).toBe('damaged')
    })
})

describe('nextCommitKey', () => {
    test('seq is one above the base and the epoch is fresh from the injected random source', () => {
        const next = nextCommitKey(baseKey(), {}, { random: sequentialRandom(1) })
        expect(next.seq).toBe(8)
        expect(next.epoch).toBe(digits26(Uint8Array.from({ length: 16 }, (_, i) => i + 1)))
        expect(next.epoch).toMatch(/^[0-9a-v]{26}$/)
        expect(next.epoch).not.toBe(EPOCH_BASE)
    })

    test('two writes over the same base draw different epochs', () => {
        const random = sequentialRandom(1)
        const first = nextCommitKey(baseKey(), {}, { random })
        const second = nextCommitKey(baseKey(), {}, { random })
        expect(first.epoch).not.toBe(second.epoch)
    })

    test('the default random source is a CSPRNG draw of 26 digits', () => {
        const next = nextCommitKey(baseKey(), {})
        expect(next.epoch).toMatch(/^[0-9a-v]{26}$/)
    })

    test('req is the union of the base, the writer and every named manifest, and never loses a token', () => {
        const base = baseKey({ req: ['x'] })
        const lowered = nextCommitKey(base, { req: [] }, { random: sequentialRandom(1) })
        expect(lowered.req).toEqual(['x'])
        const widened = nextCommitKey(base, { req: ['y'], manifests: [{ req: ['z'] }, { req: ['x', 'w'] }] }, { random: sequentialRandom(1) })
        expect(widened.req).toEqual(['w', 'x', 'y', 'z'])
        expect(nextCommitKey(baseKey(), {}, { random: sequentialRandom(1) }).req).toEqual([])
    })

    test('a field left out keeps the base value, so a clear of a marker writes back exactly what it read', () => {
        const base = baseKey({
            current: null,
            staging: { owner: 'o', prefix: 'store2/g-0000000000000001-', startedAt: 5, label: 'recovery' },
            retained: [{ key: KEY_B, at: 900 }],
            pins: [{ key: KEY_P, reason: 'keep' }],
            convertedFrom: 'database/database.bin',
            convertedAt: 42,
        })
        const cleared = nextCommitKey(base, { staging: null }, { random: sequentialRandom(1) })
        expect(cleared.current).toBeNull()
        expect(cleared.staging).toBeNull()
        expect(cleared.retained).toEqual(base.retained)
        expect(cleared.pins).toEqual(base.pins)
        expect(cleared.convertedFrom).toBe('database/database.bin')
        expect(cleared.convertedAt).toBe(42)
    })

    test('a change replaces current and the converted fields only when it names them', () => {
        const next = nextCommitKey(baseKey(), { current: { key: KEY_B, at: 2000 }, convertedFrom: 'old', convertedAt: 9 }, { random: sequentialRandom(1) })
        expect(next.current).toEqual({ key: KEY_B, at: 2000 })
        expect(next.convertedFrom).toBe('old')
        expect(next.convertedAt).toBe(9)
    })

    test('retained is capped at 20, newest first, keeping the front of the list', () => {
        const many = Array.from({ length: 25 }, (_, i) => ({ key: `store2/m-${String(i).padStart(7, '0')}${'a'.repeat(19)}`, at: 100 - i }))
        const next = nextCommitKey(baseKey(), { retained: many }, { random: sequentialRandom(1) })
        expect(RETAINED_MAX).toBe(20)
        expect(next.retained).toHaveLength(20)
        expect(next.retained[0]).toEqual(many[0])
        expect(next.retained[19]).toEqual(many[19])
        expect(roundTrip(next).retained).toHaveLength(20)
    })

    test('unknown fields at every level of a parsed key travel into the next write and through the frame', () => {
        const withExtras = {
            ...baseKey({
                retained: [{ key: KEY_B, at: 900 }],
                pins: [{ key: KEY_P, reason: 'keep' }],
                staging: { owner: 'o', prefix: 'store2/g-0000000000000001-', startedAt: 5, label: 'bulk' },
            }),
            futureTop: { n: 1 },
        } as unknown as JsonObject
        ;(withExtras.current as JsonObject).futureCurrent = 'c'
        ;((withExtras.retained as JsonObject[])[0]).futureRetained = 'r'
        ;((withExtras.pins as JsonObject[])[0]).futurePin = 'p'
        ;(withExtras.staging as JsonObject).futureStaging = 's'
        const base = parsedOf(classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, withExtras) }))
        const next = roundTrip(nextCommitKey(base, {}, { random: sequentialRandom(1) })) as unknown as JsonObject
        expect(next.futureTop).toEqual({ n: 1 })
        expect((next.current as JsonObject).futureCurrent).toBe('c')
        expect(((next.retained as JsonObject[])[0]).futureRetained).toBe('r')
        expect(((next.pins as JsonObject[])[0]).futurePin).toBe('p')
        expect((next.staging as JsonObject).futureStaging).toBe('s')
    })

    test('the result shares nothing mutable with the base', () => {
        const base = baseKey({ pins: [{ key: KEY_P, reason: 'keep' }], retained: [{ key: KEY_B, at: 1 }] })
        const next = nextCommitKey(base, {}, { random: sequentialRandom(1) })
        next.pins[0].reason = 'changed'
        next.retained[0].at = 99
        next.current!.at = 77
        expect(base.pins[0].reason).toBe('keep')
        expect(base.retained[0].at).toBe(1)
        expect(base.current!.at).toBe(1000)
    })

    test('the written key reads back as a parsed commit key with the new seq', () => {
        const next = nextCommitKey(baseKey(), { current: { key: KEY_B, at: 3 } }, { random: sequentialRandom(3) })
        expect(roundTrip(next)).toEqual(next)
    })
})

describe('firstCommitKey', () => {
    test('is seq 1 with a fresh epoch, nothing retained or pinned and no conversion record by default', () => {
        const first = firstCommitKey({ current: null, staging: { owner: 'o', prefix: 'store2/g-0000000000000001-', startedAt: 5, label: 'seed' } }, { random: sequentialRandom(1) })
        expect(first).toMatchObject({ fmt: 1, req: [], seq: 1, current: null, retained: [], pins: [], convertedFrom: null, convertedAt: null })
        expect(first.epoch).toBe(digits26(Uint8Array.from({ length: 16 }, (_, i) => i + 1)))
        expect(first.staging?.label).toBe('seed')
        expect(roundTrip(first)).toEqual(first)
    })

    test('carries a conversion record, the req of the manifests it names and the retained cap', () => {
        const many = Array.from({ length: 22 }, (_, i) => ({ key: `store2/m-${String(i).padStart(7, '0')}${'a'.repeat(19)}`, at: i }))
        const first = firstCommitKey({
            current: { key: KEY_A, at: 1 }, staging: null, convertedFrom: 'database/database.bin', convertedAt: 10,
            retained: many, req: ['q'], manifests: [{ req: ['m'] }],
        }, { random: sequentialRandom(1) })
        expect(first.convertedFrom).toBe('database/database.bin')
        expect(first.convertedAt).toBe(10)
        expect(first.retained).toHaveLength(20)
        expect(first.req).toEqual(['m', 'q'])
    })
})
