import { readonly, writable, type Readable } from "svelte/store"

/**
 * The units of reply work that currently own a chat: an outermost send (previews included) or a recovered apply.
 *
 * - Only an outermost send or a recovered apply takes a unit. A send's own recursion (group turns, auto-continue,
 *   resend) neither takes nor releases, so one unit spans the whole reply.
 * - Only the taker releases, in its own finally, and each handle releases only itself: a call that never took, or
 *   one that ends after a same-key successor took, cannot clear that successor. There is no release by key.
 * - `has` and `any` read the set directly and are not reactive. A template or `$derived` reads `isBusyIn` or
 *   `isComposerBusyIn`, never these.
 * - The key is the owner's chat (`chaId`, `chatId`), never the member of a group: a group turn holds the group's key.
 * - A second take of one key is not refused here. The admission gate refuses before a take, and `take` never
 *   refuses, so the gate stays the one place that decides.
 * - `active` is a pure function of the set, written after the set changed and with nothing in between, so
 *   `get(active)` and `any` always agree, including inside a subscriber. A value already queued to a subscriber
 *   callback can be older: when an earlier subscriber starts a successor, a later one can still be handed `false`
 *   while `get(active)` and `any()` are already true, and is handed `true` right after. `active` is a plain
 *   writable behind `readonly`, not a `derived` store, which can be stale inside another store's subscriber.
 * - The reset exists for tests only; production code never calls it.
 */
export interface ActiveUnitKey {
    chaId: string
    chatId: string
}

export interface ActiveUnit {
    /** True when this handle holds its key after the call; false when another handle holds an equal key. */
    take(): boolean
    release(): void
}

export interface ActiveUnits {
    /** True exactly while at least one unit is taken. */
    readonly active: Readable<boolean>
    /** An inert handle for this key; it holds nothing until `take`. Only the two key fields are copied. */
    unit(key: ActiveUnitKey): ActiveUnit
    /** Whether any unit is taken, read from the set. */
    any(): boolean
    /** Whether a unit holds exactly this chat (both ids equal); null holds nothing. */
    has(key: ActiveUnitKey | null): boolean
    resetForTests(): void
}

export function createActiveUnits(): ActiveUnits {
    const units = new Set<ActiveUnitKey>()
    const busy = writable(false)

    const unit = (key: ActiveUnitKey): ActiveUnit => {
        const held: ActiveUnitKey = { chaId: key.chaId, chatId: key.chatId }
        return {
            take(): boolean {
                if(units.has(held)){
                    return true
                }
                for(const other of units){
                    if(other.chaId === held.chaId && other.chatId === held.chatId){
                        return false
                    }
                }
                units.add(held)
                busy.set(true)
                return true
            },
            release(): void {
                if(!units.delete(held)){
                    return
                }
                busy.set(units.size > 0)
            },
        }
    }

    return {
        active: readonly(busy),
        unit,
        any: () => units.size > 0,
        has: (key) => {
            if(!key){
                return false
            }
            for(const held of units){
                if(held.chaId === key.chaId && held.chatId === key.chatId){
                    return true
                }
            }
            return false
        },
        resetForTests: () => {
            units.clear()
            busy.set(false)
        },
    }
}

/** The page's registry. */
export const activeUnits: ActiveUnits = createActiveUnits()
