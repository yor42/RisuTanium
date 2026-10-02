import type { DeleteEntry, StoreCondition } from './contract'
import { StoreInvalidConditionError, StoreInvalidKeyError, StoreUnsupportedConditionError } from './errors'

/**
 * Checks shared by the adapters. Each runs before any backend call, so a
 * refused call changes and reads nothing.
 */

/**
 * Rejects a condition that is not `'unconditional'` or `{ ifVersion }` with a
 * non-negative integer, and rejects any `ifVersion` on a store that cannot
 * enforce it. A malformed condition is reported as malformed on every adapter,
 * so the same call fails the same way whichever backend runs it.
 */
export function checkCondition(condition: StoreCondition, conditionalWrites: boolean): void {
    if (condition === 'unconditional') {
        return
    }
    if (typeof condition !== 'object' || condition === null || !('ifVersion' in condition)) {
        throw new StoreInvalidConditionError('a condition is \'unconditional\' or { ifVersion }')
    }
    const version: unknown = condition.ifVersion
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
        throw new StoreInvalidConditionError('ifVersion is a non-negative integer')
    }
    if (!conditionalWrites) {
        throw new StoreUnsupportedConditionError()
    }
}

/** The version to send, or `null` for an unconditional call. Call `checkCondition` first. */
export function versionOf(condition: StoreCondition): number | null {
    return condition === 'unconditional' ? null : condition.ifVersion
}

/** Refuses a duplicate key in a `deleteMany` input: one key would be removed twice with two conditions. */
export function checkNoDuplicateKeys(entries: readonly DeleteEntry[]): void {
    const seen = new Set<string>()
    for (const entry of entries) {
        if (seen.has(entry.key)) {
            throw new StoreInvalidKeyError(entry.key, 'a key is listed once in a deleteMany')
        }
        seen.add(entry.key)
    }
}

/** A value for `write` is a `Uint8Array`; any other type is a programming error, not a storage failure. */
export function checkBytes(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('A stored value is a Uint8Array.')
    }
}

/**
 * `view` itself when it owns exactly its bytes, otherwise a copy that does. A
 * view over a larger buffer would be stored with the whole buffer by
 * structured clone, and returned to a caller with bytes that are not its own.
 */
export function ownBytes(view: Uint8Array): Uint8Array {
    if (view.byteOffset === 0 && view.buffer.byteLength === view.byteLength) {
        return view
    }
    return new Uint8Array(view)
}
