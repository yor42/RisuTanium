import { matchesModuleRef, type ModuleRefShape } from './moduleRefs'

// A leaf on purpose: the module loader asks it after every install, and the loader is imported by tests that mock
// process/modules, so nothing here may pull in the reference list's database, persona or parser imports. moduleEnsure
// registers the real reference read at load.

let source: (() => readonly string[]) | null = null

/** Sets the read of the displayed origin's module references; null restores the unregistered state. */
export function setDisplayModuleRefSource(next: (() => readonly string[]) | null): void {
    source = next
}

/**
 * Whether the displayed origin references `slot`, read now. Only such a slot changes a chat body, its toggles or the
 * selected asset cache, which reload on the GUI pointer; the module list and Studio read the slot reactively.
 * Unregistered, or when the read fails, it answers true, because a missing reload is worse than an extra one.
 */
export function displayReferencesModule(slot: ModuleRefShape): boolean {
    if (source === null) {
        return true
    }
    try {
        return matchesModuleRef(slot, new Set(source()))
    }
    catch (error) {
        console.error(error)
        return true
    }
}
