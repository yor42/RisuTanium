// @vitest-environment jsdom
// The accessor the Studio UI uses: the service is built on first use and never at import, over the
// device store and the Web Locks claim (here replaced by a memory double and a scripted claim, as the
// adapters have their own suites) and with the factory's default leave registrar; the visit's ack is
// created once per visit and ended with it; the banner text covers every reason.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    registered: [] as (() => void)[],
    acks: [] as { dispose: ReturnType<typeof vi.fn> }[],
    tauri: false,
    claimAnswer: 'granted' as string,
    stores: [] as { counts: { open: number; load: number; save: number }; shared: Map<string, string> }[],
}))

// The adapters' stand-ins, kept apart so a case can register a failing module and the next case gets these back.
const adapterMocks = vi.hoisted(() => ({
    // The main realm must never build the IndexedDB adapter: this one is counted, and its stores are not the
    // ones the service uses.
    idb: async () => {
        const doubles = await import('src/ts/studio/history/tests/studioStoreDoubles')
        return { createStudioStoreIdb: vi.fn(() => doubles.createMemoryStudioStore()) }
    },
    proxy: async () => {
        const doubles = await import('src/ts/studio/history/tests/studioStoreDoubles')
        return {
            createStudioStoreProxy: vi.fn(() => {
                const store = doubles.createMemoryStudioStore()
                h.stores.push(store)
                return store
            }),
        }
    },
    locks: () => ({ createStudioClaimLocks: vi.fn(() => ({ tryClaim: vi.fn(async () => h.claimAnswer) })) }),
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/platform', () => ({
    get isTauri() {
        return h.tauri
    },
}))
vi.mock('src/ts/studio/history/studioStoreIdb', () => adapterMocks.idb())
vi.mock('src/ts/studio/history/studioStoreProxy', () => adapterMocks.proxy())
vi.mock('src/ts/studio/history/studioClaimLocks', () => adapterMocks.locks())
vi.mock('src/ts/process/saveOnHide', () => ({
    registerLeaveFlush: vi.fn((flush: () => void) => {
        h.registered.push(flush)
        return () => {}
    }),
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})
vi.mock('src/ts/studio/edit/saveAck.svelte', () => ({
    productionSaveAckDeps: vi.fn(() => ({})),
    createSaveAck: vi.fn(() => {
        const ack = { noteEdit: vi.fn(), dispose: vi.fn(), display: 'idle', canRetry: () => false, retry: () => false }
        h.acks.push(ack)
        return ack
    }),
}))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import type { OwnerHistoryService } from '../ownerHistory.svelte'
import type { SaveAck } from '../../edit/saveAck.svelte'
import { drainMicrotasks } from './historyTestKit.test-helpers'
import { expectedOwnerKeys, storedRecord } from './studioStoreDoubles'

interface Fresh {
    open: typeof import('src/ts/studio/studioOpen').studioOpen
    accessor: typeof import('../studioHistoryService.svelte')
    screen: typeof import('src/ts/studio/studioScreen.svelte')
    marks: typeof import('src/ts/storage/characterSaveMarks')
    onHide: typeof import('src/ts/process/saveOnHide')
    stores: typeof import('src/ts/stores.svelte')
    phase: typeof import('../ownerPhase')
}

async function fresh(): Promise<Fresh> {
    vi.resetModules()
    h.registered.length = 0
    h.acks.length = 0
    const onHide = await import('src/ts/process/saveOnHide')
    vi.mocked(onHide.registerLeaveFlush).mockClear()
    const stores = await import('src/ts/stores.svelte')
    const marks = await import('src/ts/storage/characterSaveMarks')
    marks.resetCharacterSaveMarksForTest()
    marks.installCharacterSaveMarks({
        tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
        schedule: () => { h.marks += 1 },
    })
    stores.DBState.db.characters = [
        { chaId: 'A', type: 'character', desc: 'd0', alternateGreetings: ['g0'], chats: [{ id: 'c1', note: '' }], chatPage: 0 },
    ] as unknown as typeof stores.DBState.db.characters
    stores.selIdState.selId = 0
    const screen = await import('src/ts/studio/studioScreen.svelte')
    screen.studioScreen.chaId = 'A'
    screen.studioScreen.visitId = 'v1'
    screen.studioScreen.open = true
    const open = (await import('src/ts/studio/studioOpen')).studioOpen
    open.set(true)
    return {
        open,
        accessor: await import('../studioHistoryService.svelte'),
        screen,
        marks,
        onHide,
        stores,
        phase: await import('../ownerPhase'),
    }
}

beforeEach(() => {
    h.marks = 0
    h.tauri = false
    h.claimAnswer = 'granted'
    h.stores.length = 0
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
})

describe('the service is built on first use', () => {
    test('importing the accessor builds nothing and reads no leave registration', async () => {
        const m = await fresh()
        // Any build the import started would have finished by now.
        await vi.dynamicImportSettled()
        await drainMicrotasks()
        expect(m.onHide.registerLeaveFlush).not.toHaveBeenCalled()
        expect(m.accessor.getStudioHistoryService()).toBeNull()
    })

    test('the first load builds one service, registered once with the page leave rule through the default registrar', async () => {
        const m = await fresh()
        const service = await m.accessor.loadStudioHistoryService()
        expect(m.onHide.registerLeaveFlush).toHaveBeenCalledTimes(1)
        expect(m.accessor.getStudioHistoryService()).toBe(service)
        expect(await m.accessor.loadStudioHistoryService()).toBe(service)
        expect(m.onHide.registerLeaveFlush).toHaveBeenCalledTimes(1)
    })

    test('concurrent first uses share one build', async () => {
        const m = await fresh()
        const [a, b] = await Promise.all([m.accessor.loadStudioHistoryService(), m.accessor.loadStudioHistoryService()])
        expect(a).toBe(b)
        expect(m.onHide.registerLeaveFlush).toHaveBeenCalledTimes(1)
    })

    test('ensureStudioHistory starts the build and the reactive getter turns non-null', async () => {
        const m = await fresh()
        m.accessor.ensureStudioHistory()
        expect(m.accessor.getStudioHistoryService()).toBeNull()
        await vi.waitFor(() => expect(m.accessor.getStudioHistoryService()).not.toBeNull())
        expect(m.onHide.registerLeaveFlush).toHaveBeenCalledTimes(1)
    })

    test('T-W1 the worker store proxy and the claim are created at first use only, once, and the IndexedDB adapter is never built on the main thread', async () => {
        const m = await fresh()
        const proxy = await import('src/ts/studio/history/studioStoreProxy')
        const idb = await import('src/ts/studio/history/studioStoreIdb')
        const locks = await import('src/ts/studio/history/studioClaimLocks')
        vi.mocked(proxy.createStudioStoreProxy).mockClear()
        vi.mocked(idb.createStudioStoreIdb).mockClear()
        vi.mocked(locks.createStudioClaimLocks).mockClear()
        await vi.dynamicImportSettled()
        expect(proxy.createStudioStoreProxy).not.toHaveBeenCalled()
        expect(locks.createStudioClaimLocks).not.toHaveBeenCalled()

        await m.accessor.loadStudioHistoryService()
        await m.accessor.loadStudioHistoryService()
        expect(proxy.createStudioStoreProxy).toHaveBeenCalledTimes(1)
        expect(idb.createStudioStoreIdb).not.toHaveBeenCalled()
        expect(locks.createStudioClaimLocks).toHaveBeenCalledTimes(1)
    })

    test('an owner reaches ready over the production ports and its edit is saved to the store after the debounce', async () => {
        const m = await fresh()
        const service = await m.accessor.loadStudioHistoryService()
        const owner = m.phase.characterOwnerKey('A')
        await service.whenReady(owner)
        expect(service.view(owner).phase).toBe('ready')
        expect(h.stores).toHaveLength(1)
        expect(h.stores[0].counts).toMatchObject({ open: 1, load: 1, save: 0 })

        expect(service.editField(owner, 'desc', 'typed').ok).toBe(true)
        await vi.advanceTimersByTimeAsync(999)
        expect(h.stores[0].counts.save).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(h.stores[0].counts.save).toBe(1)
        const stored = storedRecord(h.stores[0].shared, owner)
        expect(stored?.record.done).toHaveLength(1)
        expect([...h.stores[0].shared.keys()].sort()).toEqual(expectedOwnerKeys(stored!.header, stored!.record))
    })

    test('a page without Web Locks is memory-only with the noLocks banner, and nothing reaches the store', async () => {
        h.claimAnswer = 'unsupported'
        const m = await fresh()
        const service = await m.accessor.loadStudioHistoryService()
        const owner = m.phase.characterOwnerKey('A')
        await service.whenReady(owner)
        expect(service.view(owner)).toMatchObject({ phase: 'memoryOnly', banner: 'noLocks', editable: true })
        expect(service.editField(owner, 'desc', 'typed').ok).toBe(true)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(h.stores[0].counts).toMatchObject({ open: 0, load: 0, save: 0 })
    })

    test('on Tauri a page without Web Locks is the one live page and its owner becomes ready', async () => {
        h.claimAnswer = 'unsupported'
        h.tauri = true
        const m = await fresh()
        const service = await m.accessor.loadStudioHistoryService()
        const owner = m.phase.characterOwnerKey('A')
        await service.whenReady(owner)
        expect(service.view(owner).phase).toBe('ready')
    })

    test('T-C4b two concurrent first uses of one character ask the lock table once and neither is other-tab', async () => {
        const m = await fresh()
        const history = await import('../ownerHistory.svelte')
        const doubles = await import('./studioStoreDoubles')
        const realLocks = await vi.importActual<typeof import('../studioClaimLocks')>('../studioClaimLocks')
        const { createLocksWorld } = await import('./studioLocksFake')
        const tab = createLocksWorld().createTab()
        const service = history.createOwnerHistoryService({
            store: doubles.createMemoryStudioStore(),
            claim: realLocks.createStudioClaimLocks(() => tab),
            clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        const character = m.phase.characterOwnerKey('A')
        const chat = m.phase.chatOwnerKey('A', 'c1')
        service.useOwner(character)
        service.useOwner(chat)
        await Promise.all([service.whenReady(character), service.whenReady(chat)])
        expect(tab.requests).toEqual(['risuStudio.history:A'])
        expect(service.view(character).phase).toBe('ready')
        expect(service.view(chat).phase).toBe('ready')
        expect(service.view(chat).banner).not.toBe('otherTab')
    })

    test('a test override is returned without loading any module', async () => {
        const m = await fresh()
        const fake = { closeOpenStep: vi.fn(), setAck: vi.fn(), useOwner: vi.fn() } as unknown as OwnerHistoryService
        m.accessor.setStudioHistoryServiceForTests(fake)
        expect(m.accessor.getStudioHistoryService()).toBe(fake)
        expect(await m.accessor.loadStudioHistoryService()).toBe(fake)
        m.accessor.ensureStudioHistory()
        expect(m.onHide.registerLeaveFlush).not.toHaveBeenCalled()
        m.accessor.resetStudioHistoryAccessorForTests()
        expect(m.accessor.getStudioHistoryService()).toBeNull()
    })
})

describe('a module that cannot be loaded (I11: no form stays read-only because a chunk failed)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    const IDB = 'src/ts/studio/history/studioStoreIdb'
    const PROXY = 'src/ts/studio/history/studioStoreProxy'
    const LOCKS = 'src/ts/studio/history/studioClaimLocks'
    const CORE = 'src/ts/studio/history/ownerHistory.svelte'

    // A chunk that cannot load: its module factory throws, as a failed dynamic import does.
    function failToLoad(path: string): void {
        vi.doMock(path, () => {
            throw new Error('the chunk could not be loaded')
        })
    }

    afterEach(() => {
        vi.restoreAllMocks()
        vi.doMock(IDB, () => adapterMocks.idb())
        vi.doMock(PROXY, () => adapterMocks.proxy())
        vi.doMock(LOCKS, () => adapterMocks.locks())
        vi.doUnmock(CORE)
    })

    const adapters = [
        ['the device store proxy', PROXY],
        ['the claim adapter', LOCKS],
    ] as const

    for (const [name, path] of adapters) {
        test(`${name} failing still builds the service: owners are editable in memory with the failed banner, nothing is persisted`, async () => {
            failToLoad(path)
            const m = await fresh()
            const service = await m.accessor.loadStudioHistoryService()
            expect(m.accessor.getStudioHistoryService()).toBe(service)
            expect(m.accessor.studioHistoryLoadFailed()).toBe(false)
            expect(m.onHide.registerLeaveFlush).toHaveBeenCalledTimes(1)

            const owner = m.phase.characterOwnerKey('A')
            await service.whenReady(owner)
            expect(service.view(owner)).toMatchObject({ phase: 'memoryOnly', banner: 'failed', editable: true })
            expect(m.accessor.historyBannerText('failed')).toBeTruthy()
            expect(service.editField(owner, 'desc', 'typed').ok).toBe(true)
            await vi.advanceTimersByTimeAsync(60_000)
            expect(h.stores).toHaveLength(0)
        })
    }

    test('the IndexedDB adapter module failing to load changes nothing: the main realm never imports it, so the owner reaches ready over the proxy', async () => {
        failToLoad(IDB)
        const m = await fresh()
        const service = await m.accessor.loadStudioHistoryService()
        const owner = m.phase.characterOwnerKey('A')
        await service.whenReady(owner)
        expect(service.view(owner).phase).toBe('ready')
        expect(h.stores).toHaveLength(1)
    })

    test('the service module failing leaves no service and reports the load as failed; a later call builds it', async () => {
        failToLoad(CORE)
        const m = await fresh()
        m.accessor.ensureStudioHistory()
        await vi.waitFor(() => expect(m.accessor.studioHistoryLoadFailed()).toBe(true))
        expect(m.accessor.getStudioHistoryService()).toBeNull()
        expect(m.onHide.registerLeaveFlush).not.toHaveBeenCalled()
        await expect(m.accessor.loadStudioHistoryService()).rejects.toThrow()

        vi.doUnmock(CORE)
        m.accessor.ensureStudioHistory()
        expect(m.accessor.studioHistoryLoadFailed()).toBe(false)
        await vi.waitFor(() => expect(m.accessor.getStudioHistoryService()).not.toBeNull())
    })

    test('a rejected build is forgotten: the failure shows, and the next call starts a new build that clears it', async () => {
        const m = await fresh()
        const built = { closeOpenStep: vi.fn(), setAck: vi.fn(), useOwner: vi.fn() } as unknown as OwnerHistoryService
        let attempts = 0
        m.accessor.setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('the service chunk could not be loaded')
            return { service: built, createAck: () => ({}) as unknown as SaveAck }
        })
        m.accessor.ensureStudioHistory()
        await vi.waitFor(() => expect(m.accessor.studioHistoryLoadFailed()).toBe(true))
        expect(m.accessor.getStudioHistoryService()).toBeNull()

        m.accessor.ensureStudioHistory()
        expect(m.accessor.studioHistoryLoadFailed()).toBe(false)
        await vi.waitFor(() => expect(m.accessor.getStudioHistoryService()).toBe(built))
        expect(attempts).toBe(2)
        expect(m.accessor.studioHistoryLoadFailed()).toBe(false)
        // A build in flight or done is shared: no third attempt.
        m.accessor.ensureStudioHistory()
        expect(attempts).toBe(2)
    })
})

describe('the visit ack', () => {
    function fakeService(): { service: OwnerHistoryService; setAck: ReturnType<typeof vi.fn>; useOwner: ReturnType<typeof vi.fn>; closeOpenStep: ReturnType<typeof vi.fn> } {
        const setAck = vi.fn()
        const useOwner = vi.fn()
        const closeOpenStep = vi.fn()
        return { service: { setAck, useOwner, closeOpenStep } as unknown as OwnerHistoryService, setAck, useOwner, closeOpenStep }
    }

    test('nothing happens while the service is not built', async () => {
        const m = await fresh()
        expect(m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))).toBeNull()
        expect(m.accessor.currentVisitAck()).toBeNull()
    })

    test('an owner key that names nothing is refused', async () => {
        const m = await fresh()
        const { service } = fakeService()
        m.accessor.setStudioHistoryServiceForTests(service)
        const ack = { dispose: vi.fn() } as unknown as SaveAck
        m.accessor.setStudioVisitAckForTests(ack)
        expect(m.accessor.beginOwnerVisit('character:' as never)).toBeNull()
    })

    test('the first owner of a visit creates the ack, hands it to the service and starts the owner; the second reuses it', async () => {
        const m = await fresh()
        const real = await m.accessor.loadStudioHistoryService()
        const spySet = vi.spyOn(real, 'setAck')
        const spyUse = vi.spyOn(real, 'useOwner')
        const first = m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))
        expect(first).not.toBeNull()
        expect(h.acks).toHaveLength(1)
        expect(m.accessor.currentVisitAck()).toBe(first)
        expect(spySet).toHaveBeenCalledWith('A', first)
        expect(spyUse).toHaveBeenCalledWith('character:A')
        const second = m.accessor.beginOwnerVisit(m.phase.chatOwnerKey('A', 'c1'))
        expect(second).toBe(first)
        expect(h.acks).toHaveLength(1)
        expect(spyUse).toHaveBeenCalledWith('chat:A/c1')
    })

    test('a new visit ends the old ack: open steps close, the service forgets it, it is disposed', async () => {
        const m = await fresh()
        const real = await m.accessor.loadStudioHistoryService()
        const spySet = vi.spyOn(real, 'setAck')
        const spyClose = vi.spyOn(real, 'closeOpenStep')
        const first = m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))
        m.screen.studioScreen.visitId = 'v2'
        const second = m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))
        expect(second).not.toBe(first)
        expect(h.acks[0].dispose).toHaveBeenCalledTimes(1)
        expect(h.acks[1].dispose).not.toHaveBeenCalled()
        expect(spyClose).toHaveBeenCalledWith('character:A')
        expect(spySet).toHaveBeenCalledWith('A', null)
        expect(m.accessor.currentVisitAck()).toBe(second)
    })

    test('closing Studio ends the visit ack', async () => {
        const m = await fresh()
        const real = await m.accessor.loadStudioHistoryService()
        const spySet = vi.spyOn(real, 'setAck')
        const spyClose = vi.spyOn(real, 'closeOpenStep')
        m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))
        expect(m.accessor.currentVisitAck()).not.toBeNull()
        m.open.set(false)
        expect(m.accessor.currentVisitAck()).toBeNull()
        expect(h.acks[0].dispose).toHaveBeenCalledTimes(1)
        expect(spyClose).toHaveBeenCalledWith('character:A')
        expect(spySet).toHaveBeenLastCalledWith('A', null)
    })

    test('a test-supplied ack is not disposed by the accessor', async () => {
        const m = await fresh()
        const { service } = fakeService()
        m.accessor.setStudioHistoryServiceForTests(service)
        const dispose = vi.fn()
        m.accessor.setStudioVisitAckForTests({ dispose } as unknown as SaveAck)
        m.accessor.beginOwnerVisit(m.phase.characterOwnerKey('A'))
        m.open.set(false)
        expect(m.accessor.currentVisitAck()).toBeNull()
        expect(dispose).not.toHaveBeenCalled()
    })
})

describe('banner text', () => {
    test('every reason has its own text and no banner has none', async () => {
        const m = await fresh()
        const reasons = ['otherTab', 'noLocks', 'failed', 'unavailable', 'unwritable', 'keptUnreadable', 'unreadable', 'trimmed'] as const
        const texts = reasons.map((reason) => m.accessor.historyBannerText(reason))
        expect(texts).toEqual([
            'studioBannerOtherTab',
            'studioBannerNoLocks',
            'studioBannerFailed',
            'studioBannerUnavailable',
            'studioBannerUnwritable',
            'studioBannerKeptUnreadable',
            'studioBannerUnreadable',
            'studioBannerTrimmed',
        ])
        expect(new Set(texts).size).toBe(reasons.length)
        expect(m.accessor.historyBannerText(null)).toBeNull()
    })
})
