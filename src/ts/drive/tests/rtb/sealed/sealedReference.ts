/**
 * An independent implementation of the sealed `.rtb` envelope, version 1, for tests only. It
 * uses nothing but `node:crypto` (Argon2id, HKDF, AES-256-GCM) and never imports the engine, so
 * an engine that disagrees with the specification cannot agree with this file by sharing code.
 */
import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js'
import * as nodeCrypto from 'node:crypto'
import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto'

interface Argon2Options {
    message: Uint8Array
    nonce: Uint8Array
    parallelism: number
    tagLength: number
    memory: number
    passes: number
    secret?: Uint8Array
    associatedData?: Uint8Array
}

/** `crypto.argon2Sync` exists in the Node that runs the tests but not in the installed `@types/node`; this is its typed boundary. */
export const argon2Sync = (nodeCrypto as unknown as { argon2Sync(algorithm: 'argon2id', options: Argon2Options): Buffer }).argon2Sync

/** False on a Node that predates `crypto.argon2Sync`; the reference then derives with @noble/hashes, which is still independent of the engine's hash-wasm KDF. */
export const HAS_NODE_ARGON2 = typeof argon2Sync === 'function'

const MAGIC = Buffer.from([0x52, 0x54, 0x42, 0x58, 0x0d, 0x0a, 0x1a, 0x0a])

function u16(value: number): Buffer {
    const out = Buffer.alloc(2)
    out.writeUInt16LE(value)
    return out
}

function u32(value: number): Buffer {
    const out = Buffer.alloc(4)
    out.writeUInt32LE(value)
    return out
}

export function referenceNonce(index: number, last: boolean): Buffer {
    const out = Buffer.alloc(12)
    let rest = BigInt(index)
    for (let k = 10; k >= 0; k--) {
        out[k] = Number(rest & 0xffn)
        rest >>= 8n
    }
    out[11] = last ? 1 : 0
    return out
}

function gcmSeal(key: Buffer, nonce: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aad)
    return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

function gcmOpen(key: Buffer, nonce: Buffer, sealed: Buffer, aad: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(sealed.subarray(sealed.length - 16))
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
}

export function referenceKek(password: string, salt: Buffer, m: number, t: number, p: number): Buffer {
    const message = Buffer.from(password.normalize('NFC'), 'utf8')
    if (!HAS_NODE_ARGON2) {
        return Buffer.from(nobleArgon2id(message, salt, { t, m, p, dkLen: 32 }))
    }
    return Buffer.from(argon2Sync('argon2id', { message, nonce: salt, parallelism: p, tagLength: 32, memory: m, passes: t }))
}

export interface ReferenceInput {
    password: string
    salt: Buffer
    m: number
    t: number
    p: number
    master: Buffer
    wrapNonce: Buffer
    fileId: Buffer
    C: number
    plaintext: Buffer
}

export interface ReferenceFile {
    file: Buffer
    kek: Buffer
    payloadKey: Buffer
    keyCommit: Buffer
    headerLen: number
    n: number
}

export function referenceSeal(input: ReferenceInput): ReferenceFile {
    const { password, salt, m, t, p, master, wrapNonce, fileId, C, plaintext } = input
    const fixed = Buffer.concat([MAGIC, u16(1), u16(0), Buffer.from([1, 0, 0, 0]), u32(C), fileId])
    const info = (label: string) => Buffer.concat([Buffer.from(label, 'ascii'), fixed])
    const payloadKey = Buffer.from(hkdfSync('sha256', master, fileId, info('RTBX v1 payload key'), 32))
    const keyCommit = Buffer.from(hkdfSync('sha256', master, fileId, info('RTBX v1 key commitment'), 32))
    const kek = referenceKek(password, salt, m, t, p)
    const slotPrefix = Buffer.concat([u16(1), u16(88), Buffer.from([1, 0]), u16(p), u32(m), u32(t), salt, wrapNonce])
    const slot = Buffer.concat([slotPrefix, gcmSeal(kek, wrapNonce, master, slotPrefix)])
    const headerLen = 76 + slot.length
    const header = Buffer.concat([fixed, u32(headerLen), keyCommit, u16(1), u16(0), slot])
    const n = plaintext.length === 0 ? 1 : Math.ceil(plaintext.length / C)
    const chunks: Buffer[] = []
    for (let i = 0; i < n; i++) {
        const part = plaintext.subarray(i * C, Math.min(plaintext.length, (i + 1) * C))
        chunks.push(gcmSeal(payloadKey, referenceNonce(i, i === n - 1), part, Buffer.alloc(0)))
    }
    return { file: Buffer.concat([header, ...chunks]), kek, payloadKey, keyCommit, headerLen, n }
}

/** Opens a well-formed v1 file by the specification; throws on any failure. */
export function referenceOpen(file: Buffer, password: string): Buffer {
    const C = file.readUInt32LE(16)
    const fileId = file.subarray(20, 36)
    const headerLen = file.readUInt32LE(36)
    const keyCommit = file.subarray(40, 72)
    const slot = file.subarray(76, 76 + 92)
    const slotPrefix = slot.subarray(0, 44)
    const p = slot.readUInt16LE(6)
    const m = slot.readUInt32LE(8)
    const t = slot.readUInt32LE(12)
    const salt = slot.subarray(16, 32)
    const wrapNonce = slot.subarray(32, 44)
    const kek = referenceKek(password, Buffer.from(salt), m, t, p)
    const master = gcmOpen(kek, Buffer.from(wrapNonce), Buffer.from(slot.subarray(44, 92)), Buffer.from(slotPrefix))
    const info = (label: string) => Buffer.concat([Buffer.from(label, 'ascii'), file.subarray(0, 36)])
    if (!Buffer.from(hkdfSync('sha256', master, fileId, info('RTBX v1 key commitment'), 32)).equals(keyCommit)) {
        throw new Error('reference: key commitment mismatch')
    }
    const payloadKey = Buffer.from(hkdfSync('sha256', master, fileId, info('RTBX v1 payload key'), 32))
    const body = file.length - headerLen
    const full = C + 16
    const n = Math.floor(body / full) + (body % full === 0 ? 0 : 1)
    const parts: Buffer[] = []
    for (let i = 0; i < n; i++) {
        const sealed = file.subarray(headerLen + i * full, Math.min(file.length, headerLen + (i + 1) * full))
        parts.push(gcmOpen(payloadKey, referenceNonce(i, i === n - 1), Buffer.from(sealed), Buffer.alloc(0)))
    }
    return Buffer.concat(parts)
}

/** The inputs of the three envelope vectors; the password is the NFD spelling. */
export const VECTOR_INPUT: Omit<ReferenceInput, 'plaintext'> = {
    password: 'Test ' + String.fromCharCode(0x1112, 0x1161, 0x11ab, 0x1100, 0x1173, 0x11af) + ' 1',
    salt: Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex'),
    m: 256,
    t: 2,
    p: 1,
    master: Buffer.from('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f', 'hex'),
    wrapNonce: Buffer.from('404142434445464748494a4b', 'hex'),
    fileId: Buffer.from('505152535455565758595a5b5c5d5e5f', 'hex'),
    C: 64,
}

/** A `random(length)` that hands out the given arrays in order and checks each requested length. */
export function sequenceRandom(values: Uint8Array[]): (length: number) => Uint8Array {
    let next = 0
    return (length) => {
        const value = values[next++]
        if (value === undefined || value.length !== length) {
            throw new Error(`unexpected random request of ${length} bytes (call ${next})`)
        }
        return value
    }
}

/** The engine's random draws for the vector inputs: master key, salt, wrap nonce, file id. */
export function vectorRandom(input: ReferenceInput | typeof VECTOR_INPUT = VECTOR_INPUT): (length: number) => Uint8Array {
    return sequenceRandom([input.master, input.salt, input.wrapNonce, input.fileId])
}

/** A password prompt that answers once and then cancels, so a reader that rejects the password ends instead of asking forever. */
export function passwordOnce(password: string): () => Promise<string | null> {
    let asked = 0
    return async () => (asked++ === 0 ? password : null)
}

/** A deterministic pseudo-random plaintext, so a test needs no `Math.random`. */
export function seededBytes(length: number, seed: number): Buffer<ArrayBuffer> {
    const out = Buffer.alloc(length)
    let state = (seed >>> 0) || 1
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

/** Plaintext byte j is j mod 256. */
export function vectorPlaintext(length: number): Buffer {
    return Buffer.from(Array.from({ length }, (_, i) => i & 0xff))
}
