import { isNodeServer, isTauri } from "../platform"
import { isSafeColdStorageKey } from "../process/coldStorageKey"
import { COLD_UNIT_STORE_PREFIX, coldUnitKeyOfStoreKey, legacyOpfsUnitKeyOfName } from "../process/coldUnitLocation"
import { getAppStore } from "./store/appStore"

/**
 * What is stored on the current backend, as two sets.
 * - `units`: cold-storage unit keys, without any directory prefix or suffix.
 * - `assets`: asset keys in the form `assets/<name>`, whatever the backend.
 */
export interface StorageListing {
    units: ReadonlySet<string>
    assets: ReadonlySet<string>
}

const ASSET_PREFIX = 'assets/'

/** null until a complete listing has been recorded, and again after a listing failed. */
let recorded: StorageListing | null = null

/**
 * The names of the units kept as OPFS root files before units went through the
 * byte store. Only the web build can hold any: a browser without
 * `navigator.storage.getDirectory` has none, so there is nothing to list. A
 * `getDirectory` that rejects fails the listing, so it is never mistaken for an
 * empty one.
 */
async function listLegacyOpfsUnitNames(): Promise<string[]> {
    if (isTauri || isNodeServer || typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
        return []
    }
    const opfs = await navigator.storage.getDirectory()
    const names: string[] = []
    for await (const [name] of opfs.entries()) {
        const key = legacyOpfsUnitKeyOfName(name)
        if (key !== null) {
            names.push(key)
        }
    }
    return names
}

/**
 * Every stored name that may be a unit: the page store's entries under
 * `coldstorage/` (on the desktop the `.json` files directly in that folder),
 * united on the web with the legacy OPFS unit files. The names are not checked
 * against the key rule. Rejects when either listing cannot be taken.
 */
export async function listStoredUnitNames(): Promise<string[]> {
    const names = new Set<string>()
    for (const storeKey of await (await getAppStore()).list(COLD_UNIT_STORE_PREFIX)) {
        const name = coldUnitKeyOfStoreKey(storeKey)
        if (name !== null) {
            names.add(name)
        }
    }
    for (const name of await listLegacyOpfsUnitNames()) {
        names.add(name)
    }
    return Array.from(names)
}

/**
 * The asset keys the page's byte store lists. The store hides the temp file of
 * an atomic write. On the desktop a nested key is left out: only a file
 * directly under `assets/` is ever a candidate for deletion.
 */
async function listAssetKeys(): Promise<Set<string>> {
    const keys = await (await getAppStore()).list(ASSET_PREFIX)
    return new Set(isTauri ? keys.filter((key) => !key.slice(ASSET_PREFIX.length).includes('/')) : keys)
}

/** The unit names that may be unit keys: a stored name the key rule rejects is never listed, so it is never a candidate for deletion. */
function safeUnitKeys(names: Iterable<string>): Set<string> {
    const keys = new Set<string>()
    for (const name of names) {
        if (isSafeColdStorageKey(name)) {
            keys.add(name)
        }
    }
    return keys
}

/**
 * Lists the units and the assets on the current backend right now. Rejects
 * when either listing cannot be taken. Units and assets both come from the
 * page's byte store, the units also from the legacy OPFS files on the web. Only
 * stored names that can be unit keys (`isSafeColdStorageKey`) are listed as
 * units.
 */
export async function takeStorageListing(): Promise<StorageListing> {
    const units = safeUnitKeys(await listStoredUnitNames())
    return { units, assets: await listAssetKeys() }
}

/**
 * Records what is stored at load time, so the manual clean-up only ever
 * removes what already existed when this page loaded: anything written after
 * this point, by this page or by another device, is not this listing's to
 * delete. Never rejects: a failed listing records "no listing", and the
 * clean-up then deletes nothing.
 */
export async function recordLoadTimeListing(): Promise<void> {
    try {
        recorded = await takeStorageListing()
    } catch (error) {
        console.error('Listing the stored units and assets at load failed:', error)
        recorded = null
    }
}

/** The listing taken at load, or null when none was recorded or it failed. */
export function getLoadTimeListing(): StorageListing | null {
    return recorded
}

/** Clears the recorded load-time listing between tests. */
export function resetLoadTimeListingForTests(): void {
    recorded = null
}
