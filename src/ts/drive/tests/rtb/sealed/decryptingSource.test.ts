// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { RtbCouldNotReadError, type RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import { openSealedRtb, type AskReason, type OpenDeps, type SealedOpenResult } from 'src/ts/drive/rtb/sealed/decryptingSource'
import { RtbSealedAuthError } from 'src/ts/drive/rtb/sealed/errors'
import { encodeHeaderFromRecords, encodeSlotRecord } from 'src/ts/drive/rtb/sealed/format'
import { deriveKek, type Kdf } from 'src/ts/drive/rtb/sealed/kdf'
import type { SealedCaps } from 'src/ts/drive/rtb/sealed/policy'
import { referenceSeal, seededBytes, vectorPlaintext, VECTOR_INPUT } from './sealedReference'

const PASSWORD = VECTOR_INPUT.password
const SMALL_CAPS: SealedCaps = { mCeilKib: 1024, workCap: 4096 }
const C = VECTOR_INPUT.C

/** An outer source over mutable bytes that records every read. */
class TestOuter implements RangeSource {
    readonly size: number
    readonly reads: Array<{ offset: number, length: number }> = []
    failWith: Error | null = null

    constructor(readonly bytes: Buffer) {
        this.size = bytes.length
    }

    async read(offset: number, length: number): Promise<Uint8Array> {
        this.reads.push({ offset, length })
        if (this.failWith) {
            throw this.failWith
        }
        if (offset < 0 || length < 0 || offset + length > this.size) {
            throw new RtbCouldNotReadError('outside', offset, length)
        }
        return new Uint8Array(this.bytes.subarray(offset, offset + length))
    }

    readsAt(offset: number): number {
        return this.reads.filter((read) => read.offset === offset).length
    }
}

interface Attempt {
    result: SealedOpenResult
    reasons: AskReason[]
    kdfCalls: number
    events: string[]
}

async function attempt(
    source: RangeSource | Uint8Array,
    answers: Array<string | null>,
    options: { caps?: SealedCaps, kdf?: Kdf, aead?: AeadBackend } = {},
): Promise<Attempt> {
    const outer = source instanceof Uint8Array ? new TestOuter(Buffer.from(source)) : source
    const reasons: AskReason[] = []
    const events: string[] = []
    let kdfCalls = 0
    const baseKdf = options.kdf ?? deriveKek
    const deps: OpenDeps = {
        askPassword: async (reason) => {
            reasons.push(reason)
            events.push(`ask:${reason}`)
            return reasons.length <= answers.length ? answers[reasons.length - 1] : null
        },
        beforeDerive: async () => {
            events.push('before')
        },
        kdf: async (password, salt, params) => {
            kdfCalls++
            events.push('kdf')
            return await baseKdf(password, salt, params)
        },
        caps: options.caps ?? SMALL_CAPS,
        aead: options.aead,
    }
    const result = await openSealedRtb(outer, deps)
    return { result, reasons, kdfCalls, events }
}

function ev(length = 150, overrides: Partial<typeof VECTOR_INPUT> = {}): Buffer {
    return Buffer.from(referenceSeal({ ...VECTOR_INPUT, ...overrides, plaintext: vectorPlaintext(length) }).file)
}

function endedClass(result: SealedOpenResult): string {
    return result.kind === 'ended' ? result.class : 'open'
}

async function openOrThrow(source: RangeSource | Uint8Array, answers: Array<string | null> = [PASSWORD], options: { caps?: SealedCaps, kdf?: Kdf, aead?: AeadBackend } = {}) {
    const { result } = await attempt(source, answers, options)
    if (result.kind !== 'open') {
        throw new Error(`did not open: ${result.class} ${result.detail}`)
    }
    return result.source
}

// Layout of EV1: header 168, chunks of 80, 80 and 38 bytes.
const H = 168

describe('truncation and extension', () => {
    test('body bytes after full chunks of 1 to 16: damaged with no prompt and no derivation', async () => {
        const file = ev()
        for (let r = 1; r <= 16; r++) {
            const run = await attempt(file.subarray(0, H + 160 + r), [PASSWORD])
            expect(endedClass(run.result), `r=${r}`).toBe('damaged')
            expect(run.reasons, `r=${r}`).toEqual([])
            expect(run.kdfCalls, `r=${r}`).toBe(0)
        }
    })

    test('r of 17 or more: the file unlocks, then the last chunk fails (K5)', async () => {
        const file = ev()
        const run = await attempt(file.subarray(0, H + 160 + 17), [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual(['first'])
        expect(run.kdfCalls).toBe(1)
    })

    test('cut at a chunk boundary: damaged, because the new last chunk was sealed without the last flag', async () => {
        const file = ev()
        for (const length of [H + 80, H + 160]) {
            const run = await attempt(file.subarray(0, length), [PASSWORD])
            expect(run.result, `length=${length}`).toMatchObject({ kind: 'ended', class: 'damaged' })
            expect(run.reasons).toEqual(['first'])
        }
    })

    test('no cut length opens, and every one is damaged', async () => {
        const file = ev()
        for (let length = 0; length < file.length; length++) {
            const run = await attempt(file.subarray(0, length), [PASSWORD, null])
            expect(endedClass(run.result), `length=${length}`).toBe('damaged')
        }
    })

    test('appended bytes of any count are damaged', async () => {
        const file = ev()
        for (let extra = 1; extra <= 100; extra++) {
            const run = await attempt(Buffer.concat([file, Buffer.alloc(extra, 0x41)]), [PASSWORD, null])
            expect(endedClass(run.result), `extra=${extra}`).toBe('damaged')
        }
    })

    test('an appended whole chunk is damaged too', async () => {
        const file = ev()
        const run = await attempt(Buffer.concat([file, file.subarray(H, H + 80)]), [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
    })
})

describe('reorder and splice', () => {
    test('chunks 0 and 1 swapped: the file opens, and a read of either region fails authentication', async () => {
        const file = ev()
        const swapped = Buffer.from(file)
        file.copy(swapped, H, H + 80, H + 160)
        file.copy(swapped, H + 80, H, H + 80)
        const source = await openOrThrow(swapped)
        await expect(source.read(0, 10)).rejects.toMatchObject({ name: 'RtbSealedAuthError', chunk: 0 })
        await expect(source.read(C, 10)).rejects.toMatchObject({ name: 'RtbSealedAuthError', chunk: 1 })
        expect(Buffer.from(await source.read(2 * C, 22)).equals(vectorPlaintext(150).subarray(2 * C))).toBe(true)
    })

    test('chunk 1 and the last chunk swapped: damaged at open', async () => {
        const file = ev()
        const swapped = Buffer.concat([file.subarray(0, H + 80), file.subarray(H + 160), file.subarray(H + 80, H + 160)])
        expect(swapped.length).toBe(file.length)
        const run = await attempt(swapped, [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
    })

    test('chunk 0 copied over chunk 1: the copy fails authentication when read', async () => {
        const file = ev()
        file.copy(file, H + 80, H, H + 80)
        const source = await openOrThrow(file)
        await expect(source.read(C, 5)).rejects.toBeInstanceOf(RtbSealedAuthError)
        expect(Buffer.from(await source.read(0, 5)).equals(vectorPlaintext(5))).toBe(true)
    })

    test('chunk 1 from another file with the same password and chunk size fails authentication', async () => {
        const file = ev()
        const other = ev(150, { master: seededBytes(32, 11), fileId: seededBytes(16, 12), salt: seededBytes(16, 13), wrapNonce: seededBytes(12, 14) })
        other.copy(file, H + 80, H + 80, H + 160)
        const source = await openOrThrow(file)
        await expect(source.read(C, 5)).rejects.toBeInstanceOf(RtbSealedAuthError)
        expect(Buffer.from(await source.read(0, 5)).equals(vectorPlaintext(5))).toBe(true)
    })

    const otherPassword = 'another password'
    const otherInput = { password: otherPassword, master: seededBytes(32, 21), fileId: seededBytes(16, 22), salt: seededBytes(16, 23), wrapNonce: seededBytes(12, 24) }

    test('the slot of another file, with that file\'s password: damaged (key commitment)', async () => {
        const file = ev()
        const other = ev(150, otherInput)
        other.copy(file, 76, 76, H)
        const run = await attempt(file, [otherPassword])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual(['first'])
    })

    test('the slot of another file, with this file\'s password: wrong password', async () => {
        const file = ev()
        const other = ev(150, otherInput)
        other.copy(file, 76, 76, H)
        const run = await attempt(file, [PASSWORD, null])
        expect(run.reasons).toEqual(['first', 'wrong'])
    })

    test('the whole header of another file, with that file\'s password: damaged at the last chunk', async () => {
        const file = ev()
        const other = ev(150, otherInput)
        other.copy(file, 0, 0, H)
        const run = await attempt(file, [otherPassword])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual(['first'])
    })

    test('key_commit edited: damaged after the right password, never wrong-password', async () => {
        const file = ev()
        file[50] ^= 1
        const run = await attempt(file, [PASSWORD, null])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual(['first'])
        expect(run.kdfCalls).toBe(1)
    })
})

describe('header tamper sweep', () => {
    interface Expected {
        cls: 'damaged' | 'newer' | 'wrong-password'
        prompted: boolean
    }
    const pristine = ev()

    function expectedFor(byte: number, bit: number): Expected {
        const refused = (cls: 'damaged' | 'newer'): Expected => ({ cls, prompted: false })
        // Unsigned: bit 31 must not turn the value negative.
        const flipped = (base: number, first: number): number => (base ^ (2 ** (bit + 8 * (byte - first)))) >>> 0
        if (byte < 8 || (byte >= 20 && byte < 36) || (byte >= 40 && byte < 72)) {
            return { cls: 'damaged', prompted: true }
        }
        if (byte === 8) {
            return flipped(1, 8) === 0 ? refused('damaged') : refused('newer')
        }
        if (byte === 9 || byte === 10 || byte === 11 || (byte >= 13 && byte <= 15) || byte === 74 || byte === 75 || byte === 81) {
            return refused('newer')
        }
        if (byte === 12) {
            return bit === 0 ? refused('damaged') : refused('newer')
        }
        if (byte >= 16 && byte < 20) {
            const chunk = flipped(64, 16)
            if (chunk < 64) {
                return refused('damaged')
            }
            if (chunk > 16_777_216) {
                return refused('newer')
            }
            const body = pristine.length - H
            const rest = body % (chunk + 16)
            const layoutFails = body < 16 || (rest > 0 && rest < 16) || (rest === 16 && body >= chunk + 32)
            return layoutFails ? refused('damaged') : { cls: 'damaged', prompted: true }
        }
        if (byte >= 36 && byte < 40) {
            const headerLen = flipped(H, 36)
            if (headerLen < 80 || headerLen > pristine.length) {
                return headerLen > 65_536 ? refused('newer') : refused('damaged')
            }
            if (headerLen > 65_536) {
                return refused('newer')
            }
            if (headerLen < H) {
                return refused('damaged')
            }
            if (pristine.subarray(H, headerLen).every((value) => value === 0)) {
                throw new Error('the fixture has zero bytes where the sweep expects non-zero padding')
            }
            return refused('damaged')
        }
        if (byte === 72 || byte === 73) {
            const count = flipped(1, 72)
            return count === 0 || count <= 64 ? refused('damaged') : refused('newer')
        }
        if (byte === 76 || byte === 77) {
            return flipped(1, 76) === 0 ? refused('damaged') : refused('newer')
        }
        if (byte === 78 || byte === 79) {
            return refused('damaged')
        }
        if (byte === 80) {
            return bit === 0 ? refused('damaged') : refused('newer')
        }
        const slotParams = { p: 1, m: 256, t: 2 }
        if (byte === 82 || byte === 83) {
            slotParams.p = flipped(1, 82)
        } else if (byte >= 84 && byte < 88) {
            slotParams.m = flipped(256, 84)
        } else if (byte >= 88 && byte < 92) {
            slotParams.t = flipped(2, 88)
        } else {
            return { cls: 'wrong-password', prompted: true }
        }
        if (slotParams.p === 0 || slotParams.t === 0) {
            return refused('damaged')
        }
        if (slotParams.p > 8) {
            return refused('newer')
        }
        if (slotParams.m < 8 * slotParams.p) {
            return refused('damaged')
        }
        if (slotParams.m > SMALL_CAPS.mCeilKib || slotParams.m * slotParams.t > SMALL_CAPS.workCap) {
            return refused('newer')
        }
        return { cls: 'wrong-password', prompted: true }
    }

    test('every bit of the 168 header bytes: the class follows the field, and nothing ever opens', async () => {
        const mismatches: string[] = []
        for (let byte = 0; byte < H; byte++) {
            for (let bit = 0; bit < 8; bit++) {
                const file = Buffer.from(pristine)
                file[byte] ^= 1 << bit
                const run = await attempt(file, [PASSWORD, null])
                const observed: Expected = {
                    cls: run.result.kind === 'ended' && run.result.class === 'canceled' ? 'wrong-password' : (endedClass(run.result) as Expected['cls']),
                    prompted: run.reasons.length > 0,
                }
                const expected = expectedFor(byte, bit)
                if (observed.cls !== expected.cls || observed.prompted !== expected.prompted || run.result.kind === 'open') {
                    mismatches.push(`byte ${byte} bit ${bit}: observed ${JSON.stringify(observed)}, expected ${JSON.stringify(expected)}`)
                }
                if (!observed.prompted) {
                    expect(run.kdfCalls, `byte ${byte} bit ${bit}`).toBe(0)
                }
            }
        }
        expect(mismatches).toEqual([])
    })

    test('a version 2 header cut to 50 bytes reads as newer, not damaged', async () => {
        const file = ev().subarray(0, 50)
        file.writeUInt16LE(2, 8)
        const run = await attempt(file, [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'newer' })
        expect(run.reasons).toEqual([])
    })
})

describe('caps and slots at open', () => {
    const slotOf = (file: Buffer) => file.subarray(76, H)

    /** A header of the given slot records around the chunks of `file`. */
    function withSlots(file: Buffer, records: Uint8Array[], padding = 0): Buffer {
        const header = encodeHeaderFromRecords({ chunkSize: C, fileId: VECTOR_INPUT.fileId, keyCommit: file.subarray(40, 72), records, padding })
        return Buffer.concat([header, file.subarray(H)])
    }

    test('memory at the ceiling and work at the cap open; one above is newer and the derivation is not run', async () => {
        const at = ev(150, { m: 1024, t: 4 })
        const okRun = await attempt(at, [PASSWORD])
        expect(okRun.result.kind).toBe('open')
        const memoryOver = await attempt(ev(150, { m: 1025, t: 1 }), [PASSWORD])
        expect(memoryOver.result).toMatchObject({ kind: 'ended', class: 'newer' })
        expect(memoryOver.kdfCalls + memoryOver.reasons.length).toBe(0)
        const workOver = await attempt(ev(150, { m: 1024, t: 5 }), [PASSWORD])
        expect(workOver.result).toMatchObject({ kind: 'ended', class: 'newer' })
        expect(workOver.kdfCalls + workOver.reasons.length).toBe(0)
    })

    test('an unknown slot type before the password slot is skipped and the file opens', async () => {
        const file = ev()
        const run = await attempt(withSlots(file, [encodeSlotRecord(9, new Uint8Array(30)), slotOf(file)]), [PASSWORD])
        expect(run.result.kind).toBe('open')
    })

    test('only unknown slot types: newer, no prompt', async () => {
        const file = ev()
        const run = await attempt(withSlots(file, [encodeSlotRecord(9, new Uint8Array(30))]), [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'newer' })
        expect(run.reasons).toEqual([])
    })

    test('non-zero padding: damaged, no prompt; zero padding opens, also at 65536 bytes', async () => {
        const file = ev()
        const dirty = withSlots(file, [slotOf(file)], 8)
        dirty[H + 3] = 1
        const dirtyRun = await attempt(dirty, [PASSWORD])
        expect(dirtyRun.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(dirtyRun.reasons).toEqual([])
        expect((await attempt(withSlots(file, [slotOf(file)], 8), [PASSWORD])).result.kind).toBe('open')
        expect((await attempt(withSlots(file, [slotOf(file)], 65_536 - H), [PASSWORD])).result.kind).toBe('open')
        const tooBig = await attempt(withSlots(file, [slotOf(file)], 65_537 - H), [PASSWORD])
        expect(tooBig.result).toMatchObject({ kind: 'ended', class: 'newer' })
        expect(tooBig.reasons).toEqual([])
    })

    test('two password slots: the right password in the first opens, in the second is a wrong password', async () => {
        const file = ev()
        const otherInput = { password: 'second slot password', master: seededBytes(32, 31), fileId: seededBytes(16, 32), salt: seededBytes(16, 33), wrapNonce: seededBytes(12, 34) }
        const other = ev(150, otherInput)
        const first = await attempt(withSlots(file, [slotOf(file), slotOf(other)]), [PASSWORD])
        expect(first.result.kind).toBe('open')
        const second = await attempt(withSlots(file, [slotOf(file), slotOf(other)]), [otherInput.password, null])
        expect(second.reasons).toEqual(['first', 'wrong'])
        expect(endedClass(second.result)).toBe('canceled')
    })

    test('a password slot with another body length is damaged even when it is the second one', async () => {
        const file = ev()
        const run = await attempt(withSlots(file, [slotOf(file), encodeSlotRecord(1, new Uint8Array(40))]), [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual([])
    })
})

describe('the password loop', () => {
    test('wrong then right: asks again with reason wrong, derives twice, opens', async () => {
        const run = await attempt(ev(), ['not it', PASSWORD])
        expect(run.result.kind).toBe('open')
        expect(run.reasons).toEqual(['first', 'wrong'])
        expect(run.kdfCalls).toBe(2)
        expect(run.events).toEqual(['ask:first', 'before', 'kdf', 'ask:wrong', 'before', 'kdf'])
    })

    test('an unusable password asks again with reason unusable and runs no derivation', async () => {
        const run = await attempt(ev(), ['', '\ud800', PASSWORD])
        expect(run.result.kind).toBe('open')
        expect(run.reasons).toEqual(['first', 'unusable', 'unusable'])
        expect(run.kdfCalls).toBe(1)
    })

    test('cancel at the first prompt, and after a wrong password, ends as canceled', async () => {
        const first = await attempt(ev(), [null])
        expect(first.result).toMatchObject({ kind: 'ended', class: 'canceled' })
        expect(first.kdfCalls).toBe(0)
        const later = await attempt(ev(), ['bad', null])
        expect(later.result).toMatchObject({ kind: 'ended', class: 'canceled' })
        expect(later.reasons).toEqual(['first', 'wrong'])
    })

    test('the NFD and NFC spellings of the password both open', async () => {
        expect((await attempt(ev(), [PASSWORD.normalize('NFC')])).result.kind).toBe('open')
        expect((await attempt(ev(), [PASSWORD.normalize('NFD')])).result.kind).toBe('open')
    })

    test('the reader zeroes the key-encryption key and the password bytes after each attempt, wrong or right', async () => {
        const keks: Uint8Array[] = []
        const passwords: Uint8Array[] = []
        const run = await attempt(ev(), ['not it', PASSWORD], {
            kdf: async (password, salt, params) => {
                passwords.push(password)
                const kek = await deriveKek(password, salt, params)
                keks.push(kek)
                return kek
            },
        })
        expect(run.result.kind).toBe('open')
        expect(keks.length).toBe(2)
        expect(keks.every((kek) => kek.every((byte) => byte === 0))).toBe(true)
        expect(passwords.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    })

    test('a derivation that throws RangeError ends as unlock-failed with no source', async () => {
        const run = await attempt(ev(), [PASSWORD], {
            kdf: async () => {
                throw new RangeError('WebAssembly.Memory(): could not allocate memory')
            },
        })
        expect(run.result).toMatchObject({ kind: 'ended', class: 'unlock-failed' })
        expect(run.reasons).toEqual(['first'])
    })

    test('an AEAD error that is not an authentication failure during the unwrap is unlock-failed', async () => {
        const real = webCryptoAead()
        const failing: AeadBackend = { ...real, open: async () => { throw new TypeError('bad key') } }
        const run = await attempt(ev(), [PASSWORD, PASSWORD], { aead: failing })
        expect(run.result).toMatchObject({ kind: 'ended', class: 'unlock-failed' })
        expect(run.reasons).toEqual(['first'])
    })

    test('a read failure of the outer source while reading the header ends as could-not-read, before any prompt', async () => {
        const outer = new TestOuter(ev())
        outer.failWith = new RtbCouldNotReadError('gone', 0, 76)
        const run = await attempt(outer, [PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'could-not-read' })
        expect(run.reasons).toEqual([])
    })

    test('the backend is chosen once at open: an injected backend serves every later chunk read', async () => {
        const real = webCryptoAead()
        let opens = 0
        const counting: AeadBackend = { ...real, open: async (...args) => { opens++; return await real.open(...args) } }
        const source = await openOrThrow(ev(), [PASSWORD], { aead: counting })
        const before = opens
        await source.read(0, 150)
        expect(opens).toBeGreaterThan(before)
    })
})

describe('nested sealed files', () => {
    test('a sealed file inside a sealed file is damaged at open and the prompt is asked once', async () => {
        const inner = ev()
        const outerFile = Buffer.from(referenceSeal({ ...VECTOR_INPUT, plaintext: inner, master: seededBytes(32, 51), fileId: seededBytes(16, 52), salt: seededBytes(16, 53), wrapNonce: seededBytes(12, 54) }).file)
        const run = await attempt(outerFile, [PASSWORD, PASSWORD])
        expect(run.result).toMatchObject({ kind: 'ended', class: 'damaged' })
        expect(run.reasons).toEqual(['first'])
    })

    test('a plaintext that only begins like the magic still opens', async () => {
        const almost = Buffer.from(inner7())
        const file = Buffer.from(referenceSeal({ ...VECTOR_INPUT, plaintext: almost }).file)
        expect((await attempt(file, [PASSWORD])).result.kind).toBe('open')
    })

    function inner7(): Uint8Array {
        return Uint8Array.of(0x52, 0x54, 0x42, 0x58, 0x0d, 0x0a, 0x1a, 0x00, 1, 2, 3)
    }
})

describe('DecryptingRangeSource reads', () => {
    const P = 5 * C + 10
    const plaintext = vectorPlaintext(P)
    const build = () => new TestOuter(Buffer.from(referenceSeal({ ...VECTOR_INPUT, plaintext }).file))

    test('the size is the plaintext length', async () => {
        expect((await openOrThrow(build())).size).toBe(P)
    })

    test('out-of-range and non-integer reads reject with the plain could-not-read error', async () => {
        const source = await openOrThrow(build())
        for (const [offset, length] of [[-1, 1], [0, -1], [P, 1], [P - 1, 2], [0.5, 1], [0, 1.5], [Number.NaN, 1], [0, Number.POSITIVE_INFINITY], [Number.MAX_SAFE_INTEGER, 1]]) {
            const error = await source.read(offset, length).then(() => null, (thrown: unknown) => thrown)
            expect(error, `${offset},${length}`).toBeInstanceOf(RtbCouldNotReadError)
            expect(error, `${offset},${length}`).not.toBeInstanceOf(RtbSealedAuthError)
        }
    })

    test('a zero-length read returns an empty array, also at the end', async () => {
        const source = await openOrThrow(build())
        expect((await source.read(0, 0)).length).toBe(0)
        expect((await source.read(P, 0)).length).toBe(0)
    })

    test('reads inside a chunk and across two and three chunks return the plaintext', async () => {
        const source = await openOrThrow(build())
        for (const [offset, length] of [[3, 10], [C - 5, 10], [C - 5, C + 10], [10, 2 * C + 30], [0, P], [P - 3, 3], [4 * C, C + 10]]) {
            expect(Buffer.from(await source.read(offset, length)).equals(plaintext.subarray(offset, offset + length)), `${offset},${length}`).toBe(true)
        }
    })

    test('a returned array is the caller\'s own: changing it does not change a re-read', async () => {
        const source = await openOrThrow(build())
        const first = await source.read(10, 20)
        first.fill(0xee)
        expect(Buffer.from(await source.read(10, 20)).equals(plaintext.subarray(10, 30))).toBe(true)
        const spanning = await source.read(C - 5, 10)
        spanning.fill(0xee)
        expect(Buffer.from(await source.read(C - 5, 10)).equals(plaintext.subarray(C - 5, C + 5))).toBe(true)
    })

    test('an outer read failure passes through as the plain could-not-read error and remembers nothing', async () => {
        const outer = build()
        const source = await openOrThrow(outer)
        outer.failWith = new RtbCouldNotReadError('disk gone', 0, 0)
        const error = await source.read(0, 10).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(RtbCouldNotReadError)
        expect(error).not.toBeInstanceOf(RtbSealedAuthError)
        outer.failWith = null
        expect(Buffer.from(await source.read(0, 10)).equals(plaintext.subarray(0, 10))).toBe(true)
        expect(source.authFailure).toBeNull()
    })

    test('RtbSealedAuthError is a could-not-read error that names the chunk', () => {
        const error = new RtbSealedAuthError(4, 10, 20)
        expect(error).toBeInstanceOf(RtbCouldNotReadError)
        expect(error.name).toBe('RtbSealedAuthError')
        expect(error.chunk).toBe(4)
    })

    test('concurrent reads each return their own plaintext', async () => {
        const source = await openOrThrow(build())
        const parts = await Promise.all([source.read(0, 100), source.read(C - 10, 40), source.read(3 * C, 100), source.read(P - 50, 50)])
        expect(Buffer.from(parts[0]).equals(plaintext.subarray(0, 100))).toBe(true)
        expect(Buffer.from(parts[1]).equals(plaintext.subarray(C - 10, C + 30))).toBe(true)
        expect(Buffer.from(parts[2]).equals(plaintext.subarray(3 * C, 3 * C + 100))).toBe(true)
        expect(Buffer.from(parts[3]).equals(plaintext.subarray(P - 50))).toBe(true)
    })

    test('a failure found part-way through a straddling read rejects and returns no bytes', async () => {
        const outer = build()
        const source = await openOrThrow(outer)
        outer.bytes[H + 80 + 3] ^= 1
        const error = await source.read(C - 10, 30).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(RtbSealedAuthError)
        expect((error as RtbSealedAuthError).chunk).toBe(1)
        expect(Buffer.from(await source.read(0, 10)).equals(plaintext.subarray(0, 10))).toBe(true)
    })

    test('a failed chunk stays failed: restoring the bytes does not heal it and chunk 1 is not read again', async () => {
        const outer = build()
        const source = await openOrThrow(outer)
        const chunk1At = H + 80
        const original = outer.bytes[chunk1At + 5]
        outer.bytes[chunk1At + 5] ^= 0x10
        await expect(source.read(C, 10)).rejects.toBeInstanceOf(RtbSealedAuthError)
        const readsAfterFailure = outer.readsAt(chunk1At)
        outer.bytes[chunk1At + 5] = original
        await expect(source.read(C, 10)).rejects.toBeInstanceOf(RtbSealedAuthError)
        await expect(source.read(C - 5, 10)).rejects.toBeInstanceOf(RtbSealedAuthError)
        expect(outer.readsAt(chunk1At)).toBe(readsAfterFailure)
        expect(Buffer.from(await source.read(0, 20)).equals(plaintext.subarray(0, 20))).toBe(true)
        expect(Buffer.from(await source.read(2 * C, 20)).equals(plaintext.subarray(2 * C, 2 * C + 20))).toBe(true)
        expect(source.authFailure).toBeInstanceOf(RtbSealedAuthError)
        expect(source.authFailure?.chunk).toBe(1)
    })

    test('the first failure is the one kept for the caller', async () => {
        const outer = build()
        const source = await openOrThrow(outer)
        outer.bytes[H + 80 + 5] ^= 1
        outer.bytes[H + 2 * 80 + 5] ^= 1
        await expect(source.read(2 * C, 5)).rejects.toMatchObject({ chunk: 2 })
        await expect(source.read(C, 5)).rejects.toMatchObject({ chunk: 1 })
        expect(source.authFailure?.chunk).toBe(2)
    })

    test('a read that touches a failed chunk and a good one reports the lowest failed chunk and decrypts nothing', async () => {
        const outer = build()
        const source = await openOrThrow(outer)
        outer.bytes[H + 2 * 80 + 5] ^= 1
        await expect(source.read(2 * C, 5)).rejects.toMatchObject({ chunk: 2 })
        const decrypted = source.chunksDecrypted
        const reads = outer.reads.length
        await expect(source.read(C - 5, 2 * C + 20)).rejects.toMatchObject({ chunk: 2 })
        expect(source.chunksDecrypted).toBe(decrypted)
        expect(outer.reads.length).toBe(reads)
    })

    test('a backend error that is not an authentication failure rejects the read as plain could-not-read and is not remembered', async () => {
        const real = webCryptoAead()
        let failChunks = false
        let calls = 0
        const flaky: AeadBackend = {
            ...real,
            open: async (...args) => {
                calls++
                if (failChunks) {
                    throw new TypeError('transient')
                }
                return await real.open(...args)
            },
        }
        const source = await openOrThrow(build(), [PASSWORD], { aead: flaky })
        failChunks = true
        const error = await source.read(0, 10).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(RtbCouldNotReadError)
        expect(error).not.toBeInstanceOf(RtbSealedAuthError)
        expect((error as Error).cause).toBeInstanceOf(TypeError)
        failChunks = false
        expect(Buffer.from(await source.read(0, 10)).equals(plaintext.subarray(0, 10))).toBe(true)
        expect(source.authFailure).toBeNull()
        expect(calls).toBeGreaterThan(0)
    })
})

describe('chunk cache', () => {
    const MiB = 1024 * 1024
    const CHUNK = MiB
    const TOTAL = 8 * MiB
    const file = Buffer.from(referenceSeal({ ...VECTOR_INPUT, C: CHUNK, plaintext: seededBytes(TOTAL, 77) }).file)

    test('a forward pass with a short read at each start decrypts every chunk once', async () => {
        const source = await openOrThrow(new TestOuter(file))
        for (let k = 0; k < 8; k++) {
            const start = k * CHUNK + 50
            await source.read(start, 30)
            await source.read(start, Math.min(CHUNK, TOTAL - start))
        }
        expect(source.chunksDecrypted).toBe(8)
        expect(source.bytesDecrypted).toBe(TOTAL)
    })

    test('a read that steps back into the chunk the previous read crossed out of is served from the second entry', async () => {
        const source = await openOrThrow(new TestOuter(file))
        const boundary = 4 * CHUNK
        await source.read(boundary - 10, 20)
        await source.read(boundary - 30, 10)
        expect(source.chunksDecrypted).toBe(2)
    })

    test('a third chunk evicts the least recently used one', async () => {
        const source = await openOrThrow(new TestOuter(file))
        await source.read(0, 10)
        await source.read(CHUNK, 10)
        await source.read(2 * CHUNK, 10)
        expect(source.chunksDecrypted).toBe(3)
        await source.read(CHUNK, 10)
        expect(source.chunksDecrypted).toBe(3)
        await source.read(0, 10)
        expect(source.chunksDecrypted).toBe(4)
    })

    test('the open decrypts the last chunk and checks chunk 0 without counting them', async () => {
        const source = await openOrThrow(new TestOuter(file))
        expect(source.chunksDecrypted).toBe(0)
        expect(source.bytesDecrypted).toBe(0)
    })

    test('a last chunk of the open stays in the cache: reading it right away decrypts nothing more', async () => {
        const source = await openOrThrow(new TestOuter(file))
        await source.read(TOTAL - 10, 10)
        expect(source.chunksDecrypted).toBe(0)
    })
})
