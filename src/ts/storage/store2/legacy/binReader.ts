import {
    BACKUP_ENCRYPTION_MARKER_NAME, parseBackupEntryHeader, type BackupIndexEntry,
} from '../../../drive/backupContainer'
import {
    getColdStorageBackupKey, isAcceptedColdStorageBackupEntry, isRestorableColdStorageKey,
} from '../../../process/coldstorageData'
import type { LegacyEntryReader, LegacyUnitRead } from './resolve'

/**
 * The cold-storage entries of a `.bin` backup as a `LegacyEntryReader`, read on demand. A store2 page cannot store the
 * entries (the legacy unit writer refuses while a residency is registered) and a boot-time import must not touch the old
 * profile's own units, so the entries stay in the file: the walk of the restore records where each one sits
 * (`ColdEntryIndex`), and the resolver asks for a unit only when a pointer of the decoded tree names it, so one slice
 * of the file is read at a time and nothing is held. This module writes nothing.
 *
 * Parity with the restore loop that stores such entries, entry by entry:
 *  - Only the entry names the backup writer produces map to a unit id (`getColdStorageBackupKey`); only an id that
 *    round-trips through that name is ever looked up (`isRestorableColdStorageKey`), so an entity id or any other key a
 *    tree could name never reaches the file or the fallback.
 *  - An entry whose body is not JSON, or whose body fails the acceptance rule of its name
 *    (`isAcceptedColdStorageBackupEntry`), is skipped, exactly as the loop skips it. When a unit id repeats, the last
 *    entry that is accepted wins, because the loop overwrote the unit with each accepted entry in file order.
 *  - A unit id with no accepted entry is answered by the `fallback` reader (the page's own legacy unit, as the loop's
 *    "the device already holds it" check does). The fallback's answer is passed on as it gives it, a missing fallback
 *    answer being refined to `unparsable` when an entry for the id was present but not JSON.
 *
 * Changes to the loop: the file is read after the walk, not during it, so each lazy read re-checks the entry the way
 * the loop does before it trusts a byte: the header must carry the lengths the walk indexed, must not be the
 * encryption marker, and the slice must be exactly as long as indexed. Any difference, and any failure to read the
 * slice, is an `error` carrying `BinFileChangedError`, which aborts the resolve before anything is written.
 */

export type BinChangeReason = 'unreadable' | 'length' | 'header' | 'marker'

/** The file is not what the walk indexed (or cannot be read now). The caller shows the restore's "file changed while reading" text. */
export class BinFileChangedError extends Error {
    constructor(readonly reason: BinChangeReason, readonly entryName: string, options?: { cause?: unknown }) {
        super(`The backup entry ${entryName} cannot be read as indexed (${reason}).`, options)
        this.name = 'BinFileChangedError'
    }
}

/** Where one cold-storage entry sits in the file, and the name its header carried. */
export interface ColdEntryPlace extends BackupIndexEntry {
    name: string
}

/** An entry name that can be a cold-storage entry is short (`coldstorage_<uuid>.json`, a byte-order mark at most); a longer one is never read for its name. */
const COLD_NAME_MAX_BYTES = 64

/** The cold-storage entries of one `.bin`, by unit id, in file order. A repeated id keeps every place. */
export class ColdEntryIndex {
    private readonly places = new Map<string, ColdEntryPlace[]>()

    /** Records `entry` when `name` maps to a unit id; answers whether it did. */
    note(entry: BackupIndexEntry, name: string): boolean {
        const key = getColdStorageBackupKey(name)
        if (key === null) {
            return false
        }
        const list = this.places.get(key)
        const place: ColdEntryPlace = { ...entry, name }
        if (list === undefined) {
            this.places.set(key, [place])
        } else {
            list.push(place)
        }
        return true
    }

    /** Every place recorded for `key`, in file order; empty when the file holds none. */
    get(key: string): readonly ColdEntryPlace[] {
        return this.places.get(key) ?? []
    }

    get size(): number {
        return this.places.size
    }

    /**
     * A name-only estimate of the bytes the unit entries hold: the data length of the entry the reader tries first for
     * each id (the last one noted), summed. It reads no body, so it over-counts orphan units and bodies the reader would
     * reject, and under-counts units a fallback serves (they are not in the file) and ids served by an earlier entry.
     */
    get estimatedUnitBytes(): number {
        let total = 0
        for (const list of this.places.values()) {
            total += list[list.length - 1].dataLength
        }
        return total
    }
}

async function sliceBytes(file: Blob, start: number, length: number, name: string): Promise<Uint8Array> {
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
    } catch (error) {
        throw new BinFileChangedError('unreadable', name, { cause: error })
    }
    if (bytes.length !== length) {
        throw new BinFileChangedError('length', name)
    }
    return bytes
}

/** The header at `place` must be the one the walk indexed and not the encryption marker. */
function checkHeader(bytes: Uint8Array, place: ColdEntryPlace): void {
    const parsed = parseBackupEntryHeader(bytes)
    if (parsed.status !== 'ok') {
        throw new BinFileChangedError('header', place.name)
    }
    const header = parsed.header
    if (header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
        throw new BinFileChangedError('marker', place.name)
    }
    if (header.name !== place.name || header.nameLength !== place.nameLength
            || header.dataLength !== place.dataLength || header.headerLength !== place.headerLength) {
        throw new BinFileChangedError('header', place.name)
    }
}

/**
 * Records the cold-storage entries among `entries` (the walk of `indexBackupEntries`) by reading each header once. A
 * caller that already reads every header (the restore loop) calls `ColdEntryIndex.note` there instead. A header that
 * is not what the walk saw, or the encryption marker, throws `BinFileChangedError`.
 */
export async function indexColdEntries(file: Blob, entries: readonly BackupIndexEntry[]): Promise<ColdEntryIndex> {
    const index = new ColdEntryIndex()
    for (const entry of entries) {
        if (entry.nameLength > COLD_NAME_MAX_BYTES) {
            continue
        }
        const bytes = await sliceBytes(file, entry.headerOffset, entry.headerLength, `at ${entry.headerOffset}`)
        const parsed = parseBackupEntryHeader(bytes)
        if (parsed.status !== 'ok' || parsed.header.name === undefined) {
            throw new BinFileChangedError('header', `at ${entry.headerOffset}`)
        }
        if (parsed.header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
            throw new BinFileChangedError('marker', parsed.header.name)
        }
        if (parsed.header.nameLength !== entry.nameLength || parsed.header.dataLength !== entry.dataLength || parsed.header.headerLength !== entry.headerLength) {
            throw new BinFileChangedError('header', parsed.header.name)
        }
        index.note(entry, parsed.header.name)
    }
    return index
}

type ColdEntryBody =
    | { status: 'ok', value: unknown }
    | { status: 'unparsable' }
    | { status: 'rejected' }

/** One entry, re-checked and decoded. Throws `BinFileChangedError`. */
async function readColdEntry(file: Blob, place: ColdEntryPlace): Promise<ColdEntryBody> {
    const bytes = await sliceBytes(file, place.headerOffset, place.headerLength + place.dataLength, place.name)
    checkHeader(bytes.subarray(0, place.headerLength), place)
    let value: unknown
    try {
        value = JSON.parse(new TextDecoder().decode(bytes.subarray(place.headerLength)))
    } catch {
        return { status: 'unparsable' }
    }
    return isAcceptedColdStorageBackupEntry(place.name, value) ? { status: 'ok', value } : { status: 'rejected' }
}

export interface BinEntryReaderOptions {
    file: Blob
    index: ColdEntryIndex
    /** Answers a unit id the file holds no accepted entry for: the page's legacy unit. Absent, such an id is missing. */
    fallback?: LegacyEntryReader
}

export function createBinEntryReader(options: BinEntryReaderOptions): LegacyEntryReader {
    const { file, index, fallback } = options
    return {
        async read(key: string): Promise<LegacyUnitRead> {
            if (!isRestorableColdStorageKey(key)) {
                return { status: 'missing' }
            }
            const places = index.get(key)
            let sawUnparsable = false
            for (let at = places.length - 1; at >= 0; at--) {
                let body: ColdEntryBody
                try {
                    body = await readColdEntry(file, places[at])
                } catch (error) {
                    return { status: 'error', error }
                }
                if (body.status === 'ok') {
                    return body
                }
                sawUnparsable ||= body.status === 'unparsable'
            }
            const held = fallback === undefined ? { status: 'missing' } as const : await fallback.read(key)
            if (held.status === 'missing' && sawUnparsable) {
                return { status: 'unparsable' }
            }
            return held
        },
    }
}
