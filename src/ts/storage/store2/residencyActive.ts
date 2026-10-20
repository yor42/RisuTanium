import type { Residency, ResidencyRead } from './residency'

/**
 * The seam that tells the rest of the page whether a store2 residency exists. Like `saveActive.ts` it holds one
 * variable and imports types only, so the residency's module graph is loaded by the page that creates one.
 *
 * The registration lasts for the page: nothing deactivates a residency while a stub that names units may exist, and a
 * later registration replaces the earlier one in a single assignment.
 */

let active: Residency | null = null

export function registerResidency(residency: Residency): void {
    active = residency
}

export function getResidency(): Residency | null {
    return active
}

export function resetResidencyForTest(): void {
    active = null
}

/**
 * The residency read behind a cold-storage result, kept beside the result object so that the result keeps the shape every
 * reader of the legacy contract agrees on. A result that did not come from a residency has none; the install of a
 * character uses it to hydrate the units that were just read.
 */
const readsBehind = new WeakMap<object, Extract<ResidencyRead, { status: 'ok' }>>()

export function noteResidencyRead(result: object, read: Extract<ResidencyRead, { status: 'ok' }>): void {
    readsBehind.set(result, read)
}

export function residencyReadOf(result: object): Extract<ResidencyRead, { status: 'ok' }> | undefined {
    return readsBehind.get(result)
}

/** The shape of an entity id `u`: 26 digits of the key alphabet (`KEY_ALPHABET`, `0-9a-v`). A legacy cold-storage key is a UUID or `<uuid>_accessMeta`, so the two never meet. */
const ENTITY_UNIT_KEY = /^[0-9a-v]{26}$/

/** Whether a cold-storage key names a store2 entity rather than a legacy unit file. */
export function isEntityUnitKey(key: string): boolean {
    return ENTITY_UNIT_KEY.test(key)
}
