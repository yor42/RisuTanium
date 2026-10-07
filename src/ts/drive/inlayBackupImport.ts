import type { BackupIndexEntry } from './backupContainer'
import { inlayMetaKey } from '../process/files/inlayKeys'
import {
    InlayUnreadableError,
    bytesToString,
    withInlayLock,
    writeAppInlay,
} from '../process/files/inlayStore'
import { getAppStore } from '../storage/store/appStore'
import type { ByteStore } from '../storage/store/contract'
import {
    MAX_ENTRY_NAME_LENGTH,
    MIN_ENTRY_NAME_LENGTH,
    PART_DATA_MAX,
    headerLengthOf,
    inlayIdHash,
    parseInlayEntryName,
    parseInlayHeader,
    type InlayEntryHeader,
} from './inlayBackupCodec'

/**
 * The inlays of a local backup on restore. Part entries are kept as Blob
 * slices of the backup file, never as bytes, and an inlay is written (one
 * `writeAppInlay` commit under its id lock) only after every part of it has
 * been seen and checked. Anything that does not add up writes nothing for that
 * id and is named; no inlay can stop the restore, except that a backup file
 * that cannot be read any more does (`changed`), as for assets.
 */

export type InlaySkipReason =
    /** The entries in the file are incomplete, duplicated, mismatched or damaged. */
    | 'invalid'
    /** The inlay is larger than this page can store. */
    | 'tooLarge'
    /** This page's store refused the inlay, or its id has no key. */
    | 'notStored'

export interface InlaySkipped {
    /** The id when the header was read, else the entry name. */
    label: string
    reason: InlaySkipReason
}

export interface InlayRestoreResult {
    written: number
    skipped: InlaySkipped[]
    /** The backup file could not be read any more. */
    changed: boolean
}

interface InlayGroup {
    firstName: string
    header: InlayEntryHeader | null
    /** Body slices by part index. */
    parts: Map<number, Blob>
    /** Set once the group cannot be written. */
    skip: { label: string, reason: InlaySkipReason } | null
}

export class InlayRestoreCollector {
    private readonly groups = new Map<string, InlayGroup>()

    constructor(private readonly limit: number) { }

    /** Leaves out every entry of the inlay with name-hash `hash`, as too large for this page. */
    preSkip(hash: string, id: string): void {
        this.group(hash, hash).skip = { label: id, reason: 'tooLarge' }
    }

    private group(hash: string, firstName: string): InlayGroup {
        let found = this.groups.get(hash)
        if (found === undefined) {
            found = { firstName, header: null, parts: new Map(), skip: null }
            this.groups.set(hash, found)
        }
        return found
    }

    private invalidate(group: InlayGroup): void {
        group.skip = { label: group.header?.id ?? group.firstName, reason: 'invalid' }
        group.parts.clear()
    }

    /** Takes one part entry's data; `'unreadable'` when the file cannot be read. Never throws. */
    async add(name: string, hash: string, index: number, data: Blob): Promise<'ok' | 'unreadable'> {
        const group = this.group(hash, name)
        if (group.skip !== null) {
            return 'ok'
        }
        if (group.parts.has(index) || data.size > PART_DATA_MAX) {
            this.invalidate(group)
            return 'ok'
        }
        if (index > 0) {
            group.parts.set(index, data)
            return 'ok'
        }
        let headerBytes: Uint8Array
        let headerLength: number | null
        try {
            headerLength = headerLengthOf(new Uint8Array(await data.slice(0, 4).arrayBuffer()))
            if (headerLength === null || 4 + headerLength > data.size) {
                this.invalidate(group)
                return 'ok'
            }
            headerBytes = new Uint8Array(await data.slice(4, 4 + headerLength).arrayBuffer())
        } catch (error) {
            console.error(error)
            return 'unreadable'
        }
        const header = parseInlayHeader(headerBytes)
        if (header === null || headerBytes.length !== headerLength || await inlayIdHash(header.id) !== hash) {
            this.invalidate(group)
            return 'ok'
        }
        group.header = header
        if (header.len > this.limit) {
            group.skip = { label: header.id, reason: 'tooLarge' }
            group.parts.clear()
            return 'ok'
        }
        group.parts.set(0, data.slice(4 + headerLength))
        return 'ok'
    }

    /** Writes every inlay whose parts are all here and consistent, one at a time. */
    async finish(store: ByteStore): Promise<InlayRestoreResult> {
        const result: InlayRestoreResult = { written: 0, skipped: [], changed: false }
        for (const group of this.groups.values()) {
            if (group.skip !== null) {
                result.skipped.push(group.skip)
                continue
            }
            const header = group.header
            if (header === null || !isWhole(group, header)) {
                result.skipped.push({ label: header?.id ?? group.firstName, reason: 'invalid' })
                continue
            }
            if (inlayMetaKey(header.id) === null) {
                result.skipped.push({ label: header.id, reason: 'notStored' })
                continue
            }
            const outcome = await this.writeGroup(store, group, header)
            if (outcome === 'written') {
                result.written++
            } else if (outcome === 'changed') {
                result.changed = true
                return result
            } else {
                result.skipped.push({ label: header.id, reason: 'notStored' })
            }
        }
        return result
    }

    private async writeGroup(store: ByteStore, group: InlayGroup, header: InlayEntryHeader): Promise<'written' | 'changed' | 'refused'> {
        const slices: Blob[] = []
        for (let index = 0; index < header.parts; index++) {
            slices.push(group.parts.get(index)!)
        }
        const body = new Blob(slices, { type: header.repr === 'blob' ? header.mime : '' })
        try {
            const data = header.repr === 'blob' ? body : bytesToString(header.repr, new Uint8Array(await body.arrayBuffer()))
            await withInlayLock(header.id, async () => {
                await writeAppInlay(store, header.id, { ...header.fields, data })
            })
            return 'written'
        } catch (error) {
            if (error instanceof InlayUnreadableError || isUnreadableFile(error)) {
                console.error(error)
                return 'changed'
            }
            console.error(error)
            return 'refused'
        }
    }
}

/** A read of a slice of the backup file failed: the file changed or went away. */
function isUnreadableFile(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotReadableError'
}

/** Whether the parts of `group` are exactly 0..parts-1 and add up to the header's length. */
function isWhole(group: InlayGroup, header: InlayEntryHeader): boolean {
    let total = 0
    for (let index = 0; index < header.parts; index++) {
        const slice = group.parts.get(index)
        if (slice === undefined) {
            return false
        }
        total += slice.size
    }
    return group.parts.size === header.parts && total === header.len
}

/**
 * The inlays in the file whose body is larger than `limit`, found from their
 * part 0 headers, so a Node restore can name them before anything is written.
 * Only entries whose name length can be an inlay name are read.
 */
export async function listOversizedInlays(file: Blob, entries: readonly BackupIndexEntry[], limit: number): Promise<{ hash: string, id: string }[]> {
    const found: { hash: string, id: string }[] = []
    for (const entry of entries) {
        if (entry.nameLength < MIN_ENTRY_NAME_LENGTH || entry.nameLength > MAX_ENTRY_NAME_LENGTH) {
            continue
        }
        const nameStart = entry.headerOffset + 4
        const name = new TextDecoder().decode(new Uint8Array(await file.slice(nameStart, nameStart + entry.nameLength).arrayBuffer()))
        const parsed = parseInlayEntryName(name)
        if (parsed === null || parsed.index !== 0) {
            continue
        }
        const dataStart = entry.headerOffset + entry.headerLength
        const headerLength = headerLengthOf(new Uint8Array(await file.slice(dataStart, dataStart + 4).arrayBuffer()))
        if (headerLength === null || 4 + headerLength > entry.dataLength) {
            continue
        }
        const header = parseInlayHeader(new Uint8Array(await file.slice(dataStart + 4, dataStart + 4 + headerLength).arrayBuffer()))
        if (header !== null && header.len > limit && await inlayIdHash(header.id) === parsed.hash) {
            found.push({ hash: parsed.hash, id: header.id })
        }
    }
    return found
}

/** Writes what `collector` holds into the page's app store. */
export async function restoreCollectedInlays(collector: InlayRestoreCollector): Promise<InlayRestoreResult> {
    return await collector.finish(await getAppStore())
}
