/**
 * Parsing for the flat container format `LoadLocalBackup` and
 * `SaveLocalBackup` share (`src/ts/drive/backuplocal.ts`): a sequence of
 * `[u32 nameLength][name][u32 dataLength][data]` entries, all integers
 * unsigned little-endian, with no header, trailer or entry count. Every
 * name is decoded with the platform's default `TextDecoder`, which strips a
 * leading UTF-8 byte-order mark, so a BOM-prefixed name and its bare form
 * decode to the same string.
 *
 * `LoadLocalBackup`'s pre-read walk (over `Blob.slice()`, see
 * `indexBackupEntries`) and its restore pass (which re-reads each indexed
 * entry through `Blob.slice()`) both resolve every header through
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
 * Default window size, in bytes, `indexBackupEntries` reads at a
 * time. A window only ever has to hold a length field or a short candidate
 * name to resolve a header -- for a small entry, the same window can also
 * include that entry's body and the start of the entries that follow -- so
 * this stays small; tests shrink it (via `BackupWalkOptions.windowBytes`)
 * to force many small reads instead of relying on real file sizes.
 */
export const DEFAULT_BACKUP_WALK_WINDOW_BYTES = 4096

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

export interface BackupWalkOptions {
    /** Window size, in bytes, for each header read; grown only when a short candidate name plus its data-length field overruns it. */
    windowBytes?: number
    /** Invoked with the number of bytes scanned so far and the file's total size, once per entry boundary the walk resolves. */
    onProgress?: (scannedBytes: number, totalBytes: number) => void
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
}

/**
 * Scans `file`'s entry headers for `BACKUP_ENCRYPTION_MARKER_NAME`, reading
 * through `Blob.slice()` in bounded windows: one `DEFAULT_BACKUP_WALK_WINDOW_BYTES`
 * window at each entry header, plus a 4-byte read for a long name's
 * data-length field, seeking past the rest of each body. It never reads a
 * whole large body, nor the whole file at once -- though for a small entry
 * the header window can include that entry's body and the start of the
 * entries that follow. Whenever a complete entry name decodes to exactly
 * the marker name, this resolves `true` at once, regardless of whether that
 * entry's data length or body fits in the file.
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
    const initialWindowBytes = Math.max(4, options.windowBytes ?? DEFAULT_BACKUP_WALK_WINDOW_BYTES)
    const entries: BackupIndexEntry[] = []
    let pos = 0

    while (pos < totalBytes) {
        let windowBytes = initialWindowBytes

        for (;;) {
            const remaining = totalBytes - pos
            const windowLength = Math.min(windowBytes, remaining)
            const buffer = new Uint8Array(await file.slice(pos, pos + windowLength).arrayBuffer())
            const result = parseBackupEntryHeader(buffer, MAX_MARKER_NAME_BYTES)

            if (result.status === 'ok') {
                if (result.header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
                    return { hasMarker: true, entries: [] }
                }
                const bodyEnd = pos + result.header.headerLength + result.header.dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                entries.push({
                    headerOffset: pos,
                    nameLength: result.header.nameLength,
                    dataLength: result.header.dataLength,
                    headerLength: result.header.headerLength,
                })
                pos = bodyEnd
                options.onProgress?.(pos, totalBytes)
                break
            }

            if (result.stage === 'dataLength' && result.nameSkipped) {
                const fieldStart = pos + 4 + result.nameLength
                const fieldEnd = fieldStart + 4
                if (fieldEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                const fieldBuffer = new Uint8Array(await file.slice(fieldStart, fieldEnd).arrayBuffer())
                const dataLength = readUint32LE(fieldBuffer, 0)
                const bodyEnd = fieldEnd + dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                entries.push({ headerOffset: pos, nameLength: result.nameLength, dataLength, headerLength: 4 + result.nameLength + 4 })
                pos = bodyEnd
                options.onProgress?.(pos, totalBytes)
                break
            }

            if (result.stage === 'dataLength' && !result.nameSkipped
                    && decodeEntryName(buffer, result.nameLength) === BACKUP_ENCRYPTION_MARKER_NAME) {
                // The name is complete and is the marker: it counts as a
                // match whether or not the data-length field that follows
                // it fits in the file.
                return { hasMarker: true, entries: [] }
            }

            const moreAvailableBeyondWindow = windowLength < remaining
            if (!moreAvailableBeyondWindow) {
                return { hasMarker: false, entries }
            }
            windowBytes = Math.max(windowBytes * 2, result.need)
        }
    }

    return { hasMarker: false, entries }
}

/** `true` when `file` carries an entry whose complete name is `BACKUP_ENCRYPTION_MARKER_NAME`; see `indexBackupEntries` for the walk's rules. */
export async function findEncryptionMarkerEntry(file: Blob, options: BackupWalkOptions = {}): Promise<boolean> {
    return (await indexBackupEntries(file, options)).hasMarker
}
