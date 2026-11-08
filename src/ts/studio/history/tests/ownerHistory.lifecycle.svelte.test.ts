// @vitest-environment jsdom
// The service lifecycle over the memory doubles: one load per owner and page, edits refused until
// ready, the one ready deadline, shared claim and open entries, the single-writer claim, the
// closed connection, the cap and the save debounce. Every timing assertion uses the fake clock.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { closeStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import {
    characterOwnerKey,
    chatOwnerKey,
    READY_DEADLINE_MS,
    SAVE_DEBOUNCE_MS,
    SAVE_MAX_WAIT_MS,
    type OwnerKey,
} from '../ownerPhase'
import { asideMarkKey, headerKey, ownerCapFor } from '../studioHistoryStore'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import {
    createClaimDouble,
    createClaimWorld,
    createGate,
    createMemoryStudioStore,
    storedRecord,
    type ClaimDouble,
    type Gate,
    type MemoryStudioStore,
} from './studioStoreDoubles'

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

function live(chaId = 'A'): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[]).find((c) => c.chaId === chaId) as LiveCharacter
}

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const E = characterOwnerKey('E')
const chatA: OwnerKey = chatOwnerKey('A', 'c1')

interface Page {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    visit: { id: string }
}

interface PageOptions {
    shared?: Map<string, string>
    capBytes?: number
    claim?: ClaimDouble
    store?: MemoryStudioStore
    tauri?: boolean
    visit?: string
}

function buildPage(options: PageOptions = {}): Page {
    const clock = createFakeClock()
    const store = options.store ?? createMemoryStudioStore({ shared: options.shared, capBytes: options.capBytes })
    const claim = options.claim ?? createClaimDouble()
    const visit = { id: options.visit ?? 'v1' }
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: `p${Math.random().toString(16).slice(2, 8)}`,
        tauri: options.tauri,
        getVisitId: () => visit.id,
        registerLeaveFlush: () => () => {},
    })
    return { clock, store, claim, service, visit }
}

let page: Page

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacters(makeCharacter('A'), makeCharacter('B'), makeCharacter('E'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    page = buildPage()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// The whole stored state, sorted by key, for "nothing was written" equality.
function sortedEntries(shared: Map<string, string>): [string, string][] {
    return [...shared.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

const phase = (owner: OwnerKey, from: Page = page): string => from.service.view(owner).phase
const banner = (owner: OwnerKey, from: Page = page) => from.service.view(owner).banner

// Edits `n` steps on desc, spaced past the coalescing window, and lets the debounced save land.
async function editAndSave(from: Page, owner: OwnerKey, n: number): Promise<void> {
    await from.service.whenReady(owner)
    for (let i = 0; i < n; i++) {
        from.clock.set(from.clock.now() + 1500)
        expect(from.service.editField(owner, 'desc', `desc ${i}`).ok).toBe(true)
    }
    await from.clock.advance(SAVE_DEBOUNCE_MS)
}

describe('L1 / L2: no edit before ready, one load per owner and page', () => {
    test('T-S12: edits are refused while loading; once ready the first step records the true before', async () => {
        await editAndSave(page, A, 40)
        const stored = sortedEntries(page.store.shared)
        const reloaded = buildPage({ shared: page.store.shared, visit: 'v2' })
        const gate = createGate()
        reloaded.store.hooks.load = () => gate.promise
        reloaded.service.useOwner(A)
        await drainMicrotasks()
        expect(phase(A, reloaded)).toBe('loading')
        const desc = live().desc
        const marks = h.marks
        expect(reloaded.service.editField(A, 'desc', 'too early')).toEqual({ ok: false, reason: 'loading' })
        expect(live().desc).toBe(desc)
        expect(h.marks).toBe(marks)
        expect(reloaded.store.counts.save).toBe(0)
        gate.release()
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).done).toHaveLength(40)
        reloaded.clock.set(10_000)
        expect(reloaded.service.editField(A, 'desc', 'first after load').ok).toBe(true)
        const view = reloaded.service.view(A)
        expect(view.done).toHaveLength(41)
        const first = view.done.at(-1)?.ops[0]
        expect(first).toMatchObject({ op: 'set', path: 'desc', before: { had: true, value: desc } })
        expect(view.restore?.visitId).toBe('v2')
        expect(view.restore?.fields.desc?.before).toEqual({ had: true, value: desc })
        expect(sortedEntries(page.store.shared)).toEqual(stored)
    })

    test('T-S11: closing Studio and reopening while a save is queued keeps every step and loads once', async () => {
        await editAndSave(page, A, 2)
        const reloaded = buildPage({ shared: page.store.shared, visit: 'v2' })
        await reloaded.service.whenReady(A)
        expect(reloaded.store.counts.load).toBe(1)
        const gate = createGate()
        reloaded.store.hooks.save = () => gate.promise
        reloaded.clock.set(20_000)
        expect(reloaded.service.greetingDelete(A, 1).ok).toBe(true)
        await reloaded.clock.advance(SAVE_DEBOUNCE_MS)
        expect(reloaded.store.counts.save).toBe(1)
        // Close Studio and reopen at once: the second visit finds the slot as it is.
        closeStudio()
        reloaded.visit.id = 'v3'
        reloaded.service.useOwner(A)
        await reloaded.service.whenReady(A)
        const item = reloaded.service.view(A).deleted[0]
        expect(item.value).toBe('g1')
        expect(reloaded.service.restoreDeleted(A, item.id).ok).toBe(true)
        expect(reloaded.store.counts.load).toBe(1)
        gate.release()
        await reloaded.clock.advance(SAVE_DEBOUNCE_MS * 2)
        expect(reloaded.store.counts.load).toBe(1)
        const body = storedRecord(reloaded.store.shared, A)
        expect(body?.record.done.map((step) => step.label.kind)).toContain('greetingRemove')
        expect(body?.record.done.map((step) => step.label.kind)).toContain('restoreDeleted')
    })

    test('a later visit of a ready owner never loads again', async () => {
        await page.service.whenReady(A)
        page.service.useOwner(A)
        page.service.useOwner(chatA)
        await page.service.whenReady(chatA)
        await page.service.whenReady(A)
        expect(page.store.counts.load).toBe(2)
        expect(page.store.counts.open).toBe(1)
        expect(page.claim.calls).toEqual(['A'])
    })
})

describe('L3 / L4: nothing is written that was not read', () => {
    test('T-S13: a failed load makes the owner memory-only; edits land; the stored value stays byte-identical', async () => {
        await editAndSave(page, A, 1)
        const snapshot = new Map(page.store.shared)
        const base = createMemoryStudioStore({ shared: page.store.shared })
        const failing: MemoryStudioStore = { ...base, load: async () => ({ kind: 'failed' }) }
        const broken = buildPage({ store: failing })
        await broken.service.whenReady(A)
        expect(phase(A, broken)).toBe('memoryOnly')
        expect(banner(A, broken)).toBe('failed')
        const marks = h.marks
        for (let i = 0; i < 3; i++) {
            broken.clock.set(broken.clock.now() + 1500)
            expect(broken.service.editField(A, 'desc', `after failure ${i}`).ok).toBe(true)
        }
        expect(h.marks).toBe(marks + 3)
        expect(broken.service.view(A).done).toHaveLength(3)
        expect(broken.service.undo(A).ok).toBe(true)
        await broken.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(base.counts.save).toBe(0)
        expect(page.store.shared).toEqual(snapshot)
    })

    test('T-S14: a load that never settles ends at the deadline; a late ok changes nothing', async () => {
        await editAndSave(page, A, 2)
        const snapshot = new Map(page.store.shared)
        const slow = buildPage({ shared: page.store.shared })
        const gate = createGate()
        slow.store.hooks.load = () => gate.promise
        slow.service.useOwner(A)
        await slow.clock.advance(READY_DEADLINE_MS - 1)
        expect(phase(A, slow)).toBe('loading')
        await slow.clock.advance(1)
        expect(phase(A, slow)).toBe('memoryOnly')
        expect(banner(A, slow)).toBe('failed')
        expect(slow.service.editField(A, 'desc', 'works now').ok).toBe(true)
        gate.release()
        await slow.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(phase(A, slow)).toBe('memoryOnly')
        expect(slow.service.view(A).done).toHaveLength(1)
        expect(slow.store.counts.save).toBe(0)
        expect(page.store.shared).toEqual(snapshot)
    })

    test('an unreadable pair is copied aside by the first save; a taken aside key keeps the owner memory-only', async () => {
        // Stands for a later producer: a v2 header that this build must keep byte-for-byte.
        const shared = new Map<string, string>([[headerKey(A), '{"v":2}']])
        const first = buildPage({ shared })
        await first.service.whenReady(A)
        expect(banner(A, first)).toBe('unreadable')
        first.service.editField(A, 'desc', 'mine')
        await first.clock.advance(SAVE_DEBOUNCE_MS)
        expect(shared.get(asideMarkKey(A))).toBe('{"v":2}')
        expect(banner(A, first)).toBe('unreadable')
        // Later saves persist.
        first.clock.set(first.clock.now() + 1500)
        first.service.editField(A, 'desc', 'mine again')
        await first.clock.advance(SAVE_DEBOUNCE_MS)
        expect(storedRecord(shared, A)?.record.done).toHaveLength(2)
        expect(shared.get(asideMarkKey(A))).toBe('{"v":2}')

        const taken = new Map<string, string>([
            [headerKey(A), '{"v":2}'],
            [asideMarkKey(A), 'older aside'],
        ])
        const second = buildPage({ shared: taken })
        const before = new Map(taken)
        await second.service.whenReady(A)
        expect(phase(A, second)).toBe('memoryOnly')
        expect(banner(A, second)).toBe('keptUnreadable')
        second.service.editField(A, 'desc', 'mine')
        await second.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(taken).toEqual(before)
        expect(second.store.counts.save).toBe(0)
    })
})

describe('L8 / L6: one deadline per owner, shared entries that settle once', () => {
    test('T-S14b (a): a claim that never settles ends at 5000 ms for both owners of the character', async () => {
        const gate = createGate()
        page.claim.hook = () => gate.promise
        page.service.useOwner(A)
        await page.clock.advance(2000)
        page.service.useOwner(chatA)
        await page.clock.advance(READY_DEADLINE_MS - 2000 - 1)
        expect(phase(A)).toBe('claiming')
        expect(phase(chatA)).toBe('claiming')
        await page.clock.advance(1)
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('failed')
        expect(phase(chatA)).toBe('memoryOnly')
        expect(banner(chatA)).toBe('failed')
        expect(page.claim.calls).toEqual(['A'])
        expect(page.service.editField(A, 'desc', 'editable').ok).toBe(true)
        expect(h.marks).toBe(1)
        await page.clock.advance(2000)
        gate.release()
        await page.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(page.store.counts.open).toBe(0)
        expect(page.store.counts.load).toBe(0)
        expect(page.store.counts.save).toBe(0)
        expect(page.store.shared.size).toBe(0)
    })

    test('T-S14b (b): an open that never settles ends both waiting owners; a later owner finds it settled', async () => {
        const gate = createGate()
        page.store.hooks.open = () => gate.promise
        page.service.useOwner(A)
        // The claim answers at once, so the open entry is created at t = 0, before the clock moves.
        await drainMicrotasks()
        expect(phase(A)).toBe('opening')
        await page.clock.advance(1000)
        page.service.useOwner(B)
        await page.clock.advance(READY_DEADLINE_MS - 1000 - 1)
        expect(phase(A)).toBe('opening')
        expect(phase(B)).toBe('opening')
        await page.clock.advance(1)
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('unavailable')
        expect(phase(B)).toBe('memoryOnly')
        expect(banner(B)).toBe('unavailable')
        await page.clock.advance(1000)
        page.service.useOwner(E)
        await drainMicrotasks()
        expect(phase(E)).toBe('memoryOnly')
        expect(banner(E)).toBe('unavailable')
        expect(page.store.counts.open).toBe(1)
        await page.clock.advance(3000)
        gate.release()
        await page.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(page.store.counts.load).toBe(0)
        expect(page.store.shared.size).toBe(0)
    })

    test('T-S14b (c): a claim that rejects is mapped at once; nothing is opened', async () => {
        page.claim.hook = () => {
            throw new Error('SecurityError')
        }
        page.service.useOwner(A)
        await drainMicrotasks()
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('failed')
        expect(page.service.editField(A, 'desc', 'x').ok).toBe(true)
        expect(page.store.counts.open).toBe(0)
        expect(page.store.shared.size).toBe(0)
    })

    test('T-S14b (d): an open that rejects is mapped at once; nothing is loaded', async () => {
        page.store.hooks.open = () => {
            throw new Error('blocked')
        }
        page.service.useOwner(A)
        await drainMicrotasks()
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('unavailable')
        expect(page.store.counts.load).toBe(0)
        expect(page.store.shared.size).toBe(0)
    })

    test('T-S14b (e): the deadline counts across phases and is never restarted', async () => {
        const claimGate = createGate()
        const openGate = createGate()
        const loadGate = createGate()
        page.claim.hook = () => claimGate.promise
        page.store.hooks.open = () => openGate.promise
        page.store.hooks.load = () => loadGate.promise
        page.service.useOwner(A)
        await page.clock.advance(3000)
        claimGate.release()
        await drainMicrotasks()
        expect(phase(A)).toBe('opening')
        await page.clock.advance(1000)
        openGate.release()
        await drainMicrotasks()
        expect(phase(A)).toBe('loading')
        await page.clock.advance(999)
        expect(phase(A)).toBe('loading')
        await page.clock.advance(1)
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('failed')
        // The form is editable now: the edit lands and marks, and nothing is ever saved.
        expect(page.service.editField(A, 'desc', 'editable at 5000').ok).toBe(true)
        expect(h.marks).toBe(1)
        await page.clock.advance(3000)
        loadGate.release()
        await page.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(phase(A)).toBe('memoryOnly')
        expect(page.store.shared.size).toBe(0)
        expect(page.store.counts.save).toBe(0)
    })

    test('T-S14d: the open entry expires on its own, after its own creation', async () => {
        const claimGate = createGate()
        const openGate = createGate()
        page.claim.hook = (chaId) => (chaId === 'A' ? claimGate.promise : undefined)
        page.store.hooks.open = () => openGate.promise
        page.service.useOwner(A)
        await page.clock.advance(4900)
        claimGate.release()
        await drainMicrotasks()
        expect(phase(A)).toBe('opening')
        await page.clock.advance(100)
        // A's own deadline, in `opening`: A alone leaves.
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('unavailable')
        await page.clock.advance(500)
        page.service.useOwner(B)
        await drainMicrotasks()
        expect(phase(B)).toBe('opening')
        await page.clock.advance(100)
        openGate.release()
        await page.clock.advance(0)
        await drainMicrotasks()
        expect(phase(B)).toBe('ready')
        expect(page.store.counts.open).toBe(1)
    })

    test('T-S14d: an open that never answers expires D 5000 ms after the entry was created', async () => {
        const claimGate = createGate()
        const openGate = createGate()
        page.claim.hook = (chaId) => (chaId === 'A' ? claimGate.promise : undefined)
        page.store.hooks.open = () => openGate.promise
        page.service.useOwner(A)
        await page.clock.advance(4900)
        claimGate.release()
        await drainMicrotasks()
        await page.clock.advance(600)
        page.service.useOwner(B)
        await page.clock.advance(9899 - 5500)
        // t = 9899: the entry made at 4900 has not expired, and B's own deadline is at 10500.
        expect(phase(B)).toBe('opening')
        await page.clock.advance(1)
        expect(phase(B)).toBe('memoryOnly')
        expect(banner(B)).toBe('unavailable')
        expect(page.store.counts.open).toBe(1)
        await page.clock.advance(2100)
        openGate.release()
        await page.clock.advance(SAVE_MAX_WAIT_MS)
        expect(page.store.counts.load).toBe(0)
    })

    test('a claim granted after its owner expired is kept and never used for writes', async () => {
        const gate = createGate()
        page.claim.hook = () => gate.promise
        page.service.useOwner(A)
        await page.clock.advance(READY_DEADLINE_MS)
        expect(phase(A)).toBe('memoryOnly')
        gate.release()
        await page.clock.advance(SAVE_MAX_WAIT_MS)
        expect(phase(A)).toBe('memoryOnly')
        expect(page.claim.holds('A')).toBe(true)
        expect(page.store.counts.open).toBe(0)
        expect(page.store.counts.load).toBe(0)
    })
})

describe('T-S17: a closed connection', () => {
    test('a ready owner keeps its memory and goes memory-only; a later owner skips the load', async () => {
        await editAndSave(page, A, 2)
        page.store.simulateClose()
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('unavailable')
        expect(page.service.view(A).done).toHaveLength(2)
        expect(page.service.editField(A, 'desc', 'still editable').ok).toBe(true)
        const loads = page.store.counts.load
        page.service.useOwner(B)
        await drainMicrotasks()
        expect(phase(B)).toBe('memoryOnly')
        expect(banner(B)).toBe('unavailable')
        expect(page.store.counts.load).toBe(loads)
        expect(banner(A)).not.toBe('failed')
    })

    test('an owner that is still loading when the connection closes goes memory-only too', async () => {
        const gate = createGate()
        page.store.hooks.load = () => gate.promise
        page.service.useOwner(A)
        await drainMicrotasks()
        expect(phase(A)).toBe('loading')
        page.store.simulateClose()
        expect(phase(A)).toBe('memoryOnly')
        expect(banner(A)).toBe('unavailable')
        gate.release()
        await drainMicrotasks()
        expect(phase(A)).toBe('memoryOnly')
    })
})

describe('claim outcomes', () => {
    test('no Web Locks outside Tauri: memory-only with the noLocks banner; on Tauri the page is the live page', async () => {
        page.claim.unsupported = true
        await page.service.whenReady(A)
        expect(banner(A)).toBe('noLocks')
        const tauri = buildPage({ tauri: true })
        tauri.claim.unsupported = true
        await tauri.service.whenReady(A)
        expect(phase(A, tauri)).toBe('ready')
    })

    test('T-C4b: two concurrent first uses of one character share one claim and are never otherTab', async () => {
        page.service.useOwner(A)
        page.service.useOwner(chatA)
        await page.service.whenReady(A)
        await page.service.whenReady(chatA)
        expect(page.claim.calls).toEqual(['A'])
        expect(phase(A)).toBe('ready')
        expect(phase(chatA)).toBe('ready')
        expect(banner(chatA)).not.toBe('otherTab')
    })
})

describe('T-C1 / T-C2 / T-C3: one tab persists a character', () => {
    function twoPages(): { first: Page; second: Page; world: ReturnType<typeof createClaimWorld> } {
        const world = createClaimWorld()
        const shared = new Map<string, string>()
        const first = buildPage({ shared, claim: world.createPage() })
        const second = buildPage({ shared, claim: world.createPage() })
        return { first, second, world }
    }

    test('T-C1: the second tab edits in memory and never changes the stored record', async () => {
        const { first, second } = twoPages()
        await editAndSave(first, A, 1)
        const stored = new Map(first.store.shared)
        await second.service.whenReady(A)
        expect(banner(A, second)).toBe('otherTab')
        for (let i = 0; i < 3; i++) {
            second.clock.set(second.clock.now() + 1500)
            expect(second.service.editField(A, 'desc', `second ${i}`).ok).toBe(true)
        }
        expect(h.marks).toBeGreaterThanOrEqual(3)
        await second.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(second.store.counts.save).toBe(0)
        expect(first.store.shared).toEqual(stored)
    })

    test('T-C2: the second tab starts empty, so a deleted item cannot be restored twice', async () => {
        const { first, second } = twoPages()
        await first.service.whenReady(A)
        first.service.greetingDelete(A, 0)
        await first.clock.advance(SAVE_DEBOUNCE_MS)
        const id = first.service.view(A).deleted[0].id
        await second.service.whenReady(A)
        expect(second.service.view(A).deleted).toEqual([])
        expect(second.service.view(A).done).toEqual([])
        expect(second.service.restoreDeleted(A, id)).toEqual({ ok: false, reason: 'unknown' })
        expect(second.store.counts.load).toBe(0)
    })

    test('T-C3: the claim lasts to the end of the page, even after the visit closed', async () => {
        const { first, second, world } = twoPages()
        await editAndSave(first, A, 1)
        closeStudio()
        first.service.useOwner(A)
        // A toast Undo after Studio closed takes the same path and still persists.
        first.clock.set(first.clock.now() + 1500)
        expect(first.service.undo(A).ok).toBe(true)
        await first.clock.advance(SAVE_DEBOUNCE_MS)
        const body = storedRecord(first.store.shared, A)
        expect(body?.record.undone).toHaveLength(1)
        await second.service.whenReady(A)
        expect(banner(A, second)).toBe('otherTab')
        const third = buildPage({ shared: first.store.shared, claim: world.createPage() })
        await third.service.whenReady(A)
        expect(banner(A, third)).toBe('otherTab')
        first.claim.endPage()
        const fourth = buildPage({ shared: first.store.shared, claim: world.createPage() })
        await fourth.service.whenReady(A)
        expect(phase(A, fourth)).toBe('ready')
        expect(fourth.service.view(A).undone).toHaveLength(1)
    })
})

describe('T-C5 / T-C5b: private owners and groups', () => {
    test('T-C5: a visit to an owner that became private never claims or loads, and shows nothing', async () => {
        await editAndSave(page, A, 2)
        putCharacters(makeCharacter('A', { license: 'private' }))
        const later = buildPage({ shared: page.store.shared })
        later.service.useOwner(A)
        await later.service.whenReady(A)
        expect(later.claim.calls).toEqual([])
        expect(later.store.counts.load).toBe(0)
        expect(later.service.view(A).restricted).toBe(true)
        expect(later.service.view(A).done).toEqual([])
        expect(later.service.editField(A, 'desc', 'x')).toEqual({ ok: false, reason: 'restricted' })
    })

    test('T-C5b: a ready owner whose character became private shows nothing, refuses everything and saves nothing', async () => {
        await editAndSave(page, A, 3)
        const snapshot = new Map(page.store.shared)
        const saves = page.store.counts.save
        const marks = h.marks
        putCharacters(makeCharacter('A', { license: 'private' }))
        const view = page.service.view(A)
        expect(view.restricted).toBe(true)
        expect(view.done).toEqual([])
        expect(view.deleted).toEqual([])
        expect(view.restore).toBeNull()
        expect(page.service.editField(A, 'desc', 'x')).toEqual({ ok: false, reason: 'restricted' })
        expect(page.service.undo(A)).toEqual({ ok: false, reason: 'restricted' })
        expect(page.service.restoreDeleted(A, 'anything')).toEqual({ ok: false, reason: 'restricted' })
        await page.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(h.marks).toBe(marks)
        expect(page.store.counts.save).toBe(saves)
        expect(page.store.shared).toEqual(snapshot)
    })
})

describe('saves: I8, the debounce, the cap', () => {
    test('T-S4: an unwritable store shows a banner, the edit still lands and undo works; the next save retries', async () => {
        await page.service.whenReady(A)
        page.store.forcedSave = { kind: 'unwritable' }
        expect(page.service.editField(A, 'desc', 'lands').ok).toBe(true)
        expect(live().desc).toBe('lands')
        expect(h.marks).toBe(1)
        await page.clock.advance(SAVE_DEBOUNCE_MS)
        expect(banner(A)).toBe('unwritable')
        expect(page.service.undo(A).ok).toBe(true)
        page.store.forcedSave = null
        await page.clock.advance(SAVE_DEBOUNCE_MS)
        expect(banner(A)).toBeNull()
        expect(storedRecord(page.store.shared, A)).not.toBeNull()
    })

    test('T-S4: a store that rejects never throws into the edit path', async () => {
        await page.service.whenReady(A)
        page.store.hooks.save = () => {
            throw new DOMException('full', 'QuotaExceededError')
        }
        expect(page.service.editField(A, 'desc', 'lands').ok).toBe(true)
        await page.clock.advance(SAVE_DEBOUNCE_MS)
        expect(banner(A)).toBe('unwritable')
        expect(page.service.undo(A).ok).toBe(true)
    })

    test('T-S6b: the stored copy is trimmed to the cap; memory keeps every step and undo works for all of them', async () => {
        const small = buildPage({ capBytes: 6000 })
        await small.service.whenReady(A)
        const filler = 'x'.repeat(150)
        for (let i = 0; i < 40; i++) {
            small.clock.set(small.clock.now() + 1500)
            expect(small.service.editField(A, 'desc', `${filler}${i}`).ok).toBe(true)
        }
        await small.clock.advance(SAVE_DEBOUNCE_MS)
        expect(banner(A, small)).toBe('trimmed')
        const stored = storedRecord(small.store.shared, A)
        expect(stored).not.toBeNull()
        expect(stored!.header.size).toBeLessThanOrEqual(ownerCapFor(6000))
        expect(stored!.record.done.length).toBeGreaterThan(0)
        expect(stored!.record.done.length).toBeLessThan(40)
        expect(small.service.view(A).done).toHaveLength(40)
        for (let i = 0; i < 40; i++) {
            expect(small.service.undo(A).ok).toBe(true)
        }
        expect(live().desc).toBe('d0')
    })

    test('T-S18: ten edits 200 ms apart save once, 1 s after the last', async () => {
        await page.service.whenReady(A)
        for (let i = 0; i < 10; i++) {
            expect(page.service.editField(A, 'desc', `typed ${i}`).ok).toBe(true)
            await page.clock.advance(200)
        }
        // The last edit was at t = 1800, and the clock is at 2000.
        await page.clock.advance(2799 - 2000)
        expect(page.store.counts.save).toBe(0)
        await page.clock.advance(1)
        expect(page.store.counts.save).toBe(1)
    })

    test('T-S18: continuous typing saves at the max wait, then once 1 s after the last edit', async () => {
        await page.service.whenReady(A)
        for (let t = 0; t <= 7000; t += 200) {
            expect(page.service.editField(A, 'desc', `typed ${t}`).ok).toBe(true)
            if (t < 7000) {
                await page.clock.advance(200)
            }
        }
        // The clock is at 7000 and the max-wait save ran at 5000.
        expect(page.store.counts.save).toBe(1)
        await page.clock.advance(SAVE_DEBOUNCE_MS - 1)
        expect(page.store.counts.save).toBe(1)
        await page.clock.advance(1)
        expect(page.store.counts.save).toBe(2)
    })

    test('T-S18: closing Studio between an edit and its timer does not cancel the save', async () => {
        await page.service.whenReady(A)
        expect(page.service.editField(A, 'desc', 'typed').ok).toBe(true)
        closeStudio()
        await page.clock.advance(SAVE_DEBOUNCE_MS)
        expect(page.store.counts.save).toBe(1)
        expect(storedRecord(page.store.shared, A)).not.toBeNull()
    })

    test('a save request of an owner that left ready is dropped', async () => {
        await page.service.whenReady(A)
        page.service.editField(A, 'desc', 'typed')
        page.store.simulateClose()
        await page.clock.advance(SAVE_MAX_WAIT_MS * 2)
        expect(page.store.counts.save).toBe(0)
    })
})

describe('whenReady', () => {
    test('resolves on ready, on memory-only and for an excluded owner', async () => {
        await page.service.whenReady(A)
        expect(phase(A)).toBe('ready')
        const failing = buildPage()
        failing.claim.forced = 'held'
        await failing.service.whenReady(A)
        expect(phase(A, failing)).toBe('memoryOnly')
        putCharacters(makeCharacter('A', { license: 'private' }))
        const excluded = buildPage()
        await excluded.service.whenReady(A)
        expect(phase(A, excluded)).toBe('excluded')
    })

    test('does not resolve while the owner is still loading', async () => {
        const gate: Gate = createGate()
        page.store.hooks.load = () => gate.promise
        let resolved = false
        void page.service.whenReady(A).then(() => {
            resolved = true
        })
        await drainMicrotasks()
        expect(resolved).toBe(false)
        gate.release()
        await drainMicrotasks()
        expect(resolved).toBe(true)
    })
})
