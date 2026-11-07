/**
 * Generator of golden 4, `v1-golden-boundary.rtbseg`: a deflated sparse segment list
 * of a `.rtb`-container file over 4 GiB, written by the real `Zip64Writer` through a
 * segment sink that never holds the fill run.
 *
 * Content: one stored descriptor entry of 4 GiB + 1 bytes (all 0x55), then 65,536
 * stored entries with 1-byte bodies and fixed-width names `x/000000`.. `x/065535`,
 * whose offsets all lie past 4 GiB. Every entry is stored, so no fflate output is in
 * the decoded run list; only the `.rtbseg` wrapper is deflated (level 9).
 *
 * Writes only through `writeGoldenFile` (exclusive create, refused under any
 * repository) and only when RTB_GENERATE=1, so a run of the whole save-gen folder
 * generates nothing. The golden is never regenerated: the checked-in copy is made by
 * a deliberate hand copy, and the SHA-256 and size this harness prints are written by
 * hand into the README and into the constants of rtbGoldens.test.ts.
 *
 * Run (repository root):
 *   $env:RTB_GENERATE = '1'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbBoundaryGolden.harness.ts
 *
 * The build parameters below are duplicated in rtbGoldens.test.ts on purpose: the
 * determinism guard rebuilds the file with the current writer, independently of this
 * harness, and compares it with the checked-in golden.
 */
import { createHash } from 'node:crypto'
import { describe, test, expect } from 'vitest'
import { CRC32_INIT, crc32Final, crc32Update } from 'src/ts/drive/rtb/crc32Running'
import { fillPiece, Zip64Writer, type ZipPiece } from 'src/ts/drive/rtb/zip64Writer'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { SegmentSink } from 'src/ts/drive/tests/rtb/segmentSink'
import { decodeSegmentList, encodeSegmentList } from 'src/ts/drive/tests/rtb/sparseSource'
import { parseZip, readDescriptor } from 'src/ts/drive/tests/rtb/zipTestParser'

const GENERATE = process.env.RTB_GENERATE === '1'
const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const GIB4 = 2 ** 32
const BIG_LENGTH = GIB4 + 1
const BIG_FILL = 0x55
const SMALL_COUNT = 65536
const MIB = 1024 * 1024
const FILE_NAME = 'v1-golden-boundary.rtbseg'

function nameOf(i: number): string {
    return `x/${i.toString().padStart(6, '0')}`
}

async function* fillOnly(piece: ZipPiece): AsyncGenerator<ZipPiece> {
    yield piece
}

/** CRC-32 of the big entry by visiting every byte, independent of the writer's fill folding. */
function bytewiseBigCrc(): number {
    const chunk = new Uint8Array(MIB).fill(BIG_FILL)
    let state = CRC32_INIT
    let left = BIG_LENGTH
    while (left > 0) {
        const take = Math.min(left, chunk.length)
        state = crc32Update(state, take === chunk.length ? chunk : chunk.subarray(0, take))
        left -= take
    }
    return crc32Final(state)
}

describe.skipIf(!GENERATE)('golden 4 generation (RTB_GENERATE=1)', () => {
    test('writes v1-golden-boundary.rtbseg and re-checks the 4 GiB + 1 CRC byte by byte', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: CREATED })
        await writer.addStreamed('a/big', 0, fillOnly(fillPiece(BIG_FILL, BIG_LENGTH)), null)
        for (let i = 0; i < SMALL_COUNT; i++) {
            await writer.addBuffered(nameOf(i), 0, Uint8Array.of(i & 0xFF), 1)
        }
        await writer.finish()
        expect(sink.length).toBeGreaterThan(GIB4 + SMALL_COUNT)

        const parsed = parseZip(sink)
        expect(parsed.entries.length).toBe(SMALL_COUNT + 1)
        const big = parsed.entries[0]
        expect(big.name).toBe('a/big')
        expect(big.method).toBe(0)
        expect(big.uncompressedSize).toBe(BIG_LENGTH)
        const expectedCrc = bytewiseBigCrc()
        expect(big.crc).toBe(expectedCrc)
        expect(readDescriptor(parsed, big).crc).toBe(expectedCrc)
        for (const entry of parsed.entries.slice(1)) {
            expect(entry.method).toBe(0)
            expect(entry.offset).toBeGreaterThan(GIB4)
        }

        const runs = sink.canonicalRuns()
        const bytes = encodeSegmentList(runs)
        expect(decodeSegmentList(bytes).map((r) => (r.kind === 'data' ? r.bytes.length : -r.length))).toEqual(
            runs.map((r) => (r.kind === 'data' ? r.bytes.length : -r.length)),
        )

        const dir = goldenOutDir()
        const file = writeGoldenFile(dir, FILE_NAME, bytes)
        const sha = createHash('sha256').update(bytes).digest('hex')
        process.stdout.write(`golden 4 file: ${file}\n`)
        process.stdout.write(`golden 4 size: ${bytes.length} bytes (1 MiB is 1048576)\n`)
        process.stdout.write(`golden 4 sha256: ${sha}\n`)
        process.stdout.write(`golden 4 big entry crc: 0x${expectedCrc.toString(16).padStart(8, '0')}\n`)
        process.stdout.write(`golden 4 file length: ${sink.length}, runs: ${runs.map((r) => r.kind).join(',')}\n`)
    }, 900000)
})
