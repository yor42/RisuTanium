/**
 * Running CRC-32 (IEEE 802.3) for the `.rtb` container writer.
 *
 * The state is the raw register: start from `CRC32_INIT`, fold chunks with
 * `crc32Update` and take the stored value with `crc32Final`. The table is the one
 * `blockFrame.ts` already uses for the block format, so both checksums agree.
 *
 * A run of one repeated byte, however long, folds in through `crc32Combine` in a
 * logarithmic number of steps; the writer uses this for a 4 GiB fill that no memory
 * ever holds.
 */
import { crc32Table } from '../../storage/blockFrame'

export const CRC32_INIT = 0xFFFFFFFF

export function crc32Update(state: number, data: Uint8Array): number {
    let crc = state
    for (let i = 0; i < data.length; i++) {
        crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return crc >>> 0
}

export function crc32Final(state: number): number {
    return (state ^ 0xFFFFFFFF) >>> 0
}

// GF(2) matrix helpers for crc32Combine (the operator that appends zero bytes).
function gf2Times(matrix: Uint32Array, vector: number): number {
    let sum = 0
    let v = vector
    for (let i = 0; v !== 0; i++, v >>>= 1) {
        if (v & 1) {
            sum ^= matrix[i]
        }
    }
    return sum >>> 0
}

function gf2Square(square: Uint32Array, matrix: Uint32Array): void {
    for (let n = 0; n < 32; n++) {
        square[n] = gf2Times(matrix, matrix[n])
    }
}

/**
 * CRC of the concatenation A+B from crc(A), crc(B) and the byte length of B.
 * `length2` is a safe integer and may exceed 2^32, so it is halved with division,
 * not with bit operators.
 */
export function crc32Combine(crc1: number, crc2: number, length2: number): number {
    if (!Number.isSafeInteger(length2) || length2 < 0) {
        throw new RangeError('length2 must be a non-negative safe integer')
    }
    if (length2 === 0) {
        return crc1 >>> 0
    }
    let even = new Uint32Array(32)
    let odd = new Uint32Array(32)
    // Operator for one zero bit.
    odd[0] = 0xEDB88320
    let row = 1
    for (let n = 1; n < 32; n++) {
        odd[n] = row
        row <<= 1
    }
    gf2Square(even, odd) // two zero bits
    gf2Square(odd, even) // four zero bits
    let crc = crc1 >>> 0
    let remaining = length2
    do {
        gf2Square(even, odd)
        if (remaining % 2 === 1) {
            crc = gf2Times(even, crc)
        }
        remaining = Math.floor(remaining / 2)
        if (remaining === 0) {
            break
        }
        gf2Square(odd, even)
        if (remaining % 2 === 1) {
            crc = gf2Times(odd, crc)
        }
        remaining = Math.floor(remaining / 2)
    } while (remaining !== 0)
    return (crc ^ crc2) >>> 0
}

/** CRC-32 of `length` copies of `byte`, without visiting the bytes. */
export function crc32OfFill(byte: number, length: number): number {
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new RangeError('length must be a non-negative safe integer')
    }
    if (length === 0) {
        return 0
    }
    // Binary exponentiation: `block` is the CRC of `blockLength` copies of the byte.
    let block = crc32Final(crc32Update(CRC32_INIT, new Uint8Array([byte & 0xFF])))
    let blockLength = 1
    let result = 0
    let haveResult = false
    let remaining = length
    while (remaining > 0) {
        if (remaining % 2 === 1) {
            result = haveResult ? crc32Combine(result, block, blockLength) : block
            haveResult = true
        }
        remaining = Math.floor(remaining / 2)
        if (remaining > 0) {
            block = crc32Combine(block, block, blockLength)
            blockLength *= 2
        }
    }
    return result
}

/** Folds a fill run into a running state. */
export function crc32UpdateFill(state: number, byte: number, length: number): number {
    if (length === 0) {
        return state
    }
    const combined = crc32Combine(crc32Final(state), crc32OfFill(byte, length), length)
    return (combined ^ 0xFFFFFFFF) >>> 0
}
