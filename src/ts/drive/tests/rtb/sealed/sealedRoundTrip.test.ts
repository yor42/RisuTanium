// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { rangeSourceFrom, type RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { nobleAead, webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import { openSealedRtb } from 'src/ts/drive/rtb/sealed/decryptingSource'
import { deriveKek } from 'src/ts/drive/rtb/sealed/kdf'
import { SealedPasswordError } from 'src/ts/drive/rtb/sealed/errors'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { passwordOnce, referenceOpen, referenceSeal, seededBytes, sequenceRandom } from './sealedReference'

const PASSWORD = 'pässwörd 한글 1'
const BACKENDS: Array<[string, () => AeadBackend]> = [
    ['webcrypto', () => webCryptoAead()],
    ['noble', () => nobleAead()],
]

function outerOf(bytes: Uint8Array): RangeSource {
    return rangeSourceFrom({ size: bytes.length, read: async (start, end) => bytes.slice(start, end) })
}

async function engineSeal(plaintext: Uint8Array, chunkSize: number, aead: AeadBackend, seed = 1): Promise<Buffer> {
    const seal = await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize }, {
        random: sequenceRandom([seededBytes(32, seed), seededBytes(16, seed + 1), seededBytes(12, seed + 2), seededBytes(16, seed + 3)]),
        aead,
    })
    const parts: Uint8Array[] = []
    const sink = seal.sink((chunk) => {
        parts.push(chunk.slice())
    })
    await sink.write(plaintext)
    await sink.finish()
    const file = Buffer.concat(parts)
    expect(file.length).toBe(seal.sealedSize(plaintext.length))
    return file
}

async function engineRead(file: Uint8Array, aead: AeadBackend): Promise<Uint8Array> {
    const opened = await openSealedRtb(outerOf(file), { askPassword: passwordOnce(PASSWORD), aead })
    if (opened.kind !== 'open') {
        throw new Error(`did not open: ${opened.class} ${opened.detail}`)
    }
    return await opened.source.read(0, opened.source.size)
}

describe('round trips at several chunk sizes and lengths', () => {
    for (const chunkSize of [64, 1000, 65_536, 1_048_576]) {
        const lengths = [0, 1, chunkSize - 1, chunkSize, chunkSize + 1, 2 * chunkSize, 3 * chunkSize + 5]
        describe.each(BACKENDS)(`chunk size ${chunkSize} on the %s backend`, (_name, make) => {
            test.each(lengths)('engine to reference and reference to engine, %i bytes', async (length) => {
                const plaintext = seededBytes(length, length + chunkSize)
                const file = await engineSeal(plaintext, chunkSize, make())
                expect(referenceOpen(file, PASSWORD).equals(plaintext)).toBe(true)
                expect(Buffer.from(await engineRead(file, make())).equals(plaintext)).toBe(true)

                const reference = referenceSeal({
                    password: PASSWORD,
                    salt: seededBytes(16, 40),
                    m: 8,
                    t: 1,
                    p: 1,
                    master: seededBytes(32, 41),
                    wrapNonce: seededBytes(12, 42),
                    fileId: seededBytes(16, 43),
                    C: chunkSize,
                    plaintext,
                }).file
                expect(Buffer.from(await engineRead(reference, make())).equals(plaintext)).toBe(true)
            })
        })
    }
})

describe('size arithmetic of engine-written files', () => {
    const C = 64
    test('empty plaintext: one chunk, header plus tag', async () => {
        const file = await engineSeal(new Uint8Array(0), C, webCryptoAead())
        expect(file.length).toBe(168 + 16)
    })

    test('an exact multiple has no empty trailing chunk', async () => {
        const file = await engineSeal(seededBytes(3 * C, 3), C, webCryptoAead())
        expect(file.length).toBe(168 + 3 * (C + 16))
    })

    test('one byte, and one byte over a multiple', async () => {
        expect((await engineSeal(seededBytes(1, 3), C, webCryptoAead())).length).toBe(168 + 1 + 16)
        expect((await engineSeal(seededBytes(C + 1, 3), C, webCryptoAead())).length).toBe(168 + C + 16 + 1 + 16)
    })
})

describe('backends', () => {
    test('a file written on one backend opens on the other, both ways', async () => {
        const plaintext = seededBytes(500, 9)
        const fromWeb = await engineSeal(plaintext, 64, webCryptoAead())
        const fromNoble = await engineSeal(plaintext, 64, nobleAead())
        expect(fromWeb.equals(fromNoble)).toBe(true)
        expect(Buffer.from(await engineRead(fromWeb, nobleAead())).equals(plaintext)).toBe(true)
        expect(Buffer.from(await engineRead(fromNoble, webCryptoAead())).equals(plaintext)).toBe(true)
    })

    test('the sink and the source keep their backend when crypto.subtle disappears afterwards', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
        const plaintext = seededBytes(300, 5)
        const seal = await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize: 64 })
        const sink = seal.sink(() => undefined)
        const parts: Uint8Array[] = []
        const kept = seal.sink((chunk) => {
            parts.push(chunk.slice())
        })
        const readerFile = await engineSeal(plaintext, 64, webCryptoAead())
        const opened = await openSealedRtb(outerOf(readerFile), { askPassword: passwordOnce(PASSWORD) })
        if (opened.kind !== 'open') {
            throw new Error(opened.class)
        }
        Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined })
        try {
            await sink.write(plaintext)
            await sink.finish()
            await kept.write(plaintext)
            await kept.finish()
            expect(Buffer.from(await opened.source.read(0, plaintext.length)).equals(plaintext)).toBe(true)
        } finally {
            if (descriptor) {
                Object.defineProperty(globalThis.crypto, 'subtle', descriptor)
            } else {
                delete (globalThis.crypto as { subtle?: SubtleCrypto }).subtle
            }
        }
        expect(Buffer.concat(parts).length).toBe(seal.sealedSize(plaintext.length))
    })

    test('with crypto.subtle absent a fresh operation selects the noble backend and round-trips', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
        Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined })
        try {
            const seal = await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize: 64 })
            expect(seal.aead.name).toBe('noble')
            const parts: Uint8Array[] = []
            const sink = seal.sink((chunk) => {
                parts.push(chunk.slice())
            })
            const plaintext = seededBytes(200, 2)
            await sink.write(plaintext)
            await sink.finish()
            const file = Buffer.concat(parts)
            expect(referenceOpen(file, PASSWORD).equals(plaintext)).toBe(true)
            expect(Buffer.from(await engineRead(file, nobleAead())).equals(plaintext)).toBe(true)
            const opened = await openSealedRtb(outerOf(file), { askPassword: passwordOnce(PASSWORD) })
            expect(opened.kind).toBe('open')
        } finally {
            if (descriptor) {
                Object.defineProperty(globalThis.crypto, 'subtle', descriptor)
            } else {
                delete (globalThis.crypto as { subtle?: SubtleCrypto }).subtle
            }
        }
    })
})

describe('writer randomness and refusals', () => {
    async function sealDefault(): Promise<Buffer> {
        const seal = await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize: 64 })
        const parts: Uint8Array[] = []
        const sink = seal.sink((chunk) => {
            parts.push(chunk.slice())
        })
        await sink.write(new Uint8Array([1, 2, 3]))
        await sink.finish()
        return Buffer.concat(parts)
    }

    test('two writes of the same plaintext and password differ in file id, salt, wrap nonce and master key', async () => {
        const a = await sealDefault()
        const b = await sealDefault()
        const region = (file: Buffer, from: number, to: number) => file.subarray(from, to).toString('hex')
        expect(region(a, 20, 36)).not.toBe(region(b, 20, 36))
        expect(region(a, 92, 108)).not.toBe(region(b, 92, 108))
        expect(region(a, 108, 120)).not.toBe(region(b, 108, 120))
        // Different master keys show in the commitment, the wrapped key and the chunks.
        expect(region(a, 40, 72)).not.toBe(region(b, 40, 72))
        expect(region(a, 120, 168)).not.toBe(region(b, 120, 168))
        expect(region(a, 168, a.length)).not.toBe(region(b, 168, b.length))
    })

    test('the derivation runs once per prepareSeal, with the NFC bytes and the written parameters', async () => {
        const calls: Array<{ password: string, m: number, t: number, p: number, saltLength: number }> = []
        await prepareSeal('é', { m: 16, t: 2, chunkSize: 64 }, {
            kdf: async (password, salt, params) => {
                calls.push({ password: Buffer.from(password).toString('hex'), ...params, saltLength: salt.length })
                return new Uint8Array(32).fill(1)
            },
        })
        expect(calls).toEqual([{ password: 'c3a9', m: 16, t: 2, p: 1, saltLength: 16 }])
    })

    test('the writer zeroes the key-encryption key and the password bytes it handed to the derivation', async () => {
        const keks: Uint8Array[] = []
        const passwords: Uint8Array[] = []
        await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize: 64 }, {
            kdf: async (password, salt, params) => {
                passwords.push(password)
                const kek = await deriveKek(password, salt, params)
                keks.push(kek)
                return kek
            },
        })
        expect(keks.length).toBe(1)
        expect(keks[0].every((byte) => byte === 0)).toBe(true)
        expect(passwords[0].every((byte) => byte === 0)).toBe(true)
    })

    test('invalid parameters are refused before the password is looked at', async () => {
        await expect(prepareSeal('', { m: 7, t: 1, chunkSize: 64 })).rejects.toThrow(RangeError)
        await expect(prepareSeal('', { m: 8, t: 1, chunkSize: 64 })).rejects.toBeInstanceOf(SealedPasswordError)
    })

    test('an unusable password rejects before the derivation runs', async () => {
        let ran = 0
        const kdf = async () => {
            ran++
            return new Uint8Array(32)
        }
        await expect(prepareSeal('', { m: 8, t: 1, chunkSize: 64 }, { kdf })).rejects.toMatchObject({ name: 'SealedPasswordError', reason: 'empty' })
        await expect(prepareSeal('\ud800', { m: 8, t: 1, chunkSize: 64 }, { kdf })).rejects.toBeInstanceOf(SealedPasswordError)
        expect(ran).toBe(0)
    })

    test('parameters a reader would refuse are refused by the writer', async () => {
        for (const params of [
            { m: 8, t: 1, chunkSize: 63 },
            { m: 8, t: 1, chunkSize: 16_777_217 },
            { m: 7, t: 1, chunkSize: 64 },
            { m: 8, t: 0, chunkSize: 64 },
            { m: 1_048_577, t: 1, chunkSize: 64 },
            { m: 1_048_576, t: 5, chunkSize: 64 },
        ]) {
            await expect(prepareSeal(PASSWORD, params, { kdf: async () => new Uint8Array(32) }), JSON.stringify(params)).rejects.toThrow(RangeError)
        }
    })

    test('the writer does not keep or zero the arrays an injected random source hands out', async () => {
        const master = seededBytes(32, 1)
        const keep = Buffer.from(master)
        await prepareSeal(PASSWORD, { m: 8, t: 1, chunkSize: 64 }, {
            random: sequenceRandom([master, seededBytes(16, 2), seededBytes(12, 3), seededBytes(16, 4)]),
        })
        expect(master.equals(keep)).toBe(true)
    })
})
