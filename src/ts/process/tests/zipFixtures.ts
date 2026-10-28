/**
 * Test-only ZIP fixtures.
 *
 * `fflateZipArchive` writes the descriptor framing: a streaming `fflate.Zip` with one `ZipDeflate` per entry, so every
 * local header sets general-purpose flag bit 3 and states zero CRC and sizes, and a data descriptor follows the entry
 * data. This is the framing fork exports used before CHORE-375 stage C1 and the framing upstream still writes. It is the
 * reference shape for "an archive with data descriptors" and "an upstream archive" in the importer tests; a test about
 * what the fork's own writer produces uses `CharXWriter` instead.
 */
import * as fflate from 'fflate'

/**
 * An asset body that holds the zip signatures a streaming reader ends an entry at: the data descriptor, the local
 * header and the central record signatures, in the middle of binary data.
 */
export const ZIP_SIGNATURE_BLOB = Uint8Array.from([
    0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x21,
    0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    0x50, 0x4b, 0x03, 0x04, 20, 0, 8, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x50, 0x4b, 0x01, 0x02, 99, 98, 97,
])

export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** One archive entry: the name, its bytes and the deflate level (0, a stored body, when omitted). */
export type ZipEntry = [name: string, data: Uint8Array, level?: ZipLevel]

/**
 * Writes the entries in order as one archive. `opts.prefix` goes in front of the archive; the archive's offsets do
 * not count it, as with a JPEG written before a CharX.
 */
export function fflateZipArchive(entries: ZipEntry[], opts: { prefix?: Uint8Array } = {}): Uint8Array {
    const chunks: Uint8Array[] = []
    let failure: Error | undefined
    let ended = false
    const zip = new fflate.Zip()
    zip.ondata = (err, data, final) => {
        if (err) {
            failure ??= err
            return
        }
        if (data) {
            chunks.push(data.slice())
        }
        if (final) {
            ended = true
        }
    }
    for (const [name, data, level] of entries) {
        const file = new fflate.ZipDeflate(name, { level: level ?? 0 })
        zip.add(file)
        file.push(data, true)
    }
    zip.end()
    if (failure) {
        throw failure
    }
    if (!ended) {
        throw new Error('fflate did not finish the archive')
    }
    const parts = opts.prefix ? [opts.prefix, ...chunks] : chunks
    // A plain Uint8Array over its own buffer (offset 0), not a pooled Buffer: callers patch it through `new DataView(bytes.buffer)`.
    return new Uint8Array(Buffer.concat(parts))
}
