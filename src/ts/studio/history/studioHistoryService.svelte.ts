// The Studio history service as the UI reaches it. The service and the save ack are loaded and built on
// first use, never at import: a page or a suite that never opens a Studio form does not read their
// imports (the save loop's module, the page leave rule's registration), and a Studio screen that only
// browses does not pay for them. The module also holds the save ack of the current Studio visit and the
// banner text.

import { language } from '../../../lang'
import type { SaveAck } from '../edit/saveAck.svelte'
import { sessionAdapterOf } from '../edit/sessionAdapters'
import type { ModuleSlotReplaced } from '../edit/studioSetters'
import { resetStudioToastsForTests, retireAssetToasts } from '../edit/studioToasts'
import { openStudioModuleId } from '../assets/openModuleForm.svelte'
import { studioOpen } from '../studioOpen'
import { studioScreen } from '../studioScreen.svelte'
import type { HistoryClock } from './historyModel'
import type { OwnerHistoryService } from './ownerHistory.svelte'
import { parseOwnerKey, parseSessionOwnerKey, parseStoredOwnerKey, type MemoryOnlyReason, type OwnerKey, type ReadyReason } from './ownerPhase'
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
    // Builds the ack of one module's toggle edits; absent in a loader that serves character acks only.
    createModuleAck?: () => SaveAck
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

// What follows a Studio module slot write, in the module loader's order: the `getModules` memo is reset first, so the
// screens the bump reloads read the new module. The two functions are passed in because `process/modules` is never
// imported here at load: it pulls in most of the app and is not needed by a page that edits no module.
export function createModuleSlotPort(refreshModules: () => void, bumpModuleGui: () => void): ModuleSlotReplaced {
    return () => {
        refreshModules()
        bumpModuleGui()
    }
}

let moduleSlotPort: ModuleSlotReplaced | null = null
let moduleSlotPortLoading: Promise<void> | null = null

// Loads `process/modules` and builds the port. Started when a module owner is first used, so the port is ready before
// that owner's first write; a failed load is forgotten and tried again.
function primeModuleSlotPort(): Promise<void> {
    moduleSlotPortLoading ??= Promise.all([import('../../process/modules'), import('../../process/moduleGuiBump')]).then(
        ([modules, moduleGui]) => {
            moduleSlotPort = createModuleSlotPort(modules.refreshModules, moduleGui.bumpModuleGui)
        },
        (error: unknown) => {
            moduleSlotPortLoading = null
            console.error(error)
        },
    )
    return moduleSlotPortLoading
}

// The port the production service is given. Normally the port is ready and runs at once; a write that comes first runs
// it as soon as the load ends.
const productionModuleSlotPort: ModuleSlotReplaced = () => {
    if (moduleSlotPort) {
        moduleSlotPort()
    } else {
        void primeModuleSlotPort().then(() => moduleSlotPort?.())
    }
}

// Starts loading the slot port and returns the load, which never rejects (a failure is logged and the next call retries).
export function primeStudioModuleSlots(): Promise<void> {
    return primeModuleSlotPort()
}

// Runs the slot port once, as the history service does after a module slot write: the memo reset and the module
// screen bump are synchronous when the port is primed.
export function studioModuleSlotReplaced(): void {
    productionModuleSlotPort()
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
        service: history.createOwnerHistoryService({
            store,
            claim,
            clock: pageClock,
            tauri: platform.isTauri,
            scheduleIdle: history.browserIdleScheduler(),
            onModuleSlotReplaced: productionModuleSlotPort,
            // A module write is accepted only while the Studio detail has that module selected and publishes its id (loaded,
            // not restricted, id not shared); otherwise every module write is refused as not selected.
            openModuleId: openStudioModuleId,
            // Loaded when a replay first needs it: the asset file reader reaches the storage layer.
            openAssetFileReader: async () => (await import('../assets/assetFileState')).openAssetFileReader(),
            // Any landed step ends the Undo toasts of that owner that are no longer on top, whichever instance posted them.
            onLanded: retireAssetToasts,
        }),
        createAck: () => ack.createSaveAck(ack.productionSaveAckDeps(pageClock)),
        createModuleAck: () => ack.createSaveAck(ack.productionSaveAckDeps(pageClock), ack.productionModuleAckSubject()),
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
    const stored = parseStoredOwnerKey(owner)
    if (!stored) {
        // A session owner assumes no character: no visit ack of the character path, and `setAck` is never called.
        service.useOwner(owner)
        const session: { kind: string; id: string } | null = parseSessionOwnerKey(owner)
        return (session ? sessionAdapterOf(session.kind)?.beginVisit?.(session.id) : null) ?? null
    }
    if (stored.kind === 'module') {
        // A module owner has no character visit ack: it is used, and its writes mark through the module slot write.
        void primeModuleSlotPort()
        service.useOwner(owner)
        return null
    }
    const visitId = studioScreen.visitId
    if (held && (held.visitId !== visitId || held.chaId !== stored.chaId)) {
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
        held = { visitId, chaId: stored.chaId, ack, owners: new Set<OwnerKey>(), stop }
        heldAck = ack
    }
    held.owners.add(owner)
    service.setAck(stored.chaId, held.ack)
    service.useOwner(owner)
    // Input already happened in this visit: the use above must leave no warm-up pending.
    if (inputVisitId === visitId) {
        service.cancelWarm()
    }
    return held.ack
}

// ---------------------------------------------------------------- the save ack of a module's toggles

interface ModuleAck {
    visitId: string
    moduleId: string
    ack: SaveAck
    stop: () => void
}

// One module ack at a time: the chip of one module never shows another owner's state.
let heldModule: ModuleAck | null = null
let heldModuleAck = $state.raw<SaveAck | null>(null)
let moduleAckFactory: (() => SaveAck) | null = null

// The ack of the module whose toggle builder is open, or null when none is. Reactive.
export function currentModuleAck(): SaveAck | null {
    return heldModuleAck
}

// Ends the held module ack, when `moduleId` is given only if it is that module's: it is unregistered and disposed, so
// it leaves no timer.
export function endModuleAck(moduleId?: string): void {
    const held = heldModule
    if (!held || (moduleId !== undefined && held.moduleId !== moduleId)) {
        return
    }
    heldModule = null
    heldModuleAck = null
    held.stop()
    getStudioHistoryService()?.setModuleAck(held.moduleId, null)
    held.ack.dispose()
}

// The module toggle builder's first use of its module, once the service is built: creates the module's ack and hands it
// to the service. Calling again for the same module in the same visit keeps the ack; another module or a new visit
// replaces it, and Studio closing ends it. Returns null while the service is not built.
export function beginModuleAck(moduleId: string): SaveAck | null {
    const service = getStudioHistoryService()
    if (!service) {
        return null
    }
    const visitId = studioScreen.visitId
    if (heldModule && (heldModule.visitId !== visitId || heldModule.moduleId !== moduleId)) {
        endModuleAck()
    }
    if (!heldModule) {
        const ack = moduleAckFactory?.() ?? loadedState?.createModuleAck?.()
        if (!ack) {
            return null
        }
        // The store calls back at once with its current value, which is not news.
        let first = true
        const stop = studioOpen.subscribe((open) => {
            if (first) {
                first = false
                return
            }
            if (!open) {
                endModuleAck()
            }
        })
        heldModule = { visitId, moduleId, ack, stop }
        heldModuleAck = ack
        service.setModuleAck(moduleId, ack)
    }
    return heldModule.ack
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
        // A session owner shows no history note in S0b; the first session kind supplies its own.
        case 'session': return null
    }
}

// ---------------------------------------------------------------- tests

export function setStudioHistoryServiceForTests(service: OwnerHistoryService | null): void {
    override = service
}

export function setStudioVisitAckForTests(ack: SaveAck | null): void {
    ackOverride = ack
}

// Replaces the module ack's builder; the accessor registers and disposes what it builds.
export function setStudioModuleAckForTests(create: (() => SaveAck) | null): void {
    moduleAckFactory = create
}

// Replaces the build, so a suite can make it fail or hang without mocking modules.
export function setStudioHistoryLoaderForTests(loader: StudioHistoryLoader | null): void {
    loaderOverride = loader
}

// Ends the visit's ack, forgets the built service and every override.
export function resetStudioHistoryAccessorForTests(): void {
    endVisitAck()
    endModuleAck()
    moduleAckFactory = null
    loadedState = null
    loading = null
    loadFailed = false
    override = null
    ackOverride = null
    loaderOverride = null
    inputVisitId = null
    moduleSlotPort = null
    moduleSlotPortLoading = null
    resetStudioToastsForTests()
}
