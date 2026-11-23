// Which sections of the preset advanced form the user collapsed, kept per preset on this device only (DD-099): never part
// of the database or a backup, and a storage that is missing, full or throwing just means "all sections expanded".

const KEY_PREFIX = 'risuStudio.presetSections.'

// The names of the collapsed sections of one preset.
export function readCollapsedSections(presetId: string): Record<string, boolean> {
    try {
        const raw = globalThis.localStorage.getItem(KEY_PREFIX + presetId)
        const parsed: unknown = raw === null ? null : JSON.parse(raw)
        if (!Array.isArray(parsed)) return {}
        const out: Record<string, boolean> = {}
        for (const name of parsed) {
            if (typeof name === 'string') out[name] = true
        }
        return out
    } catch {
        return {}
    }
}

export function writeCollapsedSections(presetId: string, collapsed: Readonly<Record<string, boolean>>): void {
    try {
        const names = Object.keys(collapsed).filter((name) => collapsed[name])
        if (names.length === 0) {
            globalThis.localStorage.removeItem(KEY_PREFIX + presetId)
        } else {
            globalThis.localStorage.setItem(KEY_PREFIX + presetId, JSON.stringify(names))
        }
    } catch {
        // The collapse state is a convenience; a storage that refuses it changes nothing else.
    }
}
