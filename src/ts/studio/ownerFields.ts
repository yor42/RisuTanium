// A copy of an owner's live edit fields, read right before and right after a History action so the caller can
// tell what the action changed. The live list is mutated in place, so it is copied.
import type { JsonValue } from '../storage/blockFrame'
import { openStudioModuleId } from './assets/openModuleForm.svelte'
import { createLiveReader, resolveLiveTarget } from './edit/studioSetters'
import { liveReaderOf, resolveOwnerTarget } from './edit/ownerTargets'
import { registryPaths } from './history/fieldAccess'
import { FIELD_PRESENTATION, type SetPath } from './history/fieldRegistry'
import type { LiveReader } from './history/historyModel'
import { parseStoredOwnerKey, type OwnerKey } from './history/ownerPhase'

// A foreign reading (a stored value of another type than the field's), tagged so it never equals a typed value: a bare
// value or its JSON text could equal one (`5` and `'5'`, `true` and `'true'`).
export type ForeignFieldRead = { readonly foreign: JsonValue }

// The greetings and the live value of every registered path that has a focus target, keyed by the path.
export type OwnerFields = { readonly greetings: readonly string[] } & { readonly [P in SetPath]?: unknown }

// A module owner resolves through the published open-module id (it has no character target); the other kinds keep the
// stored-target resolution.
function readerOf(owner: OwnerKey): LiveReader | null {
    if (parseStoredOwnerKey(owner)?.kind === 'module') {
        const resolved = resolveOwnerTarget(owner, openStudioModuleId)
        return resolved.ok ? liveReaderOf(resolved.target) : null
    }
    const resolved = resolveLiveTarget(owner)
    return resolved.ok ? createLiveReader(resolved.target) : null
}

// Null when the owner cannot be resolved; its actions are refused then.
export function readOwnerFields(owner: OwnerKey): OwnerFields | null {
    const live = readerOf(owner)
    if (live === null) return null
    const values: { -readonly [P in SetPath]?: unknown } = {}
    for (const path of registryPaths()) {
        if (FIELD_PRESENTATION[path].focus !== null) {
            const read = live.field(path)
            values[path] = read.had === 'foreign' ? { foreign: read.value } : read.had ? read.value : undefined
        }
    }
    return { greetings: [...(live.greetings() ?? [])], ...values }
}
