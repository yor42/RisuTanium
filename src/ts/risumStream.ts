// The .risum byte layout, as a sequence of writes instead of one whole-file buffer.
//
// Invariant: the concatenation of every chunk handed to `write`, in order, equals the file the
// former whole-file builder produced: [111, 0], a 4-byte little-endian main block length, the
// main block, then per record [1], a 4-byte little-endian body length and the body, and a final
// [0]. Upstream reads this layout, so it must not drift.
//
// Every chunk is a fresh array that is never mutated afterwards, because Blob and held-stream
// writers keep the references. Each write is awaited before the next record body is produced, so
// only one record body plus the main block is alive at a time. The terminator is the last write;
// after a failed write or a failed body nothing more is written and no terminator follows, so a
// truncated file is never mistaken for a complete one.
//
// A sink may itself hold everything it is given (the web whole-file Blob fallback, taken when the
// streaming save helper cannot open, for example on plain HTTP without a fresh user gesture); the
// seam bounds only its own memory, not that of the sink.

const RISUM_MAGIC = 111
const RISUM_VERSION = 0
const RISUM_RECORD_MARK = 1
const RISUM_END_MARK = 0

/**
 * A 4-byte little-endian length. Stricter than `Buffer.writeUInt32LE`: it also rejects a
 * non-integer, and `DataView.setUint32` alone would wrap an oversized value silently.
 */
export function risumLength(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 0 || length > 0xFFFFFFFF) {
        throw new RangeError(`risum length out of range: ${length}`)
    }
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, length, true)
    return out
}

/**
 * Streams a .risum: the main block, then `recordCount` records whose bodies come from
 * `produceRecordBody(index)`, then the terminator. Rejects with the first error of a body or a
 * write.
 */
export async function streamRisum(
    mainBlock: Uint8Array,
    recordCount: number,
    produceRecordBody: (index: number) => Uint8Array | Promise<Uint8Array>,
    write: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
    const head = new Uint8Array(6)
    head[0] = RISUM_MAGIC
    head[1] = RISUM_VERSION
    head.set(risumLength(mainBlock.length), 2)
    await write(head)
    await write(mainBlock)
    for (let index = 0; index < recordCount; index++) {
        const body = await produceRecordBody(index)
        const header = new Uint8Array(5)
        header[0] = RISUM_RECORD_MARK
        header.set(risumLength(body.length), 1)
        await write(header)
        await write(body)
    }
    await write(Uint8Array.of(RISUM_END_MARK))
}

const risumReservedWindowsName = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * File name for an exported module: the name without characters that are invalid on Windows or
 * Android file systems and without path separators, with `.risum` appended. Dots and commas stay.
 * A name with nothing left, or one Windows reserves, still yields a usable file name.
 */
export function risumFileName(name: string | undefined): string {
    let stem = (name ?? '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .trim()
        .replace(/[. ]+$/, '')
    if (stem === '') {
        stem = 'module'
    }
    else if (risumReservedWindowsName.test(stem)) {
        stem = '_' + stem
    }
    return stem + '.risum'
}
