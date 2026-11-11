// A copy of an owner's live edit fields, read right before and right after a History action so the caller can
// tell what the action changed. The live list is mutated in place, so it is copied.
import { createLiveReader, resolveLiveTarget } from './edit/studioSetters'
import type { OwnerKey } from './history/ownerPhase'

export interface OwnerFields {
    readonly greetings: readonly string[]
    readonly desc: unknown
    readonly hideChatIcon: unknown
    readonly note: unknown
}

// Null when the owner cannot be resolved; its actions are refused then.
export function readOwnerFields(owner: OwnerKey): OwnerFields | null {
    const resolved = resolveLiveTarget(owner)
    if (resolved.ok === false) return null
    const live = createLiveReader(resolved.target)
    const valueOf = (path: 'desc' | 'hideChatIcon' | 'note') => {
        const read = live.field(path)
        return read.had ? read.value : undefined
    }
    return {
        greetings: [...(live.greetings() ?? [])],
        desc: valueOf('desc'),
        hideChatIcon: valueOf('hideChatIcon'),
        note: resolved.target.chat ? valueOf('note') : undefined,
    }
}
