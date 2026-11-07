/**
 * `manifest.json` of an `.rtb` file (A2): the top-level schema, the version number and
 * the snapshot grammar. The section rows are validated by `sections.ts`.
 *
 * The order is fixed so a newer file is never called damaged for what a newer writer
 * may have changed:
 * 1. a manifest over the size cap is damaged, whatever it says (the cap is what keeps a
 *    reader from inflating without bound to look for `rtb`);
 * 2. text that is not a JSON object is damaged;
 * 3. an integer `rtb` above 1 is "made by a newer version", before any other check;
 * 4. `rtb` that is not exactly 1 is damaged;
 * 5. only then the version 1 schema.
 * Unknown top-level fields and unknown nested fields are accepted and dropped.
 */
import { KEY_ALPHABET } from '../../storage/store2/format/keys'

export { MANIFEST_ENTRY as MANIFEST_NAME } from './entryNames'

/** A reader may refuse a manifest above 64 MiB as damaged (A2.9). */
export const DEFAULT_MANIFEST_CAP = 64 * 1024 * 1024

export interface OmittedEntry {
    kind: string
    name: string
    reason: string
}

export interface RtbManifest {
    rtb: 1
    writer: Record<string, unknown>
    createdAt: number
    snapshot: { id: string, parent: string | null, lineage: string[] }
    source: {
        device: { label: string, platform: string }
        committedAt: number
        unsavedExcluded: boolean
    }
    /** The raw row list; `parseSectionTable` validates it. */
    sections: unknown[]
    omitted: OmittedEntry[]
}

export type ManifestResult =
    | { kind: 'ok', manifest: RtbManifest }
    | { kind: 'newer', rtb: number }
    | { kind: 'damaged', reason: string }

export interface ManifestOptions {
    /** Largest manifest, in bytes, that is read at all. */
    maxBytes?: number
}

const SNAPSHOT_ID = new RegExp(`^[${KEY_ALPHABET}]{26}$`)

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isList(value: unknown): value is unknown[] {
    return Array.isArray(value)
}

function isSnapshotId(value: unknown): value is string {
    return typeof value === 'string' && SNAPSHOT_ID.test(value)
}

function isIdList(value: unknown): value is string[] {
    return isList(value) && value.every(isSnapshotId)
}

function isNewerRtb(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 1
}

function parseJsonObject(bytes: Uint8Array, maxBytes: number): { ok: true, value: Record<string, unknown> } | { ok: false, reason: string } {
    if (bytes.length > maxBytes) {
        return { ok: false, reason: `the manifest is ${bytes.length} bytes, over the ${maxBytes} byte limit` }
    }
    let text: string
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return { ok: false, reason: 'the manifest is not UTF-8 text' }
    }
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch {
        return { ok: false, reason: 'the manifest is not JSON' }
    }
    if (!isRecord(value)) {
        return { ok: false, reason: 'the manifest is not a JSON object' }
    }
    return { ok: true, value }
}

/** The `rtb` number of a manifest that says it was made by a newer version, or null for anything else. */
export function peekNewerRtb(bytes: Uint8Array, maxBytes: number = DEFAULT_MANIFEST_CAP): number | null {
    const parsed = parseJsonObject(bytes, maxBytes)
    return parsed.ok && isNewerRtb(parsed.value.rtb) ? parsed.value.rtb : null
}

function damaged(reason: string): ManifestResult {
    return { kind: 'damaged', reason }
}

export function parseManifest(bytes: Uint8Array, options: ManifestOptions = {}): ManifestResult {
    const parsed = parseJsonObject(bytes, options.maxBytes ?? DEFAULT_MANIFEST_CAP)
    if (parsed.ok === false) {
        return damaged(parsed.reason)
    }
    const value = parsed.value
    if (isNewerRtb(value.rtb)) {
        return { kind: 'newer', rtb: value.rtb }
    }
    if (value.rtb !== 1) {
        return damaged('the manifest does not say rtb 1')
    }

    const { writer, createdAt, snapshot, source, sections, omitted } = value
    if (!isRecord(writer)) {
        return damaged('writer is missing or not an object')
    }
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
        return damaged('createdAt is missing or not a number')
    }
    if (!isRecord(snapshot) || !isSnapshotId(snapshot.id)) {
        return damaged('snapshot is missing or its id is not 26 key characters')
    }
    const parentValue = snapshot.parent
    let parentId: string | null = null
    if (parentValue !== null) {
        if (!isSnapshotId(parentValue)) {
            return damaged('snapshot.parent is not null or a snapshot id')
        }
        parentId = parentValue
    }
    if (!isIdList(snapshot.lineage)) {
        return damaged('snapshot.lineage is not a list of snapshot ids')
    }
    if (!isRecord(source) || !isRecord(source.device)) {
        return damaged('source or source.device is missing')
    }
    if (typeof source.device.label !== 'string' || typeof source.device.platform !== 'string') {
        return damaged('source.device.label or source.device.platform is not a string')
    }
    if (typeof source.committedAt !== 'number' || !Number.isFinite(source.committedAt)) {
        return damaged('source.committedAt is not a number')
    }
    if (typeof source.unsavedExcluded !== 'boolean') {
        return damaged('source.unsavedExcluded is not a boolean')
    }
    if (!isList(sections)) {
        return damaged('sections is missing or not a list')
    }
    if (!isList(omitted)) {
        return damaged('omitted is missing or not a list')
    }
    const omittedEntries: OmittedEntry[] = []
    for (const entry of omitted) {
        if (!isRecord(entry) || typeof entry.kind !== 'string' || typeof entry.name !== 'string' || typeof entry.reason !== 'string') {
            return damaged('an omitted entry has no string kind, name and reason')
        }
        omittedEntries.push({ kind: entry.kind, name: entry.name, reason: entry.reason })
    }

    return {
        kind: 'ok',
        manifest: {
            rtb: 1,
            writer,
            createdAt,
            snapshot: { id: snapshot.id, parent: parentId, lineage: [...snapshot.lineage] },
            source: {
                device: { label: source.device.label, platform: source.device.platform },
                committedAt: source.committedAt,
                unsavedExcluded: source.unsavedExcluded,
            },
            sections,
            omitted: omittedEntries,
        },
    }
}
