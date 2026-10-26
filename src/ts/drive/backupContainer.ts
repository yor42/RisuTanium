/**
 * Parsing for the flat container format `LoadLocalBackup` and
 * `SaveLocalBackup` share (`src/ts/drive/backuplocal.ts`): a sequence of
 * `[u32 nameLength][name][u32 dataLength][data]` entries, all integers
 * unsigned little-endian, with no header, trailer or entry count. Every
 * name is decoded with the platform's default `TextDecoder`, which strips a
 * leading UTF-8 byte-order mark, so a BOM-prefixed name and its bare form
 * decode to the same string.
 *
 * `LoadLocalBackup`'s pre-read walk (over windowed `Blob.slice()` reads, see
 * `indexBackupEntries`) and its restore pass (which re-reads each indexed
 * entry through its own `BlobWindowReader`) both resolve every header through
 * `parseBackupEntryHeader`, which parses any given bytes the same way for
 * either caller: given the same bytes, the two agree on where one entry
 * ends and the next begins, and on what an entry is named. What each pass
 * sees can still diverge if the file changes between the two reads.
 *
 * Binding rule: whenever a COMPLETE entry name decodes to exactly
 * `BACKUP_ENCRYPTION_MARKER_NAME`, that counts as the marker, whatever
 * follows it -- an incomplete, cut-off, or out-of-range data-length field or
 * body never excuses a caller from treating it as a match. Because
 * `parseBackupEntryHeader` only decodes a name into `header.name` once the
 * data-length field is also present, a caller that needs this rule for a
 * name that resolved but whose data-length field did not must decode that
 * name itself with `decodeEntryName`, using the `nameLength` an
 * `'incomplete'`, `stage:'dataLength'`, `nameSkipped:false` result already
 * carries; both `indexBackupEntries` and `LoadLocalBackup`'s restore pass do
 * exactly that.
 *
 * This module has no side effects and imports nothing from the app: it
 * only reads the bytes it is given, or the bytes a `Blob` it is given
 * hands back.
 */

/** The entry name that only an account-sync-encrypted backup carries; MC-081 refuses any backup that has one, wherever it sits and whatever it contains. */
export const BACKUP_ENCRYPTION_MARKER_NAME = 'encryption.risudat'

/**
 * Every character in `BACKUP_ENCRYPTION_MARKER_NAME` is ASCII, so the only
 * byte sequences that decode to it are its own 18-byte UTF-8 encoding, or
 * that encoding prefixed with a 3-byte UTF-8 byte-order mark (21 bytes):
 * `TextDecoder` strips a leading BOM, but does not turn any other
 * multi-byte or overlong encoding into plain ASCII. A name longer than this
 * can never match it, so a caller only checking for this one marker never
 * needs to decode or buffer a longer name in full.
 */
export const MAX_MARKER_NAME_BYTES = 21

/**
 * Default window size, in bytes, of the header walk (`indexBackupEntries`,
 * pass 1) and of the copy pass that follows it (pass 2). Each pass reads the
 * file in large sequential windows, so a small entry costs no read of its
 * own: the number of `Blob.slice()` calls follows the file size over the
 * window, not the entry count. Tests shrink both (via
 * `BackupWalkOptions.windowBytes` and `overrideBackupWindowBytes`) to force
 * entries across window edges instead of relying on real file sizes.
 */
export const DEFAULT_BACKUP_WALK_WINDOW_BYTES = 4 * 1024 * 1024

/** Default window size of the copy pass (pass 2); see `DEFAULT_BACKUP_WALK_WINDOW_BYTES`. */
export const DEFAULT_BACKUP_COPY_WINDOW_BYTES = 4 * 1024 * 1024

const windowOverride: { walk: number | null, copy: number | null } = { walk: null, copy: null }

/**
 * Test seam: replaces the window sizes of both passes until called again with
 * `null`. A pass keeps the size it started with, so a change applies from the
 * next import.
 */
export function overrideBackupWindowBytes(sizes: { walk?: number, copy?: number } | null): void {
    windowOverride.walk = sizes?.walk ?? null
    windowOverride.copy = sizes?.copy ?? null
}

/** The window size pass 2 (the copy) reads in. */
export function backupCopyWindowBytes(): number {
    return Math.max(1, windowOverride.copy ?? DEFAULT_BACKUP_COPY_WINDOW_BYTES)
}

/** The longest entry name, in bytes, the index keeps in every import (`database.risudat`, a cold-storage unit); a longer name is kept only for an oversized body. The walk itself decodes names up to `BACKUP_NAME_PREFIX_BYTES`. */
export const BACKUP_INDEX_SHORT_NAME_BYTES = 64

/** The longest name the walk decodes; a longer name is never read into a string, except for its first this-many bytes when its body is oversized. */
export const BACKUP_NAME_PREFIX_BYTES = 1024

/** Bytes of a header with the longest decoded name: both length fields and the name. */
const HEADER_PROBE_BYTES = 4 + BACKUP_NAME_PREFIX_BYTES + 4

export interface BackupEntryHeader {
    /** Entry name, or `undefined` when it was longer than the call's `maxNameBytesToDecode` and was therefore never decoded. */
    name: string | undefined
    nameLength: number
    dataLength: number
    /** Bytes from the entry's start to the start of its data body: `4 + nameLength + 4`. */
    headerLength: number
}

export type BackupHeaderParseResult =
    | { status: 'ok'; header: BackupEntryHeader }
    | { status: 'incomplete'; stage: 'nameLength'; need: number }
    | { status: 'incomplete'; stage: 'name'; need: number; nameLength: number }
    | { status: 'incomplete'; stage: 'dataLength'; need: number; nameLength: number; nameSkipped: boolean }

function readUint32LE(buffer: Uint8Array, byteOffset: number): number {
    return new DataView(buffer.buffer, buffer.byteOffset + byteOffset, 4).getUint32(0, true)
}

/**
 * Decodes the name of the entry starting at `buffer`'s first byte, given the
 * `nameLength` a prior `parseBackupEntryHeader(buffer, ...)` call already
 * read from those same bytes. `buffer` must hold at least `4 + nameLength`
 * bytes, which only an `'incomplete'`, `stage:'dataLength'`,
 * `nameSkipped:false` result guarantees -- that is the one case where the
 * data-length field, not the name, is what such a result is missing. A
 * `nameSkipped:true` result does not guarantee the name bytes are present.
 */
export function decodeEntryName(buffer: Uint8Array, nameLength: number): string {
    return new TextDecoder().decode(buffer.subarray(4, 4 + nameLength))
}

/**
 * Parses one entry header starting at `buffer`'s first byte; `buffer` must
 * begin exactly at an entry boundary, and bytes beyond the header are
 * ignored. Every length is read unsigned little-endian. A name at most
 * `maxNameBytesToDecode` bytes long is decoded into `header.name` once its
 * data-length field is also present; a longer one is reported with
 * `nameSkipped: true` and `header.name: undefined` -- its bytes are never
 * read into a string, so a caller that only needs to test for one short
 * marker name never buffers an attacker- or corruption-supplied giant one.
 *
 * Returns `{status:'incomplete', ...}` whenever `buffer` does not yet
 * contain enough bytes to resolve the header. This is not itself an error:
 * a caller with more bytes available (a bigger window, or a later stream
 * chunk) should retry with them; a caller that has reached the real end of
 * the data with the header still incomplete is looking at the file's last,
 * truncated entry. An `'incomplete'`, `stage:'dataLength'`, `nameSkipped:
 * false` result is the one case where the name itself is already fully
 * present in `buffer` -- see `decodeEntryName` and the binding rule above.
 */
export function parseBackupEntryHeader(
    buffer: Uint8Array,
    maxNameBytesToDecode: number = Number.POSITIVE_INFINITY
): BackupHeaderParseResult {
    if (buffer.length < 4) {
        return { status: 'incomplete', stage: 'nameLength', need: 4 }
    }
    const nameLength = readUint32LE(buffer, 0)
    const nameEnd = 4 + nameLength
    const dataLengthEnd = nameEnd + 4

    if (nameLength > maxNameBytesToDecode) {
        if (buffer.length < dataLengthEnd) {
            return { status: 'incomplete', stage: 'dataLength', need: dataLengthEnd, nameLength, nameSkipped: true }
        }
        const dataLength = readUint32LE(buffer, nameEnd)
        return { status: 'ok', header: { name: undefined, nameLength, dataLength, headerLength: dataLengthEnd } }
    }

    if (buffer.length < nameEnd) {
        return { status: 'incomplete', stage: 'name', need: nameEnd, nameLength }
    }
    if (buffer.length < dataLengthEnd) {
        return { status: 'incomplete', stage: 'dataLength', need: dataLengthEnd, nameLength, nameSkipped: false }
    }
    const name = new TextDecoder().decode(buffer.subarray(4, nameEnd))
    const dataLength = readUint32LE(buffer, nameEnd)
    return { status: 'ok', header: { name, nameLength, dataLength, headerLength: dataLengthEnd } }
}

/**
 * A read inside the file's own size delivered fewer bytes than it asked for.
 * That is a changed or unreadable file, not a truncated tail: a file really
 * cut off has a size that ends with it, so its reads are never short. The
 * message carries the figures for the console only.
 */
export class BackupShortReadError extends Error {
    readonly position: number
    readonly requested: number
    readonly received: number
    readonly totalBytes: number

    constructor(position: number, requested: number, received: number, totalBytes: number) {
        super(`Backup read at ${position} returned ${received} of ${requested} bytes (file size ${totalBytes})`)
        this.name = 'BackupShortReadError'
        this.position = position
        this.requested = requested
        this.received = received
        this.totalBytes = totalBytes
    }
}

export interface BackupWalkOptions {
    /** Window size, in bytes, of the walk's sequential reads; a header larger than the window is read exactly. */
    windowBytes?: number
    /** Invoked with the number of bytes scanned so far and the file's total size, once per entry boundary the walk resolves. */
    onProgress?: (scannedBytes: number, totalBytes: number) => void
    /**
     * When set, an entry whose body is larger than this keeps its name in
     * `BackupWalkResult.names` whatever the name's length (the first
     * `BACKUP_NAME_PREFIX_BYTES` bytes of a longer one), so the Node server's
     * oversize question can name it without another read.
     */
    oversizeBodyBytes?: number
}

/**
 * Where one complete entry sits in the file, as the walk saw it. A restore
 * reads `[headerOffset, headerOffset + headerLength + dataLength)` to get the
 * entry and compares what it parses there with these figures.
 */
export interface BackupIndexEntry {
    headerOffset: number
    nameLength: number
    dataLength: number
    headerLength: number
}

export interface BackupWalkResult {
    /** `true` as soon as a complete entry name decodes to `BACKUP_ENCRYPTION_MARKER_NAME`; `entries` is then empty. */
    hasMarker: boolean
    /** Every entry whose header and whole body fit in the file, in file order. A truncated trailing entry is not listed. */
    entries: BackupIndexEntry[]
    /**
     * Decoded names by `headerOffset`: every entry whose name is at most
     * `BACKUP_INDEX_SHORT_NAME_BYTES` long, plus (when `oversizeBodyBytes` was
     * given) every entry whose body is larger than that. Other entries are not
     * listed; asset names (66 bytes and up) are never held for 383k entries.
     */
    names: Map<number, string>
}

/**
 * A sequential reader over `Blob.slice()`: one window of at most
 * `windowBytes` is held, and `view` answers from it while the requested range
 * lies inside. A reader never pools or reuses an `ArrayBuffer` across
 * windows, and each pass constructs its own, so bytes one pass read are never
 * what the next pass compares against the file.
 */
export interface BlobWindowReader {
    /**
     * The bytes of `[start, start + length)`, clamped to the file's size (a
     * request past the end is the caller's end of file, not a change). The
     * result is shorter than the clamped request only when the file delivered
     * fewer bytes than its size promised, which a caller must treat as a
     * changed file (`indexBackupEntries` throws when the short read leaves
     * what it needs unresolved). A range inside the window is a view of it; a miss reads a
     * new window starting at `start` (`fill`, the default) or, for a range
     * larger than a window or when `fill` is false, reads exactly the range
     * and leaves the held window alone. An exception from the read
     * propagates.
     */
    view(start: number, length: number, fill?: boolean): Promise<Uint8Array>
}

export function createBlobWindowReader(file: Blob, windowBytes: number): BlobWindowReader {
    const size = file.size
    const window = Math.max(1, Math.floor(windowBytes))
    let windowStart = 0
    let windowData = new Uint8Array(0)
    return {
        async view(start, length, fill = true) {
            const end = Math.min(start + length, size)
            if (end <= start) {
                return new Uint8Array(0)
            }
            if (start >= windowStart && end <= windowStart + windowData.length) {
                return windowData.subarray(start - windowStart, end - windowStart)
            }
            const wanted = end - start
            if (!fill || wanted > window) {
                return new Uint8Array(await file.slice(start, end).arrayBuffer())
            }
            const bytes = new Uint8Array(await file.slice(start, Math.min(start + window, size)).arrayBuffer())
            windowStart = start
            windowData = bytes
            return bytes.subarray(0, Math.min(wanted, bytes.length))
        },
    }
}

/**
 * Scans `file`'s entry headers for `BACKUP_ENCRYPTION_MARKER_NAME`, reading
 * through `Blob.slice()` in large sequential windows (see
 * `BlobWindowReader`): a header, and for a small entry its body and the
 * entries that follow, come out of the window already held, so the slice
 * count follows the file size over the window. A long name's data-length
 * field is read separately, and the rest of a body that is larger than the
 * window is seeked past, not read. Whenever a complete entry name decodes to
 * exactly the marker name, this resolves `true` at once, regardless of
 * whether that entry's data length or body fits in the file.
 *
 * A header cut off by the end of the file -- fewer than 4 bytes left, a
 * name cut short, a data-length field cut short, or a body that would run
 * past the file's end -- ends the walk and resolves `false`, unless the
 * entry's name is itself complete and is the marker: a truncated trailing
 * entry resolves `false` unless its complete name is the marker, so
 * nothing further to scan remains. A truncated trailing entry is not in the
 * index, so `LoadLocalBackup` silently drops it rather than treating it as
 * corruption.
 *
 * Only a file whose own size ends mid-entry is a truncated tail. A read
 * inside that size that delivers too few bytes to resolve the header it
 * needs (or a long name's data-length field or name prefix) throws
 * `BackupShortReadError`, unless the bytes it did deliver already hold a
 * complete marker name. Body bytes are not read here; the restore's copy
 * pass checks their length.
 *
 * Any exception `file.slice(...).arrayBuffer()` throws propagates to the
 * caller uncaught: a walk that could not finish reading the file must never
 * resolve `false`, since that would be read as "no marker" and let the
 * import proceed.
 *
 * The walk also records each entry it steps over (`BackupIndexEntry`), so a
 * restore can read one entry at a time without scanning the file again.
 */
export async function indexBackupEntries(file: Blob, options: BackupWalkOptions = {}): Promise<BackupWalkResult> {
    const totalBytes = file.size
    const windowBytes = Math.max(4, options.windowBytes ?? windowOverride.walk ?? DEFAULT_BACKUP_WALK_WINDOW_BYTES)
    const reader = createBlobWindowReader(file, windowBytes)
    const oversizeBodyBytes = options.oversizeBodyBytes
    const entries: BackupIndexEntry[] = []
    const names = new Map<number, string>()
    let pos = 0

    while (pos < totalBytes) {
        let want = Math.min(windowBytes, HEADER_PROBE_BYTES)

        for (;;) {
            const remaining = totalBytes - pos
            const requested = Math.min(want, remaining)
            const buffer = await reader.view(pos, requested)
            const result = parseBackupEntryHeader(buffer, BACKUP_NAME_PREFIX_BYTES)

            if (result.status === 'ok') {
                const header = result.header
                if (header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
                    return { hasMarker: true, entries: [], names: new Map() }
                }
                const bodyEnd = pos + header.headerLength + header.dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries, names }
                }
                entries.push({
                    headerOffset: pos,
                    nameLength: header.nameLength,
                    dataLength: header.dataLength,
                    headerLength: header.headerLength,
                })
                if (header.name !== undefined
                        && (header.nameLength <= BACKUP_INDEX_SHORT_NAME_BYTES
                            || (oversizeBodyBytes !== undefined && header.dataLength > oversizeBodyBytes))) {
                    names.set(pos, header.name)
                }
                pos = bodyEnd
                options.onProgress?.(pos, totalBytes)
                break
            }

            if (result.stage === 'dataLength' && result.nameSkipped) {
                const fieldStart = pos + 4 + result.nameLength
                const fieldEnd = fieldStart + 4
                if (fieldEnd > totalBytes) {
                    return { hasMarker: false, entries, names }
                }
                const fieldBuffer = await reader.view(fieldStart, 4)
                if (fieldBuffer.length < 4) {
                    throw new BackupShortReadError(fieldStart, 4, fieldBuffer.length, totalBytes)
                }
                const dataLength = readUint32LE(fieldBuffer, 0)
                const bodyEnd = fieldEnd + dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries, names }
                }
                entries.push({ headerOffset: pos, nameLength: result.nameLength, dataLength, headerLength: 4 + result.nameLength + 4 })
                if (oversizeBodyBytes !== undefined && dataLength > oversizeBodyBytes) {
                    const namePrefix = await reader.view(pos + 4, BACKUP_NAME_PREFIX_BYTES)
                    if (namePrefix.length < BACKUP_NAME_PREFIX_BYTES) {
                        throw new BackupShortReadError(pos + 4, BACKUP_NAME_PREFIX_BYTES, namePrefix.length, totalBytes)
                    }
                    names.set(pos, new TextDecoder().decode(namePrefix))
                }
                pos = bodyEnd
                options.onProgress?.(pos, totalBytes)
                break
            }

            if (result.stage === 'dataLength' && !result.nameSkipped
                    && decodeEntryName(buffer, result.nameLength) === BACKUP_ENCRYPTION_MARKER_NAME) {
                // The name is complete and is the marker: it counts as a
                // match whether or not the data-length field that follows
                // it fits in the file.
                return { hasMarker: true, entries: [], names: new Map() }
            }

            // The marker test above runs first, so a short read that already
            // holds a complete marker name still resolves as the marker. Any
            // other short read is a file that delivered fewer bytes than its
            // own size promised, never a truncated tail.
            if (buffer.length < requested) {
                throw new BackupShortReadError(pos, requested, buffer.length, totalBytes)
            }
            // A header still incomplete at the file's real end is the
            // truncated tail: the walk ends without a marker.
            const moreAvailableBeyondWindow = requested < remaining
            if (!moreAvailableBeyondWindow) {
                return { hasMarker: false, entries, names }
            }
            want = Math.max(want * 2, result.need)
        }
    }

    return { hasMarker: false, entries, names }
}

/** `true` when `file` carries an entry whose complete name is `BACKUP_ENCRYPTION_MARKER_NAME`; see `indexBackupEntries` for the walk's rules. */
export async function findEncryptionMarkerEntry(file: Blob, options: BackupWalkOptions = {}): Promise<boolean> {
    return (await indexBackupEntries(file, options)).hasMarker
}
