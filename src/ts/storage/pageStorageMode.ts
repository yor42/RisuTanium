import { writable } from 'svelte/store'
import type { TooNewSource } from './store2/boot'
import type { Store2LegacyReadOnlyReason } from './store2/bootActive'

/**
 * What the page's persistence is, as boot found it and as it has moved since.
 * One value per page load; `bootstrap.ts` sets it, the boot archive pass's
 * commit seam moves it from `legacy` to `block` when a conversion wins, and the
 * writers that run later read it.
 *
 * - `block`: a head exists (or this page created one). Saves are commits into
 *   the live generation.
 * - `legacy`: no head existed at boot and the main file is still the profile.
 *   The first whole-state replace this page makes is the conversion.
 *   `convertedFrom` is the fingerprint of the exact main-file bytes boot read
 *   (`null` when there were none to read). It is taken at read time because
 *   boot drops the bytes after the decode, and every whole-state replace this
 *   page makes while no head exists passes it, so the converted head names the
 *   file the rename finish may move aside.
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
 * The fingerprint a whole-state replace made while no head exists must pass as
 * `convertedFrom`, or `undefined` on any other page.
 */
export function pendingConvertedFrom(): string | undefined {
    return mode.kind === 'legacy' && mode.convertedFrom !== null ? mode.convertedFrom : undefined
}

/**
 * Whether a page in this mode may run the deleters of the block and main-file
 * era: the numbered-backup prune, the manual clean-up, the startup clean-up and
 * the boot listing that feeds it. Only `legacy` and `block` pages own the keys
 * those deleters remove. A `store2` page owns different keys and a `read-only`
 * page writes nothing; an `unset` page has not been decided yet, so it must not
 * delete either. Callers test this positive answer, never `kind !== 'store2'`:
 * a mode added later stays refused until it is named here.
 */
export function modeRunsLegacyDeleters(candidate: PageStorageMode): boolean {
    return candidate.kind === 'legacy' || candidate.kind === 'block'
}

/** `modeRunsLegacyDeleters` for this page's current mode. */
export function pageRunsLegacyDeleters(): boolean {
    return modeRunsLegacyDeleters(mode)
}

/** Whether boot starts the legacy startup clean-up (remote blocks and the asset sweep) on this page. */
export function startsLegacyStartupCleanup(): boolean {
    return pageRunsLegacyDeleters()
}

/**
 * Whether boot records the load-time listing of units and assets. Its only
 * consumer is the manual clean-up, so a page that refuses that clean-up does
 * not pay for the listing.
 */
export function recordsLoadTimeListing(): boolean {
    return pageRunsLegacyDeleters()
}

// -- the startup asset sweep --------------------------------------------------

/**
 * Whether the startup asset sweep is held off for this page. It is held off
 * while any kept generation exists (a damaged save, or an older one under an
 * unreadable head, that may still reference assets no live tree names) and,
 * for the rest of the page, after a damage-path replace won: the same boot
 * must not sweep what the kept generation references. It stops only the asset
 * sweep, never the remote-block clean-up.
 */
let assetSweepHeld = false

export function holdAssetSweep(): void {
    assetSweepHeld = true
}

export function isAssetSweepHeld(): boolean {
    return assetSweepHeld
}

// -- what the rename finish found ---------------------------------------------

/**
 * A main file the rename finish could not move aside because the Node server
 * would refuse to copy it, noted by whichever step ran the finish (a boot, or
 * the conversion inside the boot archive pass) and taken once by the boot, which
 * tells the user.
 */
let mainFileLeftOverLimit = false

export function noteMainFileLeftOverLimit(): void {
    mainFileLeftOverLimit = true
}

export function takeMainFileLeftOverLimit(): boolean {
    const noted = mainFileLeftOverLimit
    mainFileLeftOverLimit = false
    return noted
}

export function resetPageStorageModeForTests(): void {
    mode = { kind: 'unset' }
    pageStorageModeStore.set(mode)
    assetSweepHeld = false
    mainFileLeftOverLimit = false
}
