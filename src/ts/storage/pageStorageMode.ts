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
 * - `read-only`: the page runs from OPFS this time. Nothing is written.
 * - `unset`: boot has not decided yet.
 */
export type PageStorageMode =
    | { kind: 'unset' }
    | { kind: 'block' }
    | { kind: 'legacy', convertedFrom: string | null }
    | { kind: 'read-only' }

let mode: PageStorageMode = { kind: 'unset' }

export function getPageStorageMode(): PageStorageMode {
    return mode
}

export function setPageStorageMode(next: PageStorageMode): void {
    mode = next
}

/**
 * The fingerprint a whole-state replace made while no head exists must pass as
 * `convertedFrom`, or `undefined` on any other page.
 */
export function pendingConvertedFrom(): string | undefined {
    return mode.kind === 'legacy' && mode.convertedFrom !== null ? mode.convertedFrom : undefined
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
    assetSweepHeld = false
    mainFileLeftOverLimit = false
}
