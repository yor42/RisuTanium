/**
 * The v1 writer's setup: derives the key-encryption key from the password, wraps a fresh master
 * key in the password slot, derives the payload key and key commitment, and returns the header
 * and a sink factory. The key derivation is the expensive step, so a caller runs it before it
 * opens any output.
 *
 * Fresh randomness per file: master key, salt, wrap nonce and file id, drawn in that order from
 * `crypto.getRandomValues`. Injected randomness exists only as a test seam. A file's chunks are
 * sealed once: payload key and nonces depend only on (master key, file id, F) and the chunk
 * index, so sealing other plaintext needs a new `prepareSeal`.
 */
import { selectAead, type AeadBackend } from './aead'
import { SealedPasswordError } from './errors'
import { EncryptingSink, type SealContext } from './encryptingSink'
import { chunkCount, encodeFixedPart, encodeHeader, encodeSlotPrefix, MASTER_KEY_LEN, sealedFileSize, V1_HEADER_LEN } from './format'
import { deriveKek, type Kdf } from './kdf'
import { keyCommit, payloadKey } from './keys'
import { passwordBytes } from './password'
import { DEFAULT_CAPS, DEFAULT_P, MAX_CHUNK, MIN_CHUNK, type SealParams } from './policy'

export interface SealDeps {
    /** Fresh random bytes; called as 32 (master key), 16 (salt), 12 (wrap nonce), 16 (file id). */
    random?: (length: number) => Uint8Array
    kdf?: Kdf
    aead?: AeadBackend
}

export interface PreparedSeal {
    readonly header: Uint8Array
    readonly chunkSize: number
    readonly aead: AeadBackend
    /** Size of the sealed file for a plaintext length. */
    sealedSize(plaintextLen: number): number
    /** Chunks written for a plaintext length. */
    chunks(plaintextLen: number): number
    sink(target: (chunk: Uint8Array) => Promise<void> | void): EncryptingSink
}

function systemRandom(length: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

function checkParams(params: SealParams): void {
    if (!Number.isSafeInteger(params.chunkSize) || params.chunkSize < MIN_CHUNK || params.chunkSize > MAX_CHUNK) {
        throw new RangeError(`chunk size ${params.chunkSize} is outside ${MIN_CHUNK}..${MAX_CHUNK}`)
    }
    if (!Number.isSafeInteger(params.m) || !Number.isSafeInteger(params.t) || params.t < 1 || params.m < 8 * DEFAULT_P) {
        throw new RangeError(`Argon2id memory ${params.m} KiB and ${params.t} passes are not usable`)
    }
    if (params.m > DEFAULT_CAPS.mCeilKib || params.m * params.t > DEFAULT_CAPS.workCap) {
        throw new RangeError(`Argon2id memory ${params.m} KiB and ${params.t} passes exceed what readers accept`)
    }
}

export async function prepareSeal(passwordText: string, params: SealParams, deps: SealDeps = {}): Promise<PreparedSeal> {
    checkParams(params)
    const bytes = passwordBytes(passwordText)
    if (typeof bytes === 'string') {
        throw new SealedPasswordError(bytes)
    }
    const random = deps.random ?? systemRandom
    const kdf = deps.kdf ?? deriveKek
    const aead = deps.aead ?? selectAead()
    // Copies: the writer zeroes its key material, and an injected source may hand out shared arrays.
    const master = new Uint8Array(random(MASTER_KEY_LEN))
    const salt = new Uint8Array(random(16))
    const wrapNonce = new Uint8Array(random(12))
    const fileId = new Uint8Array(random(16))
    let kek: Uint8Array | null = null
    let rawPayloadKey: Uint8Array | null = null
    try {
        const slotFields = { p: DEFAULT_P, m: params.m, t: params.t, salt, wrapNonce }
        kek = await kdf(bytes, salt, { m: params.m, t: params.t, p: DEFAULT_P })
        const wrapped = await aead.seal(await aead.importKey(kek), wrapNonce, master, encodeSlotPrefix(slotFields))
        const context = { fileId, fixedPart: encodeFixedPart(params.chunkSize, fileId) }
        const header = encodeHeader({
            ...slotFields,
            chunkSize: params.chunkSize,
            fileId,
            keyCommit: keyCommit(master, context),
            wrappedKey: wrapped,
        })
        rawPayloadKey = payloadKey(master, context)
        const sealContext: SealContext = {
            header,
            chunkSize: params.chunkSize,
            aead,
            payloadKey: await aead.importKey(rawPayloadKey),
        }
        return {
            header,
            chunkSize: params.chunkSize,
            aead,
            sealedSize: (plaintextLen) => sealedFileSize(V1_HEADER_LEN, plaintextLen, params.chunkSize),
            chunks: (plaintextLen) => chunkCount(plaintextLen, params.chunkSize),
            sink: (target) => new EncryptingSink(sealContext, target),
        }
    } finally {
        bytes.fill(0)
        master.fill(0)
        kek?.fill(0)
        rawPayloadKey?.fill(0)
    }
}
