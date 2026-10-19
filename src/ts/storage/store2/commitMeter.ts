import { BULK_UNIT_THRESHOLD, type Store2Backend, type UnitWrite } from './backend/types'
import type { CommitRequest, CommitResult, Committer } from './commit'
import { parseStore2Key } from './format'

/**
 * The commit meter of a measurement build: per commit, the bytes handed to the backend (units, manifest and commit
 * key, separately and in total), the elapsed time, the kind and the outcome. It exists only in a measurement build:
 * `session.ts` calls `meterCommitter` only under `if (MEASURE)`, so a normal build folds the call away and drops this
 * module and the global name with it.
 *
 * Use: in the console of a store2 page, `__risuCommitMeter.last()`, `.all()` and `.reset()`. Every commit also reaches
 * a `risu-measure-commit` console line, but the build strips `console.*` (the plugin-strip step in `vite.config.ts`)
 * in every vite build, measurement builds included, so that line exists only under `pnpm dev`; on a measurement build
 * the `__risuCommitMeter` global is the only output.
 *
 * The meter never throws into or reorders a commit: counting happens before the unchanged call is passed on, and a
 * failure inside the meter is swallowed. The commit starts synchronously; the result reaches the caller a few
 * microtasks later than the inner promise would, which callers do not depend on because they await it directly.
 *
 * `forced` is recorded for any request with `force: true`, not only `saveMine`. Every .bin import commit forces, so an
 * import is recorded as `forced` and never as `bulk`, whatever mode it ran in.
 *
 * Limit: only the committer's own writes pass through the metered backend, so a collector pass, an old-data deletion or
 * an import that writes through the page's other backend handle is not counted. `pin`, `unpin`, `dropSnapshot`,
 * `clearMarker` and `abandonClear` also write through the metered backend but are not recorded themselves; one that
 * runs during a measured commit adds its bytes to that commit without setting `overlapped`. `units` counts the
 * manifest as well as the other units and does not count the commit key. If two commits of this committer overlap in
 * time, the bytes of both are added to both and both records say `overlapped: true`; the save loop runs one commit at
 * a time, so this does not occur in normal use.
 */

export type CommitMeterKind = 'ordinary' | 'bulk' | 'forced' | 'restore'

export interface CommitMeterRecord {
    kind: CommitMeterKind
    /** The result status: `committed`, `conflict`, `abandoned`, and so on; `threw` when the commit threw. */
    outcome: string
    units: number
    unitBytes: number
    manifestBytes: number
    commitKeyBytes: number
    totalBytes: number
    ms: number
    overlapped: boolean
}

export interface CommitMeterHandle {
    last(): CommitMeterRecord | null
    all(): CommitMeterRecord[]
    reset(): void
}

const RECORD_LIMIT = 1000

interface Tally {
    units: number
    unitBytes: number
    manifestBytes: number
    commitKeyBytes: number
    overlapped: boolean
}

const records: CommitMeterRecord[] = []
const active = new Set<Tally>()

const handle: CommitMeterHandle = {
    last: () => records.length === 0 ? null : records[records.length - 1],
    all: () => [...records],
    reset: () => { records.length = 0 },
}

function installGlobal(target: object): void {
    ;(target as { __risuCommitMeter?: CommitMeterHandle }).__risuCommitMeter = handle
}

function count(add: (tally: Tally) => void): void {
    try {
        for (const tally of active) {
            add(tally)
        }
    } catch {
        // A measurement failure never reaches the commit.
    }
}

function countUnit(unit: UnitWrite): void {
    count(tally => {
        tally.units++
        const shape = parseStore2Key(unit.key)?.shape
        if (shape === 'manifest' || shape === 'staged-manifest') {
            tally.manifestBytes += unit.bytes.length
        } else {
            tally.unitBytes += unit.bytes.length
        }
    })
}

function countCommitKey(bytes: Uint8Array): void {
    count(tally => { tally.commitKeyBytes += bytes.length })
}

/** The same backend with the write calls counted before they are passed on unchanged. */
function meterBackend(backend: Store2Backend): Store2Backend {
    return new Proxy(backend, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property, target)
            if (typeof value !== 'function') {
                return value
            }
            const method = value as (...args: unknown[]) => unknown
            switch (property) {
                case 'putUnit':
                    return (key: string, bytes: Uint8Array) => {
                        countUnit({ key, bytes })
                        return method.call(target, key, bytes)
                    }
                case 'commitOrdinary':
                    return (expected: unknown, units: readonly UnitWrite[], next: Uint8Array) => {
                        try {
                            units.forEach(countUnit)
                            countCommitKey(next)
                        } catch {
                            // A measurement failure never reaches the commit.
                        }
                        return method.call(target, expected, units, next)
                    }
                case 'casCommit':
                    return (expected: unknown, next: Uint8Array) => {
                        countCommitKey(next)
                        return method.call(target, expected, next)
                    }
                default:
                    return method.bind(target)
            }
        },
    })
}

function statusOf(result: unknown): string {
    const status = (result as { status?: unknown } | null)?.status
    return typeof status === 'string' ? status : 'unknown'
}

function kindOfCommit(request: CommitRequest, result: CommitResult | null, forced: boolean): CommitMeterKind {
    if (forced || request.force === true) {
        return 'forced'
    }
    if (result !== null && result.status === 'committed') {
        return result.mode
    }
    return request.newUnits > BULK_UNIT_THRESHOLD ? 'bulk' : 'ordinary'
}

async function measured<T>(run: () => Promise<T>, finish: (result: T | null) => CommitMeterKind): Promise<T> {
    let tally: Tally | null = null
    let started = 0
    try {
        tally = { units: 0, unitBytes: 0, manifestBytes: 0, commitKeyBytes: 0, overlapped: active.size > 0 }
        for (const other of active) {
            other.overlapped = true
        }
        active.add(tally)
        started = performance.now()
    } catch {
        tally = null
    }
    let result: T | null = null
    let outcome = 'threw'
    try {
        result = await run()
        outcome = statusOf(result)
        return result
    } finally {
        try {
            if (tally !== null) {
                active.delete(tally)
                const record: CommitMeterRecord = {
                    kind: finish(result),
                    outcome,
                    units: tally.units,
                    unitBytes: tally.unitBytes,
                    manifestBytes: tally.manifestBytes,
                    commitKeyBytes: tally.commitKeyBytes,
                    totalBytes: tally.unitBytes + tally.manifestBytes + tally.commitKeyBytes,
                    ms: performance.now() - started,
                    overlapped: tally.overlapped,
                }
                records.push(record)
                if (records.length > RECORD_LIMIT) {
                    records.shift()
                }
                console.log('risu-measure-commit', record)
            }
        } catch {
            // A measurement failure never reaches the commit.
        }
    }
}

/**
 * Builds the committer over the metered backend and wraps its write calls. `make` receives the metered backend and
 * returns the committer exactly as an unmetered build would have made it.
 */
export function meterCommitter(backend: Store2Backend, make: (backend: Store2Backend) => Committer, target: object = globalThis): Committer {
    let metered: Store2Backend
    try {
        metered = meterBackend(backend)
        installGlobal(target)
    } catch {
        return make(backend)
    }
    const inner = make(metered)
    return {
        ...inner,
        commit: (read, request) => measured(() => inner.commit(read, request), result => kindOfCommit(request, result, false)),
        saveMine: (read, request) => measured(() => inner.saveMine(read, request), result => kindOfCommit(request, result, true)),
        restore: (read, manifestKey) => measured(() => inner.restore(read, manifestKey), () => 'restore'),
    }
}
