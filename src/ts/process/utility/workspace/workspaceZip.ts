import { Inflate, zipSync } from 'fflate'
import { normalizeWorkspacePath, workspacePathKey } from './paths'
import { decodeWorkspaceBytes } from './textGuard'
import {
    commitWorkspaceChange, hasWorkspace, listFiles, readText, WORKSPACE_LIMITS,
    type WorkspaceChangeError, type WorkspaceEnv, type WorkspaceOp,
} from './workspaceModel.svelte'

/**
 * Zip import and export for workspaces (MC-3372, MC-3373, MC-3410, MC-3411). The archive is untrusted input: the parser reads
 * the central directory itself, never trusts a declared size, bounds every inflate by the bytes it actually produces, and
 * hands each name to the same path rules every workspace write meets. Nothing here touches a file picker or the UI.
 */

/** Unpacked bytes one zip import may produce, counted while inflating and before any workspace cap (MC-3414). */
export const ZIP_UNPACKED_LIMIT = 100 * 1024 * 1024
/** Entries (files and directories) one archive may list; the central directory is read in full, so this bounds that work. */
export const ZIP_ENTRY_LIMIT = 10000

/** The compressed input is fed to the inflater in slices this size so one slice can only expand to a bounded amount. */
const INFLATE_SLICE = 1024

export type ZipEntryRefusal =
    | 'bad-name'
    | 'encrypted'
    | 'unsupported-method'
    | 'symlink'
    | 'damaged'
    | 'too-large'
    | 'binary'
    | 'duplicate'
    | 'case-collision'
    | 'collides-with-existing'

export interface ZipRefusedEntry {
    /** The entry name as the archive wrote it (decoded when possible, otherwise a placeholder). */
    name: string
    reason: ZipEntryRefusal
    detail: string
}

export interface ZipAcceptedFile {
    path: string
    text: string
    size: number
}

export type ZipArchiveRefusal = 'not-a-zip' | 'zip64' | 'too-many-entries' | 'unpacked-too-large' | 'damaged'

export type ZipImportPlan =
    | {
        ok: true
        accepted: ZipAcceptedFile[]
        refused: ZipRefusedEntry[]
        /** Accepted paths that already exist in the workspace under exactly that spelling. */
        collisions: string[]
        unpackedBytes: number
    }
    | { ok: false, reason: ZipArchiveRefusal, detail: string }

interface CentralEntry {
    nameBytes: Uint8Array
    flags: number
    method: number
    compressedSize: number
    declaredSize: number
    localOffset: number
    madeBy: number
    externalAttrs: number
    crc: number
}

class ArchiveRefusal extends Error {
    constructor(readonly reason: ZipArchiveRefusal, detail: string) {
        super(detail)
    }
}

class EntryTooLarge extends Error {}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff

function findEndRecord(view: DataView, length: number): number {
    if (length < EOCD_SIZE) {
        return -1
    }
    const lowest = Math.max(0, length - EOCD_SIZE - MAX_COMMENT)
    for (let at = length - EOCD_SIZE; at >= lowest; at--) {
        if (view.getUint32(at, true) === SIG_EOCD && at + EOCD_SIZE + view.getUint16(at + 20, true) <= length) {
            return at
        }
    }
    return -1
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const end = findEndRecord(view, bytes.length)
    if (end === -1) {
        throw new ArchiveRefusal('not-a-zip', 'No zip end record was found.')
    }
    const diskNumber = view.getUint16(end + 4, true)
    const directoryDisk = view.getUint16(end + 6, true)
    const count = view.getUint16(end + 10, true)
    const directorySize = view.getUint32(end + 12, true)
    const directoryOffset = view.getUint32(end + 16, true)
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
        throw new ArchiveRefusal('zip64', 'Zip64 archives are not supported.')
    }
    if (diskNumber !== 0 || directoryDisk !== 0) {
        throw new ArchiveRefusal('damaged', 'Multi-part archives are not supported.')
    }
    if (count > ZIP_ENTRY_LIMIT) {
        throw new ArchiveRefusal('too-many-entries', `The archive lists ${count} entries; at most ${ZIP_ENTRY_LIMIT} are read.`)
    }
    if (directoryOffset + directorySize > end) {
        throw new ArchiveRefusal('damaged', 'The central directory lies outside the archive.')
    }
    const entries: CentralEntry[] = []
    let at = directoryOffset
    for (let index = 0; index < count; index++) {
        if (at + 46 > end || view.getUint32(at, true) !== SIG_CENTRAL) {
            throw new ArchiveRefusal('damaged', 'The central directory is damaged.')
        }
        const nameLength = view.getUint16(at + 28, true)
        const extraLength = view.getUint16(at + 30, true)
        const commentLength = view.getUint16(at + 32, true)
        const next = at + 46 + nameLength + extraLength + commentLength
        if (next > end) {
            throw new ArchiveRefusal('damaged', 'The central directory is damaged.')
        }
        entries.push({
            madeBy: view.getUint16(at + 4, true),
            flags: view.getUint16(at + 8, true),
            method: view.getUint16(at + 10, true),
            crc: view.getUint32(at + 16, true),
            compressedSize: view.getUint32(at + 20, true),
            declaredSize: view.getUint32(at + 24, true),
            externalAttrs: view.getUint32(at + 38, true),
            localOffset: view.getUint32(at + 42, true),
            nameBytes: bytes.subarray(at + 46, at + 46 + nameLength),
        })
        at = next
    }
    return entries
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) {
            return false
        }
    }
    return true
}

/** The compressed data of an entry, located through its local header and checked against the central record. */
function locateData(bytes: Uint8Array, entry: CentralEntry): Uint8Array | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const at = entry.localOffset
    if (at + 30 > bytes.length || view.getUint32(at, true) !== SIG_LOCAL) {
        return undefined
    }
    const nameLength = view.getUint16(at + 26, true)
    const extraLength = view.getUint16(at + 28, true)
    const nameStart = at + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > bytes.length || !sameBytes(bytes.subarray(nameStart, nameStart + nameLength), entry.nameBytes)) {
        return undefined
    }
    return bytes.subarray(dataStart, dataEnd)
}

const UNIX_HOST = 3
const S_IFMT = 0xf000
const S_IFLNK = 0xa000

function isSymlink(entry: CentralEntry): boolean {
    return (entry.madeBy >> 8) === UNIX_HOST && ((entry.externalAttrs >>> 16) & S_IFMT) === S_IFLNK
}

/** One running count for the archive; every inflated byte is added, including those of an entry later refused. */
class UnpackBudget {
    used = 0
    add(count: number): void {
        this.used += count
        if (this.used > ZIP_UNPACKED_LIMIT) {
            throw new ArchiveRefusal('unpacked-too-large', `The archive unpacks past ${ZIP_UNPACKED_LIMIT} bytes.`)
        }
    }
}

/** Inflates `data` while counting what it actually produces; stops at once when the entry passes the file cap. */
function inflateBounded(data: Uint8Array, budget: UnpackBudget): Uint8Array {
    const chunks: Uint8Array[] = []
    let produced = 0
    const inflater = new Inflate()
    inflater.ondata = (chunk: Uint8Array) => {
        budget.add(chunk.length)
        produced += chunk.length
        if (produced > WORKSPACE_LIMITS.fileBytes) {
            throw new EntryTooLarge()
        }
        chunks.push(chunk)
    }
    for (let at = 0; at < data.length; at += INFLATE_SLICE) {
        inflater.push(data.subarray(at, at + INFLATE_SLICE), at + INFLATE_SLICE >= data.length)
    }
    if (data.length === 0) {
        inflater.push(new Uint8Array(0), true)
    }
    const out = new Uint8Array(produced)
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

const CRC_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let bit = 0; bit < 8; bit++) {
            c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
        }
        table[n] = c >>> 0
    }
    return table
})()

/** The zip CRC-32 (IEEE) of `bytes`; fflate's public API does not expose its own. */
export function zipCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (let index = 0; index < bytes.length; index++) {
        crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function describeName(entry: CentralEntry): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(entry.nameBytes)
    } catch {
        return `(entry with a name that is not UTF-8, ${entry.nameBytes.length} bytes)`
    }
}

/**
 * Reads an archive into what an import would write. Nothing is written. A damaged or over-limit archive is refused whole;
 * a single bad entry is listed by name with its reason and the others stay accepted (MC-3410). `existingPaths` are the
 * workspace's current paths: an equal spelling is a collision to ask about once (MC-3411), a spelling that differs only by
 * case or normalization is refused.
 */
export function planZipImport(bytes: Uint8Array, existingPaths: readonly string[]): ZipImportPlan {
    const budget = new UnpackBudget()
    const accepted: ZipAcceptedFile[] = []
    const refused: ZipRefusedEntry[] = []
    const existingByKey = new Map<string, string>()
    for (const path of existingPaths) {
        existingByKey.set(workspacePathKey(path), path)
    }
    const existing = new Set(existingPaths)
    const seen = new Map<string, string>()
    const collisions: string[] = []
    try {
        const entries = readCentralDirectory(bytes)
        for (const entry of entries) {
            let name: string
            try {
                name = new TextDecoder('utf-8', { fatal: true }).decode(entry.nameBytes)
            } catch {
                refused.push({ name: describeName(entry), reason: 'bad-name', detail: 'The entry name is not valid UTF-8.' })
                continue
            }
            if (name.endsWith('/') && entry.declaredSize === 0) {
                continue
            }
            const refuse = (reason: ZipEntryRefusal, detail: string): void => {
                refused.push({ name, reason, detail })
            }
            if (name.startsWith('/')) {
                refuse('bad-name', 'An absolute path is not allowed.')
                continue
            }
            const normalized = normalizeWorkspacePath(name)
            if (normalized.ok === false) {
                refuse('bad-name', `The path is not allowed (${normalized.reason}).`)
                continue
            }
            if ((entry.flags & 1) !== 0 || entry.method === 99) {
                refuse('encrypted', 'The entry is encrypted.')
                continue
            }
            if (entry.method !== 0 && entry.method !== 8) {
                refuse('unsupported-method', `Compression method ${entry.method} is not supported.`)
                continue
            }
            if (isSymlink(entry)) {
                refuse('symlink', 'A symbolic link is not a text file.')
                continue
            }
            const path = normalized.path
            const key = workspacePathKey(path)
            const earlier = seen.get(key)
            if (earlier !== undefined) {
                refuse(earlier === path ? 'duplicate' : 'case-collision', `The path repeats "${earlier}".`)
                continue
            }
            seen.set(key, path)
            const present = existingByKey.get(key)
            if (present !== undefined && present !== path) {
                refuse('collides-with-existing', `The path differs from the existing "${present}" only by case or normalization.`)
                continue
            }
            if (entry.declaredSize > WORKSPACE_LIMITS.fileBytes) {
                refuse('too-large', `The entry declares ${entry.declaredSize} bytes; a file holds at most ${WORKSPACE_LIMITS.fileBytes}.`)
                continue
            }
            const data = locateData(bytes, entry)
            if (data === undefined) {
                refuse('damaged', 'The entry data lies outside the archive or its header does not match.')
                continue
            }
            let content: Uint8Array
            if (entry.method === 0) {
                budget.add(data.length)
                if (data.length > WORKSPACE_LIMITS.fileBytes) {
                    refuse('too-large', `The entry holds ${data.length} bytes; a file holds at most ${WORKSPACE_LIMITS.fileBytes}.`)
                    continue
                }
                content = data
            } else {
                try {
                    content = inflateBounded(data, budget)
                } catch (error) {
                    if (error instanceof ArchiveRefusal) {
                        throw error
                    }
                    if (error instanceof EntryTooLarge) {
                        refuse('too-large', `The entry unpacks past ${WORKSPACE_LIMITS.fileBytes} bytes.`)
                    } else {
                        refuse('damaged', 'The entry data cannot be inflated.')
                    }
                    continue
                }
            }
            // The stored checksum must match what the entry actually produced, so a flipped byte that still decodes as
            // text is refused instead of imported as altered content.
            if (zipCrc32(content) !== entry.crc) {
                refuse('damaged', 'The entry data does not match its checksum.')
                continue
            }
            const decoded = decodeWorkspaceBytes(content)
            if (decoded.ok === false) {
                refuse('binary', 'Only text files are accepted.')
                continue
            }
            accepted.push({ path, text: decoded.text, size: new TextEncoder().encode(decoded.text).length })
            if (existing.has(path)) {
                collisions.push(path)
            }
        }
    } catch (error) {
        if (error instanceof ArchiveRefusal) {
            return { ok: false, reason: error.reason, detail: error.message }
        }
        throw error
    }
    return { ok: true, accepted, refused, collisions, unpackedBytes: budget.used }
}

export type CollisionChoice = 'replace' | 'keep' | 'cancel'

export interface ZipImportApplied {
    ok: true
    written: string[]
    /** Existing files left alone because the user chose to keep them. */
    keptExisting: string[]
    refused: ZipRefusedEntry[]
}

export type ZipImportResult =
    | ZipImportApplied
    | { ok: false, reason: 'no-workspace', detail: string }
    | { ok: false, reason: 'archive', archive: ZipArchiveRefusal, detail: string }
    | { ok: false, reason: 'cancelled' }
    | { ok: false, reason: 'changed', detail: string }
    | { ok: false, reason: 'caps', error: WorkspaceChangeError, refused: ZipRefusedEntry[] }

/**
 * Imports `bytes` into a workspace. `askCollision` is called at most once, only when an accepted path already exists, and
 * answers for every such path (MC-3411); `cancel` writes nothing. The accepted files are committed as one change, so a cap
 * overrun refuses the whole import and leaves the workspace untouched (MC-3410).
 */
export async function importZipIntoWorkspace(
    workspaceId: string,
    bytes: Uint8Array,
    askCollision: (collisions: readonly string[]) => Promise<CollisionChoice>,
    env?: WorkspaceEnv,
): Promise<ZipImportResult> {
    if (!hasWorkspace(workspaceId)) {
        return { ok: false, reason: 'no-workspace', detail: 'The workspace does not exist.' }
    }
    const plan = planZipImport(bytes, listFiles(workspaceId).map(file => file.path))
    if (plan.ok === false) {
        return { ok: false, reason: 'archive', archive: plan.reason, detail: plan.detail }
    }
    let choice: CollisionChoice = 'replace'
    let current = plan
    if (plan.collisions.length > 0) {
        choice = await askCollision(plan.collisions)
        if (choice === 'cancel') {
            return { ok: false, reason: 'cancelled' }
        }
        // The workspace can change while the question is open. Plan again against what it holds now, and refuse when a
        // path the user was never asked about has appeared: only the asked paths may be replaced or kept.
        if (!hasWorkspace(workspaceId)) {
            return { ok: false, reason: 'no-workspace', detail: 'The workspace does not exist.' }
        }
        const replanned = planZipImport(bytes, listFiles(workspaceId).map(file => file.path))
        if (replanned.ok === false) {
            return { ok: false, reason: 'archive', archive: replanned.reason, detail: replanned.detail }
        }
        const asked = new Set(plan.collisions)
        if (replanned.collisions.some(path => !asked.has(path))) {
            return { ok: false, reason: 'changed', detail: 'The workspace changed while the question was open. Nothing was imported.' }
        }
        current = replanned
    }
    const colliding = new Set(current.collisions)
    const keptExisting = choice === 'keep' ? current.collisions : []
    const writes = current.accepted.filter(file => !(choice === 'keep' && colliding.has(file.path)))
    if (writes.length > 0) {
        const ops: WorkspaceOp[] = writes.map(file => ({ kind: 'write', path: file.path, text: file.text }))
        const result = commitWorkspaceChange(workspaceId, ops, env)
        if (result.ok === false) {
            return { ok: false, reason: 'caps', error: result.error, refused: current.refused }
        }
    }
    return { ok: true, written: writes.map(file => file.path), keptExisting, refused: current.refused }
}

export type ZipExportResult =
    | { ok: true, bytes: Uint8Array, files: number, omitted: string[] }
    | { ok: false, reason: 'no-workspace' | 'damaged', paths: string[] }

/**
 * A zip of the workspace's text files. A file whose text could not be read at boot would leave the archive silently
 * incomplete, so the export refuses naming those paths unless the caller passes `omitDamaged` after telling the user.
 */
export function exportWorkspaceZip(workspaceId: string, options: { omitDamaged?: boolean } = {}): ZipExportResult {
    if (!hasWorkspace(workspaceId)) {
        return { ok: false, reason: 'no-workspace', paths: [] }
    }
    const encoder = new TextEncoder()
    const entries: Record<string, Uint8Array> = {}
    const omitted: string[] = []
    for (const file of listFiles(workspaceId)) {
        const read = readText(workspaceId, file.path)
        if (read.state === 'ok') {
            entries[file.path] = encoder.encode(read.text)
        } else {
            omitted.push(file.path)
        }
    }
    if (omitted.length > 0 && options.omitDamaged !== true) {
        return { ok: false, reason: 'damaged', paths: omitted }
    }
    return { ok: true, bytes: zipSync(entries), files: Object.keys(entries).length, omitted }
}
