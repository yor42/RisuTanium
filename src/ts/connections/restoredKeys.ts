/**
 * The staging of connection keys a `.rtb` restore brought. A restore cannot swap the live database, so it
 * writes one record per envelope into a device-local store and the next boot applies them (vaultBoot).
 *
 * A line of the file is `{"k": id, "j": {"e": envelope, "p": plain}}`: `e` is the envelope the restored
 * config unit holds, `p` its plaintext. A record is keyed by `e` and holds either `{id, w}` (the plain
 * wrapped for this device, written only on a platform with a working vault) or `{id, p}`.
 */
import { applyStagedKeys, type StagedKey } from './keyVaultStore.svelte'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The envelope and plain of a section line's value, or null when the line is not valid (the store is then left untouched). */
export function acceptStagedLine(value: unknown): { e: string, p: string } | null {
    if (!isRecord(value) || typeof value.e !== 'string' || value.e === '' || typeof value.p !== 'string') {
        return null
    }
    return { e: value.e, p: value.p }
}

/** A staged record, or null when it is not one of the two shapes. */
export function parseStagedRecord(value: unknown): StagedKey | null {
    if (!isRecord(value) || typeof value.id !== 'string') {
        return null
    }
    if (typeof value.w === 'string' && value.w !== '') {
        return { id: value.id, w: value.w }
    }
    if (typeof value.p === 'string') {
        return { id: value.id, p: value.p }
    }
    return null
}

/** Every staged record by envelope, in key order; an unreadable record is `null`. */
export async function readStagedRecords(store: LocalForage): Promise<Map<string, StagedKey | null>> {
    const records = new Map<string, StagedKey | null>()
    for (const envelope of [...await store.keys()].sort()) {
        records.set(envelope, parseStagedRecord(await store.getItem<unknown>(envelope)))
    }
    return records
}

/**
 * Boot step 1: applies every staged record to the live connections and deletes the ones nothing carries any more. A record is kept
 * otherwise (no clear at apply), so a crash before the save applies it again.
 */
export async function applyRestoredKeys(store: LocalForage): Promise<void> {
    const records = await readStagedRecords(store)
    if (records.size === 0) {
        return
    }
    const { drop } = applyStagedKeys(records)
    for (const envelope of drop) {
        await store.removeItem(envelope)
    }
}
