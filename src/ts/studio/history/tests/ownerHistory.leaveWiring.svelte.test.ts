// @vitest-environment jsdom
// T-S18c part 1: the production wiring of the leave registration. The service is created with no
// injected registrar, so it registers through its default (the real saveOnHide.ts registry), and the
// leave is the real `flushPageBeforeLeaving()`. The file-wide mocks below replace the persistence
// module `globalApi.svelte`, the store module `stores.svelte`, the store proxy and the claim adapter, the platform
// flag, the save ack module and the language table, in both parts; saveOnHide.ts, the service and the
// accessor are the real files, and every case resets the module registry, so no registration leaks
// from one case to the next.
// T-S18c part 2: the same leave, but the service is reached only through the production accessor, which
// builds it with the device store and the claim (here a memory double and a granting claim, replaced by a
// test-side module mock; the accessor is not given a seam) and passes no registrar. The accessor module's
// own dependencies that are not part of the registration (the language table, the save ack module and the
// platform flag) are replaced, because they reach into the save loop and the whole locale set.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, stores: [] as { counts: { save: number }; shared: Map<string, string> }[] }))

vi.mock('src/ts/studio/history/studioStoreProxy', async () => {
    const doubles = await import('src/ts/studio/history/tests/studioStoreDoubles')
    return {
        createStudioStoreProxy: vi.fn(() => {
            const store = doubles.createMemoryStudioStore()
            h.stores.push(store)
            return store
        }),
    }
})
vi.mock('src/ts/studio/history/studioClaimLocks', () => ({
    createStudioClaimLocks: vi.fn(() => ({ tryClaim: async () => 'granted' })),
}))
vi.mock('src/ts/platform', () => ({ isTauri: false }))
vi.mock('src/ts/studio/edit/saveAck.svelte', () => ({ productionSaveAckDeps: vi.fn(() => ({})), createSaveAck: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

// Every export of globalApi.svelte that saveOnHide.ts and the service's edit path read.
vi.mock('src/ts/globalApi.svelte', () => ({
    requestSaveNow: vi.fn(),
    requestNetSweep: vi.fn(),
    hasUnsavedSaveMarks: vi.fn(() => false),
    getSaveMarkCount: () => h.marks,
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

interface Fresh {
    onHide: typeof import('src/ts/process/saveOnHide')
    service: typeof import('../ownerHistory.svelte')
    phase: typeof import('../ownerPhase')
    kit: typeof import('./historyTestKit.test-helpers')
    doubles: typeof import('./studioStoreDoubles')
}

async function freshModules(): Promise<Fresh> {
    vi.resetModules()
    const stores = await import('src/ts/stores.svelte')
    const marks = await import('src/ts/storage/characterSaveMarks')
    const screen = await import('src/ts/studio/studioScreen.svelte')
    marks.resetCharacterSaveMarksForTest()
    marks.installCharacterSaveMarks({
        tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
        schedule: () => { h.marks += 1 },
    })
    stores.DBState.db.characters = [
        {
            chaId: 'A',
            desc: 'd0',
            alternateGreetings: ['g0'],
            chats: [{ id: 'c1', note: '' }],
            chatPage: 0,
        },
    ] as unknown as typeof stores.DBState.db.characters
    stores.selIdState.selId = 0
    screen.studioScreen.chaId = 'A'
    return {
        onHide: await import('src/ts/process/saveOnHide'),
        service: await import('../ownerHistory.svelte'),
        phase: await import('../ownerPhase'),
        kit: await import('./historyTestKit.test-helpers'),
        doubles: await import('./studioStoreDoubles'),
    }
}

beforeEach(() => {
    h.marks = 0
    h.stores.length = 0
})

afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
})

describe('T-S18c part 1: the default registrar reaches the real page leave rule', () => {
    test('a service created without a registrar is flushed by the real flushPageBeforeLeaving()', async () => {
        const m = await freshModules()
        const A = m.phase.characterOwnerKey('A')
        const clock = m.kit.createFakeClock()
        const store = m.doubles.createMemoryStudioStore()
        const service = m.service.createOwnerHistoryService({
            store,
            claim: m.doubles.createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
        })
        await service.whenReady(A)
        expect(service.editField(A, 'desc', 'typed').ok).toBe(true)
        clock.set(100)
        // No clock advance past the debounce: only the leave can have caused a save.
        m.onHide.flushPageBeforeLeaving()
        await m.kit.drainMicrotasks()
        expect(store.counts.save).toBe(1)
        expect(m.doubles.storedRecord(store.shared, A)?.record.done).toHaveLength(1)
    })

    test('control: a service whose registrar registers nothing is not flushed by the same leave', async () => {
        const m = await freshModules()
        const A = m.phase.characterOwnerKey('A')
        const clock = m.kit.createFakeClock()
        const store = m.doubles.createMemoryStudioStore()
        const service = m.service.createOwnerHistoryService({
            store,
            claim: m.doubles.createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        await service.whenReady(A)
        expect(service.editField(A, 'desc', 'typed').ok).toBe(true)
        clock.set(100)
        m.onHide.flushPageBeforeLeaving()
        await m.kit.drainMicrotasks()
        expect(store.counts.save).toBe(0)
    })
})

describe('T-S18c part 2: the production accessor reaches the real page leave rule', () => {
    test('a service reached only through the accessor is flushed by the real flushPageBeforeLeaving()', async () => {
        // Fake timers come first, so the accessor's production clock reads the faked timer globals.
        vi.useFakeTimers()
        const m = await freshModules()
        const accessor = await import('../studioHistoryService.svelte')
        const screen = await import('src/ts/studio/studioScreen.svelte')
        screen.studioScreen.visitId = 'v1'
        const A = m.phase.characterOwnerKey('A')

        const service = await accessor.loadStudioHistoryService()
        await service.whenReady(A)
        expect(h.stores).toHaveLength(1)
        expect(service.editField(A, 'desc', 'typed').ok).toBe(true)
        await vi.advanceTimersByTimeAsync(100)
        // Still inside the debounce window: only the leave can cause a save.
        expect(h.stores[0].counts.save).toBe(0)
        m.onHide.flushPageBeforeLeaving()
        await m.kit.drainMicrotasks()
        expect(h.stores[0].counts.save).toBe(1)
        expect(m.doubles.storedRecord(h.stores[0].shared, A)?.record.done).toHaveLength(1)
        // The flush cleared the timers: the debounce adds no second save.
        await vi.advanceTimersByTimeAsync(6000)
        expect(h.stores[0].counts.save).toBe(1)
    })
})
