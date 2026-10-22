import type { Store2Backend } from '../backend/types'

/**
 * The collector's mark timing in a measurement build. `autoGc.ts` calls `meterGcBackend` only under `if (MEASURE)`, so a
 * normal build folds the call away and drops this module and the `gcMarkMs=` text with it (`util/checkReleaseDist.mjs`
 * lists the text).
 *
 * The decorator wraps the backend the pass is given, which is the session's flush tracker and never a re-created backend,
 * so the pass runs exactly the calls it would run unmetered. A round's mark time runs from the start of its commit-key
 * read to the start of its listing: it covers the manifest and unit reads, the fence read and the gate. A round that
 * never reaches the listing (a refusal) records nothing. Nothing here throws into the pass.
 */

export interface GcMeter {
    /** The backend to hand to the pass. */
    backend: Store2Backend
    /** The mark time of each round that reached its listing, in milliseconds. */
    markMs(): number[]
}

export function meterGcBackend(backend: Store2Backend, now: () => number = () => performance.now()): GcMeter {
    const marks: number[] = []
    let markStart: number | null = null
    const metered = new Proxy(backend, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property, target)
            if (typeof value !== 'function') {
                return value
            }
            const method = value as (...args: unknown[]) => unknown
            switch (property) {
                case 'readCommit':
                    return (...args: unknown[]) => {
                        markStart = now()
                        return method.apply(target, args)
                    }
                case 'listStore2':
                    return (...args: unknown[]) => {
                        if (markStart !== null) {
                            marks.push(now() - markStart)
                            markStart = null
                        }
                        return method.apply(target, args)
                    }
                default:
                    return method.bind(target)
            }
        },
    })
    return { backend: metered, markMs: () => [...marks] }
}

/**
 * Records the plain result line with the round marks through `noteImportPhase` (`drive/storeImport.ts`), the established
 * note of the measurement builds that the export also uses: it lands in the `__risuImportPhases` ring when the page's
 * `localStorage` holds `risu-measure-import` = `on`. Returns the same text for the console line. The ring module is reached
 * only through `noteImportPhase`: a direct import of it from here would keep it in a normal bundle.
 */
export async function noteMeasuredGcResult(line: string, meter: GcMeter | null): Promise<string> {
    const measured = line + formatGcMarkMs(meter === null ? [] : meter.markMs())
    try {
        // Loaded on use: the import module needs a browser page, which a protocol test does not have, and a failure here
        // never reaches the pass.
        const { noteImportPhase } = await import('../../../drive/storeImport')
        noteImportPhase(measured)
    } catch {
        // A measurement failure never reaches the pass.
    }
    return measured
}

/** The measured part of the result line, appended to the plain line. */
export function formatGcMarkMs(marks: readonly number[]): string {
    return ` gcMarkMs=${marks.length === 0 ? '-' : marks.map(ms => Math.round(ms)).join(',')}`
}
