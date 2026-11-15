// @vitest-environment node
// The tail peek: size bound, end record, ZIP64 and entry-count refusals decided from one read of the file tail, and the
// per-record ZIP64 re-read of the walked directory.
import { describe, expect, it } from 'vitest'
import { readDirectory } from '../drive/rtb/zip64Reader'
import {
    checkCentralZip64, findEndRecord, PACK_FILE_MAX_BYTES, PACK_MAX_ENTRIES, PACK_MAX_UNPACKED_BYTES, peekZipTail, ZIP_TAIL_BYTES,
} from './zipTail'
import {
    buildRawZip, buildRawZipDetailed, concat, endRecordBytes, fakeFont, spySource, tailReads, unreadableSource, utf8, type RawEntry, type RawZipOptions,
} from './fixtures/packBuilder'

function entries(count: number): RawEntry[] {
    return Array.from({ length: count }, (_, i) => ({ name: `f${i}.txt`, data: utf8('x'), method: 0 }))
}

async function peek(bytes: Uint8Array) {
    const source = spySource(bytes)
    const verdict = await peekZipTail(source)
    return { verdict, reads: source.reads, source }
}

describe('frozen format limits', () => {
    it('the entry, size and tail-window limits keep their v1 values', () => {
        expect(PACK_MAX_ENTRIES).toBe(512)
        expect(PACK_MAX_UNPACKED_BYTES).toBe(256 * 1024 * 1024)
        expect(PACK_FILE_MAX_BYTES).toBe(257 * 1024 * 1024)
        expect(ZIP_TAIL_BYTES).toBe(65577)
    })
})

describe('T1-10 entry count', () => {
    it('513 entries are refused with exactly one read, 512 pass the peek', async () => {
        const refused = await peek(buildRawZip(entries(513)))
        expect(refused.verdict).toEqual({ ok: false, code: 'tooManyFiles' })
        expect(refused.reads).toHaveLength(1)
        const allowed = await peek(buildRawZip(entries(PACK_MAX_ENTRIES)))
        expect(allowed.verdict).toEqual({ ok: true, entries: 512 })
        expect(allowed.reads).toHaveLength(1)
    })
})

describe('T1-11 file size bound', () => {
    it('a file over the bound is refused with zero reads and a file at the bound is read', async () => {
        const over = unreadableSource(PACK_FILE_MAX_BYTES + 1)
        expect(await peekZipTail(over)).toEqual({ ok: false, code: 'packTooLarge' })
        expect(over.reads).toHaveLength(0)
        // A file exactly at the bound passes the size test and reaches its one tail read, which fails the sparse source.
        const exact = unreadableSource(PACK_FILE_MAX_BYTES)
        await expect(peekZipTail(exact)).rejects.toThrow('unexpected read')
        expect(exact.reads).toEqual([{ offset: PACK_FILE_MAX_BYTES - ZIP_TAIL_BYTES, length: ZIP_TAIL_BYTES }])
    })
})

describe('T1-12 ZIP64 end structures', () => {
    it('a sentinel end record with a locator and a ZIP64 end record is refused after one read', async () => {
        const { verdict, reads } = await peek(buildRawZip(entries(2), { sentinels: true, zip64End: true, locator: true }))
        expect(verdict).toEqual({ ok: false, code: 'zip64' })
        expect(reads).toHaveLength(1)
    })

    it('a sentinel end record with no locator is refused after one read', async () => {
        const { verdict, reads } = await peek(buildRawZip(entries(2), { sentinels: true }))
        expect(verdict).toEqual({ ok: false, code: 'zip64' })
        expect(reads).toHaveLength(1)
    })

    it('each sentinel alone is refused', async () => {
        const base = buildRawZipDetailed(entries(1))
        for (const field of [10, 12, 16]) {
            const bytes = base.bytes.slice()
            const end = bytes.length - 22
            const width = field === 10 ? 2 : 4
            for (let k = 0; k < width; k++) bytes[end + field + k] = 0xFF
            expect((await peek(bytes)).verdict, `offset ${field}`).toEqual({ ok: false, code: 'zip64' })
        }
    })
})

describe('T1-17 not an archive', () => {
    it('a file with no end record is not a pack', async () => {
        expect((await peek(Uint8Array.of(0x89, 0x50, 0x4E, 0x47, ...new Array<number>(40).fill(0)))).verdict).toEqual({ ok: false, code: 'notAPack' })
        expect((await peek(fakeFont())).verdict).toEqual({ ok: false, code: 'notAPack' })
    })

    it('an empty file and a 21 byte file are refused without a read', async () => {
        for (const size of [0, 21]) {
            const source = spySource(new Uint8Array(size))
            expect(await peekZipTail(source), String(size)).toEqual({ ok: false, code: 'notAPack' })
            expect(source.reads, String(size)).toHaveLength(0)
        }
    })
})

describe('T1-28 tail peek rows', () => {
    it('a locator at eocd-20 is refused after one read even when no count is a sentinel', async () => {
        const { verdict, reads } = await peek(buildRawZip(entries(10), { locator: true }))
        expect(verdict).toEqual({ ok: false, code: 'zip64' })
        expect(reads).toHaveLength(1)
    })

    it('the backward search picks a second end record placed in the comment', async () => {
        const options: RawZipOptions = {
            comment: (layout) => endRecordBytes({ entries: 600, directorySize: layout.directorySize, directoryOffset: layout.directoryOffset }),
        }
        const { verdict, reads } = await peek(buildRawZip(entries(2), options))
        expect(verdict).toEqual({ ok: false, code: 'tooManyFiles' })
        expect(reads).toHaveLength(1)
    })

    it('a decoy end record in the comment that does not end the file is skipped, so 600 records are refused', async () => {
        const bytes = buildRawZip(entries(600), {
            comment: (layout) => concat(
                endRecordBytes({ entries: 1, directorySize: layout.directorySize, directoryOffset: layout.directoryOffset }),
                Uint8Array.of(1, 2, 3),
            ),
        })
        const { verdict, reads } = await peek(bytes)
        expect(verdict).toEqual({ ok: false, code: 'tooManyFiles' })
        expect(reads).toHaveLength(1)
    })

    it('findEndRecord on a tail shorter than an end record finds nothing, and equal structures find the same offset', () => {
        expect(findEndRecord(new Uint8Array(21))).toBe(-1)
        expect(findEndRecord(new Uint8Array(0))).toBe(-1)
        const bytes = buildRawZip(entries(1))
        expect(findEndRecord(bytes)).toBe(bytes.length - 22)
    })

    it('the peek agrees with the unedited reader when the comment holds a second well-formed end record', async () => {
        const bytes = buildRawZip(entries(2), {
            comment: (layout) => endRecordBytes({ entries: 1, directorySize: layout.directorySize, directoryOffset: layout.directoryOffset }),
        })
        const verdict = (await peek(bytes)).verdict
        expect(verdict).toEqual({ ok: true, entries: 1 })
        const walk = await readDirectory(spySource(bytes))
        expect(walk.index?.count).toBe(1)
        expect(verdict.ok && verdict.entries).toBe(walk.index?.count)
    })

    it('a file over the bound is refused with zero reads (the size row of the tail peek)', async () => {
        const source = unreadableSource(PACK_FILE_MAX_BYTES + 1)
        expect((await peekZipTail(source)).ok).toBe(false)
        expect(source.reads).toHaveLength(0)
    })

    it('the tail read is exactly the last window of the file', async () => {
        const bytes = buildRawZip(entries(1))
        const { reads } = await peek(bytes)
        expect(tailReads(reads, bytes.length, ZIP_TAIL_BYTES)).toHaveLength(1)
    })
})

describe('checkCentralZip64', () => {
    it('reads only inside the declared directory and reports a clean directory as null', async () => {
        const built = buildRawZipDetailed(entries(3))
        const source = spySource(built.bytes)
        expect(await checkCentralZip64(source, built.layout.directoryOffset, built.layout.directorySize, 3)).toBeNull()
        for (const read of source.reads) {
            expect(read.offset).toBeGreaterThanOrEqual(built.layout.directoryOffset)
            expect(read.offset + read.length).toBeLessThanOrEqual(built.layout.directoryOffset + built.layout.directorySize)
        }
    })

    it('a record without the central signature, or one that runs past the directory, is damaged', async () => {
        const built = buildRawZipDetailed(entries(2))
        const broken = built.bytes.slice()
        broken[built.layout.directoryOffset] = 0
        expect(await checkCentralZip64(spySource(broken), built.layout.directoryOffset, built.layout.directorySize, 2)).toBe('damaged')
        expect(await checkCentralZip64(spySource(built.bytes), built.layout.directoryOffset, built.layout.directorySize - 5, 2)).toBe('damaged')
        expect(await checkCentralZip64(spySource(built.bytes), built.layout.directoryOffset, built.layout.directorySize, 3)).toBe('damaged')
    })

    it('records that end before the declared end of the directory are damaged, whatever the remainder holds', async () => {
        for (const remainder of [new Uint8Array(10), Uint8Array.of(0x50, 0x4B, 0x05, 0x05, ...new Array<number>(44).fill(7))]) {
            const built = buildRawZipDetailed(entries(2), { directoryTail: remainder })
            expect(await checkCentralZip64(spySource(built.bytes), built.layout.directoryOffset, built.layout.directorySize, 2), String(remainder.length)).toBe('damaged')
        }
    })
})
