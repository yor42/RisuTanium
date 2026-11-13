// @vitest-environment node
// Archive intake over hostile and ordinary `.risutheme` archives. Real verdicts come from the merged validator through
// a test-only judge; the production judge runs in a worker. Hostile archives are written field by field by the raw
// builder; ordinary ones by fflate. "No body read" is measured on a recording source: apart from the tail reads and
// reads inside the central directory, nothing is read.
import { readFileSync } from 'node:fs'
import { deflateSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RtbCouldNotReadError } from '../drive/rtb/rangeSource'
import { judgeAreaSheet, judgePackSheets, type PackSheetsJudgement } from './index'
import {
    APPLIED_AREAS, decodeSheet, intakePack, intakePackBytes, PACK_ENTRY_NAME_MAX_BYTES, readVerifiedFile,
    type AppliedArea, type IntakeRefusal, type IntakeResult, type PackJudge, type VerifiedPack,
} from './intake'
import { PACK_FILE_MAX_BYTES, PACK_MAX_ENTRIES, PACK_MAX_UNPACKED_BYTES, ZIP_TAIL_BYTES } from './zipTail'
import {
    buildRawZip, buildRawZipDetailed, CHAT_SHEET, crc32, crcPatch, endRecordBytes, extraBlock, failingSource, fakeFont, manifestText, PLAIN_CHAT_SHEET, PNG_1X1,
    readsOutsideTailAndDirectory, spySource, tailReads, unreadableSource, utf8, validPackFiles, zip64SizesBlock, zipPack,
    type RawEntry, type RawZipOptions, type ReadRecord, type ZipLayout,
} from './fixtures/packBuilder'

const MIB = 1024 * 1024
const realJudge: PackJudge = async (sheets) => judgePackSheets(sheets)

interface JudgeSpy { readonly judge: PackJudge; readonly calls: Array<Readonly<Partial<Record<AppliedArea, string>>>> }
function spyJudge(inner: PackJudge = realJudge): JudgeSpy {
    const calls: JudgeSpy['calls'] = []
    return { calls, judge: async (sheets) => { calls.push(sheets); return inner(sheets) } }
}

interface Run { readonly result: IntakeResult; readonly reads: ReadRecord[] }
async function run(bytes: Uint8Array, judge: PackJudge = realJudge): Promise<Run> {
    const source = spySource(bytes)
    return { result: await intakePack(source, judge), reads: source.reads }
}

function refusalsOf(result: IntakeResult): readonly IntakeRefusal[] {
    if (result.ok === true) throw new Error('expected a refusal, the pack was accepted')
    return result.refusals
}

function packOf(result: IntakeResult): VerifiedPack {
    if (result.ok === false) throw new Error(`expected an accepted pack, got ${JSON.stringify(result.refusals)}`)
    return result.pack
}

function entry(name: string, content: string | Uint8Array = '', over: Partial<RawEntry> = {}): RawEntry {
    return { name, data: typeof content === 'string' ? utf8(content) : content, ...over }
}

function baseEntries(): RawEntry[] {
    return [entry('manifest.json', manifestText()), entry('chat.css', PLAIN_CHAT_SHEET)]
}

interface RawRun extends Run { readonly layout: ZipLayout; readonly bytes: Uint8Array }
async function runRaw(entries: readonly RawEntry[], options: RawZipOptions = {}, judge: PackJudge = realJudge): Promise<RawRun> {
    const built = buildRawZipDetailed(entries, options)
    return { ...(await run(built.bytes, judge)), layout: built.layout, bytes: built.bytes }
}

function outside(reads: readonly ReadRecord[], layout: ZipLayout): ReadRecord[] {
    return readsOutsideTailAndDirectory(reads, layout, ZIP_TAIL_BYTES)
}

const hostileBase = (extra: RawEntry[]): RawEntry[] => [...baseEntries(), ...extra]

afterEach(() => {
    vi.restoreAllMocks()
})

describe('accepted packs', () => {
    it('a minimal pack is accepted with its manifest, judged sheet, file map and size verdict', async () => {
        const { result } = await run(zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': PNG_1X1 })))
        const pack = packOf(result)
        expect(pack.manifest.name).toBe('Test Pack')
        expect(pack.sheets.chat.result.ok).toBe(true)
        expect(pack.skippedAreas).toEqual([])
        expect([...pack.files.keys()]).toEqual(['images/a.png'])
        expect(pack.files.get('images/a.png')).toMatchObject({ kind: 'image', mime: 'image/png', size: PNG_1X1.length, crc: crc32(PNG_1X1) })
        expect(pack.totalBytes).toBe(utf8(manifestText()).length + utf8(CHAT_SHEET).length + PNG_1X1.length)
        expect(pack.size).toEqual({ warn: false, limitBytes: 20 * MIB })
    })

    it('intakePackBytes gives the same verdict as intakePack over the same bytes', async () => {
        const bytes = zipPack(validPackFiles())
        expect(await intakePackBytes(bytes, realJudge)).toEqual((await run(bytes)).result)
    })
})

describe('T1-1 zip slip', () => {
    it.each(['../x.css', 'a/../../x.css', 'fonts/./a.woff2', '__MACOSX/../x'])('%s is an unsafe name and nothing but the tail and directory is read', async (name) => {
        const { result, reads, layout } = await runRaw(hostileBase([entry(name, 'x')]))
        expect(refusalsOf(result)).toEqual([{ code: 'unsafeName', name }])
        expect(outside(reads, layout)).toEqual([])
    })

    it('an unsafe name and a bad manifest report only the name and never read the manifest', async () => {
        const { result, reads, layout } = await runRaw([entry('manifest.json', '{}'), entry('chat.css', PLAIN_CHAT_SHEET), entry('../x.css', 'x')])
        expect(refusalsOf(result)).toEqual([{ code: 'unsafeName', name: '../x.css' }])
        expect(outside(reads, layout)).toEqual([])
    })
})

describe('T1-2 absolute names and separators', () => {
    it.each(['/chat.css', 'fonts\\a.woff2', 'C:/x.css'])('%s is an unsafe name', async (name) => {
        const { result } = await runRaw(hostileBase([entry(name, 'x')]))
        expect(refusalsOf(result)).toEqual([{ code: 'unsafeName', name }])
    })
})

describe('T1-3 name characters and length', () => {
    it('a non-ASCII name and a control byte are unsafe names', async () => {
        const hangul = 'images/\uD55C.png'
        expect(refusalsOf((await runRaw(hostileBase([entry(hangul, PNG_1X1)]))).result)).toEqual([{ code: 'unsafeName', name: hangul }])
        const control = Uint8Array.from([...utf8('images/a'), 0x01, ...utf8('.png')])
        const refusals = refusalsOf((await runRaw(hostileBase([{ name: control, data: PNG_1X1 }]))).result)
        expect(refusals.map((r) => r.code)).toEqual(['unsafeName'])
    })

    it('a 256 byte name is unsafe, ignored names included, and a 255 byte name is accepted', async () => {
        expect(PACK_ENTRY_NAME_MAX_BYTES).toBe(255)
        const long = `images/${'a'.repeat(245)}.png`
        expect(long.length).toBe(256)
        expect(refusalsOf((await runRaw(hostileBase([entry(long, PNG_1X1)]))).result)).toEqual([{ code: 'unsafeName', name: long }])
        const ignored = `__MACOSX/${'a'.repeat(247)}`
        expect(ignored.length).toBe(256)
        expect(refusalsOf((await runRaw(hostileBase([entry(ignored, 'x')]))).result)).toEqual([{ code: 'unsafeName', name: ignored }])
        const exact = `images/${'a'.repeat(244)}.png`
        expect(exact.length).toBe(255)
        const { result } = await run(zipPack(validPackFiles({ [exact]: PNG_1X1 })))
        expect(packOf(result).files.has(exact)).toBe(true)
    })
})

describe('T1-4 and T1-5 duplicates', () => {
    it('two central records with one raw name are a duplicate name', async () => {
        const { result } = await runRaw(hostileBase([entry('images/a.png', PNG_1X1), entry('images/a.png', PNG_1X1)]))
        expect(refusalsOf(result)).toEqual([{ code: 'duplicateName', name: 'images/a.png' }])
    })

    it('names equal after ASCII lower-casing are duplicates', async () => {
        const images = await runRaw(hostileBase([entry('images/A.png', PNG_1X1), entry('images/a.png', PNG_1X1)]))
        expect(refusalsOf(images.result)).toEqual([{ code: 'duplicateName', name: 'images/a.png' }])
        const chat = await runRaw([entry('manifest.json', manifestText()), entry('chat.css', PLAIN_CHAT_SHEET), entry('Chat.css', PLAIN_CHAT_SHEET)])
        expect(refusalsOf(chat.result)).toEqual([{ code: 'duplicateName', name: 'Chat.css' }])
    })
})

describe('T1-6 nested archive', () => {
    it('an image whose body is an archive is wrong content, and a .zip file is an unknown file', async () => {
        const nested = Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        const { result } = await run(zipPack(validPackFiles({ 'images/x.png': nested })))
        expect(refusalsOf(result)).toEqual([{ code: 'wrongContent', name: 'images/x.png' }])
        const zipName = await run(zipPack(validPackFiles({ 'fonts/x.zip': nested })))
        expect(refusalsOf(zipName.result)).toEqual([{ code: 'unknownFile', name: 'fonts/x.zip' }])
    })
})

describe('T1-7 link entry', () => {
    it('a symbolic-link entry is refused by its body, not by its mode bits', async () => {
        const link = entry('images/a.png', '../../etc/passwd', { versionMadeBy: 0x0314, externalAttributes: ((0xA000 | 0x1FF) << 16) >>> 0 })
        const { result } = await runRaw(hostileBase([link]))
        expect(refusalsOf(result)).toEqual([{ code: 'wrongContent', name: 'images/a.png' }])
    })
})

describe('T1-8 encryption flags', () => {
    it.each([0x0001, 0x0040, 0x2000])('flag 0x%s is encrypted and no body is read', async (flags) => {
        const { result, reads, layout } = await runRaw(hostileBase([entry('images/x.png', PNG_1X1, { flags })]))
        expect(refusalsOf(result)).toEqual([{ code: 'encrypted', name: 'images/x.png' }])
        expect(outside(reads, layout)).toEqual([])
    })
})

describe('T1-9 compression methods', () => {
    it.each([12, 14, 93, 99])('method %i is refused as compression and no body is read', async (method) => {
        const { result, reads, layout } = await runRaw(hostileBase([entry('images/x.png', PNG_1X1, { method })]))
        expect(refusalsOf(result)).toEqual([{ code: 'compression', name: 'images/x.png' }])
        expect(outside(reads, layout)).toEqual([])
    })
})

describe('T1-10 to T1-12 tail refusals', () => {
    it('513 entries are refused after exactly one read, 512 are accepted', async () => {
        const ignored = (count: number) => Array.from({ length: count }, (_, i) => entry(`__MACOSX/n${i}.txt`, 'x', { method: 0 }))
        const refused = await run(buildRawZip([...baseEntries(), ...ignored(PACK_MAX_ENTRIES + 1 - 2)]))
        expect(refusalsOf(refused.result)).toEqual([{ code: 'tooManyFiles', limit: PACK_MAX_ENTRIES }])
        expect(refused.reads).toHaveLength(1)
        const accepted = await run(buildRawZip([...baseEntries(), ...ignored(PACK_MAX_ENTRIES - 2)]))
        expect(packOf(accepted.result).directory.count).toBe(PACK_MAX_ENTRIES)
    })

    it('a file over the size bound is refused with zero reads', async () => {
        const source = unreadableSource(PACK_FILE_MAX_BYTES + 1)
        expect(refusalsOf(await intakePack(source, realJudge))).toEqual([{ code: 'packTooLarge', limitBytes: PACK_MAX_UNPACKED_BYTES }])
        expect(source.reads).toHaveLength(0)
    })

    it('ZIP64 end structures are refused after exactly one read', async () => {
        for (const options of [{ sentinels: true, zip64End: true, locator: true }, { sentinels: true }] as const) {
            const { result, reads } = await runRaw(baseEntries(), options)
            expect(refusalsOf(result)).toEqual([{ code: 'zip64' }])
            expect(reads).toHaveLength(1)
        }
    })
})

describe('T1-13 and T1-14 declared size caps', () => {
    it('a declared size over its cap is named, with no body read; the exact limit passes the cap', async () => {
        const lying = (name: string, size: number, content: string | Uint8Array = 'x') => entry(name, content, { uncompressedSize: size })
        const entries = [
            lying('manifest.json', 64 * 1024 + 1, manifestText()),
            lying('chat.css', MIB + 1, PLAIN_CHAT_SHEET),
            lying('studio.css', MIB + 1, 'a{}'),
            lying('fonts/f.woff2', 64 * MIB + 1, fakeFont()),
        ]
        const { result, reads, layout } = await runRaw(entries)
        expect(refusalsOf(result)).toEqual([
            { code: 'fileTooLarge', name: 'manifest.json', limitBytes: 64 * 1024 },
            { code: 'fileTooLarge', name: 'chat.css', limitBytes: MIB },
            { code: 'fileTooLarge', name: 'studio.css', limitBytes: MIB },
            { code: 'fileTooLarge', name: 'fonts/f.woff2', limitBytes: 64 * MIB },
        ])
        expect(outside(reads, layout)).toEqual([])
        const atLimit = await runRaw([
            lying('manifest.json', 64 * 1024, manifestText()),
            lying('chat.css', MIB, PLAIN_CHAT_SHEET),
            lying('studio.css', MIB, 'a{}'),
            lying('fonts/f.woff2', 64 * MIB, fakeFont()),
        ])
        expect(refusalsOf(atLimit.result).map((r) => r.code)).not.toContain('fileTooLarge')
        expect(refusalsOf(atLimit.result).map((r) => r.code)).not.toContain('packTooLarge')
    })

    it('a total over 256 MiB is refused from the declared sizes with no body read', async () => {
        const five = Array.from({ length: 5 }, (_, i) => entry(`images/a${i}.png`, PNG_1X1, { uncompressedSize: 52 * MIB }))
        const { result, reads, layout } = await runRaw(hostileBase(five))
        expect(refusalsOf(result)).toEqual([{ code: 'packTooLarge', limitBytes: PACK_MAX_UNPACKED_BYTES }])
        expect(outside(reads, layout)).toEqual([])
    })

    it('a declared total of exactly 256 MiB passes the total cap and one byte more is refused', async () => {
        // The manifest is a foreign one so the run ends at the manifest and no declared-size body is ever read.
        const fixed = utf8('{}').length + utf8(PLAIN_CHAT_SHEET).length
        const totalOf = (total: number): RawEntry[] => {
            const images = [0, 1, 2].map((i) => entry(`images/a${i}.png`, PNG_1X1, { uncompressedSize: 64 * MIB }))
            const last = entry('images/a3.png', PNG_1X1, { uncompressedSize: total - fixed - 3 * 64 * MIB })
            return [entry('manifest.json', '{}'), entry('chat.css', PLAIN_CHAT_SHEET), ...images, last]
        }
        const at = await runRaw(totalOf(256 * MIB))
        expect(refusalsOf(at.result)).toEqual([{ code: 'notThisKind' }])
        const over = await runRaw(totalOf(256 * MIB + 1))
        expect(refusalsOf(over.result)).toEqual([{ code: 'packTooLarge', limitBytes: 256 * MIB }])
        expect(outside(over.reads, over.layout)).toEqual([])
    })
})

describe('T1-15 manifest bomb', () => {
    it('64 KiB of nested arrays is an unreadable manifest and an 81 character name is a named field', async () => {
        const bomb = await run(zipPack({ 'manifest.json': '['.repeat(64 * 1024), 'chat.css': PLAIN_CHAT_SHEET }))
        expect(refusalsOf(bomb.result)).toEqual([{ code: 'manifestUnreadable' }])
        const longName = await run(zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'n'.repeat(81) }) })))
        expect(refusalsOf(longName.result)).toEqual([{ code: 'manifestField', field: 'name' }])
    })
})

describe('T1-15 manifest bytes', () => {
    it('a manifest that is not valid UTF-8 is unreadable', async () => {
        const { result } = await run(zipPack({ 'manifest.json': Uint8Array.of(0x7B, 0xFF, 0xFE, 0x7D), 'chat.css': PLAIN_CHAT_SHEET }))
        expect(refusalsOf(result)).toEqual([{ code: 'manifestUnreadable' }])
    })
})

describe('T1-16 damage', () => {
    it('two central records over one local header are damaged', async () => {
        const { result } = await runRaw(hostileBase([entry('images/a.png', PNG_1X1), entry('images/b.png', PNG_1X1, { sharesLocalOf: 2 })]))
        const refusals = refusalsOf(result)
        expect(refusals.length).toBeGreaterThan(0)
        expect(refusals.every((r) => r.code === 'damaged')).toBe(true)
    })

    it('a wrong CRC, an inflated size above the declaration and a stream shorter than declared are damaged', async () => {
        const wrongCrc = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { crc: 0x12345678 })]))
        expect(refusalsOf(wrongCrc.result)).toEqual([{ code: 'damaged', name: 'images/a.png' }])
        const tooBig = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { uncompressedSize: 10 })]))
        expect(refusalsOf(tooBig.result)).toEqual([{ code: 'damaged', name: 'images/a.png' }])
        const tooShort = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { uncompressedSize: PNG_1X1.length + 100 })]))
        expect(refusalsOf(tooShort.result)).toEqual([{ code: 'damaged', name: 'images/a.png' }])
    })

    it('a local header name that differs from the central record is damaged', async () => {
        const { result } = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { localName: 'images/b.png' })]))
        expect(refusalsOf(result)).toEqual([{ code: 'damaged', name: 'images/a.png' }])
    })

    it('bytes counted inside the directory after the last central record are damaged', async () => {
        const { result } = await runRaw(baseEntries(), { directoryTail: new Uint8Array(10) })
        expect(refusalsOf(result)).toEqual([{ code: 'damaged', name: null }])
    })

    it('bytes after the last central record are damaged when they open with the digital-signature header PK 05 05', async () => {
        const signature = Uint8Array.of(0x50, 0x4B, 0x05, 0x05)
        const tail = new Uint8Array(signature.length + 44)
        tail.set(signature)
        const { result } = await runRaw(baseEntries(), { directoryTail: tail })
        expect(refusalsOf(result)).toEqual([{ code: 'damaged', name: null }])
    })

    it('a licence text and a skipped sheet with a bad CRC are damaged', async () => {
        const { result } = await runRaw(hostileBase([entry('fonts/OFL.txt', 'licence', { crc: 1 }), entry('studio.css', 'a{}', { crc: 1 })]))
        expect(refusalsOf(result)).toEqual([{ code: 'damaged', name: 'fonts/OFL.txt' }, { code: 'damaged', name: 'studio.css' }])
    })

    it('a file cut short loses its end record and is not a pack', async () => {
        const cut = buildRawZip(baseEntries()).slice(0, -10)
        expect(refusalsOf((await run(cut)).result)).toEqual([{ code: 'notAPack' }])
    })

    it('a second end record in the comment that the reader and the peek both pick leaves bytes after the last record', async () => {
        const bytes = buildRawZip(baseEntries(), {
            comment: (layout) => endRecordBytes({ entries: 1, directorySize: layout.directorySize, directoryOffset: layout.directoryOffset }),
        })
        expect(refusalsOf((await run(bytes)).result).map((r) => r.code)).toEqual(['damaged'])
    })
})

describe('T1-17 not an archive', () => {
    it('a PNG, an empty file and a 21 byte file are not packs', async () => {
        for (const bytes of [PNG_1X1, new Uint8Array(0), new Uint8Array(21)]) {
            expect(refusalsOf((await run(bytes)).result), String(bytes.length)).toEqual([{ code: 'notAPack' }])
        }
    })
})

describe('T1-18 foreign archives', () => {
    it('a foreign manifest is not this kind and a missing manifest is named', async () => {
        const foreign = await run(zipPack({ 'manifest.json': '{"manifest_version":3}', 'chat.css': PLAIN_CHAT_SHEET }))
        expect(refusalsOf(foreign.result)).toEqual([{ code: 'notThisKind' }])
        const missing = await run(zipPack({ 'chat.css': PLAIN_CHAT_SHEET }))
        expect(refusalsOf(missing.result)).toEqual([{ code: 'manifestMissing' }])
    })
})

describe('T1-19 SVG', () => {
    it.each(['images/a.svg', 'images/A.SVG'])('%s is an svg', async (name) => {
        const { result } = await run(zipPack(validPackFiles({ [name]: '<svg xmlns="http://www.w3.org/2000/svg"/>' })))
        expect(refusalsOf(result)).toEqual([{ code: 'svg', name }])
    })

    it('SVG text in a png entry is wrong content', async () => {
        const { result } = await run(zipPack(validPackFiles({ 'images/a.png': '<svg xmlns="http://www.w3.org/2000/svg"/>' })))
        expect(refusalsOf(result)).toEqual([{ code: 'wrongContent', name: 'images/a.png' }])
    })
})

describe('T1-20 and T1-37 sheet decoding', () => {
    it('a sheet with an invalid UTF-8 byte is refused before the judge', async () => {
        const spy = spyJudge()
        const { result } = await run(zipPack(validPackFiles({ 'chat.css': Uint8Array.of(0x61, 0xFF, 0x62) })), spy.judge)
        expect(refusalsOf(result)).toEqual([{ code: 'notUtf8', name: 'chat.css' }])
        expect(spy.calls).toHaveLength(0)
    })

    it('one leading BOM is dropped before the judge and a second reaches it', async () => {
        const bom = Uint8Array.of(0xEF, 0xBB, 0xBF)
        const spy = spyJudge()
        const one = await run(zipPack(validPackFiles({ 'chat.css': Uint8Array.from([...bom, ...utf8(PLAIN_CHAT_SHEET)]) })), spy.judge)
        packOf(one.result)
        expect(spy.calls[0].chat).toBe(PLAIN_CHAT_SHEET)
        const two = await run(zipPack(validPackFiles({ 'chat.css': Uint8Array.from([...bom, ...bom, ...utf8(PLAIN_CHAT_SHEET)]) })), spy.judge)
        expect(spy.calls[1].chat?.startsWith(String.fromCharCode(0xFEFF))).toBe(true)
        expect(refusalsOf(two.result).map((r) => r.code)).toEqual(['sheetRefused'])
    })

    it('a manifest with a leading BOM is accepted', async () => {
        const bom = Uint8Array.of(0xEF, 0xBB, 0xBF)
        const { result } = await run(zipPack(validPackFiles({ 'manifest.json': Uint8Array.from([...bom, ...utf8(manifestText())]) })))
        expect(result.ok).toBe(true)
    })

    it('decodeSheet is fatal on bad UTF-8 and drops one BOM', () => {
        expect(decodeSheet(Uint8Array.of(0xFF))).toBeNull()
        expect(decodeSheet(Uint8Array.of(0xEF, 0xBB, 0xBF, 0x61))).toBe('a')
    })
})

describe('T1-21 directory entries', () => {
    it('a directory entry with a declared size is damaged; fonts/ and images/ of size 0 are ignored', async () => {
        const sized = await runRaw(hostileBase([entry('images/', '', { uncompressedSize: 1 })]))
        expect(refusalsOf(sized.result)).toEqual([{ code: 'damaged', name: 'images/' }])
        const ignored = await run(buildRawZip(hostileBase([entry('fonts/', '', { method: 0 }), entry('images/', '', { method: 0 })])))
        expect(packOf(ignored.result).directory.count).toBe(4)
    })

    it('other directories and nested files are unknown files', async () => {
        const { result } = await run(buildRawZip(hostileBase([entry('fonts/sub/', '', { method: 0 }), entry('images/sub/a.png', PNG_1X1)])))
        expect(refusalsOf(result)).toEqual([{ code: 'unknownFile', name: 'fonts/sub/' }, { code: 'unknownFile', name: 'images/sub/a.png' }])
    })
})

describe('T1-22 unknown files', () => {
    it('files outside the layout, odd extensions and upper-case extensions are unknown', async () => {
        const names = ['scripts/x.js', 'x.html', 'a.png', 'fonts/a.woff3', 'fonts/A.WOFF2']
        const { result } = await run(zipPack(validPackFiles(Object.fromEntries(names.map((name) => [name, 'x'])))))
        expect(refusalsOf(result)).toEqual(names.map((name) => ({ code: 'unknownFile', name })))
    })
})

describe('T1-23 ordinary writers', () => {
    const FIXTURES = new URL('./fixtures/packs/', import.meta.url)
    for (const name of ['compress-archive.risutheme', 'bsdtar.risutheme', '7zip.risutheme']) {
        const file = new URL(name, FIXTURES)
        it(`${name} is accepted`, async () => {
            const { result } = await run(new Uint8Array(readFileSync(file)))
            const pack = packOf(result)
            expect(pack.files.has('images/x.png')).toBe(true)
            expect(pack.files.has('fonts/x.woff2')).toBe(true)
            expect(pack.sheets.chat.result.ok).toBe(true)
        })
    }

    it('a Finder-shaped archive is accepted: descriptors, a resource-fork directory and .DS_Store', async () => {
        const entries = [
            entry('manifest.json', manifestText(), { dataDescriptor: true }),
            entry('chat.css', CHAT_SHEET, { dataDescriptor: true }),
            entry('images/', '', { method: 0 }),
            entry('images/a.png', PNG_1X1, { dataDescriptor: true }),
            entry('__MACOSX/', '', { method: 0 }),
            entry('__MACOSX/._chat.css', 'resource fork', { dataDescriptor: true }),
            entry('.DS_Store', 'finder', { dataDescriptor: true }),
        ]
        const { result } = await run(buildRawZip(entries))
        const pack = packOf(result)
        expect(pack.directory.count).toBe(7)
        expect([...pack.files.keys()]).toEqual(['images/a.png'])
    })

    it('ignored entries count toward the 512 entry limit and are not read', async () => {
        const noise = Array.from({ length: PACK_MAX_ENTRIES - 2 }, (_, i) => entry(`__MACOSX/n${i}`, 'x', { crc: 1 }))
        const { result } = await run(buildRawZip([...baseEntries(), ...noise]))
        expect(packOf(result).directory.count).toBe(PACK_MAX_ENTRIES)
    })
})

describe('T1-26 font licences', () => {
    const FONT = { file: 'fonts/a.woff2', license: 'OFL-1.1' }
    const files = (manifest: Record<string, unknown>) => validPackFiles({ 'fonts/a.woff2': fakeFont(), 'manifest.json': manifestText(manifest) })

    it('a font with exactly one licence member is accepted, and a pack without fonts needs no member', async () => {
        expect(packOf((await run(zipPack(files({ fonts: [FONT] })))).result).files.get('fonts/a.woff2')).toMatchObject({ kind: 'font', mime: 'font/woff2' })
        expect((await run(zipPack(validPackFiles()))).result.ok).toBe(true)
    })

    it('a font without a member, or with two, is refused', async () => {
        expect(refusalsOf((await run(zipPack(files({})))).result)).toEqual([{ code: 'fontLicense', file: 'fonts/a.woff2' }])
        expect(refusalsOf((await run(zipPack(files({ fonts: [FONT, FONT] })))).result)).toEqual([{ code: 'fontLicense', file: 'fonts/a.woff2' }])
    })

    it('an otf font with its own head is accepted as font/otf', async () => {
        const file = 'fonts/a.otf'
        const { result } = await run(zipPack(validPackFiles({ [file]: fakeFont('OTTO'), 'manifest.json': manifestText({ fonts: [{ file, license: 'OFL-1.1' }] }) })))
        expect(packOf(result).files.get(file)).toMatchObject({ kind: 'font', mime: 'font/otf' })
    })

    it('a markdown licence text is accepted beside a txt one, and neither is an applied file', async () => {
        const { result } = await run(zipPack(validPackFiles({ 'fonts/OFL.md': 'licence', 'images/NOTICE.txt': 'notice', 'LICENSE.md': 'licence' })))
        expect([...packOf(result).files.keys()]).toEqual([])
    })

    it('a member naming no font is refused', async () => {
        expect(refusalsOf((await run(zipPack(validPackFiles({ 'manifest.json': manifestText({ fonts: [FONT] }) })))).result))
            .toEqual([{ code: 'licenseWithoutFont', file: 'fonts/a.woff2' }])
    })
})

describe('T1-29 pass 2', () => {
    function dataStart(bytes: Uint8Array, pack: VerifiedPack, path: string): number {
        const file = pack.files.get(path)!
        const offset = pack.directory.entry(file.entryIndex).offset
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        return offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    }

    it('unchanged bytes read back exactly, with their MIME', async () => {
        const bytes = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': PNG_1X1 }))
        const source = spySource(bytes)
        const pack = packOf(await intakePack(source, realJudge))
        const read = await readVerifiedFile(source, pack, 'images/a.png')
        expect(read).toEqual({ ok: true, bytes: PNG_1X1, mime: 'image/png' })
    })

    it('a byte changed after intake is damaged, and an unknown path is damaged', async () => {
        const bytes = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': PNG_1X1 }))
        const source = spySource(bytes)
        const pack = packOf(await intakePack(source, realJudge))
        bytes[dataStart(bytes, pack, 'images/a.png') + 2] ^= 0xFF
        expect(await readVerifiedFile(source, pack, 'images/a.png')).toEqual({ ok: false, refusal: { code: 'damaged', name: 'images/a.png' } })
        expect(await readVerifiedFile(source, pack, 'images/none.png')).toEqual({ ok: false, refusal: { code: 'damaged', name: 'images/none.png' } })
    })

    it('a stored entry whose head changed under an unchanged CRC is wrong content', async () => {
        const bytes = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': { data: PNG_1X1, stored: true } }))
        const source = spySource(bytes)
        const pack = packOf(await intakePack(source, realJudge))
        const at = dataStart(bytes, pack, 'images/a.png')
        const changed = PNG_1X1.slice()
        changed[1] = 0x51
        const prefix = changed.subarray(0, changed.length - 4)
        const patched = Uint8Array.from([...prefix, ...crcPatch(prefix, crc32(PNG_1X1))])
        expect(crc32(patched)).toBe(crc32(PNG_1X1))
        bytes.set(patched, at)
        expect(await readVerifiedFile(source, pack, 'images/a.png')).toEqual({ ok: false, refusal: { code: 'wrongContent', name: 'images/a.png' } })
    })
})

describe('T1-30 a judge that fails', () => {
    it.each(['the check timed out', 'the worker crashed'])('%s is could-not-check, logs once in development and reads nothing more', async (message) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const bytes = zipPack(validPackFiles())
        const source = spySource(bytes)
        let readsAtJudge = -1
        const failure = new Error(message)
        const result = await intakePack(source, async () => {
            readsAtJudge = source.reads.length
            throw failure
        })
        expect(refusalsOf(result)).toEqual([{ code: 'couldNotCheck' }])
        expect(source.reads).toHaveLength(readsAtJudge)
        expect(log).toHaveBeenCalledTimes(1)
        expect(log.mock.calls[0]).toContain(failure)
    })
})

describe('T1-32 and T1-43 skipped and empty sheets', () => {
    it('hostile home and studio sheets are skipped and never judged', async () => {
        const hostile = '[data-part]{padding-inline:60px}'
        const spy = spyJudge()
        const { result } = await run(zipPack(validPackFiles({ 'home.css': hostile, 'studio.css': hostile })), spy.judge)
        expect(packOf(result).skippedAreas).toEqual(['home', 'studio'])
        expect(spy.calls).toHaveLength(1)
        expect(Object.keys(spy.calls[0])).toEqual(['chat'])
    })

    it('an empty chat sheet and a comment-only chat sheet are valid sheets', async () => {
        const spy = spyJudge()
        const empty = await run(zipPack(validPackFiles({ 'chat.css': '', 'studio.css': 'a{}' })), spy.judge)
        expect(packOf(empty.result).skippedAreas).toEqual(['studio'])
        expect(spy.calls[0]).toEqual({ chat: '' })
        const comment = await run(zipPack(validPackFiles({ 'chat.css': '/* nothing */' })))
        expect(comment.result.ok).toBe(true)
    })
})

describe('T1-33 judgements are read per area', () => {
    it('a pack-level ok with no chat judgement is could-not-check, and a refused chat judgement is a refused sheet', async () => {
        const bytes = zipPack(validPackFiles())
        expect(refusalsOf((await run(bytes, async () => ({ ok: true, areas: {} }))).result)).toEqual([{ code: 'couldNotCheck' }])
        const refused = judgeAreaSheet('chat', '[data-part]{padding-inline:60px}')
        expect(refused.result.ok).toBe(false)
        const judgement: PackSheetsJudgement = { ok: true, areas: { chat: refused } }
        expect(refusalsOf((await run(bytes, async () => judgement)).result)).toEqual([{ code: 'sheetRefused', sheet: 'chat.css', errors: refused.result.errors }])
    })
})

describe('T1-34 a pack without chat.css', () => {
    it.each([
        ['only studio.css', { 'studio.css': 'a{}' }],
        ['only settings.css', { 'settings.css': 'a{}' }],
        ['no sheet', {}],
    ] as const)('%s is no-area, the judge is not called and no sheet is read', async (_name, sheets) => {
        const spy = spyJudge()
        const entries = [entry('manifest.json', manifestText()), ...Object.entries(sheets).map(([name, css]) => entry(name, css))]
        const { result, reads, layout } = await runRaw(entries, {}, spy.judge)
        expect(refusalsOf(result)).toEqual([{ code: 'noArea' }])
        expect(spy.calls).toHaveLength(0)
        const sheetStart = layout.localOffsets[1]
        if (sheetStart !== undefined) {
            expect(reads.filter((read) => read.offset >= sheetStart && read.offset < layout.directoryOffset)).toEqual([])
        }
    })
})

describe('T1-35 targets of a refused sheet', () => {
    it('a refused sheet gives the validator reasons only, with no target check and no asset read', async () => {
        const css = '[data-part]{background-image:url(images/missing.png);padding-inline:60px}'
        const built = buildRawZipDetailed([entry('manifest.json', manifestText()), entry('chat.css', css), entry('images/a.png', PNG_1X1)])
        const { result, reads } = await run(built.bytes)
        const refusals = refusalsOf(result)
        expect(refusals).toHaveLength(1)
        expect(refusals[0].code).toBe('sheetRefused')
        const assetStart = built.layout.localOffsets[2]
        expect(reads.filter((read) => read.offset >= assetStart && read.offset < built.layout.directoryOffset)).toEqual([])
    })
})

describe('T1-36 applied-area tripwire', () => {
    const ROWS = [
        ['H1', '[data-part]{padding-inline:60px}'],
        ['H3', '[data-part]{margin-inline:60px}'],
        ['H6', '[data-x="y"]{margin-inline:60px}'],
        ['S1', '[data-part]{padding-inline:60px}'],
    ] as const

    it('the applied areas are exactly chat, and every R20 row is refused in each of them', () => {
        expect([...APPLIED_AREAS]).toEqual(['chat'])
        for (const area of APPLIED_AREAS) {
            for (const [id, css] of ROWS) {
                expect(judgeAreaSheet(area, css).result.ok, `${id} in ${area}`).toBe(false)
            }
        }
    })
})

describe('T1-38 size verdict', () => {
    it('a pack of exactly 20 MiB does not warn and one byte more does, by the declared total', async () => {
        const fixed = utf8(manifestText()).length + utf8(PLAIN_CHAT_SHEET).length
        const image = (size: number) => {
            const body = new Uint8Array(size)
            body.set(PNG_1X1)
            return body
        }
        const at = await run(zipPack(validPackFiles({ 'images/big.png': { data: image(20 * MIB - fixed), stored: true } })))
        expect(packOf(at.result).totalBytes).toBe(20 * MIB)
        expect(packOf(at.result).size.warn).toBe(false)
        const over = await run(zipPack(validPackFiles({ 'images/big.png': { data: image(21 * MIB), stored: true } })))
        expect(packOf(over.result).size).toEqual({ warn: true, limitBytes: 20 * MIB })
    }, 60000)
})

describe('T1-39 step order', () => {
    it('an unsafe name hides an over-cap file, and an unknown file stops before any sheet is read', async () => {
        const hidden = await runRaw(hostileBase([entry('../x.css', 'x'), entry('images/big.png', PNG_1X1, { uncompressedSize: 65 * MIB })]))
        expect(refusalsOf(hidden.result)).toEqual([{ code: 'unsafeName', name: '../x.css' }])
        const unknown = await runRaw(hostileBase([entry('x.html', 'x')]))
        expect(refusalsOf(unknown.result)).toEqual([{ code: 'unknownFile', name: 'x.html' }])
        const chatStart = unknown.layout.localOffsets[1]
        const afterManifest = unknown.reads.filter((read) => read.offset >= chatStart && read.offset < unknown.layout.directoryOffset)
        expect(afterManifest).toEqual([])
    })
})

describe('T1-40 bytes outside entries', () => {
    const gap = (n: number) => new Uint8Array(n).fill(0x7A)

    it('a prefix, a gap between entries, descriptors and a gap before the end record are accepted', async () => {
        const plain = hostileBase([entry('images/a.png', PNG_1X1)])
        const cases: ReadonlyArray<readonly [string, RawEntry[], RawZipOptions]> = [
            ['prefix', plain, { prefix: new Uint8Array(100) }],
            ['gap between entries', [{ ...plain[0], gapAfter: gap(16) }, ...plain.slice(1)], {}],
            ['descriptors', plain.map((e) => ({ ...e, dataDescriptor: true })), {}],
            ['gap before the end record', plain, { gapBeforeEnd: gap(32) }],
            ['gap before the directory', plain, { gapBeforeDirectory: gap(8) }],
        ]
        for (const [name, entries, options] of cases) {
            const { result } = await runRaw(entries, options)
            expect(result.ok, `${name}: ${JSON.stringify(result.ok === false ? result.refusals : null)}`).toBe(true)
        }
    })

    it('bytes after a deflate stream inside its entry extent are ignored (diagnostic outcome, pinned)', async () => {
        const base = baseEntries()
        const junk = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
        const payload = Uint8Array.from([...deflateSync(base[0].data ?? new Uint8Array(0), { level: 9 }), ...junk])
        const withJunk = await runRaw([{ ...base[0], payload }, base[1]])
        // The observed outcome is format statement 2 in goldens/README.md; a reader that changes it must change that sentence.
        expect(withJunk.result.ok).toBe(true)
    })
})

describe('T1-41 per-entry ZIP64', () => {
    const ZIP64 = [{ code: 'zip64' }]

    it('a sentinel size with a ZIP64 extra is refused as zip64 alone, reading only the tail and directory', async () => {
        const sized = entry('images/a.png', PNG_1X1, {
            method: 0,
            compressedSize: 0xFFFFFFFF,
            uncompressedSize: 0xFFFFFFFF,
            centralExtra: zip64SizesBlock(PNG_1X1.length, PNG_1X1.length),
        })
        const { result, reads, layout } = await runRaw(hostileBase([sized]))
        expect(refusalsOf(result)).toEqual(ZIP64)
        expect(outside(reads, layout)).toEqual([])
    })

    it('a ZIP64 extra block with no sentinel is refused', async () => {
        const entries = [entry('manifest.json', manifestText()), entry('chat.css', PLAIN_CHAT_SHEET, { centralExtra: extraBlock(0x0001, new Uint8Array(8)) })]
        const { result, reads, layout } = await runRaw(entries)
        expect(refusalsOf(result)).toEqual(ZIP64)
        expect(outside(reads, layout)).toEqual([])
    })

    it('a sentinel offset with no extra is zip64 and not damaged', async () => {
        const { result } = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { localOffset: 0xFFFFFFFF })]))
        expect(refusalsOf(result)).toEqual(ZIP64)
    })

    it('Info-ZIP time and owner blocks on every entry are accepted', async () => {
        const time = extraBlock(0x5455, Uint8Array.of(1, 0, 0, 0, 0))
        const owner = extraBlock(0x7875, Uint8Array.of(1, 4, 0xE8, 3, 0, 0, 4, 0xE8, 3, 0, 0))
        const extra = Uint8Array.from([...time, ...owner])
        const entries = hostileBase([entry('images/a.png', PNG_1X1)]).map((e) => ({ ...e, localExtra: extra, centralExtra: extra }))
        expect((await runRaw(entries)).result.ok).toBe(true)
    })

    it('a ZIP64 block placed after another block is still found', async () => {
        const extra = Uint8Array.from([...extraBlock(0x5455, Uint8Array.of(1, 0, 0, 0, 0)), ...extraBlock(0x0001, new Uint8Array(8))])
        const { result } = await runRaw(hostileBase([entry('images/a.png', PNG_1X1, { centralExtra: extra })]))
        expect(refusalsOf(result)).toEqual(ZIP64)
    })
})

describe('T1-42 findings overflow', () => {
    it('a flag past the 1000 finding cap is still refused from the index, and the overflow is damage', async () => {
        const noise = Array.from({ length: 500 }, (_, i) => entry(`d${i}/`, '', { method: 99 }))
        const { result, reads, layout } = await runRaw([...noise, entry('images/e.png', PNG_1X1, { flags: 0x0001 })])
        const refusals = refusalsOf(result)
        expect(refusals).toContainEqual({ code: 'damaged', name: null })
        expect(refusals).toContainEqual({ code: 'encrypted', name: 'images/e.png' })
        expect(outside(reads, layout)).toEqual([])
    })
})

describe('T1-44 failed reads', () => {
    it('a failed tail read is could-not-check', async () => {
        const bytes = zipPack(validPackFiles())
        const source = failingSource(bytes, (offset, length) => offset + length === bytes.length, new RtbCouldNotReadError('gone', 0, 0))
        expect(refusalsOf(await intakePack(source, realJudge))).toEqual([{ code: 'couldNotCheck' }])
    })

    it('a failed chat.css read is could-not-check and the judge is not called', async () => {
        const spy = spyJudge()
        const built = buildRawZipDetailed(baseEntries())
        const chatStart = built.layout.localOffsets[1]
        const source = failingSource(built.bytes, (offset) => offset >= chatStart && offset < built.layout.directoryOffset, new RtbCouldNotReadError('gone', 0, 0))
        expect(refusalsOf(await intakePack(source, spy.judge))).toEqual([{ code: 'couldNotCheck' }])
        expect(spy.calls).toHaveLength(0)
    })

    it('readVerifiedFile maps a failed read to could-not-check', async () => {
        const bytes = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'images/a.png': PNG_1X1 }))
        const pack = packOf(await intakePack(spySource(bytes), realJudge))
        const source = failingSource(bytes, () => true, new RtbCouldNotReadError('gone', 0, 0))
        expect(await readVerifiedFile(source, pack, 'images/a.png')).toEqual({ ok: false, refusal: { code: 'couldNotCheck' } })
    })

    it('any other error is a programming error and propagates', async () => {
        const bytes = zipPack(validPackFiles())
        const source = failingSource(bytes, (offset, length) => offset + length === bytes.length, new TypeError('bug'))
        await expect(intakePack(source, realJudge)).rejects.toThrow('bug')
    })
})

describe('tail window helper', () => {
    it('the recorded tail read is the last window', async () => {
        const bytes = zipPack(validPackFiles())
        const { reads } = await run(bytes)
        expect(tailReads(reads, bytes.length, ZIP_TAIL_BYTES).length).toBeGreaterThanOrEqual(1)
    })
})
