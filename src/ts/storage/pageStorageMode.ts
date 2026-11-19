import { writable } from 'svelte/store'
import type { TooNewSource } from './store2/boot'
import type { Store2LegacyReadOnlyReason } from './store2/bootActive'

/**
 * What the page's persistence is, as boot found it and as it has moved since.
 * One value per page load; `bootstrap.ts` and the store2 dispatch set it, and
 * the writers that run later read it. No production path sets `block` or
 * `legacy`: those members remain only in the type.
 *
 * - `block`: retired; no page runs in it.
 * - `legacy`: retired; no page runs in it.
 * - `store2`: the profile is a store2 tree this page opened. Saves are store2 commits; no write goes to the legacy
 *   block or main-file store.
 * - `read-only`: nothing is written this page load (the page runs from OPFS, or the boot found a store it must not
 *   write).
 * - `unset`: boot has not decided yet.
 */
export type PageStorageMode =
    | { kind: 'unset' }
    | { kind: 'block' }
    | { kind: 'legacy', convertedFrom: string | null }
    | { kind: 'store2' }
    | PageReadOnlyMode

/**
 * A read-only page and why it is one, as a returned fact: nothing displayed or decided reads `reason` (the
 * read-only wording keeps its own probe-first order and OPFS precedence). `too-new` names the store part that was
 * written by a newer version.
 */
export type PageReadOnlyMode =
    | { kind: 'read-only', reason: Store2LegacyReadOnlyReason }
    | { kind: 'read-only', reason: 'too-new', source: TooNewSource }

let mode: PageStorageMode = { kind: 'unset' }

/**
 * The same mode as a store, for a component that is created before boot has
 * decided it (the app is mounted before the profile loads) and must follow it.
 */
export const pageStorageModeStore = writable<PageStorageMode>(mode)

export function getPageStorageMode(): PageStorageMode {
    return mode
}

export function setPageStorageMode(next: PageStorageMode): void {
    mode = next
    pageStorageModeStore.set(next)
}

/**
 * Whether a page in this mode may become interactive: a `read-only` page, which refuses every write, or a `store2` page
 * that holds its active save, which is what every later write goes through. Any other mode, and a `store2` page with no
 * save, can neither save nor refuse, so it must not go live. Callers test this positive answer, never a list of the
 * modes that may not: a mode added later stays refused until it is named here.
 */
export function pageMayGoLive(candidate: PageStorageMode, hasActiveStore2Save: boolean): boolean {
    return candidate.kind === 'read-only' || (candidate.kind === 'store2' && hasActiveStore2Save)
}

export function resetPageStorageModeForTests(): void {
    mode = { kind: 'unset' }
    pageStorageModeStore.set(mode)
}
