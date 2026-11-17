/**
 * The long-text fields' one macro index. The registry import pulls the CBS module and the stores, so it is loaded on
 * the first request only and the index is built once. A failed import rejects; the next request tries again.
 */
import { createMacroIndex, type MacroIndex } from './macroIndex'

let seam: MacroIndex | null = null
let loaded: Promise<MacroIndex> | null = null

export function loadMacroIndex(): Promise<MacroIndex> {
    if (seam) return Promise.resolve(seam)
    if (loaded === null) {
        loaded = import('./macroRegistry').then(
            (module) => createMacroIndex(module.collectMacroEntries()),
            (error: unknown) => {
                loaded = null
                throw error
            },
        )
    }
    return loaded
}

/** Replaces the index, or restores the real one with `null`. The real index is also forgotten. */
export function setMacroIndexForTests(index: MacroIndex | null): void {
    seam = index
    if (index === null) loaded = null
}
