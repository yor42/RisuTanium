import type { JsonObject } from '../blockFrame'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../moduleStub'
import type { ModuleEntry } from './format'
import { plainObject, sameJsonValue } from './codec/normalize'

/**
 * The one definition of a minted module stub and of "this slot is still that stub". It imports only the marker leaf and
 * the codec's plain-JSON helpers, so a boot-time or install-time caller can load it without the encoder, `uuid` or the
 * cold-character process code.
 */

/**
 * The module stub a module index entry stands for: the entry's fields plus the module stub marker, with none of the
 * module's body arrays. `unit`, `al` and `il` are fresh copies, never the entry's own arrays, and `unit` keeps all four
 * elements (the entry-fields version included), so a stub nobody touched equals the stub minted from its entry again.
 * `mcp` is carried as the entry holds it (`true`), not as the object a full module holds.
 *
 * Invariant: `unit`, `al` and `il` are copied here element for element, with no normalisation, truncation or re-tagging,
 * exactly as the encoder's carried entry copies them. A divergence makes an untouched stub compare as edited, or a
 * carried entry differ from the stub minted from it.
 */
export function moduleStubOf(entry: ModuleEntry): JsonObject {
    const stub: JsonObject = { ...entry, unit: [...entry.unit], al: [...entry.al], il: entry.il === null ? null : [...entry.il] }
    stub[MODULE_STUB_KEY] = MODULE_STUB_VALUE
    return stub
}

/**
 * Whether `plain`, a plain copy of a module slot, is exactly the stub minted from `entry`. Symmetric: a field the slot
 * gained and a field it lost both read as different, so an edited stub is never taken for an untouched one.
 */
export function isRecordedStub(plain: JsonObject, entry: ModuleEntry): boolean {
    return sameJsonValue(plain, moduleStubOf(entry))
}

/** `isRecordedStub` over a live slot (a `$state` proxy included); a slot that cannot be read as JSON throws `CodecInputError`. */
export function slotIsRecordedStub(raw: unknown, entry: ModuleEntry): boolean {
    return isRecordedStub(plainObject(raw, 'module slot'), entry)
}

/** Whether two entries of one handle name the same stored units: the module unit and its asset and inlay lists. */
export function sameEntryUnits(left: ModuleEntry, right: ModuleEntry): boolean {
    return JSON.stringify([left.unit, left.al, left.il]) === JSON.stringify([right.unit, right.al, right.il])
}
