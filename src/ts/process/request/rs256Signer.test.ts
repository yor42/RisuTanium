// @vitest-environment node
/**
 * The Vertex JWT signer must give the same bytes with and without `crypto.subtle`, and every key that
 * is not a usable RSA PKCS#8 key must surface as `RsaKeyError`, on both paths.
 *
 * The reference is Node's WebCrypto (OpenSSL), driven with real RSA keys. PKCS1 v1.5 is deterministic,
 * so byte equality with WebCrypto is the proof that the owned signer is correct. Tests whose title
 * starts with `guard:` pin the new module's contract and pass on first run by construction.
 */
import { describe, expect, test, vi } from 'vitest'
import { pkcs8FromPem, RsaKeyError, rsaPkcs1Sha256Sign, signRs256 } from './rs256Signer'

const realCrypto = globalThis.crypto
const subtle = realCrypto.subtle
const utf8 = (text: string) => new TextEncoder().encode(text)
const RSA_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

async function generate(modulusLength: number) {
    const pair = await subtle.generateKey({ ...RSA_ALGORITHM, modulusLength, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
    return { pair, pkcs8 }
}

async function webSign(pkcs8: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const key = await subtle.importKey('pkcs8', pkcs8.slice(), RSA_ALGORITHM, false, ['sign'])
    return new Uint8Array(await subtle.sign(RSA_ALGORITHM.name, key, message.slice()))
}

function toPem(pkcs8: Uint8Array, newline = '\n'): string {
    let binary = ''
    for (const byte of pkcs8) { binary += String.fromCharCode(byte) }
    return `-----BEGIN PRIVATE KEY-----${newline}${btoa(binary).replace(/(.{64})/g, `$1${newline}`)}${newline}-----END PRIVATE KEY-----${newline}`
}

//#region minimal DER encoder for building keys from JWK components

function derLength(length: number): number[] {
    if (length < 0x80) { return [length] }
    const bytes: number[] = []
    for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) { bytes.unshift(rest % 256) }
    return [0x80 | bytes.length, ...bytes]
}
const der = (tag: number, body: number[]) => [tag, ...derLength(body.length), ...body]
function derInt(hex: string): number[] {
    const bytes = hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [0]
    return der(0x02, bytes[0] & 0x80 ? [0, ...bytes] : bytes)
}
function base64urlToHex(value: string): string {
    return Buffer.from(value, 'base64url').toString('hex')
}
const ALGORITHM_IDENTIFIER = der(0x30, [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])

async function pkcs8WithPrime(original: Uint8Array, replacement: { p?: string }): Promise<Uint8Array> {
    const key = await subtle.importKey('pkcs8', original.slice(), RSA_ALGORITHM, true, ['sign'])
    const jwk = await subtle.exportKey('jwk', key)
    const parts = [jwk.n, jwk.e, jwk.d, jwk.p, jwk.q, jwk.dp, jwk.dq, jwk.qi].map((value) => base64urlToHex(value ?? ''))
    if (replacement.p !== undefined) { parts[3] = replacement.p }
    const rsaKey = der(0x30, [...derInt('00'), ...parts.flatMap(derInt)])
    return new Uint8Array(der(0x30, [...derInt('00'), ...ALGORITHM_IDENTIFIER, ...der(0x04, rsaKey)]))
}

//#endregion

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => null, (error: unknown) => error)
}

describe('owned RSA signer against WebCrypto', () => {
    test('guard: 2048-bit key, 16 messages: the signature bytes equal WebCrypto', async () => {
        const { pkcs8 } = await generate(2048)
        for (let i = 0; i < 16; i++) {
            const message = utf8(`header.claims-${i}-${'x'.repeat(i * 37)}`)
            expect(Buffer.from(rsaPkcs1Sha256Sign(pkcs8, message)).toString('hex')).toBe(Buffer.from(await webSign(pkcs8, message)).toString('hex'))
        }
    }, 60000)

    test('guard: 3072-bit and 4096-bit keys sign the same bytes as WebCrypto', async () => {
        for (const bits of [3072, 4096]) {
            const { pkcs8 } = await generate(bits)
            for (const message of [utf8('a.b'), utf8('another.message')]) {
                const owned = rsaPkcs1Sha256Sign(pkcs8, message)
                expect(owned).toHaveLength(bits / 8)
                expect(Buffer.from(owned).toString('hex')).toBe(Buffer.from(await webSign(pkcs8, message)).toString('hex'))
            }
        }
    }, 120000)

    test('guard: a signature that starts with a zero byte is left-padded to the modulus length', async () => {
        const { pkcs8 } = await generate(2048)
        let message: Uint8Array | null = null
        let expected: Uint8Array | null = null
        for (let i = 0; i < 5000 && message === null; i++) {
            const candidate = utf8(`zero-search-${i}`)
            const signature = await webSign(pkcs8, candidate)
            if (signature[0] === 0) {
                message = candidate
                expected = signature
            }
        }
        expect(message).not.toBeNull()
        const owned = rsaPkcs1Sha256Sign(pkcs8, message as Uint8Array)
        expect(owned).toHaveLength(256)
        expect(owned[0]).toBe(0)
        expect(Buffer.from(owned).toString('hex')).toBe(Buffer.from(expected as Uint8Array).toString('hex'))
    }, 60000)

    test('guard: a corrupted CRT coefficient still signs, and matches OpenSSL, because d is used instead', async () => {
        const { pair, pkcs8 } = await generate(2048)
        const tampered = pkcs8.slice()
        tampered[tampered.length - 1] ^= 0x01
        const message = utf8('crt.fallback')

        const owned = rsaPkcs1Sha256Sign(tampered, message)

        expect(await subtle.verify(RSA_ALGORITHM.name, pair.publicKey, owned.slice(), message.slice())).toBe(true)
        expect(Buffer.from(owned).toString('hex')).toBe(Buffer.from(await webSign(tampered, message)).toString('hex'))
    }, 60000)
})

describe('a key that is not a usable RSA PKCS#8 key', () => {
    test('guard: empty, truncated, EC, raw PKCS#1, corrupted modulus and zero prime are RsaKeyError', async () => {
        const { pkcs8 } = await generate(2048)
        const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        const ecPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', ec.privateKey))
        // The header of a 2048-bit modulus INTEGER; the modulus bytes follow it.
        const nHeader = [0x02, 0x82, 0x01, 0x01, 0x00]
        const nOffset = pkcs8.findIndex((_, i) => nHeader.every((byte, j) => pkcs8[i + j] === byte)) + nHeader.length
        expect(nOffset).toBeGreaterThan(nHeader.length - 1)
        const corruptModulus = pkcs8.slice()
        corruptModulus[nOffset + 128] ^= 0x55
        // The RSAPrivateKey SEQUENCE sits inside the OCTET STRING that follows the AlgorithmIdentifier.
        const rawPkcs1 = pkcs8.slice(pkcs8.findIndex((byte, i) => byte === 0x04 && pkcs8[i + 1] === 0x82 && pkcs8[i + 2] === 0x04) + 4)
        // Same length as the rsaEncryption OID, but id-RSASSA-PSS: only the OID check can reject it.
        const oidOffset = pkcs8.findIndex((_, i) => pkcs8[i] === 0x06 && pkcs8[i + 1] === 0x09 && pkcs8[i + 10] === 0x01 && pkcs8[i + 9] === 0x01 && pkcs8[i + 8] === 0x01)
        expect(oidOffset).toBeGreaterThan(0)
        const pssOid = pkcs8.slice()
        pssOid[oidOffset + 10] = 0x0a
        const cases: Array<[string, Uint8Array]> = [            ['empty', new Uint8Array(0)],
            ['truncated', pkcs8.slice(0, pkcs8.length - 1)],
            ['ec', ecPkcs8],
            ['raw pkcs1', rawPkcs1],
            ['other algorithm OID', pssOid],
            ['corrupted n', corruptModulus],
            ['p = 0', await pkcs8WithPrime(pkcs8, { p: '00' })],
        ]
        for (const [label, bytes] of cases) {
            const error = await rejection(Promise.resolve().then(() => rsaPkcs1Sha256Sign(bytes, utf8('m'))))
            expect(error, label).toBeInstanceOf(RsaKeyError)
        }
    }, 60000)
})

describe('pkcs8FromPem', () => {
    test('guard: LF, literal backslash-n and CRLF layouts all decode to the exported DER', async () => {
        const { pkcs8 } = await generate(2048)
        const hex = Buffer.from(pkcs8).toString('hex')
        expect(Buffer.from(pkcs8FromPem(toPem(pkcs8))).toString('hex')).toBe(hex)
        expect(Buffer.from(pkcs8FromPem(toPem(pkcs8, '\\n'))).toString('hex')).toBe(hex)
        expect(Buffer.from(pkcs8FromPem(toPem(pkcs8, '\r\n'))).toString('hex')).toBe(hex)
    })

    test('guard: a body that is not base64 is RsaKeyError', () => {
        expect(() => pkcs8FromPem('-----BEGIN PRIVATE KEY-----\nab$cd\n-----END PRIVATE KEY-----')).toThrow(RsaKeyError)
    })
})

describe('signRs256 backend selection and error mapping', () => {
    test('guard: WebCrypto is used when subtle exists and the owned signer when it does not, with equal bytes', async () => {
        const { pkcs8 } = await generate(2048)
        const message = utf8('select.backend')
        const sign = vi.fn(subtle.sign.bind(subtle))
        const spy = {
            importKey: subtle.importKey.bind(subtle),
            sign,
        } as unknown as SubtleCrypto

        const viaSubtle = await signRs256(pkcs8, message, { crypto: { subtle: spy } })
        expect(sign).toHaveBeenCalledTimes(1)
        const owned = await signRs256(pkcs8, message, {})
        expect(sign).toHaveBeenCalledTimes(1)

        expect(Buffer.from(owned).toString('hex')).toBe(Buffer.from(viaSubtle).toString('hex'))
    })

    test('guard: only an importKey DataError is mapped; other importKey and sign rejections pass through', async () => {
        const { pkcs8 } = await generate(2048)
        const fake = (importKey: () => Promise<never>, sign: () => Promise<never>) => ({ crypto: { subtle: { importKey, sign } as unknown as SubtleCrypto } })

        const mapped = await rejection(signRs256(pkcs8, utf8('m'), fake(async () => { throw new DOMException('bad', 'DataError') }, async () => { throw new Error('unused') })))
        expect(mapped).toBeInstanceOf(RsaKeyError)

        const typeError = new TypeError('x')
        expect(await rejection(signRs256(pkcs8, utf8('m'), fake(async () => { throw typeError }, async () => { throw new Error('unused') })))).toBe(typeError)

        const realImport = { crypto: { subtle: { importKey: subtle.importKey.bind(subtle), sign: async () => { throw new DOMException('x', 'OperationError') } } as unknown as SubtleCrypto } }
        const signError = await rejection(signRs256(pkcs8, utf8('m'), realImport))
        expect(signError).not.toBeInstanceOf(RsaKeyError)
        expect((signError as { name?: string }).name).toBe('OperationError')
    })

    test('guard: WebCrypto and the owned path both raise RsaKeyError for a truncated key', async () => {
        const { pkcs8 } = await generate(2048)
        const truncated = pkcs8.slice(0, pkcs8.length - 1)
        expect(await rejection(signRs256(truncated, utf8('m')))).toBeInstanceOf(RsaKeyError)
        expect(await rejection(signRs256(truncated, utf8('m'), {}))).toBeInstanceOf(RsaKeyError)
    })
})
