/**
 * The list type a module's `assets` takes once the module is installed into the
 * reactive database.
 *
 * Svelte's `$state` proxy wraps only values whose prototype is `Object.prototype`
 * or `Array.prototype`; any other value is stored and returned as is. An `Array`
 * subclass therefore keeps a module's asset list (and every `[name, path, ext]`
 * tuple in it) out of the reactive graph, which is where the memory goes for a
 * module with tens of thousands of assets.
 *
 * Invariants the holders of an `AssetList` rely on:
 * - It is not reactive. Writing an element, a tuple field, or calling `push`,
 *   `splice` or `length =` on an installed list is not tracked, so nothing
 *   re-renders and no save is scheduled. Every change replaces the whole list:
 *   assign a new `AssetList` to `module.assets`.
 * - It never becomes another object's own array. A handoff stores a plain copy.
 * - Serialisation (`JSON.stringify`, msgpackr, `structuredClone`,
 *   `$state.snapshot`) sees an ordinary array, so the save blocks and the `.bin`
 *   are unchanged.
 *
 * This module imports nothing reactive, so any file may use it without a cycle.
 */

export type AssetTuple = [string, string, string]

export class AssetList extends Array<AssetTuple> {
    // `map`, `filter`, `slice`, `concat` and the like return plain arrays, so a
    // derived list is never an `AssetList` by accident.
    static get [Symbol.species]() {
        return Array
    }
}

/**
 * A new `AssetList` holding the entries of `source`. The tuples are shared, not
 * copied: pass a list whose tuples are plain arrays (a raw array, or a
 * `$state.snapshot` of a proxied one).
 */
export function toAssetList(source: readonly AssetTuple[]): AssetList {
    const list = new AssetList()
    for (let i = 0; i < source.length; i++) {
        list.push(source[i])
    }
    return list
}

/** A plain array with the entries of `source`, for a handoff or a V2.1 plugin. */
export function toPlainAssetArray(source: readonly AssetTuple[]): AssetTuple[] {
    const list: AssetTuple[] = []
    for (let i = 0; i < source.length; i++) {
        list.push(source[i])
    }
    return list
}
