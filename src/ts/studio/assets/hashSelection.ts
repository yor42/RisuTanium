// Which rows of one asset array Check bytes hashes. Hashing reads bytes, so only a row that could share its bytes
// with another row is read: a unique name with a unique known size cannot.

import type { StoredSize } from './assetSizes'

export interface HashRow {
    readonly name: string
    readonly path: string
}

export type HashSelection<R extends HashRow> =
    | { kind: 'pending' }
    | { kind: 'selected', rows: R[] }

/**
 * The rows of one array to hash, in array order. `sizes` maps a path to its size: a number (known), `null` (the
 * store cannot say) or `undefined` (pending). With any pending size nothing is selected and `{kind:'pending'}` is
 * returned, so a pending size is never read as "unknown".
 *
 * With settled sizes a row is selected when:
 * - its name is shared by another row of the array (names compare exactly), or
 * - its known size equals another row's known size, whatever the names.
 *
 * A size-unknown row is selected only through its name. The selection never looks past the array it is given.
 */
export function selectForHashing<R extends HashRow>(rows: readonly R[], sizes: ReadonlyMap<string, StoredSize>): HashSelection<R> {
    for (const row of rows) {
        if (sizes.get(row.path) === undefined) {
            return { kind: 'pending' }
        }
    }
    const nameCount = new Map<string, number>()
    const sizeCount = new Map<number, number>()
    for (const row of rows) {
        nameCount.set(row.name, (nameCount.get(row.name) ?? 0) + 1)
        const size = sizes.get(row.path)
        if (typeof size === 'number') {
            sizeCount.set(size, (sizeCount.get(size) ?? 0) + 1)
        }
    }
    const selected = rows.filter((row) => {
        if ((nameCount.get(row.name) ?? 0) >= 2) {
            return true
        }
        const size = sizes.get(row.path)
        return typeof size === 'number' && (sizeCount.get(size) ?? 0) >= 2
    })
    return { kind: 'selected', rows: selected }
}
