// A copy of an owner's live edit fields, read right before and right after a History action so the caller can
// tell what the action changed. The live list is mutated in place, so it is copied.
import { liveReaderOf, resolveOwnerTarget } from './edit/ownerTargets'
import { createLiveReader, resolveLiveTarget } from './edit/studioSetters'
import { registryPaths } from './history/fieldAccess'
import { FIELD_PRESENTATION, type SetPath } from './history/fieldRegistry'
import type { LiveReader } from './history/historyModel'
import { parseSessionOwnerKey, type OwnerKey } from './history/ownerPhase'

// The greetings and the live value of every registered path that has a focus target, keyed by the path.
export type OwnerFields = { readonly greetings: readonly string[] } & { readonly [P in SetPath]?: unknown }

// Null when the owner cannot be resolved; its actions are refused then. A session owner (a preset) is resolved by its
// adapter, which answers by id.
export function readOwnerFields(owner: OwnerKey): OwnerFields | null {
    let live: LiveReader
    if (parseSessionOwnerKey(owner)) {
        const session = resolveOwnerTarget(owner, () => null)
        if (session.ok === false) return null
        live = liveReaderOf(session.target)
    } else {
        const resolved = resolveLiveTarget(owner)
        if (resolved.ok === false) return null
        live = createLiveReader(resolved.target)
    }
    const values: { -readonly [P in SetPath]?: unknown } = {}
    for (const path of registryPaths()) {
        if (FIELD_PRESENTATION[path].focus !== null) {
            const read = live.field(path)
            values[path] = read.had ? read.value : undefined
        }
    }
    return { greetings: [...(live.greetings() ?? [])], ...values }
}
