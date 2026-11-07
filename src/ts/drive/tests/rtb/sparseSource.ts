/**
 * Test helpers for reading `.rtb` files that are too large to hold: range sources
 * over bytes and over a segment sink, and the `.rtbseg` segment-list codec.
 *
 * Segment list layout: bytes 0-7 are `RTBSEG\0\x01`; the rest is one raw DEFLATE
 * stream whose inflated content is a sequence of records covering the file from
 * offset 0:
 * - `0x01` data run: u32 LE length (at least 1), then that many bytes;
 * - `0x02` fill run: u64 LE length (at least 1), then one byte, the fill value;
 * - `0x00` end: u64 LE total file length, equal to the sum of the run lengths.
 */
import { deflateSync, inflateSync } from 'fflate'
import type { RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { SegmentSink, type SegmentRun } from './segmentSink'

export const SEGMENT_MAGIC = new Uint8Array([0x52, 0x54, 0x42, 0x53, 0x45, 0x47, 0x00, 0x01])

export function rangeSourceOfBytes(bytes: Uint8Array): RangeSource {
    return {
        size: bytes.length,
        async read(offset: number, length: number): Promise<Uint8Array> {
            return bytes.slice(offset, offset + length)
        },
    }
}

/** A range source over anything that reads synchronously, such as a `SegmentSink`. */
export function rangeSourceOfSink(sink: { readonly length: number, read(offset: number, length: number): Uint8Array }): RangeSource {
    return {
        size: sink.length,
        async read(offset: number, length: number): Promise<Uint8Array> {
            return sink.read(offset, length)
        },
    }
}

export function sparseSourceOfRuns(runs: SegmentRun[]): RangeSource {
    const sink = new SegmentSink()
    for (const run of runs) {
        if (run.kind === 'data') {
            sink.write(run.bytes)
        } else {
            sink.writeFill?.(run.length, run.byte)
        }
    }
    return rangeSourceOfSink(sink)
}

export function encodeSegmentList(runs: SegmentRun[]): Uint8Array {
    const parts: Uint8Array[] = []
    let total = 0
    for (const run of runs) {
        if (run.kind === 'data') {
            if (run.bytes.length === 0) {
                continue
            }
            const head = new Uint8Array(5)
            head[0] = 0x01
            new DataView(head.buffer).setUint32(1, run.bytes.length, true)
            parts.push(head, run.bytes)
            total += run.bytes.length
        } else {
            if (run.length === 0) {
                continue
            }
            const head = new Uint8Array(10)
            head[0] = 0x02
            new DataView(head.buffer).setBigUint64(1, BigInt(run.length), true)
            head[9] = run.byte
            parts.push(head)
            total += run.length
        }
    }
    const end = new Uint8Array(9)
    new DataView(end.buffer).setBigUint64(1, BigInt(total), true)
    parts.push(end)
    const inflated = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        inflated.set(part, at)
        at += part.length
    }
    const deflated = deflateSync(inflated, { level: 9 })
    const out = new Uint8Array(SEGMENT_MAGIC.length + deflated.length)
    out.set(SEGMENT_MAGIC, 0)
    out.set(deflated, SEGMENT_MAGIC.length)
    return out
}

export function decodeSegmentList(bytes: Uint8Array): SegmentRun[] {
    for (let i = 0; i < SEGMENT_MAGIC.length; i++) {
        if (bytes[i] !== SEGMENT_MAGIC[i]) {
            throw new Error('not a segment list')
        }
    }
    const inflated = inflateSync(bytes.subarray(SEGMENT_MAGIC.length))
    const dv = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength)
    const runs: SegmentRun[] = []
    let at = 0
    let total = 0
    for (;;) {
        if (at >= inflated.length) {
            throw new Error('segment list has no end record')
        }
        const kind = inflated[at]
        if (kind === 0x01) {
            const length = dv.getUint32(at + 1, true)
            if (length < 1 || at + 5 + length > inflated.length) {
                throw new Error('bad data run')
            }
            runs.push({ kind: 'data', bytes: inflated.slice(at + 5, at + 5 + length) })
            total += length
            at += 5 + length
        } else if (kind === 0x02) {
            const length = Number(dv.getBigUint64(at + 1, true))
            if (length < 1 || at + 10 > inflated.length) {
                throw new Error('bad fill run')
            }
            runs.push({ kind: 'fill', length, byte: inflated[at + 9] })
            total += length
            at += 10
        } else if (kind === 0x00) {
            if (at + 9 !== inflated.length) {
                throw new Error('bytes after the end record')
            }
            if (Number(dv.getBigUint64(at + 1, true)) !== total) {
                throw new Error('end record total differs from the runs')
            }
            return runs
        } else {
            throw new Error(`unknown record ${kind}`)
        }
    }
}
