/**
 * A 128-bit non-cryptographic print of a byte string: MurmurHash3 x86_128 over little-endian 32-bit words, with the
 * standard tail and length finalisation, returned as 32 lowercase hex digits (h1 to h4, each as eight digits).
 *
 * The print is never persisted and two prints are compared only when both were computed by this function on the same
 * page. It is a guard against accidental collision between two payloads of one module, not a security property: content
 * an adversary supplied for both sides can be made to collide. The result depends only on the bytes, never on the
 * `byteOffset` of the view, so a payload read at any offset agrees with the same payload built at offset zero.
 */

/** What the residency holds for one module handle: the stored module unit it was taken from, and the print of that unit's payload. */
export interface StoredPayloadPrint {
    unitKey: string
    digest: string
    /** Byte length of the payload the print was taken over. */
    length: number
    print: string
}

const C1 = 0x239b961b
const C2 = 0xab0e9789
const C3 = 0x38b34ae5
const C4 = 0xa1e38b93

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

function rotl(x: number, r: number): number {
    return (x << r) | (x >>> (32 - r))
}

function fmix(h: number): number {
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    return h ^ (h >>> 16)
}

function hex(h: number): string {
    return (h >>> 0).toString(16).padStart(8, '0')
}

/** The print of `bytes`; `seed` is 0 for every use in the application and varies only to check the construction against published vectors. */
export function payloadPrint(bytes: Uint8Array, seed = 0): string {
    const length = bytes.length
    const blocks = length >> 4
    // Words are read through an Int32Array only when the view is word-aligned and the platform is little-endian.
    const words = LITTLE_ENDIAN && (bytes.byteOffset & 3) === 0 ? new Int32Array(bytes.buffer, bytes.byteOffset, length >> 2) : null
    let h1 = seed | 0
    let h2 = h1
    let h3 = h1
    let h4 = h1
    for (let block = 0; block < blocks; block++) {
        const at = block << 4
        let k1: number
        let k2: number
        let k3: number
        let k4: number
        if (words !== null) {
            const w = block << 2
            k1 = words[w]
            k2 = words[w + 1]
            k3 = words[w + 2]
            k4 = words[w + 3]
        } else {
            k1 = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)
            k2 = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)
            k3 = bytes[at + 8] | (bytes[at + 9] << 8) | (bytes[at + 10] << 16) | (bytes[at + 11] << 24)
            k4 = bytes[at + 12] | (bytes[at + 13] << 8) | (bytes[at + 14] << 16) | (bytes[at + 15] << 24)
        }
        k1 = Math.imul(rotl(Math.imul(k1, C1), 15), C2)
        h1 ^= k1
        h1 = Math.imul(rotl(h1, 19) + h2 | 0, 5) + 0x561ccd1b | 0
        k2 = Math.imul(rotl(Math.imul(k2, C2), 16), C3)
        h2 ^= k2
        h2 = Math.imul(rotl(h2, 17) + h3 | 0, 5) + 0x0bcaa747 | 0
        k3 = Math.imul(rotl(Math.imul(k3, C3), 17), C4)
        h3 ^= k3
        h3 = Math.imul(rotl(h3, 15) + h4 | 0, 5) + 0x96cd1c35 | 0
        k4 = Math.imul(rotl(Math.imul(k4, C4), 18), C1)
        h4 ^= k4
        h4 = Math.imul(rotl(h4, 13) + h1 | 0, 5) + 0x32ac3b17 | 0
    }
    // The tail is the last length mod 16 bytes: lane j holds bytes 4j to 4j+3, and a lane is mixed when it holds at least one byte.
    const tail = blocks << 4
    const rest = length - tail
    const lane = (j: number): number => {
        let k = 0
        const from = tail + (j << 2)
        const to = Math.min(tail + rest, from + 4)
        for (let i = to - 1; i >= from; i--) {
            k = (k << 8) | bytes[i]
        }
        return k
    }
    if (rest > 12) {
        h4 ^= Math.imul(rotl(Math.imul(lane(3), C4), 18), C1)
    }
    if (rest > 8) {
        h3 ^= Math.imul(rotl(Math.imul(lane(2), C3), 17), C4)
    }
    if (rest > 4) {
        h2 ^= Math.imul(rotl(Math.imul(lane(1), C2), 16), C3)
    }
    if (rest > 0) {
        h1 ^= Math.imul(rotl(Math.imul(lane(0), C1), 15), C2)
    }
    h1 ^= length
    h2 ^= length
    h3 ^= length
    h4 ^= length
    h1 = h1 + h2 + h3 + h4 | 0
    h2 = h2 + h1 | 0
    h3 = h3 + h1 | 0
    h4 = h4 + h1 | 0
    h1 = fmix(h1)
    h2 = fmix(h2)
    h3 = fmix(h3)
    h4 = fmix(h4)
    h1 = h1 + h2 + h3 + h4 | 0
    h2 = h2 + h1 | 0
    h3 = h3 + h1 | 0
    h4 = h4 + h1 | 0
    return hex(h1) + hex(h2) + hex(h3) + hex(h4)
}
