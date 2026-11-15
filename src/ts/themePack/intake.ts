// Theme-pack archive intake: decides, from the bytes of a `.risutheme` archive alone, whether it is a pack this build
// installs. Nothing here stores, applies or shows anything; a refusal is a typed code and the caller words it.
//
// The archive is hostile input. Steps 0-3 read only the file tail and the central directory (the declared names, sizes,
// methods and flags), so a size, count, name, flag or method refusal never inflates a byte. A body is read only after
// those pass, and every body is read through the `.rtb` reader's bounded `readEntry`, which never delivers past the
// declared size and checks the size and CRC-32.
import type { AreaSheetJudgement, LintError, PackSheetsJudgement, PackSizeVerdict } from './index'
import { packSizeWarning } from './packSize'
import { parseManifest, type ManifestRefusal, type PackManifest } from './manifest'
import { kindOfMime, mimeOfExtension, SNIFF_BYTES, sniffPackFile, type PackFileKind, type PackFileMime } from './sniff'
import {
    checkCentralZip64, PACK_FILE_MAX_BYTES, PACK_MAX_ENTRIES, PACK_MAX_UNPACKED_BYTES, peekZipTail, type ZipTailRefusal,
} from './zipTail'
import { checkEntryPath } from '../drive/rtb/entryPath'
import { RtbCouldNotReadError, rangeSourceFrom, type RangeSource } from '../drive/rtb/rangeSource'
import { readDirectory, readEntry, type BodySink, type ContainerFinding, type ZipIndex } from '../drive/rtb/zip64Reader'

export type AppliedArea = 'chat'
/** The areas this build judges and applies. An area joins only once every R20 tripwire row is refused there. */
export const APPLIED_AREAS: readonly AppliedArea[] = ['chat']
/** The longest entry name a pack may hold, in raw bytes (a trailing `/` counted). */
export const PACK_ENTRY_NAME_MAX_BYTES = 255

/** Judges the applied-area sheets; the worker client implements it (a timeout or an error rejects). */
export type PackJudge = (sheets: Readonly<Partial<Record<AppliedArea, string>>>) => Promise<PackSheetsJudgement>

export type IntakeRefusal =
    | ManifestRefusal
    | { code: 'notAPack' } | { code: 'zip64' } | { code: 'manifestMissing' } | { code: 'noArea' } | { code: 'couldNotCheck' }
    | { code: 'tooManyFiles'; limit: number }
    | { code: 'packTooLarge'; limitBytes: number }
    | { code: 'damaged'; name: string | null }
    | { code: 'unsafeName' | 'duplicateName' | 'encrypted' | 'compression' | 'unknownFile' | 'svg' | 'wrongContent' | 'notUtf8'; name: string }
    | { code: 'fileTooLarge'; name: string; limitBytes: number }
    | { code: 'target' | 'wrongKind'; sheet: string; target: string }
    | { code: 'fontLicense' | 'licenseWithoutFont'; file: string }
    | { code: 'sheetRefused'; sheet: string; errors: readonly LintError[] }

export interface VerifiedFile {
    readonly path: string
    readonly entryIndex: number
    readonly kind: PackFileKind
    readonly mime: PackFileMime
    readonly size: number
    readonly crc: number
}
export interface VerifiedPack {
    readonly manifest: PackManifest
    /** One accepted judgement per applied area: `result.ok` is true, so `resources` is complete. */
    readonly sheets: Readonly<Record<AppliedArea, AreaSheetJudgement>>
    /** Area names of the skipped `<area>.css` sheets, sorted (never judged, kept in the archive). */
    readonly skippedAreas: readonly string[]
    /** Every font and image entry, by exact entry name. */
    readonly files: ReadonlyMap<string, VerifiedFile>
    /** Declared uncompressed total of every entry. */
    readonly totalBytes: number
    readonly size: PackSizeVerdict
    /** The directory the checks read; `readVerifiedFile` uses it with the same source. */
    readonly directory: ZipIndex
}
export type IntakeResult = { ok: true; pack: VerifiedPack } | { ok: false; refusals: readonly IntakeRefusal[] }
export type VerifiedFileRead = { ok: true; bytes: Uint8Array; mime: PackFileMime } | { ok: false; refusal: IntakeRefusal }

const MANIFEST_MAX_BYTES = 64 * 1024
const SHEET_MAX_BYTES = 1024 * 1024
const FILE_MAX_BYTES = 64 * 1024 * 1024
const FLAGS_REFUSED = 0x0001 | 0x0040 | 0x2000
const SLASH = 0x2F

const SHEET_PATTERN = /^([a-z][a-z0-9-]{0,31})\.css$/
const FONT_PATTERN = /^fonts\/[A-Za-z0-9._-]+\.(woff2|woff|ttf|otf)$/
const IMAGE_PATTERN = /^images\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|gif|webp|avif)$/
const LICENSE_TEXT_PATTERN = /^(?:(?:fonts|images)\/)?[A-Za-z0-9._-]+\.(?:txt|md)$/

/** UTF-8 with fatal errors; one leading BOM is dropped (the decoder default). Null when the bytes are not UTF-8. */
export function decodeSheet(bytes: Uint8Array): string | null {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

/** Refusals in the order found, each (code, subject) pair once. */
class RefusalList {
    readonly list: IntakeRefusal[] = []
    private readonly seen = new Set<string>()

    add(refusal: IntakeRefusal): void {
        const key = JSON.stringify(refusal)
        if (!this.seen.has(key)) {
            this.seen.add(key)
            this.list.push(refusal)
        }
    }

    get size(): number {
        return this.list.length
    }
}

function refuse(refusals: readonly IntakeRefusal[]): IntakeResult {
    return { ok: false, refusals }
}

function couldNotCheck(): IntakeResult {
    return refuse([{ code: 'couldNotCheck' }])
}

function tailRefusal(code: ZipTailRefusal): IntakeRefusal {
    switch (code) {
        case 'packTooLarge': return { code, limitBytes: PACK_MAX_UNPACKED_BYTES }
        case 'tooManyFiles': return { code, limit: PACK_MAX_ENTRIES }
        default: return { code }
    }
}

/** The refusal a reader finding stands for; null for a name finding, which the name rule judges itself. */
function refusalOfFinding(finding: ContainerFinding): IntakeRefusal | null {
    const name = finding.name ?? ''
    switch (finding.code) {
        case 'flags': return { code: 'encrypted', name }
        case 'method': return { code: 'compression', name }
        case 'duplicate': return { code: 'duplicateName', name }
        case 'name': return null
        case 'zip64-extra': return { code: 'zip64' }
        default: return { code: 'damaged', name: finding.name }
    }
}

function isSafeName(bytes: Uint8Array): boolean {
    if (checkEntryPath(bytes) !== null) {
        return false
    }
    for (const byte of bytes) {
        const allowed = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
            || byte === 0x2E || byte === 0x5F || byte === SLASH || byte === 0x2D
        if (!allowed) {
            return false
        }
    }
    return true
}

function asciiLower(name: string): string {
    return name.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

function extensionOf(name: string): string {
    return name.slice(name.lastIndexOf('.') + 1)
}

function sizeLimitOf(name: string): number {
    if (name === 'manifest.json') return MANIFEST_MAX_BYTES
    if (!name.includes('/') && name.endsWith('.css')) return SHEET_MAX_BYTES
    return FILE_MAX_BYTES
}

type EntryClass =
    | { kind: 'ignored' }
    | { kind: 'manifest' }
    | { kind: 'sheet'; area: string }
    | { kind: 'font' | 'image'; mime: PackFileMime }
    | { kind: 'licenseText' }
    | { kind: 'svg' }
    | { kind: 'unknown' }

function classifyName(name: string): EntryClass {
    const lastSegment = name.endsWith('/') ? name : name.slice(name.lastIndexOf('/') + 1)
    if (name === '__MACOSX/' || name.startsWith('__MACOSX/') || lastSegment === '.DS_Store') return { kind: 'ignored' }
    if (name === 'fonts/' || name === 'images/') return { kind: 'ignored' }
    if (name.endsWith('/')) return { kind: 'unknown' }
    if (asciiLower(name).endsWith('.svg')) return { kind: 'svg' }
    if (name === 'manifest.json') return { kind: 'manifest' }
    const sheet = SHEET_PATTERN.exec(name)
    if (sheet) return { kind: 'sheet', area: sheet[1] }
    if (FONT_PATTERN.test(name) || IMAGE_PATTERN.test(name)) {
        const mime = mimeOfExtension(extensionOf(name))
        return mime === null ? { kind: 'unknown' } : { kind: kindOfMime(mime), mime }
    }
    if (LICENSE_TEXT_PATTERN.test(name)) return { kind: 'licenseText' }
    return { kind: 'unknown' }
}

/** The refusal a failed entry read stands for. */
function refusalOfRead(finding: ContainerFinding): IntakeRefusal {
    return refusalOfFinding(finding) ?? { code: 'damaged', name: finding.name }
}

type Whole = { ok: true; bytes: Uint8Array } | { ok: false; refusal: IntakeRefusal }

async function readWhole(source: RangeSource, index: ZipIndex, i: number): Promise<Whole> {
    const size = index.entry(i).uncompressedSize
    const bytes = new Uint8Array(size)
    let at = 0
    const sink: BodySink = (chunk) => {
        bytes.set(chunk, at)
        at += chunk.length
    }
    const read = await readEntry(source, index, i, sink)
    return read.ok === false ? { ok: false, refusal: refusalOfRead(read.finding) } : { ok: true, bytes }
}

/** Reads one entry keeping only its first SNIFF_BYTES bytes. */
async function readHead(source: RangeSource, index: ZipIndex, i: number): Promise<{ ok: true; head: Uint8Array } | { ok: false; refusal: IntakeRefusal }> {
    const head = new Uint8Array(SNIFF_BYTES)
    let got = 0
    const sink: BodySink = (chunk) => {
        if (got < SNIFF_BYTES) {
            const take = Math.min(SNIFF_BYTES - got, chunk.length)
            head.set(chunk.subarray(0, take), got)
            got += take
        }
    }
    const read = await readEntry(source, index, i, sink)
    return read.ok === false ? { ok: false, refusal: refusalOfRead(read.finding) } : { ok: true, head: head.subarray(0, got) }
}

async function readDiscarding(source: RangeSource, index: ZipIndex, i: number): Promise<IntakeRefusal | null> {
    const read = await readEntry(source, index, i, () => undefined)
    return read.ok === false ? { code: 'damaged', name: read.finding.name } : null
}

export async function intakePack(source: RangeSource, judge: PackJudge): Promise<IntakeResult> {
    try {
        return await runIntake(source, judge)
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return couldNotCheck()
        }
        throw error
    }
}

/** The same check over bytes already in memory (install after a whole read, apply over stored bytes). */
export async function intakePackBytes(bytes: Uint8Array, judge: PackJudge): Promise<IntakeResult> {
    return intakePack(rangeSourceFrom({ size: bytes.length, read: async (start, end) => bytes.subarray(start, end) }), judge)
}

async function runIntake(source: RangeSource, judge: PackJudge): Promise<IntakeResult> {
    // Step 0: file size and end record.
    const tail = await peekZipTail(source)
    if (tail.ok === false) {
        return refuse([tailRefusal(tail.code)])
    }

    // Step 1: the directory.
    const walk = await readDirectory(source)
    const index = walk.index
    const directoryRefusals = new RefusalList()
    if (index === null || !walk.complete || walk.findingsOmitted > 0) {
        directoryRefusals.add({ code: 'damaged', name: null })
    }
    for (const finding of walk.findings) {
        const refusal = refusalOfFinding(finding)
        if (refusal) directoryRefusals.add(refusal)
    }
    if (index === null) {
        return refuse(directoryRefusals.list)
    }
    for (let i = 0; i < index.count; i++) {
        const entry = index.entry(i)
        if ((entry.flags & FLAGS_REFUSED) !== 0) directoryRefusals.add({ code: 'encrypted', name: entry.name })
        if (entry.method !== 0 && entry.method !== 8) directoryRefusals.add({ code: 'compression', name: entry.name })
    }
    if (walk.complete) {
        const central = await checkCentralZip64(source, index.directoryOffset, index.directorySize, index.count)
        if (central === 'zip64') directoryRefusals.add({ code: 'zip64' })
        else if (central === 'damaged') directoryRefusals.add({ code: 'damaged', name: null })
    }
    if (directoryRefusals.size > 0) {
        return refuse(directoryRefusals.list)
    }

    // Step 2: names, every entry included.
    const nameRefusals = new RefusalList()
    const folded = new Set<string>()
    const names: string[] = []
    for (let i = 0; i < index.count; i++) {
        const bytes = index.nameBytes(i)
        const name = index.name(i)
        names.push(name)
        const isDirectory = bytes.length > 0 && bytes[bytes.length - 1] === SLASH
        const judged = isDirectory ? bytes.subarray(0, bytes.length - 1) : bytes
        if (bytes.length > PACK_ENTRY_NAME_MAX_BYTES || !isSafeName(judged)) {
            nameRefusals.add({ code: 'unsafeName', name })
            continue
        }
        const key = asciiLower(name)
        if (folded.has(key)) nameRefusals.add({ code: 'duplicateName', name })
        folded.add(key)
        if (isDirectory && index.entry(i).uncompressedSize > 0) nameRefusals.add({ code: 'damaged', name })
    }
    if (nameRefusals.size > 0) {
        return refuse(nameRefusals.list)
    }

    // Step 3: declared sizes, before any body is read.
    const sizeRefusals = new RefusalList()
    let totalBytes = 0
    for (let i = 0; i < index.count; i++) {
        const declared = index.entry(i).uncompressedSize
        totalBytes += declared
        const limit = sizeLimitOf(names[i])
        if (declared > limit) sizeRefusals.add({ code: 'fileTooLarge', name: names[i], limitBytes: limit })
    }
    if (totalBytes > PACK_MAX_UNPACKED_BYTES) {
        sizeRefusals.add({ code: 'packTooLarge', limitBytes: PACK_MAX_UNPACKED_BYTES })
    }
    if (sizeRefusals.size > 0) {
        return refuse(sizeRefusals.list)
    }

    // Step 4: the manifest, the first body read.
    const manifestAt = index.find('manifest.json')
    if (manifestAt.length === 0) {
        return refuse([{ code: 'manifestMissing' }])
    }
    const manifestBytes = await readWhole(source, index, manifestAt[0])
    if (manifestBytes.ok === false) {
        return refuse([manifestBytes.refusal])
    }
    const manifestText = decodeSheet(manifestBytes.bytes)
    if (manifestText === null) {
        return refuse([{ code: 'manifestUnreadable' }])
    }
    const parsed = parseManifest(manifestText)
    if (parsed.ok === false) {
        return refuse([parsed.refusal])
    }
    const manifest = parsed.manifest

    // Step 5: names against the fixed layout.
    const layoutRefusals = new RefusalList()
    const files = new Map<string, VerifiedFile>()
    const skippedSheets: { area: string; at: number }[] = []
    const licenseTexts: number[] = []
    let chatAt = -1
    for (let i = 0; i < index.count; i++) {
        const name = names[i]
        const entry = classifyName(name)
        switch (entry.kind) {
            case 'svg':
                layoutRefusals.add({ code: 'svg', name })
                break
            case 'unknown':
                layoutRefusals.add({ code: 'unknownFile', name })
                break
            case 'sheet':
                if (entry.area === 'chat') chatAt = i
                else skippedSheets.push({ area: entry.area, at: i })
                break
            case 'licenseText':
                licenseTexts.push(i)
                break
            case 'font':
            case 'image': {
                const declared = index.entry(i)
                files.set(name, { path: name, entryIndex: i, kind: entry.kind, mime: entry.mime, size: declared.uncompressedSize, crc: declared.crc })
                break
            }
            default:
                break
        }
    }
    if (chatAt < 0) {
        layoutRefusals.add({ code: 'noArea' })
    }
    const licensesOf = new Map<string, number>()
    for (const font of manifest.fonts) {
        licensesOf.set(font.file, (licensesOf.get(font.file) ?? 0) + 1)
        if (files.get(font.file)?.kind !== 'font') layoutRefusals.add({ code: 'licenseWithoutFont', file: font.file })
    }
    for (const file of files.values()) {
        if (file.kind === 'font' && licensesOf.get(file.path) !== 1) layoutRefusals.add({ code: 'fontLicense', file: file.path })
    }
    if (layoutRefusals.size > 0) {
        return refuse(layoutRefusals.list)
    }

    // Step 6: the applied sheet.
    const chatBytes = await readWhole(source, index, chatAt)
    if (chatBytes.ok === false) {
        return refuse([chatBytes.refusal])
    }
    const chatText = decodeSheet(chatBytes.bytes)
    if (chatText === null) {
        return refuse([{ code: 'notUtf8', name: 'chat.css' }])
    }

    // Step 7: the judge sees the applied-area sheets only.
    let judgement: PackSheetsJudgement
    try {
        judgement = await judge({ chat: chatText })
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack judge failed', error)
        }
        return couldNotCheck()
    }
    const chat = judgement?.areas?.chat
    if (!chat || typeof chat.result?.ok !== 'boolean') {
        return couldNotCheck()
    }
    if (!chat.result.ok) {
        return refuse([{ code: 'sheetRefused', sheet: 'chat.css', errors: chat.result.errors }])
    }

    // Step 8: every resource the accepted sheet names is an entry of the kind its context needs.
    const targetRefusals = new RefusalList()
    for (const span of chat.resources) {
        const inFontFace = chat.fontFaceBlocks.some((block) => block.start <= span.start && span.end <= block.end)
        const file = files.get(span.raw)
        if (file && file.kind === (inFontFace ? 'font' : 'image')) {
            continue
        }
        if (index.find(span.raw).length > 0) targetRefusals.add({ code: 'wrongKind', sheet: 'chat.css', target: span.raw })
        else targetRefusals.add({ code: 'target', sheet: 'chat.css', target: span.raw })
    }
    if (targetRefusals.size > 0) {
        return refuse(targetRefusals.list)
    }

    // Step 9: bodies of everything the pack keeps.
    const bodyRefusals = new RefusalList()
    for (const file of files.values()) {
        const read = await readHead(source, index, file.entryIndex)
        if (read.ok === false) {
            bodyRefusals.add(read.refusal)
        } else if (sniffPackFile(read.head) !== file.mime) {
            bodyRefusals.add({ code: 'wrongContent', name: file.path })
        }
    }
    for (const at of [...licenseTexts, ...skippedSheets.map((sheet) => sheet.at)]) {
        const refusal = await readDiscarding(source, index, at)
        if (refusal) bodyRefusals.add(refusal)
    }
    if (bodyRefusals.size > 0) {
        return refuse(bodyRefusals.list)
    }

    return {
        ok: true,
        pack: {
            manifest,
            sheets: { chat },
            skippedAreas: skippedSheets.map((sheet) => sheet.area).sort(),
            files,
            totalBytes,
            size: packSizeWarning(totalBytes),
            directory: index,
        },
    }
}

/** Pass 2: re-reads one font or image of an accepted pack from the same source; CRC, size and sniff must equal pass 1. */
export async function readVerifiedFile(source: RangeSource, pack: VerifiedPack, path: string): Promise<VerifiedFileRead> {
    const file = pack.files.get(path)
    if (!file) {
        return { ok: false, refusal: { code: 'damaged', name: path } }
    }
    try {
        const whole = await readWhole(source, pack.directory, file.entryIndex)
        if (whole.ok === false) {
            return { ok: false, refusal: whole.refusal }
        }
        if (whole.bytes.length !== file.size || sniffPackFile(whole.bytes.subarray(0, SNIFF_BYTES)) !== file.mime) {
            return { ok: false, refusal: { code: 'wrongContent', name: path } }
        }
        return { ok: true, bytes: whole.bytes, mime: file.mime }
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            return { ok: false, refusal: { code: 'couldNotCheck' } }
        }
        throw error
    }
}
