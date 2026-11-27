/**
 * Which lorebook folders are expanded in Studio's list, kept per owner on this device only. It is never part of the
 * database or a backup, and a storage that is missing, full or throwing just means "all folders collapsed".
 */

const KEY_PREFIX = 'risuStudio.loreFolders.'

export function readExpandedFolders(ownerKey: string): Set<string> {
    try {
        const raw = globalThis.localStorage.getItem(KEY_PREFIX + ownerKey)
        if (raw === null || raw === '') return new Set()
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((key): key is string => typeof key === 'string'))
    } catch {
        return new Set()
    }
}

export function writeExpandedFolders(ownerKey: string, keys: ReadonlySet<string>): void {
    try {
        if (keys.size === 0) globalThis.localStorage.removeItem(KEY_PREFIX + ownerKey)
        else globalThis.localStorage.setItem(KEY_PREFIX + ownerKey, JSON.stringify([...keys]))
    } catch {
        // Expansion is a convenience; a storage that refuses it changes nothing else.
    }
}

/** Adds `keys` to the owner's expanded set and writes once. Returns the set now stored. */
export function expandFolders(ownerKey: string, keys: readonly string[]): Set<string> {
    const set = readExpandedFolders(ownerKey)
    let changed = false
    for (const key of keys) {
        if (!set.has(key)) {
            set.add(key)
            changed = true
        }
    }
    if (changed) writeExpandedFolders(ownerKey, set)
    return set
}
