import { describe, expect, test } from 'vitest'
import { isStore2Key } from '../../store/keyRules'
import {
    COMMIT_KEY, defaultKeyEnv, digits26, digitsFromBytes, FENCE_KEY, isRecoveryCandidateKey, KEY_ALPHABET, keyOfTail,
    MAX_KEY_BYTES, newManifestKey, newShardKey, newStagedKey, newStagedManifestKey, newStagingId, newUnitKey,
    orderRecoveryCandidates, parseStore2Key, stagingPrefix, SWEEP_KEY, tailOfKey, timeDigits, TOP_LEVEL_KEYS,
    type KeyEnv,
} from '../../store2/format'

/** A deterministic byte source and clock. */
function envOf(seconds: number, seed = 1): KeyEnv {
    let state = seed >>> 0
    return {
        random: (length) => {
            const out = new Uint8Array(length)
            for (let i = 0; i < length; i++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0
                out[i] = state >>> 24
            }
            return out
        },
        now: () => seconds * 1000 + 500,
    }
}

const utf8 = (text: string) => new TextEncoder().encode(text).length

describe('alphabet and digits', () => {
    test('the alphabet is 0-9a-v in ordinal order', () => {
        expect(KEY_ALPHABET).toBe('0123456789abcdefghijklmnopqrstuv')
        expect([...KEY_ALPHABET].sort().join('')).toBe(KEY_ALPHABET)
    })

    test('26 digits of 16 bytes are the 128-bit number in base 32, ordinal order equals numeric order', () => {
        expect(digits26(new Uint8Array(16))).toBe('0'.repeat(26))
        expect(digits26(new Uint8Array(16).fill(255))).toBe('7' + 'v'.repeat(25))
        const one = new Uint8Array(16)
        one[15] = 1
        expect(digits26(one)).toBe('0'.repeat(25) + '1')
        const env = envOf(0, 7)
        const samples = Array.from({ length: 200 }, () => env.random(16))
        const asNumber = (bytes: Uint8Array) => bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
        for (let i = 1; i < samples.length; i++) {
            const byNumber = asNumber(samples[i - 1]) < asNumber(samples[i])
            const byText = digits26(samples[i - 1]) < digits26(samples[i])
            expect(byText).toBe(byNumber)
        }
    })

    test('digitsFromBytes takes five bits per digit from the front and refuses too few bytes', () => {
        expect(digitsFromBytes(new Uint8Array([0b11111000, 0]), 1)).toBe('v')
        expect(digitsFromBytes(new Uint8Array([0b00000111, 0b11000000]), 2)).toBe('0v')
        expect(() => digitsFromBytes(new Uint8Array(1), 2)).toThrow(RangeError)
    })

    test('time digits are 7 digits, big endian, and refuse what does not fit', () => {
        expect(timeDigits(0)).toBe('0000000')
        expect(timeDigits(31)).toBe('000000v')
        expect(timeDigits(32)).toBe('0000010')
        expect(timeDigits(32 ** 7 - 1)).toBe('vvvvvvv')
        expect(() => timeDigits(32 ** 7)).toThrow(RangeError)
        expect(() => timeDigits(-1)).toThrow(RangeError)
        expect(() => timeDigits(1.5)).toThrow(RangeError)
    })
})

describe('key lengths and shapes', () => {
    test('ordinary keys are 35 bytes, staged keys 43, every key at most 48', () => {
        const env = envOf(1_800_000_000, 3)
        const stg = newStagingId(env)
        expect(stg).toMatch(/^[0-9a-v]{16}$/)
        for (let i = 0; i < 50; i++) {
            const ordinary = [newManifestKey(env), newShardKey(env), newUnitKey(env)]
            const staged = [newStagedKey(stg, 's', env), newStagedKey(stg, 'u', env), newStagedManifestKey(stg, env)]
            for (const key of ordinary) {
                expect(utf8(key)).toBe(35)
            }
            for (const key of staged) {
                expect(utf8(key)).toBe(43)
                expect(key.startsWith(stagingPrefix(stg))).toBe(true)
            }
            for (const key of [...ordinary, ...staged]) {
                expect(utf8(key)).toBeLessThanOrEqual(MAX_KEY_BYTES)
                expect(isStore2Key(key)).toBe(true)
                expect(key).toBe(key.toLowerCase())
            }
        }
    })

    test('the staging prefix is store2/g-<stg16>-', () => {
        expect(stagingPrefix('0123456789abcdef')).toBe('store2/g-0123456789abcdef-')
        expect(() => stagingPrefix('short')).toThrow(RangeError)
        expect(() => stagingPrefix('0123456789ABCDEF')).toThrow(RangeError)
    })

    test('the top-level keys are not store2 keys', () => {
        expect(TOP_LEVEL_KEYS).toEqual([COMMIT_KEY, SWEEP_KEY, FENCE_KEY])
        for (const key of TOP_LEVEL_KEYS) {
            expect(isStore2Key(key)).toBe(false)
            expect(key.startsWith('store2/')).toBe(false)
            expect(parseStore2Key(key)).toBeNull()
        }
    })

    test('generated keys parse back to their shape and the time digits', () => {
        const env = envOf(1_800_000_000, 5)
        const stg = newStagingId(env)
        expect(parseStore2Key(newManifestKey(env))).toMatchObject({ shape: 'manifest', seconds: 1_800_000_000 })
        expect(parseStore2Key(newShardKey(env))?.shape).toBe('shard')
        expect(parseStore2Key(newUnitKey(env))?.shape).toBe('unit')
        expect(parseStore2Key(newStagedKey(stg, 's', env))).toMatchObject({ shape: 'staged-unit', kind: 's', stagingId: stg })
        expect(parseStore2Key(newStagedKey(stg, 'u', env))).toMatchObject({ shape: 'staged-unit', kind: 'u' })
        expect(parseStore2Key(newStagedManifestKey(stg, env))).toMatchObject({ shape: 'staged-manifest', seconds: 1_800_000_000, stagingId: stg })
    })

    test('keys of another shape, case or length do not parse', () => {
        const good = newManifestKey(envOf(10))
        expect(parseStore2Key(good)?.shape).toBe('manifest')
        expect(parseStore2Key(good.toUpperCase().replace('STORE2/', 'store2/'))).toBeNull()
        expect(parseStore2Key(good + '0')).toBeNull()
        expect(parseStore2Key(good.slice(0, -1))).toBeNull()
        expect(parseStore2Key('store2/x-' + '0'.repeat(26))).toBeNull()
        expect(parseStore2Key('store2/m-' + 'w'.repeat(26))).toBeNull()
    })

    test('tail and key convert and refuse a non-store2 key', () => {
        const key = newUnitKey(envOf(10))
        expect(keyOfTail(tailOfKey(key))).toBe(key)
        expect(tailOfKey(key)).toBe(key.slice('store2/'.length))
        expect(() => tailOfKey(COMMIT_KEY)).toThrow(RangeError)
    })

    test('the default environment uses the CSPRNG and the wall clock', () => {
        expect(defaultKeyEnv.random(16)).toHaveLength(16)
        expect(defaultKeyEnv.random(16)).not.toEqual(defaultKeyEnv.random(16))
        const key = newManifestKey()
        const shape = parseStore2Key(key)
        expect(shape?.shape).toBe('manifest')
        if (shape?.shape === 'manifest') {
            expect(Math.abs(shape.seconds - Date.now() / 1000)).toBeLessThan(5)
        }
    })
})

describe('ordinal order is time order', () => {
    test('manifest keys across a digit boundary', () => {
        const before = newManifestKey(envOf(31, 1))
        const after = newManifestKey(envOf(32, 1))
        expect(before < after).toBe(true)
        const later = newManifestKey(envOf(32 * 32, 1))
        expect(after < later).toBe(true)
    })

    test('staged manifest keys across a digit boundary, within one staging id', () => {
        const stg = '0123456789abcdef'
        const before = newStagedManifestKey(stg, envOf(31, 1))
        const after = newStagedManifestKey(stg, envOf(32, 1))
        expect(before < after).toBe(true)
        expect(utf8(before)).toBe(43)
    })

    test('a sample of times sorts the same by key as by time', () => {
        const times = [0, 1, 31, 32, 1023, 1024, 1_000_000, 1_800_000_000, 32 ** 7 - 1]
        const keys = times.map((seconds) => newManifestKey(envOf(seconds, 9)))
        expect([...keys].sort()).toEqual(keys)
    })
})

describe('recovery candidates', () => {
    const stgOld = '0000000000000001'
    const stgStanding = '0000000000000002'
    const manifestAt = (seconds: number, seed = 1) => newManifestKey(envOf(seconds, seed))
    const stagedAt = (stg: string, seconds: number, seed = 1) => newStagedManifestKey(stg, envOf(seconds, seed))

    test('only manifests and completed staged manifests are candidates', () => {
        const env = envOf(100)
        expect(isRecoveryCandidateKey(manifestAt(100), null)).toBe(true)
        expect(isRecoveryCandidateKey(stagedAt(stgOld, 100), null)).toBe(true)
        expect(isRecoveryCandidateKey(newShardKey(env), null)).toBe(false)
        expect(isRecoveryCandidateKey(newUnitKey(env), null)).toBe(false)
        expect(isRecoveryCandidateKey(newStagedKey(stgOld, 's', env), null)).toBe(false)
        expect(isRecoveryCandidateKey(COMMIT_KEY, null)).toBe(false)
        expect(isRecoveryCandidateKey(FENCE_KEY, null)).toBe(false)
    })

    test('newest first by the time digits of either shape, no body read', () => {
        const a = manifestAt(500)
        const b = stagedAt(stgOld, 700)
        const c = manifestAt(900)
        const d = stagedAt(stgOld, 100)
        const noise = [newShardKey(envOf(1)), newUnitKey(envOf(2)), newStagedKey(stgOld, 'u', envOf(3)), COMMIT_KEY]
        expect(orderRecoveryCandidates([d, ...noise, a, c, b], null)).toEqual([c, b, a, d])
    })

    test('ties are ordered by key, descending, so the order is stable', () => {
        const x = manifestAt(500, 1)
        const y = manifestAt(500, 2)
        const expected = [x, y].sort().reverse()
        expect(orderRecoveryCandidates([x, y], null)).toEqual(expected)
        expect(orderRecoveryCandidates([y, x], null)).toEqual(expected)
    })

    test('the standing staging prefix of a parsed commit key is excluded, other stages are offered', () => {
        const standing = stagedAt(stgStanding, 800)
        const abandoned = stagedAt(stgOld, 600)
        const ordinary = manifestAt(400)
        const prefix = stagingPrefix(stgStanding)
        expect(isRecoveryCandidateKey(standing, prefix)).toBe(false)
        expect(orderRecoveryCandidates([standing, abandoned, ordinary], prefix)).toEqual([abandoned, ordinary])
    })

    test('without a standing prefix (unparsable commit key) every staged manifest is a candidate', () => {
        const standing = stagedAt(stgStanding, 800)
        expect(orderRecoveryCandidates([standing, manifestAt(400)], null)[0]).toBe(standing)
    })
})
