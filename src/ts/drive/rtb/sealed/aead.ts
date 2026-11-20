import { gcm } from '@noble/ciphers/aes.js'

/**
 * AES-256-GCM, 12-byte nonce, 16-byte tag, behind one interface with two backends: WebCrypto
 * where `crypto.subtle` exists and @noble/ciphers where it does not (plain HTTP by LAN address).
 *
 * `open` resolves `null` only for an authentication failure, which is exactly: WebCrypto's
 * `decrypt` rejecting with a `DOMException` named `OperationError`, or @noble's tag-mismatch
 * error. Every other error is rethrown, so a caller never reads an allocation failure or a type
 * error as "wrong password" or "damaged".
 */

/** A key made by one backend's `importKey`; it is only valid for that backend. */
export type AeadKey = CryptoKey | Uint8Array

export interface AeadBackend {
    readonly name: 'webcrypto' | 'noble'
    importKey(raw: Uint8Array): Promise<AeadKey>
    /** Ciphertext followed by the 16-byte tag. */
    seal(key: AeadKey, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>
    /** The plaintext, or `null` for an authentication failure. */
    open(key: AeadKey, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null>
}

/** The exact message @noble/ciphers throws for a tag mismatch; a test pins it so a rename fails loudly. */
export const NOBLE_TAG_ERROR_MESSAGE = 'aes-gcm: invalid tag'

/** WebCrypto takes only `ArrayBuffer`-backed views; a view over a shared buffer is copied. */
function plain(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) : new Uint8Array(bytes)
}

function webKey(key: AeadKey): CryptoKey {
    if (ArrayBuffer.isView(key)) {
        throw new TypeError('a noble key was given to the WebCrypto backend')
    }
    return key
}

function nobleKey(key: AeadKey): Uint8Array {
    if (!ArrayBuffer.isView(key)) {
        throw new TypeError('a WebCrypto key was given to the noble backend')
    }
    return key
}

export function webCryptoAead(subtle: SubtleCrypto = globalThis.crypto.subtle): AeadBackend {
    return {
        name: 'webcrypto',
        async importKey(raw) {
            return await subtle.importKey('raw', plain(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
        },
        async seal(key, nonce, plaintext, aad) {
            const sealed = await subtle.encrypt({ name: 'AES-GCM', iv: plain(nonce), additionalData: plain(aad), tagLength: 128 }, webKey(key), plain(plaintext))
            return new Uint8Array(sealed)
        },
        async open(key, nonce, sealed, aad) {
            try {
                const opened = await subtle.decrypt({ name: 'AES-GCM', iv: plain(nonce), additionalData: plain(aad), tagLength: 128 }, webKey(key), plain(sealed))
                return new Uint8Array(opened)
            } catch (error) {
                if (error instanceof DOMException && error.name === 'OperationError') {
                    return null
                }
                throw error
            }
        },
    }
}

export function nobleAead(): AeadBackend {
    return {
        name: 'noble',
        async importKey(raw) {
            return new Uint8Array(raw)
        },
        async seal(key, nonce, plaintext, aad) {
            return gcm(nobleKey(key), nonce, aad).encrypt(plaintext)
        },
        async open(key, nonce, sealed, aad) {
            try {
                return gcm(nobleKey(key), nonce, aad).decrypt(sealed)
            } catch (error) {
                if (error instanceof Error && error.message === NOBLE_TAG_ERROR_MESSAGE) {
                    return null
                }
                throw error
            }
        },
    }
}

export interface AeadEnv {
    readonly crypto?: { readonly subtle?: SubtleCrypto }
}

/** Picks the backend once per operation; the caller keeps it and never selects again. */
export function selectAead(env: AeadEnv = globalThis): AeadBackend {
    const subtle = env.crypto?.subtle
    return subtle === undefined ? nobleAead() : webCryptoAead(subtle)
}
