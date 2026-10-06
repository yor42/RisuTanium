/**
 * SHA-256 for asset keys. An asset is named after the hash of its bytes
 * (`assets/<64 lowercase hex>.<ext>`), on every platform and for every size.
 *
 * `Sha256` is an incremental implementation owned here instead of a library one:
 * it carries the message length as a full 64-bit big-endian bit count, so a
 * message of 512 MiB or more (2^32 bits) hashes the same as `crypto.subtle` and
 * `node:crypto`, and it works on a plain-HTTP page where `crypto.subtle` does not
 * exist. `sha256Hex` uses the browser's implementation when there is one.
 */

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Bytes the owned core hashes before `sha256Hex` yields to the event loop: about 50 ms of work on a phone web view. */
export const HASH_PIECE_BYTES = 4 * 1024 * 1024

/**
 * An asset whose size can reach this is saved piece by piece on the desktop and Android app (`saveAssetFromPieces`);
 * a smaller one is read whole and saved by `saveAsset`. The importers decide by the same bound the save does.
 */
export const ASSET_PIECE_SAVE_MIN_BYTES = 16 * 1024 * 1024

export class Sha256 {
    private readonly state = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ])
    private readonly schedule = new Uint32Array(64)
    private readonly tail = new Uint8Array(64)
    private tailLength = 0
    private total = 0
    private finished = false

    private block(data: Uint8Array, start: number): void {
        const w = this.schedule
        const h = this.state
        let o = start
        for (let i = 0; i < 16; i++, o += 4) {
            w[i] = (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]
        }
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15]
            const b = w[i - 2]
            const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
            const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
        for (let i = 0; i < 64; i++) {
            const bigS1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
            const ch = (e & f) ^ (~e & g)
            const t1 = (hh + bigS1 + ch + K[i] + w[i]) | 0
            const bigS0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
            const maj = (a & b) ^ (a & c) ^ (b & c)
            const t2 = (bigS0 + maj) | 0
            hh = g
            g = f
            f = e
            e = (d + t1) | 0
            d = c
            c = b
            b = a
            a = (t1 + t2) | 0
        }
        h[0] = (h[0] + a) | 0
        h[1] = (h[1] + b) | 0
        h[2] = (h[2] + c) | 0
        h[3] = (h[3] + d) | 0
        h[4] = (h[4] + e) | 0
        h[5] = (h[5] + f) | 0
        h[6] = (h[6] + g) | 0
        h[7] = (h[7] + hh) | 0
    }

    private absorb(data: Uint8Array): void {
        let i = 0
        const n = data.length
        if (this.tailLength > 0) {
            while (this.tailLength < 64 && i < n) {
                this.tail[this.tailLength++] = data[i++]
            }
            if (this.tailLength === 64) {
                this.block(this.tail, 0)
                this.tailLength = 0
            }
        }
        for (; i + 64 <= n; i += 64) {
            this.block(data, i)
        }
        while (i < n) {
            this.tail[this.tailLength++] = data[i++]
        }
    }

    /** Adds `data` to the message. The array is read now and not kept. */
    update(data: Uint8Array): this {
        if (this.finished) {
            throw new Error('the hash is already finished')
        }
        this.total += data.length
        this.absorb(data)
        return this
    }

    /** The 64 lowercase hex digits of the digest. The hasher accepts no more bytes afterwards. */
    digestHex(): string {
        if (this.finished) {
            throw new Error('the hash is already finished')
        }
        this.finished = true
        const bits = this.total * 8
        const padLength = (this.tailLength < 56 ? 64 : 128) - this.tailLength
        const pad = new Uint8Array(padLength)
        pad[0] = 0x80
        const view = new DataView(pad.buffer)
        view.setUint32(padLength - 8, Math.floor(bits / 4294967296))
        view.setUint32(padLength - 4, bits >>> 0)
        this.absorb(pad)
        let hex = ''
        for (let i = 0; i < 8; i++) {
            hex += (this.state[i] >>> 0).toString(16).padStart(8, '0')
        }
        return hex
    }
}

function hexOf(digest: ArrayBuffer): string {
    let hex = ''
    for (const byte of new Uint8Array(digest)) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return hex
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * The SHA-256 of `bytes` as 64 lowercase hex digits. The browser's `crypto.subtle`
 * does the work when the page has it; otherwise (a plain-HTTP origin) the owned
 * core hashes in pieces of `HASH_PIECE_BYTES` and yields to the event loop
 * between them, so a large buffer does not freeze the page in one stretch.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle
    if (subtle !== undefined) {
        return hexOf(await subtle.digest('SHA-256', bytes as BufferSource))
    }
    const hash = new Sha256()
    for (let start = 0; start < bytes.length; start += HASH_PIECE_BYTES) {
        if (start > 0) {
            await yieldToEventLoop()
        }
        hash.update(bytes.subarray(start, Math.min(start + HASH_PIECE_BYTES, bytes.length)))
    }
    return hash.digestHex()
}
