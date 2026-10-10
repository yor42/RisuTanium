import { DBState } from "../stores.svelte"
import type { character, groupChat } from "../storage/database.svelte"
import { MEASURE, putBackEnabled } from "./memory/measureFlag"
import { noteFingerprint } from "./memory/putBackMeasure"

/**
 * What a restore keeps of the placeholder it replaced, so that a character the
 * user only looked at can be put back as that placeholder (`characterPutBack.ts`)
 * instead of staying in memory for the rest of the page's life.
 *
 * A record holds the stub, the unit key it points at and a fingerprint of the
 * unit's character as it was read. It is taken at the install, over the plain
 * object the unit decoded to, before anything else can touch it. The
 * fingerprint is not persisted and is not a field of any character.
 *
 * This module must not import `characters.ts` (see `coldCharacterRestore.ts`).
 */

type Slot = character | groupChat

export interface RetainedRecord {
    readonly chaId: string
    readonly stub: Slot
    readonly unitKey: string
    readonly fp: string
    /** Measurement builds only: one hash per top-level key, to name what changed on a dirty verdict. */
    readonly keyHashes?: Record<string, string>
}

/**
 * Measurement builds only: a weak reference to the plain decoded object of a
 * record, which the reactive installed character wraps without copying. Kept
 * beside the record so that the record's shape is the same in every build.
 */
const rawRefs = new WeakMap<RetainedRecord, WeakRef<object>>()

export function rawRefOf(record: RetainedRecord): WeakRef<object> | undefined {
    return rawRefs.get(record)
}

/**
 * The record of an installed character, by identity. A replaced slot is not
 * pinned by it, and a record is never found through a copy of the character.
 */
const byInstalled = new WeakMap<object, RetainedRecord>()

/**
 * The same records by `chaId`: the stub, its unit key and the fingerprint, and
 * never the installed full character, so that a slot that was replaced does not
 * keep the full character alive.
 */
const byChaId = new Map<string, RetainedRecord>()

/** The hidden utility character rewrites itself on every selection and is selected only while in use. */
const PLAYGROUND_CHA_ID = '§playground'

/** Fields that change without the character's content changing: the stub carries them across a put-back. */
const VOLATILE_FIELDS = ['lastInteraction', 'trashTime'] as const

function hashText(text: string): [number, number] {
    // Two independent 32-bit lanes over the UTF-16 units: FNV-1a and a
    // cyrb53-style mix. With the length they make a collision between two
    // different characters negligible for data that is not built to collide.
    let h1 = 0x811c9dc5
    let a = 0xdeadbeef
    let b = 0x41c6ce57
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        h1 = Math.imul(h1 ^ unit, 0x01000193) >>> 0
        a = Math.imul(a ^ unit, 2654435761)
        b = Math.imul(b ^ unit, 1597334677)
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
    return [h1, ((b >>> 0) ^ (a >>> 0)) >>> 0]
}

function hashLabel(text: string): string {
    const [h1, h2] = hashText(text)
    return `${text.length}:${h1.toString(16)}:${h2.toString(16)}`
}

/**
 * A fingerprint of `cha`'s content: its fields as JSON, without the fields in
 * `VOLATILE_FIELDS`. A reactive proxy and the plain object it wraps give the
 * same fingerprint. Synchronous on purpose: a check that awaited could be
 * followed by a change before the swap it guards.
 */
export function contentFingerprint(cha: Slot): string {
    const copy: Record<string, unknown> = { ...cha }
    for (const field of VOLATILE_FIELDS) {
        delete copy[field]
    }
    return hashLabel(JSON.stringify(copy))
}

function perKeyHashes(cha: Slot): Record<string, string> {
    const hashes: Record<string, string> = {}
    for (const [key, value] of Object.entries(cha)) {
        if (!(VOLATILE_FIELDS as readonly string[]).includes(key)) {
            hashes[key] = hashLabel(JSON.stringify(value) ?? '')
        }
    }
    return hashes
}

/** Measurement builds only: the top-level keys of `current` whose content differs from what `record` was taken from. */
export function differingKeys(record: Pick<RetainedRecord, 'keyHashes'>, current: Slot): string[] {
    const before = record.keyHashes
    if (!before) {
        return []
    }
    const after = perKeyHashes(current)
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...keys].filter((key) => before[key] !== after[key])
}

/**
 * Records that `installed`, now in the character list, was restored in place of
 * `stub`, from `restored`: the plain character the unit decoded to. Call it in
 * the step that installs, before anything else can change `restored`. A
 * character without a usable `chaId`, a stub without a unit key and the
 * Playground character are not retained.
 */
export function retainOnRestore(installed: Slot, stub: Slot, restored: Slot): void {
    if (!putBackEnabled()) {
        return
    }
    const chaId = stub.chaId
    const unitKey = stub.coldstorage
    if (typeof chaId !== 'string' || chaId === '' || chaId === PLAYGROUND_CHA_ID || typeof unitKey !== 'string' || unitKey === '') {
        return
    }
    let record: RetainedRecord
    try {
        const startedAt = MEASURE ? performance.now() : 0
        const fp = contentFingerprint(restored)
        const fingerprintedAt = MEASURE ? performance.now() : 0
        const keyHashes = MEASURE ? perKeyHashes(restored) : undefined
        if (MEASURE) {
            noteFingerprint('restore', fingerprintedAt - startedAt, fp)
            noteFingerprint('restore-keyhash', performance.now() - fingerprintedAt, fp)
        }
        record = { chaId, stub, unitKey, fp, ...(keyHashes ? { keyHashes } : {}) }
        if (MEASURE) {
            rawRefs.set(record, new WeakRef<object>(restored))
        }
    } catch (error) {
        // A character that cannot be fingerprinted stays loaded; the restore itself must not fail for it.
        console.error(error)
        return
    }
    byInstalled.set(installed, record)
    byChaId.set(chaId, record)
}

/** The record of `installed` if it is the character a restore installed and is still retained. */
export function retainedRecordOf(installed: Slot | null | undefined): RetainedRecord | undefined {
    if (!installed || typeof installed !== 'object') {
        return undefined
    }
    const record = byInstalled.get(installed)
    return record !== undefined && byChaId.get(record.chaId) === record ? record : undefined
}

/** The indexes of every character holding `chaId`. */
export function findChaIdHolders(chaId: string): number[] {
    const characters = DBState.db?.characters
    const found: number[] = []
    if (!Array.isArray(characters)) {
        return found
    }
    for (let i = 0; i < characters.length; i++) {
        if (characters[i]?.chaId === chaId) {
            found.push(i)
        }
    }
    return found
}

/** How many restored characters are retained. */
export function retainedCount(): number {
    return byChaId.size
}

/** True while any restored character is retained. */
export function hasRetained(): boolean {
    return byChaId.size > 0
}

/** Forgets `record`; its installed character stays where it is. */
export function dropRetained(record: RetainedRecord): void {
    if (byChaId.get(record.chaId) === record) {
        byChaId.delete(record.chaId)
    }
}

/** Forgets the records whose installed character is no longer in the character list. */
export function pruneRetained(): void {
    if (byChaId.size === 0) {
        return
    }
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        return
    }
    const present = new Set<RetainedRecord>()
    for (const cha of characters) {
        const record = retainedRecordOf(cha)
        if (record) {
            present.add(record)
        }
    }
    for (const record of [...byChaId.values()]) {
        if (!present.has(record)) {
            byChaId.delete(record.chaId)
        }
    }
}

/**
 * The unit keys that retained stubs point at: each stub's unit and its archived
 * chats. A put-back reinstalls the stub, so these units are still referenced
 * while the full character is loaded.
 */
export function retainedUnitKeys(): Set<string> {
    pruneRetained()
    const keys = new Set<string>()
    for (const record of byChaId.values()) {
        keys.add(record.unitKey)
        const chats: unknown = record.stub.coldStoragedChats
        if (Array.isArray(chats)) {
            for (const key of chats) {
                if (typeof key === 'string') {
                    keys.add(key)
                }
            }
        }
    }
    return keys
}

export function resetRetainedForTest(): void {
    byChaId.clear()
}
