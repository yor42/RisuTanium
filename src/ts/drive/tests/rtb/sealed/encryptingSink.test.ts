// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { nobleAead, webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import type { EncryptingSink } from 'src/ts/drive/rtb/sealed/encryptingSink'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { referenceOpen, referenceSeal, seededBytes, vectorPlaintext, vectorRandom, VECTOR_INPUT } from './sealedReference'

const C = VECTOR_INPUT.C
const PARAMS = { m: VECTOR_INPUT.m, t: VECTOR_INPUT.t, chunkSize: C }

async function sealPieces(pieces: Uint8Array[], aead: AeadBackend = webCryptoAead(), params = PARAMS): Promise<{ file: Buffer, calls: number[] }> {
    const seal = await prepareSeal(VECTOR_INPUT.password, params, { random: vectorRandom(), aead })
    const parts: Uint8Array[] = []
    const sink = seal.sink((chunk) => {
        parts.push(chunk.slice())
    })
    for (const piece of pieces) {
        await sink.write(piece)
    }
    await sink.finish()
    const file = Buffer.concat(parts)
    expect(sink.bytesWritten).toBe(file.length)
    return { file, calls: parts.map((part) => part.length) }
}

function splitAt(bytes: Uint8Array, sizes: number[]): Uint8Array[] {
    const out: Uint8Array[] = []
    let at = 0
    for (const size of sizes) {
        out.push(bytes.subarray(at, at + size))
        at += size
    }
    out.push(bytes.subarray(at))
    return out
}

describe('EncryptingSink output', () => {
    test.each([0, 1, C - 1, C, C + 1, 2 * C, 3 * C + 7])('%i plaintext bytes equal the reference file however they are written', async (length) => {
        const plaintext = vectorPlaintext(length)
        const expected = referenceSeal({ ...VECTOR_INPUT, plaintext }).file
        const one = await sealPieces([plaintext])
        expect(one.file.equals(expected)).toBe(true)
        const bytewise = await sealPieces(Array.from({ length }, (_, i) => plaintext.subarray(i, i + 1)))
        expect(bytewise.file.equals(expected)).toBe(true)
        const uneven = await sealPieces(splitAt(plaintext, [Math.min(length, 5), Math.min(Math.max(length - 5, 0), C + 3)]))
        expect(uneven.file.equals(expected)).toBe(true)
        const noble = await sealPieces([plaintext], nobleAead())
        expect(noble.file.equals(expected)).toBe(true)
    })

    test('empty writes change nothing and an all-empty sink writes the header and one sealed empty chunk', async () => {
        const { file, calls } = await sealPieces([new Uint8Array(0), new Uint8Array(0)])
        expect(calls).toEqual([168, 16])
        expect(file.equals(referenceSeal({ ...VECTOR_INPUT, plaintext: Buffer.alloc(0) }).file)).toBe(true)
    })

    test('a 2 MiB write passes through as the bytes of many small ones', async () => {
        const params = { m: 8, t: 1, chunkSize: 65_536 }
        const plaintext = seededBytes(2 * 1024 * 1024, 7)
        const whole = await sealPieces([plaintext], webCryptoAead(), params)
        const pieces = await sealPieces(splitAt(plaintext, [1, 65_535, 70_000, 1_000_000]), webCryptoAead(), params)
        expect(pieces.file.equals(whole.file)).toBe(true)
        expect(whole.file.length).toBe(168 + 2 * 1024 * 1024 + 16 * 32)
        expect(referenceOpen(whole.file, VECTOR_INPUT.password).equals(plaintext)).toBe(true)
    })

    test('mutating the input after write resolves changes nothing', async () => {
        const plaintext = vectorPlaintext(3 * C + 7)
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const parts: Uint8Array[] = []
        const sink = seal.sink((chunk) => {
            parts.push(chunk.slice())
        })
        const scratch = new Uint8Array(100)
        for (let at = 0; at < plaintext.length; at += scratch.length) {
            const piece = plaintext.subarray(at, Math.min(plaintext.length, at + scratch.length))
            scratch.set(piece)
            await sink.write(scratch.subarray(0, piece.length))
            scratch.fill(0xff)
        }
        await sink.finish()
        const expected = referenceSeal({ ...VECTOR_INPUT, plaintext }).file
        expect(Buffer.concat(parts).equals(expected)).toBe(true)
    })

    test('the target may keep or alter the chunks it receives without affecting the sink', async () => {
        const plaintext = vectorPlaintext(200)
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const parts: Uint8Array[] = []
        const sink = seal.sink((chunk) => {
            parts.push(chunk)
            chunk.fill(0xaa)
        })
        await sink.write(plaintext)
        await sink.finish()
        expect(parts.length).toBe(1 + 4)
        expect(parts.every((part) => part.every((byte) => byte === 0xaa))).toBe(true)
    })
})

describe('EncryptingSink chunking', () => {
    test('after exactly C bytes the target has only the header; the next byte seals chunk 0 with the flag 0', async () => {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const calls: number[] = []
        const sink = seal.sink((chunk) => {
            calls.push(chunk.length)
        })
        await sink.write(vectorPlaintext(C))
        expect(calls).toEqual([168])
        await sink.write(vectorPlaintext(1))
        expect(calls).toEqual([168, C + 16])
        await sink.finish()
        expect(calls).toEqual([168, C + 16, 1 + 16])
    })

    test('a full buffer at finish is sealed once with the last flag, never followed by an empty chunk', async () => {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const calls: number[] = []
        const sink = seal.sink((chunk) => {
            calls.push(chunk.length)
        })
        await sink.write(vectorPlaintext(2 * C))
        await sink.finish()
        expect(calls).toEqual([168, C + 16, C + 16])
    })

    test('nothing is written to the target before the first byte of content', async () => {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const calls: number[] = []
        const sink = seal.sink((chunk) => {
            calls.push(chunk.length)
        })
        await sink.write(new Uint8Array(0))
        expect(calls).toEqual([])
        expect(sink.bytesWritten).toBe(0)
    })
})

describe('key wiping', () => {
    const allZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)

    /** A noble backend that records the raw arrays it is given and the key objects it returns. */
    function recording() {
        const inner = nobleAead()
        const raws: Uint8Array[] = []
        const keys: Uint8Array[] = []
        const aead: AeadBackend = {
            ...inner,
            importKey: async (raw) => {
                raws.push(raw)
                const key = await inner.importKey(raw)
                keys.push(key as Uint8Array)
                return key
            },
        }
        return { aead, raws, keys }
    }

    test('after setup the writer has zeroed the raw key-encryption key and the raw payload key', async () => {
        const { aead, raws, keys } = recording()
        await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        expect(raws.length).toBe(2)
        expect(allZero(raws[0])).toBe(true)
        expect(allZero(raws[1])).toBe(true)
        // The key the sink will use is a separate copy and is still live.
        expect(allZero(keys[1])).toBe(false)
    })

    test('the sink zeroes a plain-array payload key when finish ends', async () => {
        const { aead, keys } = recording()
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        const sink = seal.sink(() => undefined)
        await sink.write(vectorPlaintext(100))
        expect(allZero(keys[1])).toBe(false)
        await sink.finish()
        expect(allZero(keys[1])).toBe(true)
    })

    test('the sink zeroes it when it poisons after a failing target', async () => {
        const { aead, keys } = recording()
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        const sink = seal.sink(() => {
            throw new Error('disk full')
        })
        await expect(sink.write(vectorPlaintext(10))).rejects.toThrow('disk full')
        expect(allZero(keys[1])).toBe(true)
    })

    test('a WebCrypto key needs no wiping and finish still works', async () => {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead: webCryptoAead() })
        const sink = seal.sink(() => undefined)
        await sink.write(vectorPlaintext(10))
        await sink.finish()
    })
})

describe('EncryptingSink state', () => {
    async function openSink(target: (chunk: Uint8Array) => Promise<void> | void = () => undefined, aead?: AeadBackend) {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        return seal.sink(target)
    }

    test('write after finish, and a second finish, reject', async () => {
        const sink = await openSink()
        await sink.write(vectorPlaintext(10))
        await sink.finish()
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow()
        await expect(sink.finish()).rejects.toThrow()
    })

    test('after a failing target write every later call rejects', async () => {
        let calls = 0
        const sink = await openSink(() => {
            calls++
            if (calls === 2) {
                throw new Error('disk full')
            }
        })
        await sink.write(vectorPlaintext(C))
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow('disk full')
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow()
        await expect(sink.finish()).rejects.toThrow()
        expect(calls).toBe(2)
    })

    test('after a failed header write nothing else is sent', async () => {
        const seen: number[] = []
        const sink = await openSink((chunk) => {
            seen.push(chunk.length)
            throw new Error('no space')
        })
        await expect(sink.write(vectorPlaintext(5))).rejects.toThrow('no space')
        await expect(sink.finish()).rejects.toThrow()
        expect(seen).toEqual([168])
    })

    test('a failing seal poisons the sink', async () => {
        const real = webCryptoAead()
        let seals = 0
        const failing: AeadBackend = {
            ...real,
            // The first seal is the key wrap during setup; the chunk seals fail.
            seal: async (key, nonce, plaintext, aad) => {
                if (seals++ === 0) {
                    return await real.seal(key, nonce, plaintext, aad)
                }
                throw new RangeError('out of memory')
            },
        }
        const sink = await openSink(() => undefined, failing)
        await expect(sink.write(vectorPlaintext(C + 1))).rejects.toThrow('out of memory')
        await expect(sink.finish()).rejects.toThrow()
    })

    test('a prepared seal gives out one sink; a second call throws and writes nothing', async () => {
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom() })
        const calls: number[] = []
        const first = seal.sink((chunk) => {
            calls.push(chunk.length)
        })
        await first.write(vectorPlaintext(10))
        await first.finish()
        const before = calls.length
        expect(() => seal.sink((chunk) => {
            calls.push(chunk.length)
        })).toThrow()
        expect(calls.length).toBe(before)
    })

    test('overlapping calls are refused, wipe the sink and poison it; the call in flight rejects too', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const sink = await openSink(() => gate)
        const first = sink.write(vectorPlaintext(10))
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow('overlapping')
        release()
        await expect(first).rejects.toThrow('failed earlier')
        await expect(sink.finish()).rejects.toThrow()
    })
})

describe('EncryptingSink abandon', () => {
    const allZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)

    async function openRecorded(target: (chunk: Uint8Array) => Promise<void> | void = () => undefined) {
        const inner = nobleAead()
        const keys: Uint8Array[] = []
        const aead: AeadBackend = {
            ...inner,
            importKey: async (raw) => {
                const key = await inner.importKey(raw)
                keys.push(key as Uint8Array)
                return key
            },
        }
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        return { sink: seal.sink(target), payloadKey: keys[1] }
    }

    function heldBuffer(sink: unknown): Uint8Array {
        return (sink as { buffer: Uint8Array }).buffer
    }

    test('after writes, abandon zeroes the key and the held buffer, and later calls reject', async () => {
        const { sink, payloadKey } = await openRecorded()
        await sink.write(vectorPlaintext(C + 10))
        expect(allZero(payloadKey)).toBe(false)
        expect(allZero(heldBuffer(sink))).toBe(false)
        sink.abandon()
        expect(allZero(payloadKey)).toBe(true)
        expect(allZero(heldBuffer(sink))).toBe(true)
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow('failed earlier')
        await expect(sink.finish()).rejects.toThrow('failed earlier')
    })

    test('abandon before any write and a second abandon do not throw', async () => {
        const { sink, payloadKey } = await openRecorded()
        expect(() => sink.abandon()).not.toThrow()
        expect(() => sink.abandon()).not.toThrow()
        expect(allZero(payloadKey)).toBe(true)
        await expect(sink.finish()).rejects.toThrow('failed earlier')
    })

    /**
     * A noble-backed sink whose target holds call number `targetHold`, or whose `aead.seal` holds seal number
     * `sealHold` (counted after `prepareSeal`, whose key wrap goes through the same backend), until `release()`.
     */
    async function openGated(hold: { targetHold?: number, sealHold?: number }) {
        const inner = nobleAead()
        const keys: Uint8Array[] = []
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const state = { setup: true, abandoned: false, targets: 0, seals: 0, targetsAfter: 0, sealsAfter: 0 }
        const aead: AeadBackend = {
            ...inner,
            importKey: async (raw) => {
                const key = await inner.importKey(raw)
                keys.push(key as Uint8Array)
                return key
            },
            seal: async (key, nonce, plaintext, aad) => {
                if (!state.setup) {
                    state.seals++
                    if (state.abandoned) {
                        state.sealsAfter++
                    }
                    if (state.seals === hold.sealHold) {
                        await gate
                    }
                }
                return await inner.seal(key, nonce, plaintext, aad)
            },
        }
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead })
        state.setup = false
        const sink = seal.sink(async () => {
            state.targets++
            if (state.abandoned) {
                state.targetsAfter++
            }
            if (state.targets === hold.targetHold) {
                await gate
            }
        })
        return {
            sink,
            payloadKey: keys[1],
            state,
            /** Waits until the held call is reached, abandons through the sink, then lets the held call go on. */
            abandonAndRelease: async () => {
                for (let waited = 0; waited < 200 && state.targets < (hold.targetHold ?? Infinity) && state.seals < (hold.sealHold ?? Infinity); waited++) {
                    await new Promise((resolve) => setTimeout(resolve, 1))
                }
                sink.abandon()
                state.abandoned = true
                release()
            },
        }
    }

    const windows: Array<[string, { targetHold?: number, sealHold?: number }, (sink: EncryptingSink) => Promise<void>]> = [
        ['a write on the header of a small write', { targetHold: 1 }, (sink) => sink.write(vectorPlaintext(5))],
        ['a write on the header of a large write', { targetHold: 1 }, (sink) => sink.write(vectorPlaintext(3 * C + 5))],
        ['a write on a sealed chunk when the remainder fits', { targetHold: 2 }, (sink) => sink.write(vectorPlaintext(C + 5))],
        ['a write on a sealed chunk when the remainder fills the buffer', { targetHold: 2 }, (sink) => sink.write(vectorPlaintext(2 * C))],
        ['a write on a sealed chunk when more input follows', { targetHold: 2 }, (sink) => sink.write(vectorPlaintext(3 * C + 5))],
        ['a write while the seal is pending', { sealHold: 1 }, (sink) => sink.write(vectorPlaintext(C + 5))],
        ['a finish on the header', { targetHold: 1 }, (sink) => sink.finish()],
        ['a finish while the seal is pending', { sealHold: 1 }, (sink) => sink.finish()],
        ['a finish on the last chunk', { targetHold: 2 }, (sink) => sink.finish()],
    ]

    test.each(windows)('abandon during %s: the call rejects, no target call or new seal follows, and buffer and key end zero', async (_name, hold, run) => {
        const { sink, payloadKey, state, abandonAndRelease } = await openGated(hold)
        const call = run(sink)
        const settled = expect(call).rejects.toThrow('abandoned')
        await abandonAndRelease()
        await settled
        expect(state.targetsAfter, 'target calls after the abandon').toBe(0)
        // A seal already pending when the abandon came may finish; a new one must not start.
        expect(state.sealsAfter, 'seals started after the abandon').toBe(0)
        expect(allZero(heldBuffer(sink))).toBe(true)
        expect(allZero(payloadKey)).toBe(true)
        await expect(sink.finish()).rejects.toThrow()
    })

    test.each([
        ['a write', (sink: EncryptingSink) => sink.write(vectorPlaintext(5))],
        ['a finish', (sink: EncryptingSink) => sink.finish()],
    ])('abandon between the start of %s and the first resume, with the header already sent: it rejects, nothing is sealed or sent, and buffer and key end zero', async (_name, run) => {
        const { sink, payloadKey, state } = await openGated({})
        await sink.write(vectorPlaintext(10))
        const targetsBefore = state.targets
        const sealsBefore = state.seals
        const call = run(sink)
        sink.abandon()
        await expect(call).rejects.toThrow('abandoned')
        expect(state.targets).toBe(targetsBefore)
        expect(state.seals).toBe(sealsBefore)
        expect(allZero(heldBuffer(sink))).toBe(true)
        expect(allZero(payloadKey)).toBe(true)
    })

    test('abandon after finish does not throw and the emitted output stays as it was', async () => {
        const parts: Uint8Array[] = []
        const { sink } = await openRecorded((chunk) => {
            parts.push(chunk.slice())
        })
        await sink.write(vectorPlaintext(100))
        await sink.finish()
        const before = Buffer.concat(parts)
        expect(() => sink.abandon()).not.toThrow()
        expect(Buffer.concat(parts).equals(before)).toBe(true)
        expect(sink.bytesWritten).toBe(before.length)
        await expect(sink.finish()).rejects.toThrow('finished')
    })
})

describe('EncryptingSink wipe sweep', () => {
    // The wipe (an abandon or an overlapping call) is placed after every number of microtask ticks of a call, from
    // before its first await until the call has settled. Hop counts belong to the engine, so no tick is pinned.
    interface Shape {
        name: string
        pre: number[]
        op: 'write' | 'finish'
        size: number
    }
    const SHAPES: Shape[] = [
        { name: 'write(5) fresh', pre: [], op: 'write', size: 5 },
        { name: 'write(5) header sent', pre: [3], op: 'write', size: 5 },
        { name: 'write(C+5)', pre: [], op: 'write', size: C + 5 },
        { name: 'write(2C)', pre: [], op: 'write', size: 2 * C },
        { name: 'write(3C+5)', pre: [], op: 'write', size: 3 * C + 5 },
        { name: 'write(5) on a full buffer', pre: [C], op: 'write', size: 5 },
        { name: 'write(2C+5) on a full buffer', pre: [C], op: 'write', size: 2 * C + 5 },
        { name: 'finish fresh', pre: [], op: 'finish', size: 0 },
        { name: 'finish after 10 bytes', pre: [10], op: 'finish', size: 0 },
        { name: 'finish after C bytes', pre: [C], op: 'finish', size: 0 },
    ]
    const TARGETS = ['synchronous', 'microtask'] as const

    // vectorPlaintext starts with a zero byte, so a constant non-zero fill makes "the buffer holds plaintext" visible.
    const fill = (length: number) => new Uint8Array(length).fill(0xa5)
    const nonZero = (bytes: Uint8Array) => bytes.some((byte) => byte !== 0)
    const tick = () => Promise.resolve()

    async function runAt(shape: Shape, target: typeof TARGETS[number], ticks: number, how: 'abandon' | 'overlap') {
        const inner = nobleAead()
        const keys: Uint8Array[] = []
        const state = { armed: false, wiped: false, targetsAfter: 0, sealsAfter: 0 }
        const aead: AeadBackend = {
            ...inner,
            importKey: async (raw) => {
                const key = await inner.importKey(raw)
                keys.push(key as Uint8Array)
                return key
            },
            seal: async (key, nonce, plaintext, aad) => {
                if (state.armed && state.wiped) {
                    state.sealsAfter++
                }
                return await inner.seal(key, nonce, plaintext, aad)
            },
        }
        const seal = await prepareSeal(VECTOR_INPUT.password, PARAMS, { random: vectorRandom(), aead, kdf: async () => new Uint8Array(32).fill(7) })
        const note = () => {
            if (state.wiped) {
                state.targetsAfter++
            }
        }
        const sink = seal.sink(target === 'synchronous' ? note : async () => {
            note()
        })
        for (const size of shape.pre) {
            await sink.write(fill(size))
        }
        state.armed = true
        const buffer = (sink as unknown as { buffer: Uint8Array }).buffer
        const call = shape.op === 'write' ? sink.write(fill(shape.size)) : sink.finish()
        let outcome = 'pending'
        call.then(() => {
            outcome = 'resolved'
        }, (error: Error) => {
            outcome = `rejected: ${error.message}`
        })
        for (let step = 0; step < ticks; step++) {
            await tick()
        }
        const busy = (sink as unknown as { busy: boolean }).busy
        if (how === 'overlap' && !busy) {
            // Nothing overlaps once the call has settled; a further write is then an ordinary one.
            await call.then(() => undefined, () => undefined)
            return { busy, violations: [] as string[] }
        }
        if (how === 'abandon') {
            seal.abandon()
        } else {
            sink.write(fill(1)).catch(() => undefined)
        }
        state.wiped = true
        const violations: string[] = []
        const checkZero = (when: string) => {
            if (nonZero(buffer)) {
                violations.push(`buffer holds plaintext ${when}`)
            }
        }
        checkZero('right after the wipe')
        for (let step = 0; step < 40; step++) {
            await tick()
            checkZero('at a later tick')
        }
        await call.then(() => undefined, () => undefined)
        checkZero('after the call settled')
        if (nonZero(keys[1])) {
            violations.push('key is not zero after the call settled')
        }
        if (state.targetsAfter > 0) {
            violations.push('target call after the wipe')
        }
        if (state.sealsAfter > 0) {
            violations.push('seal started after the wipe')
        }
        if (busy && !outcome.startsWith('rejected')) {
            violations.push(`a call that was busy at the wipe ended ${outcome}`)
        }
        await sink.finish().then(() => violations.push('a later finish resolved'), () => undefined)
        return { busy, violations }
    }

    for (const how of ['abandon', 'overlap'] as const) {
        for (const shape of SHAPES.filter((candidate) => how === 'abandon' || candidate.op === 'write')) {
            for (const target of TARGETS) {
                test(`${how} at every tick of ${shape.name}, ${target} target: busy calls reject, nothing is used after the wipe, buffer and key end zero`, async () => {
                    const found: string[] = []
                    let busyPositions = 0
                    let idlePositions = 0
                    // From before the first await until two positions after the call had settled.
                    for (let ticks = 0; idlePositions < 3; ticks++) {
                        const run = await runAt(shape, target, ticks, how)
                        if (run.busy) {
                            busyPositions++
                        } else {
                            idlePositions++
                        }
                        found.push(...run.violations.map((violation) => `tick ${ticks}: ${violation}`))
                        if (ticks > 200) {
                            throw new Error('the call never settled')
                        }
                    }
                    expect(found).toEqual([])
                    expect(busyPositions, 'at least one position with the call in flight').toBeGreaterThan(0)
                    expect(idlePositions, 'at least one position after the call settled').toBeGreaterThan(0)
                })
            }
        }
    }
})
