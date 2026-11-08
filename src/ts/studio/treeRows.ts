// Row identity for the Studio tree: a rebuilt row list keeps the previous object of every row whose fields are all
// unchanged, so the keyed list can skip it. A row that differs in any field is always the fresh object.

function sameValue(left: unknown, right: unknown): boolean {
    if (left === right) return true
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry: unknown, index) => entry === right[index])
}

function sameRow(left: object, right: object): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
        const a: unknown = Reflect.get(left, key)
        const b: unknown = Reflect.get(right, key)
        if (!sameValue(a, b)) return false
    }
    return true
}

/**
 * Returns `next` with each row replaced by its `previous` object (by id) when every own field is `===`; array
 * fields are compared element by element. `byId` maps every returned row, to be passed as `previous` next time.
 */
export function reuseUnchangedRows<T extends { id: string }>(
    previous: ReadonlyMap<string, T>,
    next: T[],
): { rows: T[], byId: Map<string, T> } {
    const byId = new Map<string, T>()
    const rows = next.map((row) => {
        const old = previous.get(row.id)
        const kept = old !== undefined && sameRow(old, row) ? old : row
        byId.set(kept.id, kept)
        return kept
    })
    return { rows, byId }
}
