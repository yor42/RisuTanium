import { argon2id } from 'hash-wasm'

export interface KdfParams {
    /** Memory, KiB. */
    readonly m: number
    /** Passes. */
    readonly t: number
    /** Lanes. */
    readonly p: number
}

/** Password bytes and salt to a 32-byte key-encryption key. Injectable so tests can count or fail it. */
export type Kdf = (password: Uint8Array, salt: Uint8Array, params: KdfParams) => Promise<Uint8Array>

/**
 * Argon2id version 0x13, tag length 32, empty secret and empty associated data, through
 * hash-wasm. The derivation is one synchronous WASM call after the memory is allocated; an
 * allocation failure surfaces as a thrown error.
 */
export const deriveKek: Kdf = async (password, salt, params) => {
    return await argon2id({
        password,
        salt,
        parallelism: params.p,
        iterations: params.t,
        memorySize: params.m,
        hashLength: 32,
        outputType: 'binary',
    })
}
