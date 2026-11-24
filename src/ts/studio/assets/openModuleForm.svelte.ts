// The id of the module the Studio detail has selected while it can take writes, which the history service needs to
// accept a module write and the History panel needs to reach the module's steps. A leaf: it imports no store and no service, so a module that
// imports it reads nothing from the database and no import cycle can form.
//
// Only the published id and the withdrawn id are reactive. The token counter, the check in `clearOpenModuleId` and the
// plain copy of the withdrawn id are plain variables, so a publish never reads what it writes: a publish runs inside the
// detail's effect, and a read of reactive state there would run that effect again.

let published = $state<string | null>(null)
// The id an import replace took from the published slot. The detail reads it to clear its selection; it is reactive for
// that read only and never gates a write.
let withdrawn = $state<string | null>(null)
let withdrawnNow: string | null = null
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
    if (id !== withdrawnNow) clearWithdrawnOpenModuleId()
    return counter
}

/** Clears the published id only when `token` is still the latest publish, so an older publish never clears a newer one's id. */
export function clearOpenModuleId(token: number): void {
    if (token !== current) return
    published = null
}

/**
 * Takes the published slot away from id when id is the published id, and records it as withdrawn. Every module write
 * is refused `not-selected` from then on, so text a form still holds never lands on the content that replaced the
 * module. The token is left alone: a teardown's later clear only sets an already-null id to null. Any other id changes
 * nothing.
 */
export function withdrawOpenModuleId(id: string): void {
    if (published !== id) return
    published = null
    withdrawnNow = id
    withdrawn = id
}

/** The id a replace withdrew and the detail has not yet handled, or null. */
export function withdrawnOpenModuleId(): string | null {
    return withdrawn
}

/** The detail calls this once it has cleared its selection for the withdrawn id. */
export function clearWithdrawnOpenModuleId(): void {
    withdrawnNow = null
    withdrawn = null
}

export function resetOpenModuleIdForTests(): void {
    published = null
    withdrawnNow = null
    withdrawn = null
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
