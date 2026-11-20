// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { nobleAead, webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
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

    test('overlapping calls are refused and poison the sink', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const sink = await openSink(() => gate)
        const first = sink.write(vectorPlaintext(10))
        await expect(sink.write(vectorPlaintext(1))).rejects.toThrow()
        release()
        await first
        await expect(sink.finish()).rejects.toThrow()
    })
})
