import { describe, test, expect } from 'vitest'
import { RtbCouldNotReadError, rangeSourceFrom } from 'src/ts/drive/rtb/rangeSource'
import { RTB_MIMETYPE, classifyPrefix, sniffRtb } from 'src/ts/drive/rtb/sniff'
import { checkEntryPath, MAX_NAME_BYTES } from 'src/ts/drive/rtb/entryPath'
import { Zip64Writer } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'

const encoder = new TextEncoder()

interface Call { start: number, end: number }

/** An import source over bytes whose `read` can be made to misbehave. */
function importLike(bytes: Uint8Array, behave: (start: number, end: number, calls: Call[]) => Uint8Array | Promise<Uint8Array>) {
    const calls: Call[] = []
    return {
        calls,
        size: bytes.length,
        async read(start: number, end: number): Promise<Uint8Array> {
            calls.push({ start, end })
            return behave(start, end, calls)
        },
    }
}

async function validPrefix(): Promise<Uint8Array> {
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: Date.UTC(2024, 0, 2) })
    const mime = encoder.encode(RTB_MIMETYPE)
    await writer.addBuffered('mimetype', 0, mime, mime.length)
    await writer.addBuffered('manifest.json', 8, encoder.encode('{}'), 2)
    await writer.finish()
    return sink.toBytes()
}

describe('T37b rangeSource returns exactly the requested bytes', () => {
    const data = Uint8Array.from({ length: 100 }, (_, i) => i)

    test('a full read passes through', async () => {
        const source = rangeSourceFrom(importLike(data, (start, end) => data.slice(start, end)))
        expect(await source.read(10, 5)).toEqual(data.slice(10, 15))
        expect(source.size).toBe(100)
    })

    test('a partial read throws could-not-read and is never returned', async () => {
        const source = rangeSourceFrom(importLike(data, (start, end) => data.slice(start, end - 1)))
        await expect(source.read(10, 5)).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })

    test('an over-long read throws could-not-read', async () => {
        const source = rangeSourceFrom(importLike(data, (start, end) => data.slice(start, end + 1)))
        await expect(source.read(10, 5)).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })

    test('a rejected source read becomes could-not-read with the cause kept', async () => {
        const failure = new Error('disk gone')
        const source = rangeSourceFrom(importLike(data, () => Promise.reject(failure)))
        const caught = await source.read(0, 4).catch((error: unknown) => error)
        expect(caught).toBeInstanceOf(RtbCouldNotReadError)
        expect((caught as RtbCouldNotReadError).cause).toBe(failure)
    })

    test('a read outside the reported size is refused before the source is asked', async () => {
        const inner = importLike(data, (start, end) => data.slice(start, end))
        const source = rangeSourceFrom(inner)
        await expect(source.read(98, 5)).rejects.toBeInstanceOf(RtbCouldNotReadError)
        await expect(source.read(-1, 5)).rejects.toBeInstanceOf(RtbCouldNotReadError)
        expect(inner.calls).toEqual([])
    })

    test('a zero-length read needs no source call', async () => {
        const inner = importLike(data, () => Promise.reject(new Error('must not be called')))
        const source = rangeSourceFrom(inner)
        expect((await source.read(5, 0)).length).toBe(0)
        expect(inner.calls).toEqual([])
    })
})

describe('T11 sniff', () => {
    test('a file that starts with the mimetype entry is a zip candidate', async () => {
        const bytes = await validPrefix()
        expect(await sniffRtb(rangeSourceOfBytes(bytes))).toEqual({ kind: 'zip' })
    })

    test('RTBX with the full magic is sealed and carries the envelope version', () => {
        const prefix = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 0x03, 0x00, 9, 9])
        expect(classifyPrefix(prefix)).toEqual({ kind: 'sealed', envelopeVersion: 3 })
    })

    test('RTBX with a different rest of the magic is damaged', () => {
        const wrongRest = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0B, 0x01, 0x00])
        expect(classifyPrefix(wrongRest)).toEqual({ kind: 'sealed-damaged' })
        expect(classifyPrefix(encoder.encode('RTBX'))).toEqual({ kind: 'sealed-damaged' })
        const noVersion = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 0x01])
        expect(classifyPrefix(noVersion)).toEqual({ kind: 'sealed-damaged' })
    })

    test('other magic and empty files are not an rtb', () => {
        expect(classifyPrefix(encoder.encode('%PDF-1.7 something longer than the sniff window............................................'))).toEqual({ kind: 'not-an-rtb' })
        expect(classifyPrefix(new Uint8Array(0))).toEqual({ kind: 'not-an-rtb' })
        expect(classifyPrefix(new Uint8Array([0x50, 0x4B]))).toEqual({ kind: 'not-an-rtb' })
    })

    test('a zip without a leading mimetype entry is not an rtb', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: Date.UTC(2024, 0, 2) })
        const body = encoder.encode('hello world, a body long enough to fill the sniff window........')
        await writer.addBuffered('other.txt', 0, body, body.length)
        await writer.finish()
        expect(await sniffRtb(rangeSourceOfBytes(sink.toBytes()))).toEqual({ kind: 'not-an-rtb' })
    })

    test('a mimetype entry with different content is not an rtb', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: Date.UTC(2024, 0, 2) })
        const wrong = encoder.encode('application/vnd.risutanium.zzz')
        await writer.addBuffered('mimetype', 0, wrong, wrong.length)
        await writer.finish()
        expect(await sniffRtb(rangeSourceOfBytes(sink.toBytes()))).toEqual({ kind: 'not-an-rtb' })
    })

    test('a first entry of the same name length but another name is not an rtb', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: Date.UTC(2024, 0, 2) })
        const mime = encoder.encode(RTB_MIMETYPE)
        await writer.addBuffered('mimetyqe', 0, mime, mime.length)
        await writer.finish()
        expect(await sniffRtb(rangeSourceOfBytes(sink.toBytes()))).toEqual({ kind: 'not-an-rtb' })
    })

    test('a mimetype entry with an extra field is not an rtb (content would not sit at offset 38)', async () => {
        const bytes = (await validPrefix()).slice()
        new DataView(bytes.buffer).setUint16(28, 4, true)
        expect(await sniffRtb(rangeSourceOfBytes(bytes))).toEqual({ kind: 'not-an-rtb' })
    })

    test('sniff reads only the prefix', async () => {
        const bytes = await validPrefix()
        const inner = importLike(bytes, (start, end) => bytes.slice(start, end))
        await sniffRtb(rangeSourceFrom(inner))
        expect(inner.calls.length).toBe(1)
        expect(inner.calls[0].start).toBe(0)
        expect(inner.calls[0].end).toBeLessThanOrEqual(68)
    })

    test('a short source during the sniff is could-not-read', async () => {
        const bytes = await validPrefix()
        const source = rangeSourceFrom(importLike(bytes, (start, end) => bytes.slice(start, end - 3)))
        await expect(sniffRtb(source)).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })
})

describe('T24 entry path rules', () => {
    const name = (text: string) => checkEntryPath(encoder.encode(text))

    test('ordinary names pass', () => {
        expect(name('mimetype')).toBeNull()
        expect(name('manifest.json')).toBeNull()
        expect(name('u/1/0.blk')).toBeNull()
        expect(name('a/Abc%2Fdef.inner.png')).toBeNull()
        expect(name('x/..hidden/.dot/a..b')).toBeNull()
    })

    test('control bytes are refused, including 0x00, 0x01, 0x1F and DEL', () => {
        expect(name('a\x01b')).toBe('control-byte')
        expect(name('a\x1Fb')).toBe('control-byte')
        expect(name('a\x00b')).toBe('control-byte')
        expect(name('a\x7Fb')).toBe('control-byte')
        expect(name('a b')).toBeNull()
    })

    test('dot segments are refused', () => {
        expect(name('a/../b')).toBe('dot-dot-segment')
        expect(name('..')).toBe('dot-dot-segment')
        expect(name('a/./b')).toBe('dot-segment')
        expect(name('.')).toBe('dot-segment')
    })

    test('empty segments, a trailing slash, a leading slash and a backslash are refused', () => {
        expect(name('a//b')).toBe('empty-segment')
        expect(name('a/')).toBe('empty-segment')
        expect(name('/a')).toBe('leading-slash')
        expect(name('a\\b')).toBe('backslash')
        expect(checkEntryPath(new Uint8Array(0))).toBe('empty')
    })

    test('non-ASCII bytes are refused', () => {
        expect(name('café')).toBe('non-ascii')
        expect(checkEntryPath(new Uint8Array([0x61, 0x80]))).toBe('non-ascii')
    })

    test('the read limit is 65,535 bytes', () => {
        expect(MAX_NAME_BYTES).toBe(65535)
        expect(checkEntryPath(new Uint8Array(65535).fill(0x61))).toBeNull()
        expect(checkEntryPath(new Uint8Array(65536).fill(0x61))).toBe('too-long')
        expect(checkEntryPath(new Uint8Array(1025).fill(0x61))).toBeNull()
    })
})
