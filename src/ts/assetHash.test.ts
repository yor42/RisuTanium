/**
 * The owned SHA-256 of `assetHash.ts` against `node:crypto`: block and padding
 * boundaries, arbitrary splits of one message into updates, and a message past
 * 2^32 bits, where a 32-bit length counter would change the digest.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { HASH_PIECE_BYTES, Sha256, sha256Hex } from './assetHash'

function reference(...parts: Uint8Array[]): string {
    const hash = createHash('sha256')
    for (const part of parts) {
        hash.update(part)
    }
    return hash.digest('hex')
}

/** A deterministic byte stream: the same seed gives the same bytes. */
function randomBytes(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0 || 1
    for (let i = 0; i < length; i++) {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        out[i] = state & 0xff
    }
    return out
}

function ownedHex(...parts: Uint8Array[]): string {
    const hash = new Sha256()
    for (const part of parts) {
        hash.update(part)
    }
    return hash.digestHex()
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the owned SHA-256 core', () => {
    test.each([0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1024 * 1024 + 7])(
        'guard: a message of %i bytes hashes like node:crypto',
        (length) => {
            const bytes = randomBytes(length, length + 11)

            expect(ownedHex(bytes)).toBe(reference(bytes))
        },
    )

    test('guard: the digest of the empty message and of "abc" are the published values', () => {
        expect(ownedHex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        expect(ownedHex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    })

    test('guard: any split of a message into updates gives the digest of the whole', () => {
        const bytes = randomBytes(5000, 7)
        const expected = reference(bytes)
        let state = 12345
        const next = (limit: number): number => {
            state = (state * 1103515245 + 12345) & 0x7fffffff
            return state % limit
        }

        for (let round = 0; round < 60; round++) {
            const parts: Uint8Array[] = []
            for (let at = 0; at < bytes.length;) {
                const size = next(4) === 0 ? 0 : next(200)
                parts.push(bytes.subarray(at, Math.min(at + size, bytes.length)))
                at += size
            }

            expect(ownedHex(...parts), `round ${round}`).toBe(expected)
        }
    })

    test('guard: every split point of a short message into two updates gives the digest of the whole', () => {
        const bytes = randomBytes(200, 3)
        const expected = reference(bytes)

        for (let at = 0; at <= bytes.length; at++) {
            expect(ownedHex(bytes.subarray(0, at), bytes.subarray(at)), `split ${at}`).toBe(expected)
        }
    })

    test('guard: a message of 2^32 bits and more hashes like node:crypto', () => {
        const piece = randomBytes(4 * 1024 * 1024, 99)
        const tail = randomBytes(5, 100)
        const pieces = (512 * 1024 * 1024) / piece.length
        const owned = new Sha256()
        const node = createHash('sha256')
        for (let i = 0; i < pieces; i++) {
            owned.update(piece)
            node.update(piece)
        }
        owned.update(tail)
        node.update(tail)

        expect(owned.digestHex()).toBe(node.digest('hex'))
    }, 120_000)

    test('guard: a hasher accepts nothing after its digest', () => {
        const hash = new Sha256()
        hash.update(new Uint8Array(3))
        hash.digestHex()

        expect(() => hash.update(new Uint8Array(1))).toThrow()
        expect(() => hash.digestHex()).toThrow()
    })
})

describe('sha256Hex', () => {
    test('guard: with crypto.subtle it gives the node:crypto digest as lowercase hex', async () => {
        const bytes = randomBytes(1234, 5)

        expect(await sha256Hex(bytes)).toBe(reference(bytes))
        expect(await sha256Hex(bytes.subarray(10, 20))).toBe(reference(bytes.subarray(10, 20)))
    })

    test('new behaviour: without crypto.subtle it gives the same digest, and yields to the event loop between pieces of a large buffer', async () => {
        const bytes = randomBytes(HASH_PIECE_BYTES * 2 + 123, 8)
        const withSubtle = await sha256Hex(bytes)
        vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
        const yields = vi.spyOn(globalThis, 'setTimeout')

        const withoutSubtle = await sha256Hex(bytes)

        expect(withoutSubtle).toBe(withSubtle)
        expect(withoutSubtle).toBe(reference(bytes))
        expect(yields).toHaveBeenCalledTimes(2)
    })

    test('guard: the empty buffer hashes without crypto.subtle', async () => {
        vi.stubGlobal('crypto', {})

        expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })
})
