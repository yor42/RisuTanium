/**
 * RSASSA-PKCS1-v1_5 / SHA-256 signing for the Vertex service-account JWT.
 *
 * `crypto.subtle` is absent on a plain-HTTP page, so `signRs256` uses WebCrypto when it exists and
 * otherwise the owned BigInt signer below. PKCS1 v1.5 is deterministic, so for a consistent key both
 * paths produce the same bytes for the same message. The owned signer is used only without `crypto.subtle`; BigInt
 * arithmetic is not constant-time, which is accepted for a key the user pasted into this page.
 *
 * Every "this is not a usable RSA PKCS#8 key" outcome is an `RsaKeyError`, on both paths, so the caller
 * can tell a malformed key apart from a network or token failure.
 */
import { sha256 } from '@noble/hashes/sha2.js'

export class RsaKeyError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'RsaKeyError'
    }
}

function errorName(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string') {
        return error.name
    }
    return undefined
}

/**
 * Decodes the base64 body of a PKCS#8 PEM. Literal `\n` escapes (a JSON-pasted key) and any ASCII
 * whitespace are dropped; text that is not base64 is an `RsaKeyError`.
 */
export function pkcs8FromPem(pem: string): Uint8Array {
    let binary: string
    try {
        binary = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n/g, ''))
    }
    catch (error) {
        if (errorName(error) === 'InvalidCharacterError') {
            throw new RsaKeyError('The private key body is not valid base64', { cause: error })
        }
        throw error
    }
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

//#region DER

type Tlv = { tag: number, start: number, end: number }

const TAG_INTEGER = 0x02
const TAG_OCTET_STRING = 0x04
const TAG_NULL = 0x05
const TAG_OID = 0x06
const TAG_SEQUENCE = 0x30

/** Reads one definite-length element at `offset`; the element must lie inside `limit`. */
function readTlv(bytes: Uint8Array, offset: number, limit: number): Tlv {
    if (offset + 2 > limit) {
        throw new RsaKeyError('DER element is truncated')
    }
    const tag = bytes[offset]
    const lengthByte = bytes[offset + 1]
    let start = offset + 2
    let length = lengthByte
    if (lengthByte >= 0x80) {
        const count = lengthByte & 0x7f
        if (count < 1 || count > 4 || start + count > limit) {
            throw new RsaKeyError('DER length is not a definite length')
        }
        length = 0
        for (let i = 0; i < count; i++) {
            length = length * 256 + bytes[start + i]
        }
        start += count
    }
    const end = start + length
    if (end > limit) {
        throw new RsaKeyError('DER element overruns its container')
    }
    return { tag, start, end }
}

function expectTlv(bytes: Uint8Array, offset: number, limit: number, tag: number): Tlv {
    const tlv = readTlv(bytes, offset, limit)
    if (tlv.tag !== tag) {
        throw new RsaKeyError('DER element has an unexpected tag')
    }
    return tlv
}

function readInteger(bytes: Uint8Array, offset: number, limit: number): { value: bigint, next: number } {
    const tlv = expectTlv(bytes, offset, limit, TAG_INTEGER)
    if (tlv.end === tlv.start || (bytes[tlv.start] & 0x80) !== 0) {
        throw new RsaKeyError('DER integer is empty or negative')
    }
    let hex = ''
    for (let i = tlv.start; i < tlv.end; i++) {
        hex += bytes[i].toString(16).padStart(2, '0')
    }
    return { value: BigInt('0x' + hex), next: tlv.end }
}

const RSA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]

type RsaPrivateKey = { n: bigint, e: bigint, d: bigint, p: bigint, q: bigint, dP: bigint, dQ: bigint, qInv: bigint }

function parsePkcs8(pkcs8: Uint8Array): RsaPrivateKey {
    const info = expectTlv(pkcs8, 0, pkcs8.length, TAG_SEQUENCE)
    if (info.end !== pkcs8.length) {
        throw new RsaKeyError('Trailing bytes after the PrivateKeyInfo')
    }
    const version = readInteger(pkcs8, info.start, info.end)
    if (version.value !== 0n) {
        throw new RsaKeyError('Unsupported PrivateKeyInfo version')
    }
    const algorithm = expectTlv(pkcs8, version.next, info.end, TAG_SEQUENCE)
    const oid = expectTlv(pkcs8, algorithm.start, algorithm.end, TAG_OID)
    if (oid.end - oid.start !== RSA_OID.length || RSA_OID.some((byte, i) => pkcs8[oid.start + i] !== byte)) {
        throw new RsaKeyError('The key is not an RSA key')
    }
    if (oid.end !== algorithm.end) {
        const params = expectTlv(pkcs8, oid.end, algorithm.end, TAG_NULL)
        if (params.start !== params.end || params.end !== algorithm.end) {
            throw new RsaKeyError('Unexpected RSA algorithm parameters')
        }
    }
    const octets = expectTlv(pkcs8, algorithm.end, info.end, TAG_OCTET_STRING)
    if (octets.end !== info.end) {
        throw new RsaKeyError('Trailing bytes inside the PrivateKeyInfo')
    }

    const rsa = expectTlv(pkcs8, octets.start, octets.end, TAG_SEQUENCE)
    if (rsa.end !== octets.end) {
        throw new RsaKeyError('Trailing bytes after the RSAPrivateKey')
    }
    let offset = rsa.start
    const rsaVersion = readInteger(pkcs8, offset, rsa.end)
    if (rsaVersion.value !== 0n) {
        throw new RsaKeyError('Unsupported RSAPrivateKey version')
    }
    offset = rsaVersion.next
    const fields: bigint[] = []
    for (let i = 0; i < 8; i++) {
        const field = readInteger(pkcs8, offset, rsa.end)
        fields.push(field.value)
        offset = field.next
    }
    if (offset !== rsa.end) {
        throw new RsaKeyError('Trailing bytes inside the RSAPrivateKey')
    }
    const [n, e, d, p, q, dP, dQ, qInv] = fields
    if (p <= 1n || q <= 1n || e <= 1n) {
        throw new RsaKeyError('RSA parameters are out of range')
    }
    return { n, e, d, p, q, dP, dQ, qInv }
}

//#endregion

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n
    let b = base % modulus
    let e = exponent
    while (e > 0n) {
        if ((e & 1n) === 1n) {
            result = (result * b) % modulus
        }
        b = (b * b) % modulus
        e >>= 1n
    }
    return result
}

function toBigInt(bytes: Uint8Array): bigint {
    let hex = ''
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return BigInt('0x' + hex)
}

function i2osp(value: bigint, length: number): Uint8Array {
    const hex = value.toString(16).padStart(length * 2, '0')
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return out
}

// DigestInfo prefix for SHA-256: SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING (32) }.
const SHA256_DIGEST_INFO = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]

/** Signs `message` with the RSA private key in `pkcs8`, using only BigInt arithmetic and `sha256`. */
export function rsaPkcs1Sha256Sign(pkcs8: Uint8Array, message: Uint8Array): Uint8Array {
    const key = parsePkcs8(pkcs8)
    const k = Math.ceil(key.n.toString(16).length / 2)
    if (k < SHA256_DIGEST_INFO.length + 32 + 11) {
        throw new RsaKeyError('The RSA modulus is too small')
    }

    const digest = sha256(message)
    const em = new Uint8Array(k)
    em[1] = 0x01
    const tLength = SHA256_DIGEST_INFO.length + digest.length
    em.fill(0xff, 2, k - tLength - 1)
    em.set(SHA256_DIGEST_INFO, k - tLength)
    em.set(digest, k - digest.length)
    const m = toBigInt(em)
    if (m >= key.n) {
        throw new RsaKeyError('The encoded message is not smaller than the modulus')
    }

    const m1 = modPow(m, key.dP, key.p)
    const m2 = modPow(m, key.dQ, key.q)
    const h = (key.qInv * (((m1 - m2) % key.p) + key.p)) % key.p
    let s = m2 + h * key.q
    // A consistent key always verifies; a key whose CRT parameters are damaged signs with d instead.
    if (modPow(s, key.e, key.n) !== m) {
        s = modPow(m, key.d, key.n)
        if (modPow(s, key.e, key.n) !== m) {
            throw new RsaKeyError('The RSA key parameters are inconsistent')
        }
    }
    return i2osp(s, k)
}

/**
 * Signs with WebCrypto when `env.crypto.subtle` exists, otherwise with the owned signer. A WebCrypto
 * `importKey` `DataError` becomes an `RsaKeyError`; every other WebCrypto rejection passes through.
 */
export async function signRs256(
    pkcs8: Uint8Array,
    message: Uint8Array,
    env: { crypto?: { subtle?: SubtleCrypto } } = globalThis,
): Promise<Uint8Array> {
    const subtle = env.crypto?.subtle
    if (!subtle) {
        return rsaPkcs1Sha256Sign(pkcs8, message)
    }
    let cryptoKey: CryptoKey
    try {
        cryptoKey = await subtle.importKey('pkcs8', pkcs8.slice().buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    }
    catch (error) {
        if (errorName(error) === 'DataError') {
            throw new RsaKeyError('The private key is not a usable RSA PKCS#8 key', { cause: error })
        }
        throw error
    }
    return new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, message.slice().buffer))
}
