import type { BackupIndexEntry, BinFile, BinSlice } from './backupContainer'
import { inlayMetaKey } from '../process/files/inlayKeys'
import {
    InlayUnreadableError,
    withInlayLock,
    writeAppInlay,
    type InlayAsset,
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
 * The inlays of a local backup on restore. Part entries are kept as
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
    /** For `tooLarge`: the limit that applied to this inlay, so a notice prints the bound that was used. */
    limit?: number
}

/** The largest inlay body that may be stored for an inlay of `type` (see `inlayAttachmentLimit`). */
export type InlayLimitOf = (type: InlayAsset['type'] | undefined) => number

/** The inlay type a header's record fields name, or `undefined` for anything else. */
function inlayTypeOf(fields: Record<string, unknown>): InlayAsset['type'] | undefined {
    const type = fields.type
    return type === 'image' || type === 'video' || type === 'audio' || type === 'signature' ? type : undefined
}

function limitFunction(limit: number | InlayLimitOf): InlayLimitOf {
    return typeof limit === 'number' ? () => limit : limit
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
    parts: Map<number, BinSlice>
    /** Set once the group cannot be written. */
    skip: InlaySkipped | null
}

export class InlayRestoreCollector {
    private readonly groups = new Map<string, InlayGroup>()

    private readonly limitOf: InlayLimitOf

    constructor(limit: number | InlayLimitOf) {
        this.limitOf = limitFunction(limit)
    }

    /** Leaves out every entry of the inlay with name-hash `hash`, as too large for this page. */
    preSkip(hash: string, id: string, limit?: number): void {
        this.group(hash, hash).skip = { label: id, reason: 'tooLarge', limit }
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
    async add(name: string, hash: string, index: number, data: BinSlice): Promise<'ok' | 'unreadable'> {
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
            const lengthBytes = new Uint8Array(await data.slice(0, 4).arrayBuffer())
            // A read that comes back shorter than the part covers is a file that changed, not a damaged inlay.
            if (lengthBytes.length < Math.min(4, data.size)) {
                return 'unreadable'
            }
            headerLength = headerLengthOf(lengthBytes)
            if (headerLength === null || 4 + headerLength > data.size) {
                this.invalidate(group)
                return 'ok'
            }
            headerBytes = new Uint8Array(await data.slice(4, 4 + headerLength).arrayBuffer())
            if (headerBytes.length < headerLength) {
                return 'unreadable'
            }
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
        const limit = this.limitOf(inlayTypeOf(header.fields))
        if (header.len > limit) {
            group.skip = { label: header.id, reason: 'tooLarge', limit }
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
        const slices: BinSlice[] = []
        for (let index = 0; index < header.parts; index++) {
            slices.push(group.parts.get(index)!)
        }
        const type = header.repr === 'blob' ? header.mime : ''
        let body: Blob
        if (slices.every((slice): slice is BinSlice & Blob => slice instanceof Blob)) {
            body = new Blob(slices, { type })
        } else {
            // A source-backed part is read here, one at a time, and kept as a Blob of its own, so the heap never holds more
            // than one part of this inlay. A part that cannot be read, or comes back short, means the file changed.
            const pieces: Blob[] = []
            try {
                for (const slice of slices) {
                    const bytes = await slice.arrayBuffer()
                    if (bytes.byteLength !== slice.size) {
                        console.error(`Inlay part of ${header.id} read ${bytes.byteLength} of ${slice.size} bytes`)
                        return 'changed'
                    }
                    pieces.push(new Blob([bytes]))
                }
            } catch (error) {
                console.error(error)
                return 'changed'
            }
            body = new Blob(pieces, { type })
        }
        try {
            // A text inlay's bytes travel as the Blob they arrived in; the record keeps its repr, so it reads back as a string.
            const textRepr = header.repr === 'blob' ? undefined : header.repr
            await withInlayLock(header.id, async () => {
                await writeAppInlay(store, header.id, { ...header.fields, data: body }, { textRepr })
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
    return error instanceof DOMException && (error.name === 'NotReadableError' || error.name === 'NotFoundError')
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
export async function listOversizedInlays(file: BinFile, entries: readonly BackupIndexEntry[], limit: number | InlayLimitOf): Promise<{ hash: string, id: string, limit: number }[]> {
    const limitOf = limitFunction(limit)
    const found: { hash: string, id: string, limit: number }[] = []
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
        if (header === null) {
            continue
        }
        const applied = limitOf(inlayTypeOf(header.fields))
        if (header.len > applied && await inlayIdHash(header.id) === parsed.hash) {
            found.push({ hash: parsed.hash, id: header.id, limit: applied })
        }
    }
    return found
}

/** Writes what `collector` holds into the page's app store. */
export async function restoreCollectedInlays(collector: InlayRestoreCollector): Promise<InlayRestoreResult> {
    return await collector.finish(await getAppStore())
}
