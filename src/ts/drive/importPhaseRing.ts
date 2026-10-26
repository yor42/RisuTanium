/**
 * The console-free sink of the measurement notes of a measurement build: the import phases (`noteImportPhase` in
 * storeImport.ts), the restore refusal note and the export reopen size note all go through `noteMeasurePhase` below, which
 * pushes here only after its `MEASURE` and `localStorage` gates, so a normal build folds the push away and drops this module
 * and the global name with it. The build strips `console.*` from application source in every vite build, measurement builds
 * included, so the console line of `noteMeasurePhase` exists only under `pnpm dev`; on a measurement build this ring is the
 * output.
 *
 * Use: in the console of the page, `__risuImportPhases.snapshot()` and `.reset()`.
 *
 * The ring holds the newest `IMPORT_PHASE_RING_LIMIT` entries. A push never throws into the import: a failure inside the
 * ring is swallowed.
 */

import { MEASURE } from '../process/memory/measureFlag'

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

const MEASURE_NOTE_KEY = 'risu-measure-import'

/**
 * Measurement builds only (`MEASURE`), and only when `localStorage` says `on` under `risu-measure-import`: logs the
 * phase, the time since the page started and, where the engine reports it, the JS heap in use, and records the same in
 * the ring. A normal build folds the condition away and logs and records nothing. This is the one switch of every note
 * (`noteImportPhase`, the export reopen size line, the restore refusal line); it lives here, in a module that imports
 * only the flag, so a writer module can use it without joining the import graph of `storeImport.ts`.
 */
export function noteMeasurePhase(phase: string): void {
    if (!MEASURE) {
        return
    }
    try {
        if (typeof localStorage === 'undefined' || localStorage.getItem(MEASURE_NOTE_KEY) !== 'on') {
            return
        }
    } catch {
        return
    }
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    const t = Math.round(performance.now())
    console.info(`[import-measure] ${phase} t=${t}ms heap=${heap === undefined ? 'n/a' : `${Math.round(heap / (1024 * 1024))}MiB`}`)
    pushImportPhase(phase, t, heap === undefined ? null : Math.round(heap / (1024 * 1024)))
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
