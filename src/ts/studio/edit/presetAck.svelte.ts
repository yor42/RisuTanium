// The save ack of the preset whose toggle builder or regex pane is open: one at a time, built lazily because the ack machine reaches the
// save loop's exports, which no other Studio screen needs. Nothing here imports saveAck or globalApi at runtime (the
// ack is built by a factory the lazy import resolves to), so a suite that mocks those modules loads this file.
// The ack's lifetime is its holders': each holder ends only its own share, and a switch of preset, a new Studio visit,
// the last holder's destroy and Studio closing each end it synchronously, so the chip of one preset never shows another's state and no ack leaves a timer behind.

import type { HistoryClock } from '../history/historyModel'
import { studioOpen } from '../studioOpen'
import type { SaveAck } from './saveAck.svelte'

// Resolves, after the import, to the only place an ack is built. The holder calls the factory only for a request that is
// still current, so a stale or ended request builds nothing (an ack arms a repeating peer poll that only `dispose` ends).
export type PresetAckLoad = () => Promise<() => SaveAck>

// One party that keeps the ack alive (a toggle builder or a regex pane). Compared by identity.
export interface PresetAckHolder {
    readonly label: string
}

interface HeldPresetAck {
    presetId: string
    visitId: string
    ack: SaveAck
    holders: Set<PresetAckHolder>
}

// An import in flight. `earliestBefore` is the mark count before the first edit that landed while it ran, replayed to the
// ack once it exists so the edit is not lost to the import's delay.
interface PendingPresetAck {
    token: number
    presetId: string
    visitId: string
    earliestBefore: number | null
    holders: Set<PresetAckHolder>
}

// The page's real timers, resolved at call time so timers installed after import govern the ack.
const pageClock: HistoryClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

// `held` and `pending` are never both set between holder calls, and every built ack is held or disposed.
let held = $state.raw<HeldPresetAck | null>(null)
let pending: PendingPresetAck | null = null
let requestToken = 0
let stopOpenRule: (() => void) | null = null

// The shared import. A rejected import is forgotten, so the next begin imports again; an old rejection never clears a
// newer import.
let importing: Promise<() => SaveAck> | null = null

function productionLoad(): Promise<() => SaveAck> {
    if (!importing) {
        const attempt = import('./saveAck.svelte').then(
            (loaded) => (): SaveAck => loaded.createSaveAck(loaded.productionSaveAckDeps(pageClock), loaded.productionPresetAckSubject()),
        )
        importing = attempt
        attempt.catch(() => {
            if (importing === attempt) {
                importing = null
            }
        })
    }
    return importing
}

let load: PresetAckLoad = productionLoad

// The ack of the preset whose toggle builder is open, or null when there is none or it belongs to another preset.
// Reactive.
export function currentPresetAck(presetId: string | null): SaveAck | null {
    return held !== null && held.presetId === presetId ? held.ack : null
}

// Disposes the held ack and drops the request in flight, which then resolves to nothing.
function endAll(): void {
    const current = held
    held = null
    pending = null
    current?.ack.dispose()
}

// One subscription for the page, installed by the first begin so it exists before any import resolves: closing Studio
// during an import drops the request. The store's immediate first value is not a close.
function installCloseRule(): void {
    if (stopOpenRule !== null) {
        return
    }
    let first = true
    stopOpenRule = studioOpen.subscribe((open) => {
        if (first) {
            first = false
            return
        }
        if (!open) {
            endPresetAck()
        }
    })
}

async function settleRequest(token: number, presetId: string, visitId: string): Promise<void> {
    let built: SaveAck | null = null
    try {
        const factory = await load()
        if (pending?.token !== token) {
            return
        }
        built = factory()
        const earliestBefore = pending.earliestBefore
        held = { presetId, visitId, ack: built, holders: pending.holders }
        pending = null
        if (earliestBefore !== null) {
            built.noteEdit(presetId, earliestBefore)
        }
    } catch (error) {
        const current = built !== null || pending?.token === token
        if (built !== null) {
            built.dispose()
            if (held?.ack === built) {
                held = null
            }
        }
        if (pending?.token === token) {
            pending = null
        }
        // A stale request's failure changes nothing. No rejection is returned: the next begin retries.
        if (current) {
            console.error(error)
        }
    }
}

// A holder's first use of its preset, in the given visit. The same preset in the same visit keeps what is held or in
// flight and adds the holder to it; another preset or a new visit ends the old ack at once and asks for a new one.
export function beginPresetAck(presetId: string, visitId: string, holder?: PresetAckHolder): void {
    const entry = held ?? pending
    if (entry !== null && entry.presetId === presetId && entry.visitId === visitId) {
        if (holder !== undefined) {
            entry.holders.add(holder)
        }
        return
    }
    endAll()
    installCloseRule()
    const token = ++requestToken
    pending = { token, presetId, visitId, earliestBefore: null, holders: holder === undefined ? new Set() : new Set([holder]) }
    void settleRequest(token, presetId, visitId)
}

// Ends the ack and the request in flight, when `presetId` is given only if it is that preset's: a late destroy of one
// holder after another began leaves the other alone. With a holder, only its own share ends: the entry ends when its
// last holder does, and a holder that never joined the entry (or joined an older one) ends nothing. Without a holder
// the whole entry ends.
export function endPresetAck(presetId?: string, holder?: PresetAckHolder): void {
    if (presetId === undefined) {
        endAll()
        return
    }
    const entry = held ?? pending
    if (entry === null || entry.presetId !== presetId) {
        return
    }
    if (holder === undefined) {
        endAll()
        return
    }
    if (!entry.holders.delete(holder)) {
        return
    }
    if (entry.holders.size === 0) {
        endAll()
    }
}

// An edit of the preset's toggle text or regex list landed: forwarded to its ack, or kept (earliest first) for the ack an import in
// flight will build. Any other id is ignored.
export function notePresetEdit(presetId: string, before: number): void {
    if (held !== null && held.presetId === presetId) {
        held.ack.noteEdit(presetId, before)
    } else if (pending !== null && pending.presetId === presetId) {
        pending.earliestBefore = pending.earliestBefore === null ? before : Math.min(pending.earliestBefore, before)
    }
}

// ---------------------------------------------------------------- tests

// Replaces the import, so a suite can resolve, fail or hang it and inject the ack the factory builds.
export function setPresetAckLoaderForTests(loader: PresetAckLoad): void {
    load = loader
}

// Ends the ack and the request in flight (a resolve still pending builds nothing), removes the page's close rule and
// restores the production import.
export function resetPresetAckForTests(): void {
    endAll()
    stopOpenRule?.()
    stopOpenRule = null
    load = productionLoad
    importing = null
}
