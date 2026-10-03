import { BaseDirectory, exists, readDir } from "@tauri-apps/plugin-fs"
import { forageStorage } from "../globalApi.svelte"
import { isNodeServer, isTauri } from "../platform"
import { isSafeColdStorageKey } from "../process/coldStorageKey"
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

const UNIT_PREFIX = 'coldstorage/'
const ASSET_PREFIX = 'assets/'
const OPFS_UNIT_PREFIX = 'coldstorage_'
const UNIT_JSON_SUFFIX = '.json'

/** null until a complete listing has been recorded, and again after a listing failed. */
let recorded: StorageListing | null = null

/**
 * Lists one Tauri app-data directory. A directory that does not exist is an
 * empty listing (the units directory is only created by the first unit
 * write); any other failure rejects, so a listing that could not be taken is
 * never mistaken for an empty one. Whether the directory exists is decided by
 * `exists()`, never by the wording or code of the read error, which differs
 * per platform.
 */
async function listTauriDirectory(dir: string): Promise<string[]> {
    try {
        const entries = await readDir(dir, { baseDir: BaseDirectory.AppData })
        return entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name)
    } catch (error) {
        if (!await exists(dir, { baseDir: BaseDirectory.AppData })) {
            return []
        }
        throw error
    }
}

async function listOpfsUnits(): Promise<string[]> {
    const opfs = await navigator.storage.getDirectory()
    const keys: string[] = []
    for await (const [name] of opfs.entries()) {
        if (name.startsWith(OPFS_UNIT_PREFIX) && name.endsWith(UNIT_JSON_SUFFIX)) {
            keys.push(name.slice(OPFS_UNIT_PREFIX.length, -UNIT_JSON_SUFFIX.length))
        }
    }
    return keys
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
 * when either listing cannot be taken. Units are listed from their own
 * directory or prefix; assets always through the byte store, so a Node server
 * answers two listings. Only stored names that can be unit keys
 * (`isSafeColdStorageKey`) are listed as units.
 */
export async function takeStorageListing(): Promise<StorageListing> {
    if (isTauri) {
        const unitNames = await listTauriDirectory('coldstorage')
        return {
            units: safeUnitKeys(unitNames.filter((name) => name.endsWith(UNIT_JSON_SUFFIX)).map((name) => name.slice(0, -UNIT_JSON_SUFFIX.length))),
            assets: await listAssetKeys(),
        }
    }
    const keys = await forageStorage.keys()
    const assets = await listAssetKeys()
    if (isNodeServer) {
        return {
            units: safeUnitKeys(keys.filter((key) => key.startsWith(UNIT_PREFIX)).map((key) => key.slice(UNIT_PREFIX.length))),
            assets,
        }
    }
    return { units: safeUnitKeys(await listOpfsUnits()), assets }
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
