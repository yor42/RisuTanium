// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { rangeSourceFrom } from 'src/ts/drive/rtb/rangeSource'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { nobleAead, webCryptoAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import { openSealedRtb } from 'src/ts/drive/rtb/sealed/decryptingSource'
import { parseSealedHeader } from 'src/ts/drive/rtb/sealed/format'
import { keyCommit, payloadKey } from 'src/ts/drive/rtb/sealed/keys'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { passwordOnce, referenceSeal, vectorPlaintext, vectorRandom, VECTOR_INPUT } from './sealedReference'

// Envelope vectors EV1 to EV3 of the specification (section 14), produced there with node:crypto only.
const HEADER_HEX = '525442580d0a1a0a010000000100000040000000505152535455565758595a5b5c5d5e5fa8000000a546d0aad9d3f4ad520627a26273c2bccf8d3f5c625f5b73b7116ed711eccfd10100000001005800010001000001000002000000101112131415161718191a1b1c1d1e1f404142434445464748494a4b44e51b79941e16374072aaaa84d0e8a5a4711f599f1f13e01a3cb69b169cdf7f9406a72e425f336f85ffd4574472ab3d'
const KEK_HEX = 'de78a0cb12b1e86d49fa4d4586b981c374f028f41a2483dbb4406cdb1ec3f5d1'
const PAYLOAD_KEY_HEX = 'ba05b2aeb68a6152119963dc220b41a5f886b9dd6673e492d1e9c9c3019bcc33'
const COMMIT_HEX = 'a546d0aad9d3f4ad520627a26273c2bccf8d3f5c625f5b73b7116ed711eccfd1'
const EV3_CHUNK_HEX = 'a4659975d96ff99257e276dc2686a368'

const VECTORS = [
    { id: 'EV1', plaintextLen: 150, size: 366, sha256: 'dbab4104b722e4e47980ecc5a5fdf34fff1c57ae4a8f7f5bc7723196f57deaad' },
    { id: 'EV2', plaintextLen: 128, size: 328, sha256: '7eaabdef1edc9c3787a0e9298cfd882b8bde4b8de70be3544a66ffeb46dc0f43' },
    { id: 'EV3', plaintextLen: 0, size: 184, sha256: 'ed6553175747340a29af784fa88c7035f6cf6e206282cf2ef580569dbd9c2820' },
]

const BACKENDS: Array<[string, () => AeadBackend]> = [
    ['webcrypto', () => webCryptoAead()],
    ['noble', () => nobleAead()],
]

const SEAL_PARAMS = { m: VECTOR_INPUT.m, t: VECTOR_INPUT.t, chunkSize: VECTOR_INPUT.C }

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

async function sealWithEngine(plaintext: Uint8Array, aead: AeadBackend): Promise<Uint8Array> {
    const seal = await prepareSeal(VECTOR_INPUT.password, SEAL_PARAMS, { random: vectorRandom(), aead })
    const parts: Uint8Array[] = []
    const sink = seal.sink((chunk) => {
        parts.push(chunk.slice())
    })
    await sink.write(plaintext)
    await sink.finish()
    expect(sink.bytesWritten).toBe(seal.sealedSize(plaintext.length))
    return new Uint8Array(Buffer.concat(parts))
}

describe('the independent reference reproduces the specification vectors', () => {
    for (const vector of VECTORS) {
        test(`${vector.id}: size, SHA-256 and header`, () => {
            const reference = referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(vector.plaintextLen) })
            expect(reference.file.length).toBe(vector.size)
            expect(sha256(reference.file)).toBe(vector.sha256)
            expect(reference.file.subarray(0, 168).toString('hex')).toBe(HEADER_HEX)
            expect(reference.kek.toString('hex')).toBe(KEK_HEX)
            expect(reference.payloadKey.toString('hex')).toBe(PAYLOAD_KEY_HEX)
            expect(reference.keyCommit.toString('hex')).toBe(COMMIT_HEX)
        })
    }

    test('EV3 in full is the header followed by one sealed empty chunk', () => {
        const reference = referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(0) })
        expect(reference.file.toString('hex')).toBe(HEADER_HEX + EV3_CHUNK_HEX)
    })
})

describe.each(BACKENDS)('the engine on the %s backend', (_name, makeBackend) => {
    for (const vector of VECTORS) {
        test(`${vector.id}: the writer reproduces the vector byte for byte`, async () => {
            const file = await sealWithEngine(vectorPlaintext(vector.plaintextLen), makeBackend())
            expect(file.length).toBe(vector.size)
            expect(sha256(file)).toBe(vector.sha256)
            expect(Buffer.from(file.subarray(0, 168)).toString('hex')).toBe(HEADER_HEX)
        })

        test(`${vector.id}: the reader opens the vector (the password in NFD and in NFC)`, async () => {
            const file = referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(vector.plaintextLen) }).file
            for (const password of [VECTOR_INPUT.password, VECTOR_INPUT.password.normalize('NFC')]) {
                const opened = await openSealedRtb(rangeSourceFrom({ size: file.length, read: async (start, end) => file.subarray(start, end) }), {
                    askPassword: passwordOnce(password),
                    aead: makeBackend(),
                })
                if (opened.kind !== 'open') {
                    throw new Error(`${vector.id} did not open: ${opened.class} ${opened.detail}`)
                }
                expect(opened.source.size).toBe(vector.plaintextLen)
                const plain = await opened.source.read(0, vector.plaintextLen)
                expect(Buffer.from(plain).equals(vectorPlaintext(vector.plaintextLen))).toBe(true)
            }
        })
    }
})

test('the engine derives the vector payload key and key commitment from the parsed header', () => {
    const file = referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(150) }).file
    const parsed = parseSealedHeader(file.subarray(0, 76), file.subarray(76), file.length)
    if (parsed.kind !== 'ok') {
        throw new Error(`header refused: ${parsed.row}`)
    }
    expect(Buffer.from(payloadKey(VECTOR_INPUT.master, parsed.value)).toString('hex')).toBe(PAYLOAD_KEY_HEX)
    expect(Buffer.from(keyCommit(VECTOR_INPUT.master, parsed.value)).toString('hex')).toBe(COMMIT_HEX)
    expect(Buffer.from(parsed.value.keyCommit).toString('hex')).toBe(COMMIT_HEX)
})

describe('builds that cannot read the envelope', () => {
    test('the plaintext verifier still reports EV1 as encrypted, with nothing read past the header', async () => {
        const file = referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(150) }).file
        const verdict = await verifyRtb(rangeSourceFrom({ size: file.length, read: async (start, end) => file.subarray(start, end) }))
        expect(verdict).toEqual({ kind: 'encrypted' })
    })

    for (const [name, patch] of [
        ['envelope version 2', (file: Buffer) => file.writeUInt16LE(2, 8)],
        ['aead id 2', (file: Buffer) => file.writeUInt8(2, 12)],
        ['kdf id 2', (file: Buffer) => file.writeUInt8(2, 80)],
    ] as Array<[string, (file: Buffer) => void]>) {
        test(`the engine refuses ${name} as newer before any prompt`, async () => {
            const file = Buffer.from(referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(150) }).file)
            patch(file)
            let asked = 0
            const opened = await openSealedRtb(rangeSourceFrom({ size: file.length, read: async (start, end) => file.subarray(start, end) }), {
                askPassword: async () => {
                    asked++
                    return null
                },
            })
            expect(opened).toMatchObject({ kind: 'ended', class: 'newer' })
            expect(asked).toBe(0)
        })
    }
})
