// The save ack of the preset whose toggle builder is open: one at a time, built lazily because the ack machine reaches the
// save loop's exports, which no other Studio screen needs. Nothing here imports saveAck or globalApi at runtime (the
// ack is built by a factory the lazy import resolves to), so a suite that mocks those modules loads this file.
// The ack's lifetime is the builder's: a switch of preset, a new Studio visit, the builder's destroy and Studio closing
// each end it synchronously, so the chip of one preset never shows another's state and no ack leaves a timer behind.

import type { HistoryClock } from '../history/historyModel'
import { studioOpen } from '../studioOpen'
import type { SaveAck } from './saveAck.svelte'

// Resolves, after the import, to the only place an ack is built. The holder calls the factory only for a request that is
// still current, so a stale or ended request builds nothing (an ack arms a repeating peer poll that only `dispose` ends).
export type PresetAckLoad = () => Promise<() => SaveAck>

interface HeldPresetAck {
    presetId: string
    visitId: string
    ack: SaveAck
}

// An import in flight. `earliestBefore` is the mark count before the first edit that landed while it ran, replayed to the
// ack once it exists so the edit is not lost to the import's delay.
interface PendingPresetAck {
    token: number
    presetId: string
    visitId: string
    earliestBefore: number | null
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
        held = { presetId, visitId, ack: built }
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

// The toggle builder's first use of its preset, in the given visit. The same preset in the same visit keeps what is held
// or in flight; another preset or a new visit ends the old ack at once and asks for a new one.
export function beginPresetAck(presetId: string, visitId: string): void {
    const same = (entry: { presetId: string, visitId: string } | null): boolean => entry !== null && entry.presetId === presetId && entry.visitId === visitId
    if (same(held) || same(pending)) {
        return
    }
    endAll()
    installCloseRule()
    const token = ++requestToken
    pending = { token, presetId, visitId, earliestBefore: null }
    void settleRequest(token, presetId, visitId)
}

// Ends the ack and the request in flight, when `presetId` is given only if it is that preset's: a late destroy of one
// builder after another began leaves the other alone.
export function endPresetAck(presetId?: string): void {
    if (presetId !== undefined && held?.presetId !== presetId && pending?.presetId !== presetId) {
        return
    }
    endAll()
}

// An edit of the preset's toggle text landed: forwarded to its ack, or kept (earliest first) for the ack an import in
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
