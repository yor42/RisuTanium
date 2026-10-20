import type { Database } from '../../database.svelte'
import { isColdStorageBackupData, isRestorableColdStorageKey } from '../../../process/coldstorageData'
import { legacyRefsOfDatabase, legacyRefsOfUnit } from './refs'
import { LegacyReadError, readLegacyUnit, type LegacyEntryReader } from './resolve'

/**
 * The key-only walk behind the `coldstorage/` exclusion of the old files'
 * deletion: every unit id the legacy trees refer to, directly or through the
 * units they name. Only keys are kept; a unit's body is parsed, searched for
 * further references and dropped before the next is read.
 *
 * Fail whole. Any failure (the iterable's own, which is how a tree that does
 * not decode strictly reaches the walk; a unit that cannot be read; a unit
 * whose body is not JSON, which hides the references it holds; a referenced
 * key that cannot name a unit, so the unit it might hold cannot be read)
 * rejects the call and returns nothing, so a caller never deletes on a partial answer.
 * A unit that is simply absent, or that is not chat or character shaped, is
 * not a failure: its key is in the result and it holds no references.
 *
 * Plugin storage units are listed but not read: their content is carried
 * whole and never searched for further references.
 *
 * `visit`, when given, is called once with the key and parsed body of every
 * unit the walk reads successfully, before the body is dropped, so a caller can
 * scan it without a second read. Each call to the walk keeps its own state, so
 * a caller that walks one file per call can attribute a failure to that file.
 */
export async function collectLegacyColdKeys(
    trees: Iterable<Database> | AsyncIterable<Database>,
    reader: LegacyEntryReader,
    visit?: (key: string, value: unknown) => void,
): Promise<Set<string>> {
    const keys = new Set<string>()
    // Keys whose unit is already queued for reading.
    const done = new Set<string>()

    for await (const tree of trees) {
        const queue: string[] = []
        // A referenced unit that is searched must be nameable: a key that cannot be a storage name cannot be read, so the
        // references it may hold are unknown.
        const schedule = (key: string): void => {
            if (!isRestorableColdStorageKey(key)) {
                throw new LegacyReadError(key, 'unit', new Error(`The key ${JSON.stringify(key)} cannot name a unit, so the references it may hold are unknown.`))
            }
            if (!done.has(key)) {
                done.add(key)
                queue.push(key)
            }
        }
        for (const ref of legacyRefsOfDatabase(tree)) {
            keys.add(ref.key)
            if (ref.kind !== 'plugin') {
                schedule(ref.key)
            }
        }
        for (let i = 0; i < queue.length; i++) {
            const key = queue[i]
            const read = await readLegacyUnit(reader, key, 'unit')
            if (read.status === 'unparsable') {
                throw new LegacyReadError(key, 'unit', new Error(`The unit ${key} is not JSON, so the references it holds are unknown.`))
            }
            if (read.status === 'ok') {
                visit?.(key, read.value)
            }
            if (read.status !== 'ok' || !isColdStorageBackupData(read.value)) {
                continue
            }
            for (const inner of legacyRefsOfUnit(read.value)) {
                keys.add(inner.key)
                schedule(inner.key)
            }
        }
    }
    return keys
}
