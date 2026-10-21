import type { Database } from '../../database.svelte'
import { isColdStorageBackupData, isRestorableColdStorageKey } from '../../../process/coldstorageData'
import { isPluginStorageIndex, largeIdsOfIndex } from '../../../process/pluginStorageIndex'
import { legacyPluginIndexPointer, legacyRefsOfDatabase, legacyRefsOfUnit } from './refs'
import { LegacyReadError, readLegacyUnit, type LegacyEntryReader } from './resolve'

export interface LegacyWalkOptions {
    /** An index unit that is absent holds nothing to keep. Any other index failure still rejects. */
    absentIndexKeepsNothing?: boolean
}

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
 * whole and never searched for further references. The one exception is the
 * upstream plugin storage index a tree points at: it is read, and because an
 * absent or malformed index hides the large units it names, that is a failure
 * like the others, never "absent is not a failure". The index key and every
 * large unit id it names are in the result; the large units are not read.
 * The one tolerated case is an index that is absent (never unreadable, damaged
 * or not an index) when `absentIndexKeepsNothing` is set: nothing can resolve
 * the units it named, so it contributes only its own key. The option applies to
 * every tree of the call, so a caller that must keep one file strict walks it
 * in a call of its own.
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
    options: LegacyWalkOptions = {},
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
        // The upstream plugin storage index is read for every tree that points at it, even when an earlier tree already
        // queued the same key as an ordinary unit, so the check below runs for this tree.
        const indexKey = legacyPluginIndexPointer(tree)
        if (indexKey !== null) {
            keys.add(indexKey)
            schedule(indexKey)
            if (!queue.includes(indexKey)) {
                queue.push(indexKey)
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
            if (key === indexKey) {
                if (options.absentIndexKeepsNothing === true && read.status === 'missing') {
                    continue
                }
                // An absent or malformed index hides the large units it names, so unlike any other unit it is a failure.
                if (read.status !== 'ok' || !isPluginStorageIndex(read.value)) {
                    throw new LegacyReadError(key, 'unit', new Error(`The plugin storage index ${key} is missing or is not an index, so the units it names are unknown.`))
                }
                for (const id of largeIdsOfIndex(read.value)) {
                    keys.add(id)
                }
                continue
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
