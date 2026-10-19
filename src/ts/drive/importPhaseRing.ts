/**
 * The console-free sink of the import phases of a measurement build. `noteImportPhase` (storeImport.ts) pushes here only
 * after its `MEASURE` and `localStorage` gates, so a normal build folds the push away and drops this module and the global
 * name with it. The build strips `console.*` from application source in every vite build, measurement builds included, so
 * the console line of `noteImportPhase` exists only under `pnpm dev`; on a measurement build this ring is the output.
 *
 * Use: in the console of the page, `__risuImportPhases.snapshot()` and `.reset()`.
 *
 * The ring holds the newest `IMPORT_PHASE_RING_LIMIT` entries. A push never throws into the import: a failure inside the
 * ring is swallowed.
 */

export interface ImportPhaseRecord {
    phase: string
    /** Milliseconds since the page started (`performance.now()`). */
    t: number
    /** The JS heap in use in MiB where the engine reports it, otherwise `null`. */
    heapMiB: number | null
}

export interface ImportPhaseRingHandle {
    snapshot(): ImportPhaseRecord[]
    reset(): void
}

export const IMPORT_PHASE_RING_LIMIT = 200

const records: ImportPhaseRecord[] = []

const handle: ImportPhaseRingHandle = {
    snapshot: () => records.map(record => ({ ...record })),
    reset: () => { records.length = 0 },
}

function installGlobal(target: object): void {
    ;(target as { __risuImportPhases?: ImportPhaseRingHandle }).__risuImportPhases = handle
}

/** Records one phase and makes sure the global exists. Never throws. */
export function pushImportPhase(phase: string, t: number, heapMiB: number | null, target: object = globalThis): void {
    try {
        installGlobal(target)
        records.push({ phase, t, heapMiB })
        if (records.length > IMPORT_PHASE_RING_LIMIT) {
            records.splice(0, records.length - IMPORT_PHASE_RING_LIMIT)
        }
    } catch {
        // A measurement failure never reaches the import.
    }
}
