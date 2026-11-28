// Which preset folders the user collapsed in the "Manage presets" sheet, kept on this device only (DD-099): never part of
// the database or a backup, and a storage that is missing, full or throwing just means "all folders expanded".

const KEY = 'risuStudio.presetFolders.collapsed'

export function readCollapsedFolders(): Set<string> {
    try {
        const raw = globalThis.localStorage.getItem(KEY)
        const parsed: unknown = raw === null ? null : JSON.parse(raw)
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((id): id is string => typeof id === 'string'))
    } catch {
        return new Set()
    }
}

export function writeCollapsedFolders(ids: ReadonlySet<string>): void {
    try {
        if (ids.size === 0) globalThis.localStorage.removeItem(KEY)
        else globalThis.localStorage.setItem(KEY, JSON.stringify([...ids]))
    } catch {
        // The collapse state is a convenience; a storage that refuses it changes nothing else.
    }
}