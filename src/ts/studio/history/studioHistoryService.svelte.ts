// The Studio history service as the UI reaches it. The service and the save ack are loaded and built on
// first use, never at import: a page or a suite that never opens a Studio form does not read their
// imports (the save loop's module, the page leave rule's registration), and a Studio screen that only
// browses does not pay for them. The module also holds the save ack of the current Studio visit and the
// banner text.

import { language } from '../../../lang'
import type { SaveAck } from '../edit/saveAck.svelte'
import { studioOpen } from '../studioOpen'
import { studioScreen } from '../studioScreen.svelte'
import type { HistoryClock } from './historyModel'
import type { OwnerHistoryService } from './ownerHistory.svelte'
import { parseOwnerKey, type MemoryOnlyReason, type OwnerKey, type ReadyReason } from './ownerPhase'
import type { StudioClaimPort, StudioHistoryStore } from './studioHistoryStore'

// The page's real timers, resolved at call time so timers installed after import govern the service.
const pageClock: HistoryClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export interface Loaded {
    service: OwnerHistoryService
    createAck: () => SaveAck
}

export type StudioHistoryLoader = () => Promise<Loaded>

let loadedState = $state.raw<Loaded | null>(null)
let loading: Promise<Loaded> | null = null
let override: OwnerHistoryService | null = null
let loaderOverride: StudioHistoryLoader | null = null
// True after a build failed for good (the service module itself could not load) until the next build starts.
let loadFailed = $state(false)

// The ports used when an adapter chunk cannot load: the claim fails and the store is unavailable, so every
// owner is editable in memory with the `failed` banner and nothing is persisted on this page.
const failedClaim: StudioClaimPort = { tryClaim: async () => 'failed' }
const failedStore: StudioHistoryStore = {
    open: async () => 'unavailable',
    load: async () => ({ kind: 'failed' }),
    save: async () => ({ kind: 'unwritable' }),
    onClosed: () => {},
}

// Builds the service: the modules load, then the device store and the Web Locks claim are created and the
// service is created once over them. `tauri` makes a page without Web Locks the one live page, as on a Tauri
// build. No `registerLeaveFlush` is passed, so the service registers its flush with the page's leave rule
// itself. If an adapter chunk cannot load, the service is still built, over the memory-only failed ports. If
// the service module (or the ack's or the platform's) cannot load, there is no write path and this rejects.
async function build(): Promise<Loaded> {
    const [history, ack, platform] = await Promise.all([
        import('./ownerHistory.svelte'),
        import('../edit/saveAck.svelte'),
        import('../../platform'),
    ])
    let store = failedStore
    let claim = failedClaim
    try {
        const [proxy, locks] = await Promise.all([import('./studioStoreProxy'), import('./studioClaimLocks')])
        const created = { store: proxy.createStudioStoreProxy(), claim: locks.createStudioClaimLocks() }
        store = created.store
        claim = created.claim
    } catch (error) {
        console.error(error)
    }
    return {
        service: history.createOwnerHistoryService({ store, claim, clock: pageClock, tauri: platform.isTauri, scheduleIdle: history.browserIdleScheduler() }),
        createAck: () => ack.createSaveAck(ack.productionSaveAckDeps(pageClock)),
    }
}

// Starts the build on the first call and shares it; later calls return the same build. A build that rejected
// is forgotten, so a later call tries again.
function load(): Promise<Loaded> {
    if (!loading) {
        loadFailed = false
        const attempt: Promise<Loaded> = (loaderOverride ?? build)().then(
            (loaded) => {
                loadedState = loaded
                return loaded
            },
            (error: unknown) => {
                if (loading === attempt) {
                    loading = null
                }
                loadFailed = true
                throw error
            },
        )
        loading = attempt
    }
    return loading
}

// Starts building the service if it is not built. Safe to call from an effect; it never throws.
export function ensureStudioHistory(): void {
    if (!override && !loading) {
        void load().catch((error) => {
            console.error(error)
        })
    }
}

// Whether the last build failed with no service to show for it. Reactive.
export function studioHistoryLoadFailed(): boolean {
    return loadFailed && !override && loadedState === null
}

// The service once it is built (or the test override), else null. Reactive: it turns non-null when the
// build finishes.
export function getStudioHistoryService(): OwnerHistoryService | null {
    return override ?? loadedState?.service ?? null
}

// Resolves with the service, building it first if needed.
export async function loadStudioHistoryService(): Promise<OwnerHistoryService> {
    return override ?? (await load()).service
}

// Input anywhere in Studio that is not a history write (the search box, any later field) ends the pending
// warm-up, as a history write does; nothing restarts it (MC-1432: never during typing). The visit is
// remembered too: input can arrive before the service is built or before an owner's first use, and that
// visit then starts no warm-up (see beginOwnerVisit).
let inputVisitId: string | null = null

export function noteStudioInput(): void {
    inputVisitId = studioScreen.visitId
    getStudioHistoryService()?.cancelWarm()
}

// ---------------------------------------------------------------- the save ack of the visit

interface VisitAck {
    visitId: string
    chaId: string
    ack: SaveAck
    // Owners the visit's forms used: their open step closes with the visit.
    owners: Set<OwnerKey>
    stop: () => void
}

let held: VisitAck | null = null
let heldAck = $state.raw<SaveAck | null>(null)
let ackOverride: SaveAck | null = null

// The ack of the current visit, or null before a form has used an owner. Reactive.
export function currentVisitAck(): SaveAck | null {
    return heldAck
}

function endVisitAck(): void {
    const visit = held
    if (!visit) {
        return
    }
    held = null
    heldAck = null
    visit.stop()
    const service = getStudioHistoryService()
    if (service) {
        for (const owner of visit.owners) {
            service.closeOpenStep(owner)
        }
        service.setAck(visit.chaId, null)
    }
    if (visit.ack !== ackOverride) {
        visit.ack.dispose()
    }
}

// First use of an owner by a Studio form, once the service is built: starts the owner's lifecycle and
// hands the visit's ack to the service (one ack per visit, created here). The ack and the open steps
// end with the visit. Returns null while the service is not built.
export function beginOwnerVisit(owner: OwnerKey): SaveAck | null {
    const parsed = parseOwnerKey(owner)
    const service = getStudioHistoryService()
    if (!parsed || !service) {
        return null
    }
    const visitId = studioScreen.visitId
    if (held && (held.visitId !== visitId || held.chaId !== parsed.chaId)) {
        endVisitAck()
    }
    if (!held) {
        const ack = ackOverride ?? loadedState?.createAck()
        if (!ack) {
            return null
        }
        // The visit ends when Studio closes, whoever closes it; the store calls back at once with its current
        // value, which is not news.
        let first = true
        const stop = studioOpen.subscribe((open) => {
            if (first) {
                first = false
                return
            }
            if (!open) {
                endVisitAck()
            }
        })
        held = { visitId, chaId: parsed.chaId, ack, owners: new Set<OwnerKey>(), stop }
        heldAck = ack
    }
    held.owners.add(owner)
    service.setAck(parsed.chaId, held.ack)
    service.useOwner(owner)
    // Input already happened in this visit: the use above must leave no warm-up pending.
    if (inputVisitId === visitId) {
        service.cancelWarm()
    }
    return held.ack
}

// ---------------------------------------------------------------- banner

// The note shown for an owner's history state, or null when there is nothing to say.
export function historyBannerText(banner: MemoryOnlyReason | ReadyReason | null): string | null {
    switch (banner) {
        case null: return null
        case 'otherTab': return language.studioBannerOtherTab
        case 'noLocks': return language.studioBannerNoLocks
        case 'failed': return language.studioBannerFailed
        case 'unavailable': return language.studioBannerUnavailable
        case 'unwritable': return language.studioBannerUnwritable
        case 'keptUnreadable': return language.studioBannerKeptUnreadable
        case 'unreadable': return language.studioBannerUnreadable
        case 'trimmed': return language.studioBannerTrimmed
    }
}

// ---------------------------------------------------------------- tests

export function setStudioHistoryServiceForTests(service: OwnerHistoryService | null): void {
    override = service
}

export function setStudioVisitAckForTests(ack: SaveAck | null): void {
    ackOverride = ack
}

// Replaces the build, so a suite can make it fail or hang without mocking modules.
export function setStudioHistoryLoaderForTests(loader: StudioHistoryLoader | null): void {
    loaderOverride = loader
}

// Ends the visit's ack, forgets the built service and every override.
export function resetStudioHistoryAccessorForTests(): void {
    endVisitAck()
    loadedState = null
    loading = null
    loadFailed = false
    override = null
    ackOverride = null
    loaderOverride = null
    inputVisitId = null
}
