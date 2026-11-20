import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Key schedule: HKDF-SHA-256 with salt = file id and IKM = the per-file master key, and
 * info = a label followed by the fixed part F (header bytes 0..35). Binding F into the derived
 * keys, not into chunk AAD, means a header changed within F never opens: it fails the key
 * commitment. The master key is never an AEAD key itself.
 */

const ENCODER = new TextEncoder()
const PAYLOAD_LABEL = ENCODER.encode('RTBX v1 payload key')
const COMMIT_LABEL = ENCODER.encode('RTBX v1 key commitment')

/** The parts of a header the key schedule reads. */
export interface KeyContext {
    readonly fileId: Uint8Array
    /** Header bytes 0..35. */
    readonly fixedPart: Uint8Array
}

function expand(master: Uint8Array, header: KeyContext, label: Uint8Array): Uint8Array {
    const info = new Uint8Array(label.length + header.fixedPart.length)
    info.set(label, 0)
    info.set(header.fixedPart, label.length)
    return hkdf(sha256, master, header.fileId, info, 32)
}

export function payloadKey(master: Uint8Array, header: KeyContext): Uint8Array {
    return expand(master, header, PAYLOAD_LABEL)
}

export function keyCommit(master: Uint8Array, header: KeyContext): Uint8Array {
    return expand(master, header, COMMIT_LABEL)
}

/** Compares every byte, with no early exit. */
export function commitEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    let diff = 0
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i]
    }
    return diff === 0
}
