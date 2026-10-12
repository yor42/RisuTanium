import { MODEL_STATUS_TABLE, type ModelStatusEntry } from './modelStatusTable'

/** Only the local calendar getters are read, so a caller can pass any clock that has them. */
export type ClockDate = Pick<Date, 'getFullYear' | 'getMonth' | 'getDate'>

export type ModelIdStatus =
    | { kind: 'ok' }
    | { kind: 'retired', date?: string }
    | { kind: 'redirected', target: string }
    | { kind: 'deprecated', date: string }

const RESPONSE_API_SUFFIX = '-response-api'

/** Local `YYYY-MM-DD`, zero-padded so that string order is date order. */
export function localDateString(now: ClockDate): string {
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

function ownRow(table: Readonly<Record<string, ModelStatusEntry>>, id: string): ModelStatusEntry | undefined {
    return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined
}

/**
 * Status of a catalog id against `table`. An explicit row wins; otherwise a `-response-api` twin
 * takes its base id's row (same provider and model). A `-vertex` twin never inherits: Vertex has
 * its own lifecycle. A deprecated row is retired from its shutdown day on.
 */
export function resolveModelStatus(table: Readonly<Record<string, ModelStatusEntry>>, id: string, now: ClockDate): ModelIdStatus {
    let row = ownRow(table, id)
    if (row === undefined && id.endsWith(RESPONSE_API_SUFFIX)) {
        row = ownRow(table, id.slice(0, -RESPONSE_API_SUFFIX.length))
    }
    if (row === undefined) {
        return { kind: 'ok' }
    }
    switch (row.kind) {
        case 'retired':
            return row.date === undefined ? { kind: 'retired' } : { kind: 'retired', date: row.date }
        case 'redirected':
            return { kind: 'redirected', target: row.target }
        case 'deprecated':
            return row.date <= localDateString(now)
                ? { kind: 'retired', date: row.date }
                : { kind: 'deprecated', date: row.date }
    }
}

/** Lifecycle of a catalog id on the current local day; ids outside the catalog table are `ok`. */
export function modelIdStatus(id: string, opts: { now?: ClockDate } = {}): ModelIdStatus {
    return resolveModelStatus(MODEL_STATUS_TABLE, id, opts.now ?? new Date())
}

/** Retired and redirected ids are not offered for selection; deprecated ones stay listed. */
export function isHiddenFromPicker(status: ModelIdStatus): boolean {
    return status.kind === 'retired' || status.kind === 'redirected'
}
