/**
 * Test support: the archived characters the one-character archive wrote, captured from the real writer
 * and committed beside this file; the generator was removed with the writer, see `README.md` for how to read it.
 *
 * `loadArchiveCase` reads one case's source, stub and unit bytes, `placeUnits` puts the unit bytes under the page store
 * key the real reader looks them up by, and `decodeUnitBytes` decodes a unit without the application's reader. The
 * directory is `ARCHIVE_FIXTURES_DIR` when set, which a mutant run points at a scratch copy.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { decompressSync } from 'fflate'
import type { character, groupChat } from 'src/ts/storage/database.svelte'
import { coldUnitStoreKey } from 'src/ts/process/coldUnitLocation'

type Slot = character | groupChat

export const ARCHIVE_FIXTURE_DIR = path.resolve(process.env.ARCHIVE_FIXTURES_DIR ?? path.join(process.cwd(), 'src/ts/process/tests/archiveCapture'))

/** The gzip header's MTIME field: bytes 4 to 7. It is the one header field that depends on when the writer ran. */
export const GZIP_MTIME_START = 4
export const GZIP_MTIME_END = 8

export type CaseEntry = 'engine-new' | 'engine-loaded' | 'engine-sequence' | 'card-import'
export type UnitRole = 'unit' | 'unit1' | 'unit2' | 'chat'

export interface ManifestUnit {
    role: UnitRole
    key: string
    storeKey: string
    file: string
    byteLength: number
    /** sha256 of the gzip bytes with the MTIME field zeroed. */
    maskedSha256: string
    /** sha256 of the decompressed bytes. */
    payloadSha256: string
}

export interface ManifestCase {
    id: string
    chaId: string
    kind: 'new' | 'loaded' | 'sequence' | 'import'
    entry: CaseEntry
    /** What `sourceFile` holds: the character handed to the writer, or the card file that was imported. */
    sourceKind: 'character' | 'card'
    sourceFile: string
    stubFile: string
    /** The chat units the character's chats pointed at when it was archived; the stub's `coldStoragedChats`. */
    chatKeys: string[]
    units: ManifestUnit[]
}

export interface ArchiveManifest {
    /** Everything a re-capture must reproduce exactly. */
    content: {
        generator: { files: string[], command: string, config: string }
        fflateVersion: string
        platform: 'web'
        systemTime: number
        standIns: string[]
        cases: ManifestCase[]
    }
    /** Facts about the one run that wrote the files; never compared across runs. */
    capture: {
        baseCommit: string
        productionDirty: string[]
        time: string
        units: Record<string, { sha256: string, gzipMtime: number }>
    }
}

export interface CapturedUnit extends ManifestUnit {
    bytes: Uint8Array
}

export interface ArchivedCase {
    id: string
    chaId: string
    entry: CaseEntry
    sourceKind: 'character' | 'card'
    /** The character handed to the writer, or for a card import the card's JSON. */
    source: Slot
    /** The slot the writer left in the list. */
    stub: Slot
    chatKeys: string[]
    units: CapturedUnit[]
}

export function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

/** `bytes` with the gzip MTIME field zeroed, as a copy. */
export function withoutGzipMtime(bytes: Uint8Array): Uint8Array {
    const copy = new Uint8Array(bytes)
    copy.fill(0, GZIP_MTIME_START, Math.min(GZIP_MTIME_END, copy.length))
    return copy
}

export function maskedSha256(bytes: Uint8Array): string {
    return sha256Hex(withoutGzipMtime(bytes))
}

/** The MTIME value in the gzip header of `bytes`. */
export function gzipMtimeOf(bytes: Uint8Array): number {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(GZIP_MTIME_START, true)
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(path.join(ARCHIVE_FIXTURE_DIR, file), 'utf8')) as T
}

export function manifest(): ArchiveManifest {
    return readJson<ArchiveManifest>('manifest.json')
}

export function loadArchiveCase(id: string): ArchivedCase {
    const entry = manifest().content.cases.find((candidate) => candidate.id === id)
    if (entry === undefined) {
        throw new Error(`the archive fixtures hold no case ${id}`)
    }
    return {
        id: entry.id,
        chaId: entry.chaId,
        entry: entry.entry,
        sourceKind: entry.sourceKind,
        source: readJson<Slot>(entry.sourceFile),
        stub: readJson<Slot>(entry.stubFile),
        chatKeys: [...entry.chatKeys],
        units: entry.units.map((unit) => ({ ...unit, bytes: new Uint8Array(fs.readFileSync(path.join(ARCHIVE_FIXTURE_DIR, unit.file))) })),
    }
}

/** Puts every unit under the page store key the real reader asks for. */
export function placeUnits(store: Map<string, Uint8Array>, units: readonly CapturedUnit[]): void {
    for (const unit of units) {
        store.set(coldUnitStoreKey(unit.key), unit.bytes)
    }
}

/** The JSON value a unit's gzip bytes hold. */
export function decodeUnitBytes(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(decompressSync(bytes)))
}

/** The character a character unit holds. */
export function unitCharacterOf(unit: CapturedUnit): Slot {
    return (decodeUnitBytes(unit.bytes) as { character: Slot }).character
}
