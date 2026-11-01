/**
 * The build-time switch that makes one chosen module fail to load, for device checks of the load-failure path.
 * This module imports nothing. It is loaded only by the module loader's dynamic import inside the branch that tests
 * `VITE_RISU_MODULE_FAULT === '1'`, and application source must never import it statically: a build without the flag
 * then holds no chunk, no sourcemap entry, no key and no fault text of it. The key and the fault text are defined here
 * and nowhere else in the application source.
 */

/** The localStorage key whose value is the id of the module that fails to load. */
export const MODULE_FAULT_KEY = 'risu-fault-module-load'

/** The text every faulted load carries, so a failure caused by the switch is recognisable. */
export const MODULE_FAULT_TEXT = 'module fault switch'

/**
 * True only when the key holds exactly `id`. Read at every call, never cached, so a set or cleared key takes effect at
 * the next load; a missing or throwing localStorage reads as off. It never writes the key.
 */
export function moduleFaultActive(id: string): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(MODULE_FAULT_KEY) === id
    } catch {
        return false
    }
}

/** The error a faulted load reports as its read failure. */
export function moduleFaultError(id: string): Error {
    return new Error(`${MODULE_FAULT_TEXT}: ${MODULE_FAULT_KEY} names module ${id}`)
}
