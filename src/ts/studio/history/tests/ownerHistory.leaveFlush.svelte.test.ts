// @vitest-environment jsdom
// A page leave (hide, pagehide, or the Back route's flush) enqueues at once the waiting history save
// of every ready owner whose debounce is pending, and touches nothing else. The service gets an
// injected capturing registrar here; the production wiring is in ownerHistory.leaveWiring.svelte.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { flushBeforeLeaving, installSaveOnHide, type SaveOnHideDeps } from 'src/ts/process/saveOnHide'
import { closeStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createGate, createMemoryStudioStore, storedRecord, type ClaimDouble, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveCharacter {
    chaId: string
    license?: string
    desc: string
    alternateGreetings: string[]
    chats: { id?: string; note: string; fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(chaId: string, overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

function putCharacters(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')

interface Page {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    // The flushes the service registered, and how many remover calls the test made.
    captured: (() => void)[]
    removers: (() => void)[]
}

function buildPage(): Page {
    const clock = createFakeClock()
    const store = createMemoryStudioStore()
    const claim = createClaimDouble()
    const captured: (() => void)[] = []
    const removers: (() => void)[] = []
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush(flush) {
            captured.push(flush)
            const remove = (): void => {
                const at = captured.indexOf(flush)
                if (at >= 0) {
                    captured.splice(at, 1)
                }
            }
            removers.push(remove)
            return remove
        },
    })
    return { clock, store, claim, service, captured, removers }
}

let page: Page

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacters(makeCharacter('A'), makeCharacter('B'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    page = buildPage()
})

afterEach(() => {
    for (const remove of page.removers) {
        remove()
    }
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

interface Profile {
    deps: SaveOnHideDeps
    saveNow: ReturnType<typeof vi.fn>
    doc: EventTarget & { visibilityState: DocumentVisibilityState }
    win: EventTarget
}

// Stub profile deps around the captured flush: a clean page with no chat, as the real rule sees it.
function profileAround(flush: () => void): Profile {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const win = new EventTarget()
    const saveNow = vi.fn()
    const deps: SaveOnHideDeps = {
        doc,
        win,
        kinds: () => [],
        streams: () => [],
        unsaved: () => false,
        mark: vi.fn(),
        saveNow,
        sweepNet: vi.fn(),
        leaveFlush: flush,
    }
    return { deps, saveNow, doc, win }
}

type Leave = (profile: Profile) => void

const leaves: [string, Leave][] = [
    [
        'visibilitychange to hidden',
        (profile) => {
            profile.doc.visibilityState = 'hidden'
            profile.doc.dispatchEvent(new Event('visibilitychange'))
        },
    ],
    ['pagehide', (profile) => profile.win.dispatchEvent(new Event('pagehide'))],
    ['flushBeforeLeaving called directly (the Back route runs this function)', (profile) => flushBeforeLeaving(profile.deps)],
]

describe.each(leaves)('T-S18b: a leave by %s', (_name, leave) => {
    let uninstall: () => void = () => {}

    function wire(): Profile {
        expect(page.captured).toHaveLength(1)
        // The leave rule runs whatever is registered at the leave, as the page's registry does: a
        // registration that was removed in between is not run.
        const profile = profileAround(() => {
            for (const flush of [...page.captured]) {
                flush()
            }
        })
        uninstall = installSaveOnHide(profile.deps)
        return profile
    }

    afterEach(() => {
        uninstall()
        uninstall = () => {}
    })

    test('a pending edit is saved at once; the registrar was called once; no clock advance is needed', async () => {
        const profile = wire()
        await page.service.whenReady(A)
        expect(page.service.editField(A, 'desc', 'typed').ok).toBe(true)
        page.clock.set(100)
        const marks = h.marks
        leave(profile)
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(1)
        expect(storedRecord(page.store.shared, A)?.record.done).toHaveLength(1)
        // The flush marks nothing and never dirties the page.
        expect(h.marks).toBe(marks)
        expect(profile.saveNow).not.toHaveBeenCalled()
        await page.clock.advance(6000)
        expect(page.store.counts.save).toBe(1)
    })

    test('a second leave with nothing pending writes nothing', async () => {
        const profile = wire()
        await page.service.whenReady(A)
        page.service.editField(A, 'desc', 'typed')
        page.clock.set(100)
        leave(profile)
        await drainMicrotasks()
        leave(profile)
        await drainMicrotasks()
        await page.clock.advance(6000)
        expect(page.store.counts.save).toBe(1)
    })

    test('closing Studio does not remove the registration', async () => {
        const profile = wire()
        await page.service.whenReady(A)
        page.service.editField(A, 'desc', 'typed')
        page.clock.set(50)
        // What the UI does at a visit close.
        page.service.closeOpenStep(A)
        closeStudio()
        page.clock.set(100)
        leave(profile)
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(1)
    })

    // This case and the next are guards, not pure controls: a leave that enqueues a save for a ready owner with
    // no pending debounce fails the first one too.
    test('an owner that is still loading is untouched', async () => {
        const profile = wire()
        await page.service.whenReady(A)
        const gate = createGate()
        page.store.hooks.load = () => gate.promise
        page.service.useOwner(B)
        await drainMicrotasks()
        expect(page.service.view(B).phase).toBe('loading')
        const snapshot = new Map(page.store.shared)
        leave(profile)
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(0)
        expect(page.store.shared).toEqual(snapshot)
    })

    test('a memory-only owner with an edit is untouched', async () => {
        const profile = wire()
        page.claim.forced = 'held'
        await page.service.whenReady(A)
        expect(page.service.view(A).phase).toBe('memoryOnly')
        expect(page.service.editField(A, 'desc', 'typed').ok).toBe(true)
        leave(profile)
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(0)
        expect(page.store.shared.size).toBe(0)
    })
})

describe('registration', () => {
    test('the service registers its flush once per instance, at creation', () => {
        expect(page.captured).toHaveLength(1)
    })
})

describe('T-C5c: a save armed before the character became private writes nothing', () => {
    test('the debounce fires after the change', async () => {
        await page.service.whenReady(A)
        expect(page.service.editField(A, 'desc', 'typed').ok).toBe(true)
        page.clock.set(100)
        putCharacters(makeCharacter('A', { license: 'private' }), makeCharacter('B'))
        const snapshot = new Map(page.store.shared)
        await page.clock.advance(6000)
        expect(page.store.counts.save).toBe(0)
        expect(page.store.shared).toEqual(snapshot)
    })

    test('a leave after the change enqueues the job, which writes nothing', async () => {
        await page.service.whenReady(A)
        expect(page.service.editField(A, 'desc', 'typed').ok).toBe(true)
        page.clock.set(100)
        putCharacters(makeCharacter('A', { license: 'private' }), makeCharacter('B'))
        page.clock.set(200)
        const snapshot = new Map(page.store.shared)
        page.captured[0]()
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(0)
        expect(page.store.shared).toEqual(snapshot)
    })

    test('without the change the same leave saves (the control)', async () => {
        await page.service.whenReady(A)
        page.service.editField(A, 'desc', 'typed')
        page.clock.set(200)
        page.captured[0]()
        await drainMicrotasks()
        expect(page.store.counts.save).toBe(1)
    })
})
