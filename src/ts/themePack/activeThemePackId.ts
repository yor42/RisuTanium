// The single writer of the active pack id. It is a leaf (the database state only), so the turn-off path can use it without
// pulling in the install transaction's storage and hashing imports.
import { DBState } from '../stores.svelte'

/** Sets or clears the active pack id (a record id or `builtin:<slug>`); `undefined` deletes the key, so no `undefined` value is stored. */
export function setActiveThemePack(id: string | undefined): void {
    if (id === undefined) {
        delete DBState.db.activeThemePack
    } else {
        DBState.db.activeThemePack = id
    }
}
