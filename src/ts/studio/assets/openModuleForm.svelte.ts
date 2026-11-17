// The id of the module the Studio detail has selected while it can take writes, which the history service needs to
// accept a module write and the History panel needs to reach the module's steps. A leaf: it imports no store and no service, so a module that
// imports it reads nothing from the database and no import cycle can form.
//
// Only the published id is reactive. The token counter and the check in `clearOpenModuleId` are plain variables, so a
// publish never reads what it writes.

let published = $state<string | null>(null)
let counter = 0
let current = 0

/** The raw id of the selected module, or null when none is selected, it is not loaded or private, or its id is shared by several modules. */
export function openStudioModuleId(): string | null {
    return published
}

/**
 * Sets the published id and returns the token of this publish. The detail publishes the selected module's id, or null
 * while the id is shared; its teardown clears with the token it was given.
 */
export function publishOpenModuleId(id: string | null): number {
    counter += 1
    current = counter
    published = id
    return counter
}

/** Clears the published id only when `token` is still the latest publish, so an older publish never clears a newer one's id. */
export function clearOpenModuleId(token: number): void {
    if (token !== current) return
    published = null
}

export function resetOpenModuleIdForTests(): void {
    published = null
    counter = 0
    current = 0
}

/** A module row of the database: the id it is stored under and its place in the module list. */
export interface ModuleRowRef {
    id: string
    index: number
}

/**
 * The row an owner id names. The Studio owner id of a module is its stored id for the first row holding that id and
 * `${id}#${rowIndex}` for a later row, and this follows that rule row by row, so the stored id is read from the row and
 * never cut out of the owner id (a stored id may itself hold a "#"). Null when no row has that owner id.
 */
export function moduleRowOf(rows: readonly { id: string }[], ownerId: string): ModuleRowRef | null {
    const used = new Set<string>()
    for (let index = 0; index < rows.length; index++) {
        const id = rows[index].id
        const owner = used.has(id) ? `${id}#${index}` : id
        used.add(owner)
        if (owner === ownerId) return { id, index }
    }
    return null
}
