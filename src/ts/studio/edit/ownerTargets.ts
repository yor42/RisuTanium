// Resolves any owner key to its live target: a stored character, chat or module through studioSetters, a
// session kind through its adapter. The import edges run one way (ownerHistory -> ownerTargets ->
// studioSetters and sessionAdapters), so an adapter may import studioSetters at runtime without a cycle.

import type { LiveReader } from '../history/historyModel'
import { parseSessionOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { sessionAdapterOf, type SessionTarget } from './sessionAdapters'
import {
    createLiveReader,
    createModuleLiveReader,
    isModuleTarget,
    resolveLiveTarget,
    type LiveTarget,
    type ModuleTarget,
    type SetterRefusal,
} from './studioSetters'

// Wider than studioSetters' `OwnerTarget` (stored targets only): it adds a session kind's target.
export type ResolvedOwnerTarget = LiveTarget | ModuleTarget | SessionTarget

export function isSessionTarget(target: ResolvedOwnerTarget): target is SessionTarget {
    return 'session' in target
}

export function resolveOwnerTarget(owner: OwnerKey, openModuleId: () => string | null): { ok: true; target: ResolvedOwnerTarget } | { ok: false; reason: SetterRefusal } {
    // Widened on purpose: while no session kind is registered the parsed type is `never`.
    const session: { kind: string; id: string } | null = parseSessionOwnerKey(owner)
    if (session) {
        const adapter = sessionAdapterOf(session.kind)
        return adapter ? adapter.resolve(session.id) : { ok: false, reason: 'gone' }
    }
    return resolveLiveTarget(owner, openModuleId)
}

export function liveReaderOf(target: ResolvedOwnerTarget): LiveReader {
    if (isSessionTarget(target)) {
        return target.reader
    }
    return isModuleTarget(target) ? createModuleLiveReader(target.module) : createLiveReader(target)
}
