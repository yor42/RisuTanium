/**
 * The exact comparison and the persisted names of `mainFileRecord.ts`, against
 * the real record and the real `crypto.subtle`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    digestMainFileBytes,
    getMainFileRecordDigest,
    matchesMainFileRecord,
    noteMainFileBytes,
    resetMainFileRecordForTests,
} from '../mainFileRecord'

const realCrypto = globalThis.crypto

/** Deterministic bytes of a given length. */
function bytesOf(length: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed) & 0xff
    }
    return bytes
}

const SLICE = 4 * 1024 * 1024

function withoutSubtle() {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto), randomUUID: realCrypto.randomUUID.bind(realCrypto), subtle: undefined })
}

beforeEach(() => {
    resetMainFileRecordForTests()
})

afterEach(() => {
    vi.stubGlobal('crypto', realCrypto)
})

describe('matchesMainFileRecord', () => {
    test('is false without a record', async () => {
        expect(await matchesMainFileRecord(bytesOf(10, 1))).toBe(false)
    })

    test.each([0, 1, SLICE - 1, SLICE, SLICE + 1, 2 * SLICE + 17])('is true for the recorded bytes and false for one changed byte, at length %i', async (length) => {
        const bytes = bytesOf(length, 3)
        noteMainFileBytes(bytes)
        expect(await matchesMainFileRecord(bytes.slice())).toBe(true)
        if (length > 0) {
            const changed = bytes.slice()
            changed[length - 1] ^= 1
            expect(await matchesMainFileRecord(changed)).toBe(false)
            const front = bytes.slice()
            front[0] ^= 1
            expect(await matchesMainFileRecord(front)).toBe(false)
        }
        expect(await matchesMainFileRecord(new Uint8Array(length + 1))).toBe(false)
    })

    test('is false when the record is the sampled form, even for the very same bytes', async () => {
        withoutSubtle()
        const bytes = bytesOf(100, 5)
        noteMainFileBytes(bytes)
        expect(await matchesMainFileRecord(bytes.slice())).toBe(false)
    })

    test('is false when a newer note replaces the record while the comparison runs', async () => {
        const bytes = bytesOf(2 * SLICE, 7)
        noteMainFileBytes(bytes)
        const answer = matchesMainFileRecord(bytes.slice())
        noteMainFileBytes(bytesOf(3, 9))
        expect(await answer).toBe(false)
    })

    test('is false when the native digest throws', async () => {
        const bytes = bytesOf(100, 2)
        noteMainFileBytes(bytes)
        await getMainFileRecordDigest()
        vi.stubGlobal('crypto', { subtle: { digest: async () => { throw new Error('digest unavailable') } } })
        expect(await matchesMainFileRecord(bytes.slice())).toBe(false)
    })
})

describe('the persisted names', () => {
    test.each([0, 5, SLICE + 3])('the record and equal bytes have the same name, at length %i', async (length) => {
        const bytes = bytesOf(length, 11)
        noteMainFileBytes(bytes)
        const recorded = await getMainFileRecordDigest()
        expect(recorded).toMatch(/^sha256:\d+:[0-9a-f]{64}$/)
        expect(await digestMainFileBytes(bytes.slice())).toBe(recorded)
    })

    test('different bytes of the same length have different names', async () => {
        const first = bytesOf(100, 1)
        const second = first.slice()
        second[50] ^= 1
        expect(await digestMainFileBytes(first)).not.toBe(await digestMainFileBytes(second))
    })

    test('the record has no name without a record, and no name when it is the sampled form', async () => {
        expect(await getMainFileRecordDigest()).toBeNull()
        withoutSubtle()
        noteMainFileBytes(bytesOf(100, 1))
        expect(await getMainFileRecordDigest()).toBeNull()
    })

    test('bytes have no name without the native digest', async () => {
        withoutSubtle()
        expect(await digestMainFileBytes(bytesOf(100, 1))).toBeNull()
    })
})
