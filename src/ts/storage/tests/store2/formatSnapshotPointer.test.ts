// @vitest-environment node
/**
 * The commit key's snapshot pointer, a known optional field: a malformed pointer reads as absent and never makes the
 * key damaged, a valid one (with its unknown members) is carried whole by `nextCommitKey`, and the drop member removes
 * the property without writing `null`. Each test says what it is: new behaviour, guard, or mutant (red under the named
 * in-memory mutant of the library, kept in the test name).
 */
import { describe, expect, test } from 'vitest'
import type { JsonObject, JsonValue } from 'src/ts/storage/blockFrame'
import { classifyCommitRead, firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, parseCommitKey, UNIT_TYPE, type CommitKey, type SnapshotPointer } from 'src/ts/storage/store2/format'

const POINTER: SnapshotPointer = {
    key: 'store2/g-abcdefghijklmnop-u0123456789abcdef',
    digest: '0123456789abcdef0123456789abcdef',
    count: 3,
}

function baseKey(over: Partial<CommitKey> = {}): CommitKey {
    return {
        fmt: 1,
        req: [],
        seq: 7,
        epoch: '00000000000000000000000001',
        current: { key: 'store2/m-0000001aaaaaaaaaaaaaaaaaaa', at: 1000 },
        retained: [],
        pins: [],
        staging: null,
        convertedFrom: null,
        convertedAt: null,
        ...over,
    }
}

const env = { random: (length: number) => Uint8Array.from({ length }, (_, i) => i) }

/** The commit key's JSON with `snapshot` replaced by `value` (`undefined` leaves the member out). */
function withSnapshot(value: JsonValue | undefined): JsonObject {
    const raw = JSON.parse(JSON.stringify(baseKey())) as JsonObject
    if (value !== undefined) {
        raw.snapshot = value
    }
    return raw
}

describe('reading the snapshot pointer', () => {
    test('new behaviour: a valid pointer parses whole, unknown members of the pointer included', () => {
        const parsed = parseCommitKey(withSnapshot({ ...POINTER, extra: { nested: [1, 2] } }))
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
            expect(parsed.value.snapshot).toEqual({ ...POINTER, extra: { nested: [1, 2] } })
        }
    })

    test('new behaviour: a key with no pointer has no snapshot property at all', () => {
        const parsed = parseCommitKey(withSnapshot(undefined))
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
            expect(Object.hasOwn(parsed.value, 'snapshot')).toBe(false)
        }
    })

    const MALFORMED: readonly (readonly [string, JsonValue])[] = [
        ['a string', 'x'],
        ['null', null],
        ['a number', 5],
        ['a list', [POINTER.key, POINTER.digest, POINTER.count]],
        ['an empty object', {}],
        ['a missing key', { digest: POINTER.digest, count: 3 }],
        ['a missing digest', { key: POINTER.key, count: 3 }],
        ['a missing count', { key: POINTER.key, digest: POINTER.digest }],
        ['a non-string key', { ...POINTER, key: 5 }],
        ['a key outside store2', { ...POINTER, key: 'blocks/x' }],
        ['an empty store2 key', { ...POINTER, key: 'store2/' }],
        ['a non-string digest', { ...POINTER, digest: 12 }],
        ['a digest of the wrong length', { ...POINTER, digest: 'abcd' }],
        ['an upper-case digest', { ...POINTER, digest: 'ABCDEF0123456789ABCDEF0123456789' }],
        ['a digest of non-hex characters', { ...POINTER, digest: 'zz23456789abcdef0123456789abcdef' }],
        ['a negative count', { ...POINTER, count: -1 }],
        ['a fractional count', { ...POINTER, count: 1.5 }],
        ['a count beyond the safe integers', { ...POINTER, count: 2 ** 60 }],
        ['a string count', { ...POINTER, count: '3' }],
    ]

    test.each(MALFORMED)('mutant "a malformed pointer makes the key damaged": %s reads as absent and the key is ok', (_name, value) => {
        const parsed = parseCommitKey(withSnapshot(value))
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
            expect(Object.hasOwn(parsed.value, 'snapshot')).toBe(false)
            expect(parsed.value.seq).toBe(7)
        }
    })

    test('guard: readCommitKey never throws on a malformed pointer through the framed read either', () => {
        for (const [, value] of MALFORMED) {
            const bytes = encodeUnit(UNIT_TYPE.commit, withSnapshot(value))
            expect(() => classifyCommitRead({ bytes })).not.toThrow()
            expect(classifyCommitRead({ bytes }).status).toBe('parsed')
        }
    })

    test('new behaviour: an unrelated damaged field still damages the key (the pointer rule is not a blanket leniency)', () => {
        const raw = withSnapshot({ ...POINTER })
        raw.seq = -1
        expect(parseCommitKey(raw).status).toBe('damaged')
    })
})

describe('writing the snapshot pointer', () => {
    test('new behaviour: nextCommitKey carries the pointer whole, as a copy', () => {
        const base = baseKey({ snapshot: { ...POINTER, extra: { nested: [1] } } as SnapshotPointer })
        const next = nextCommitKey(base, { staging: null }, env)
        expect(next.snapshot).toEqual(base.snapshot)
        expect(next.snapshot).not.toBe(base.snapshot)
    })

    test('mutant "nextCommitKey omits the pointer": the carried pointer is present in the next key', () => {
        const next = nextCommitKey(baseKey({ snapshot: POINTER }), { pins: [{ key: 'store2/m-0000001aaaaaaaaaaaaaaaaaaa', reason: 'p' }] }, env)
        expect(next.snapshot).toEqual(POINTER)
    })

    test('new behaviour: a change may set the pointer, and the key stays framed and readable with it', () => {
        const next = nextCommitKey(baseKey(), { snapshot: POINTER }, env)
        const read = classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, next) })
        expect(read.status).toBe('parsed')
        expect(read.status === 'parsed' ? read.value.snapshot : null).toEqual(POINTER)
        expect(firstCommitKey({ current: null, staging: null, snapshot: POINTER }, env).snapshot).toEqual(POINTER)
    })

    test('mutant "the drop member writes null": the property is gone from the key and from its bytes', () => {
        const next = nextCommitKey(baseKey({ snapshot: POINTER }), { dropSnapshot: true }, env)
        expect(Object.hasOwn(next, 'snapshot')).toBe(false)
        expect(next.snapshot).toBeUndefined()
        const bytes = encodeUnit(UNIT_TYPE.commit, next)
        expect(Buffer.from(bytes).includes('snapshot')).toBe(false)
    })

    test('guard: dropping where there is no pointer writes no property either, and setting plus dropping is refused', () => {
        expect(Object.hasOwn(nextCommitKey(baseKey(), { dropSnapshot: true }, env), 'snapshot')).toBe(false)
        expect(() => nextCommitKey(baseKey(), { snapshot: POINTER, dropSnapshot: true }, env)).toThrow(TypeError)
    })

    test('new behaviour: a malformed pointer is dropped by the next writer (nothing carries its bytes)', () => {
        const parsed = classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, withSnapshot({ ...POINTER, count: -1 })) })
        expect(parsed.status).toBe('parsed')
        if (parsed.status !== 'parsed') {
            return
        }
        const next = nextCommitKey(parsed.value, {}, env)
        expect(Object.hasOwn(next, 'snapshot')).toBe(false)
        expect(Buffer.from(encodeUnit(UNIT_TYPE.commit, next)).includes('snapshot')).toBe(false)
    })

    test('guard: a pointer survives a framed round trip byte-equal', () => {
        const key = nextCommitKey(baseKey(), { snapshot: { ...POINTER, extra: [1, 'x'] } as SnapshotPointer }, env)
        const bytes = encodeUnit(UNIT_TYPE.commit, key)
        const read = classifyCommitRead({ bytes })
        expect(read.status === 'parsed' ? Array.from(encodeUnit(UNIT_TYPE.commit, read.value)) : []).toEqual(Array.from(bytes))
    })
})
