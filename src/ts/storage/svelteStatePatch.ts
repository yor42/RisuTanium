// The one module that imports Svelte's internal client runtime. It is plain .ts because Svelte's compiler rejects
// `svelte/internal/*` imports in runes modules; runes modules import dbWriteHook.ts instead. The import is a static
// named one with no feature detection on purpose: against a runtime without the patch (patches/svelte-5.57.3,
// served by patches/svelte-5.57.3/plugin.mjs) a build fails on the missing export, and the load-hook test fails.
import {
    set_state_write_hook,
    link_state_child,
    state_records,
    record_of,
    PATCH_ID,
} from 'svelte/internal/client'
import type {
    StateLinkCallback,
    StateRecord,
    StateRecordLink,
    StateWriteCallback,
    StateWriteKind,
} from 'svelte/internal/client'

export type { StateLinkCallback, StateRecord, StateRecordLink, StateWriteCallback, StateWriteKind }

/** Registers the write callback, the error sink for both callbacks, and the link callback. `null` unregisters. */
export const setStateWriteHook = set_state_write_hook
/** Records that `child` (a state proxy) was stored under `key` of `parent`; a no-op for any other child. */
export const linkStateChild = link_state_child
/** The patch's record of every state proxy that was stored in another proxy or asked for. */
export const stateRecords = state_records
export const recordOf = record_of
/** Names the patch revision; shipped inside the error sink label so a build can be checked for it. */
export const STATE_PATCH_ID: string = PATCH_ID
