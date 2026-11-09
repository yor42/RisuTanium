// @vitest-environment jsdom
/**
 * The History panel over a real history service on the memory doubles, a real save ack with injected
 * dependencies and a toast host on a fake clock, mounted alone and inside the Studio screen. Time only moves when
 * the test says so: the service and the ack use one fake clock, and "settle" awaits resolved promises without
 * moving it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: fixtureDb() })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { createStudioToasts } from 'src/ts/studio/edit/studioToasts'
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioHistoryOpen, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { DEFAULT_TOAST_CONFIG, createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, READY_DEADLINE_MS, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS } from '../../ts/studio/history/ownerPhase'
import { ensureStudioHistory, resetStudioHistoryAccessorForTests, setStudioHistoryLoaderForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { asideMarkKey, headerKey, ownerCapFor } from '../../ts/studio/history/studioHistoryStore'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type ClaimDouble, type MemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioHistoryPanel from './StudioHistoryPanel.svelte'
import StudioScreen from './StudioScreen.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

interface Live {
    desc: string
    hideChatIcon?: boolean
    license?: string
    type?: string
    alternateGreetings: string[]
    chats: LiveChat[]
}

function fixtureDb(patch: Partial<Live> = {}) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat: LiveChat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2'], ...patch, chats: patch.chats ?? [chat] }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const CHAT = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const basicTarget = { owner: { type: 'character', id: 'A' }, kind: 'basic', item: 'A/basic:0', from: 'chat' } as const

// ---------------------------------------------------------------- rigs

function makeAck(clock: FakeClock): SaveAck {
    const committed = 0
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => committed,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

interface Rig {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
}

let rigCount = 0

function makeRig(options: { shared?: Map<string, string>; capBytes?: number } = {}): Rig {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared: options.shared, capBytes: options.capBytes })
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({ store, claim, clock, pageSession: `p${++rigCount}`, registerLeaveFlush: () => () => {} })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, store, claim, service }
}

// A toast clock that moves only when the test advances it; timers due within the step fire in order.
interface AdvancingToastClock extends ToastClock {
    advance(ms: number): void
}

function advancingToastClock(): AdvancingToastClock {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number; run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => {
                timers.delete(key)
            }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number; run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) next = entry
                }
                if (next === null) break
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

let toastClock = advancingToastClock()

function makeToastHost(): ToastHost {
    toastClock = advancingToastClock()
    return createToastHost({ clock: toastClock })
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const desc = () => part('studio-form-desc') as HTMLTextAreaElement

function click(name: string): void {
    part(name)?.click()
    flushSync()
}

function type(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function live() {
    return db.db.characters[0]
}

// A history page for character A, selected and open.
function openPanelState(): void {
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    setStudioSelection(A, null, null)
    setStudioHistoryOpen(true)
}

// Edits that stay separate steps: a pause is not needed because each one closes the open step.
function edit(rig: Rig, text: string): void {
    expect(rig.service.editField(A, 'desc', text).ok).toBe(true)
    rig.service.closeOpenStep(A)
}

function stepsText(): string[] {
    return parts('studio-history-step').map((row) => row.querySelector('span')?.textContent?.trim() ?? '')
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = fixtureDb()
    selection.selId = 0
    setStudioEnabled(true)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- banners

describe('T-UI8 the panel names why history is not kept', () => {
    const bannerOf = () => part('studio-history-banner')

    function expectBanner(reason: string, key: string): void {
        expect(bannerOf()?.getAttribute('data-banner')).toBe(reason)
        expect(bannerOf()?.textContent).toBe(key)
    }

    async function open(): Promise<void> {
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
    }

    test('otherTab: another page holds the character', async () => {
        const rig = makeRig()
        rig.claim.forced = 'held'
        await open()
        expectBanner('otherTab', 'studioBannerOtherTab')
    })

    test('noLocks: the page has no Web Locks', async () => {
        const rig = makeRig()
        rig.claim.unsupported = true
        await open()
        expectBanner('noLocks', 'studioBannerNoLocks')
    })

    test('failed: the claim failed', async () => {
        const rig = makeRig()
        rig.claim.forced = 'failed'
        await open()
        expectBanner('failed', 'studioBannerFailed')
    })

    test('failed with no service at all: the module could not load, the panel offers Retry and lists the steps after it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const rig = makeRig()
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('the service chunk could not be loaded')
            return { service: rig.service, createAck: () => makeAck(rig.clock) }
        })
        await open()
        expect(attempts).toBe(1)
        expectBanner('failed', 'studioBannerFailed')
        expect(part('studio-history-loading')).toBeNull()
        expect(part('studio-history-retry')?.textContent).toBe('studioChipRetry')

        click('studio-history-retry')
        await settle()
        await settle()
        expect(attempts).toBe(2)
        expect(part('studio-history-retry')).toBeNull()
        expect(part('studio-history-undo')).not.toBeNull()
        vi.restoreAllMocks()
    })

    // T-UI-R1: the Retry button unmounts when the build starts, so focus moves to the panel's root first.
    test('T-UI-R1 after a Retry click focus is on the panel root, never on the body', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const rig = makeRig()
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('the service chunk could not be loaded')
            return { service: rig.service, createAck: () => makeAck(rig.clock) }
        })
        await open()
        await settle()
        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()
        expect(document.activeElement).toBe(retry)
        retry.click()
        await settle()
        await settle()
        expect(attempts).toBe(2)
        expect(part('studio-history-retry')).toBeNull()
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement).toBe(part('studio-history'))
        vi.restoreAllMocks()
    })

    // T-UI-R2: a retry that fails again puts Retry back; focus follows it only when the click had put it on the root.
    test('T-UI-R2 when Retry fails twice the banner and Retry return and focus lands on Retry; a build nobody asked for steals nothing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            throw new Error('the service chunk could not be loaded')
        })
        await open()
        await settle()
        expect(attempts).toBe(1)
        expectBanner('failed', 'studioBannerFailed')
        // The first failure was nobody's click: focus is not moved.
        expect(document.activeElement).toBe(document.body)

        for (const expected of [2, 3]) {
            const retry = part('studio-history-retry') as HTMLButtonElement
            retry.focus()
            retry.click()
            await settle()
            await settle()
            expect(attempts).toBe(expected)
            expectBanner('failed', 'studioBannerFailed')
            expect(part('studio-history-retry')).not.toBeNull()
            expect(document.activeElement).toBe(part('studio-history-retry'))
        }

        // A build started some other way fails while focus sits on the root: the flag of the earlier click is spent.
        const root = part('studio-history') as HTMLElement
        root.focus()
        ensureStudioHistory()
        await settle()
        await settle()
        expect(attempts).toBe(4)
        expect(document.activeElement).toBe(root)
        vi.restoreAllMocks()
    })

    test('unavailable: the store connection was closed', async () => {
        const rig = makeRig()
        rig.store.simulateClose()
        await open()
        expectBanner('unavailable', 'studioBannerUnavailable')
    })

    test('unavailable at the deadline when the open never answers, and the panel is usable then', async () => {
        const rig = makeRig()
        rig.store.hooks.open = () => new Promise<void>(() => {})
        await open()
        expect(part('studio-history-loading')).not.toBeNull()
        await rig.clock.advance(READY_DEADLINE_MS - 1)
        flushSync()
        expect(part('studio-history-loading')).not.toBeNull()
        await rig.clock.advance(1)
        flushSync()
        expect(part('studio-history-loading')).toBeNull()
        expectBanner('unavailable', 'studioBannerUnavailable')
    })

    test('unwritable: a save could not be written, and a later good save clears the banner', async () => {
        const rig = makeRig()
        rig.store.forcedSave = { kind: 'unwritable' }
        await open()
        expect(bannerOf()).toBeNull()
        edit(rig, 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expectBanner('unwritable', 'studioBannerUnwritable')
        rig.store.forcedSave = null
        edit(rig, 'typed more')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expect(bannerOf()).toBeNull()
    })

    test('unreadable: stored bytes could not be read and were set aside by the first save', async () => {
        // Hand-written: stands for a header written by a later producer.
        const shared = new Map<string, string>([[headerKey(A), '{"v":2}']])
        const rig = makeRig({ shared })
        await open()
        edit(rig, 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expectBanner('unreadable', 'studioBannerUnreadable')
        expect(shared.get(asideMarkKey(A))).toBe('{"v":2}')
    })

    test('keptUnreadable: unreadable bytes already have a copy aside, so history stays in memory', async () => {
        const shared = new Map<string, string>([
            [headerKey(A), '{"v":2}'],
            [asideMarkKey(A), 'an earlier copy'],
        ])
        const before = new Map(shared)
        const rig = makeRig({ shared })
        await open()
        expectBanner('keptUnreadable', 'studioBannerKeptUnreadable')
        edit(rig, 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expect(shared).toEqual(before)
    })

    test('a healthy owner shows no banner and no loading note', async () => {
        makeRig()
        await open()
        expect(bannerOf()).toBeNull()
        expect(part('studio-history-loading')).toBeNull()
    })

    test('the device-only note is always shown with the history, and not before the owner has a view', async () => {
        makeRig()
        await open()
        expect(part('studio-history-device-note')?.textContent).toBe('studioHistoryDeviceNote')
    })
})

describe('T-S6b the trimmed note, and the page keeps every step', () => {
    test('a save that trimmed the stored copy shows the note while all 40 steps stay listed and undoable', async () => {
        const CAP = 10000
        const rig = makeRig({ capBytes: CAP })
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        for (let i = 0; i < 40; i++) {
            edit(rig, `step ${i} ${'x'.repeat(300)}`)
        }
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expect(part('studio-history-banner')?.getAttribute('data-banner')).toBe('trimmed')
        expect(part('studio-history-banner')?.textContent).toBe('studioBannerTrimmed')
        // The stored copy fits the cap; the page's own history was not cut.
        const stored = storedRecord(rig.store.shared, A)
        expect(stored?.header.size ?? Infinity).toBeLessThanOrEqual(ownerCapFor(CAP))
        expect(stored?.record.done.length ?? 0).toBeGreaterThan(0)
        expect(stored?.record.done.length ?? 40).toBeLessThan(40)
        expect(parts('studio-history-step')).toHaveLength(40)
        for (let i = 0; i < 40; i++) {
            expect(rig.service.undo(A).ok).toBe(true)
        }
        expect(live().desc).toBe('d0')
    })
})

// ---------------------------------------------------------------- private and groups

describe('T-C5b the panel renders nothing for a private owner, re-checked at every render', () => {
    test('a character that becomes private shows no steps, and every action is refused without a save or a mark', async () => {
        const rig = makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        edit(rig, 'one')
        expect(rig.service.editField(A, 'hideChatIcon', true).ok).toBe(true)
        rig.service.closeOpenStep(A)
        expect(rig.service.greetingAdd(A).ok).toBe(true)
        flushSync()
        expect(parts('studio-history-step')).toHaveLength(3)
        // No save is pending: the debounce and the max-wait have both run.
        await rig.clock.advance(SAVE_MAX_WAIT_MS)
        flushSync()
        const saves = rig.store.counts.save
        const marks = h.marks

        db.db = fixtureDb({ license: 'private' })
        flushSync()
        expect(part('studio-history')).toBeNull()
        expect(document.body.textContent).not.toContain('studioHistoryDeviceNote')
        expect(rig.service.undo(A)).toEqual({ ok: false, reason: 'restricted' })
        expect(rig.service.editField(A, 'desc', 'again')).toEqual({ ok: false, reason: 'restricted' })
        expect(rig.service.restoreDeleted(A, 'anything')).toEqual({ ok: false, reason: 'restricted' })
        await rig.clock.advance(SAVE_MAX_WAIT_MS)
        expect(rig.store.counts.save).toBe(saves)
        expect(h.marks).toBe(marks)
        expect(rig.service.view(A).done).toEqual([])
    })

    test('a private character shows nothing at all, from the first render', async () => {
        db.db = fixtureDb({ license: 'private' })
        makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history')).toBeNull()
    })

    test('the panel checks the licence itself, whatever the view it is handed says', async () => {
        // A service whose view still reports a usable owner with a step: only the panel's own check can hide it.
        const stale = {
            useOwner: () => {},
            setAck: () => {},
            closeOpenStep: () => {},
            view: (owner: string) => ({
                ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
                done: [{ id: 's1', at: 0, label: { kind: 'field', field: 'desc' }, ops: [] }], undone: [], deleted: [], restore: null,
            }),
        } as unknown as OwnerHistoryService
        setStudioHistoryServiceForTests(stale)
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(parts('studio-history-step')).toHaveLength(1)
        db.db = fixtureDb({ license: 'private' })
        flushSync()
        expect(part('studio-history')).toBeNull()
    })

    test('a group shows nothing', async () => {
        db.db = fixtureDb({ type: 'group' })
        makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history')).toBeNull()
    })
})

// ---------------------------------------------------------------- what the panel is about

describe('the panel follows the selection', () => {
    test('a selection that has no history says so and starts nothing', async () => {
        const rig = makeRig()
        openPanelState()
        setStudioSelection('module:res', null, null)
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-none')?.textContent).toBe('studioHistoryNone')
        expect(part('studio-history-steps')).toBeNull()
        expect(rig.claim.calls).toEqual([])
    })

    test('a chat without a unique id has no history', async () => {
        db.db = fixtureDb({ chats: [{ ...makeChat({ id: 'c1', name: 'one' }), note: '' }, { ...makeChat({ id: 'c1', name: 'two' }), note: '' }] })
        const rig = makeRig()
        openPanelState()
        setStudioSelection('chat:c1', null, null)
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-none')).not.toBeNull()
        expect(rig.claim.calls).toEqual([])
    })

    test('the chat owner has its own history, apart from the character', async () => {
        const rig = makeRig()
        openPanelState()
        setStudioSelection('chat:c1', null, null)
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-empty')).not.toBeNull()
        expect(rig.service.editField(CHAT, 'note', 'a note').ok).toBe(true)
        flushSync()
        expect(parts('studio-history-step')).toHaveLength(1)
        expect(stepsText()[0]).toBe('note')
        setStudioSelection(A, null, null)
        flushSync()
        expect(part('studio-history-empty')).not.toBeNull()
    })
})

// ---------------------------------------------------------------- steps, undo, redo, revert

describe('steps, undo, redo and revert', () => {
    async function openWithSteps(): Promise<Rig> {
        const rig = makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        edit(rig, 'a')
        edit(rig, 'b')
        edit(rig, 'c')
        flushSync()
        return rig
    }

    test('steps are listed newest first, and an empty history says so', async () => {
        const rig = makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-empty')).not.toBeNull()
        rig.service.editField(A, 'desc', 'a')
        rig.service.closeOpenStep(A)
        rig.service.editField(A, 'hideChatIcon', true)
        rig.service.closeOpenStep(A)
        rig.service.greetingAdd(A)
        flushSync()
        expect(part('studio-history-empty')).toBeNull()
        expect(stepsText()).toEqual(['studioStepGreetingAdd', 'hideChatIcon', 'description'])
    })

    test('Undo and Redo replay the top step, and an undone step is marked', async () => {
        await openWithSteps()
        click('studio-history-undo')
        expect(live().desc).toBe('b')
        const undone = parts('studio-history-step').filter((row) => row.dataset.undone === 'true')
        expect(undone).toHaveLength(1)
        expect(undone[0].querySelector('[data-part="studio-history-undone"]')?.textContent).toBe('studioHistoryUndone')
        click('studio-history-redo')
        expect(live().desc).toBe('c')
        expect(parts('studio-history-step').filter((row) => row.dataset.undone === 'true')).toHaveLength(0)
    })

    test('the buttons are disabled when there is nothing to replay', async () => {
        const rig = makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect((part('studio-history-undo') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-history-redo') as HTMLButtonElement).disabled).toBe(true)
        edit(rig, 'a')
        flushSync()
        expect((part('studio-history-undo') as HTMLButtonElement).disabled).toBe(false)
        expect((part('studio-history-redo') as HTMLButtonElement).disabled).toBe(true)
    })

    test('Revert to here undoes every step above that one, and the newest step has no such button', async () => {
        const rig = await openWithSteps()
        const done = rig.service.view(A).done
        expect(parts('studio-history-revert')).toHaveLength(2)
        const first = parts('studio-history-step').find((row) => row.dataset.stepId === done[0].id)!
        first.querySelector<HTMLElement>('[data-part="studio-history-revert"]')!.click()
        flushSync()
        expect(live().desc).toBe('a')
        // The revert is one new step on top.
        expect(rig.service.view(A).done.at(-1)?.label.kind).toBe('revert')
    })

    test('a refused action shows the refusal text and changes nothing', async () => {
        await openWithSteps()
        live().desc = 'changed outside Studio'
        flushSync()
        click('studio-history-undo')
        expect(part('studio-history-message')?.textContent).toBe('studioRefusalPrecondition')
        expect(live().desc).toBe('changed outside Studio')
    })

    test('while the owner loads nothing can be pressed', async () => {
        const rig = makeRig()
        rig.store.hooks.open = () => new Promise<void>(() => {})
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-loading')).not.toBeNull()
        expect((part('studio-history-undo') as HTMLButtonElement).disabled).toBe(true)
    })
})

// ---------------------------------------------------------------- deleted items and the restore point

describe('T-D2 / T-RP2 the panel after a reload', () => {
    // The first page produces the stored record; the second page loads it as a reload would.
    async function reloadOver(shared: Map<string, string>): Promise<Rig> {
        await unmountAll()
        resetStudioHistoryAccessorForTests()
        resetStudioScreenForTests()
        setStudioEnabled(true)
        const rig = makeRig({ shared })
        openPanelState()
        studioScreen.visitId = 'v2'
        mountInto(StudioHistoryPanel)
        await settle()
        return rig
    }

    test('a deleted first message is listed after a reload and can be restored there', async () => {
        const shared = new Map<string, string>()
        const first = makeRig({ shared })
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(first.service.greetingDelete(A, 1).ok).toBe(true)
        await first.clock.advance(SAVE_DEBOUNCE_MS)
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])

        const second = await reloadOver(shared)
        expect(second.store.counts.load).toBe(1)
        const rows = parts('studio-history-deleted-item')
        expect(rows).toHaveLength(1)
        expect(rows[0].textContent).toContain('g1')
        click('studio-history-restore-item')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(parts('studio-history-deleted-item')).toHaveLength(0)
        expect(part('studio-history-deleted-empty')).not.toBeNull()
    })

    test('the restore point of the earlier visit is offered after a reload until the new visit edits', async () => {
        const shared = new Map<string, string>()
        const first = makeRig({ shared })
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        edit(first, 'first visit')
        await first.clock.advance(SAVE_DEBOUNCE_MS)

        const second = await reloadOver(shared)
        expect(part('studio-history-restore-open')).not.toBeNull()
        expect(second.service.view(A).restore?.visitId).toBe('v1')
        edit(second, 'second visit')
        flushSync()
        expect(second.service.view(A).restore?.visitId).toBe('v2')
        expect(part('studio-history-restore-open')).not.toBeNull()
    })

    test('without a restore point there is no restore entry', async () => {
        makeRig()
        openPanelState()
        mountInto(StudioHistoryPanel)
        await settle()
        expect(part('studio-history-restore-open')).toBeNull()
    })
})

// ---------------------------------------------------------------- the toast of a delete

describe('an Undo toast ends when its delete is undone another way (M56)', () => {
    async function deleteWithToast(): Promise<{ rig: Rig; host: ToastHost; deletedId: string }> {
        const rig = makeRig()
        const host = makeToastHost()
        openPanelState()
        mountInto(StudioHistoryPanel, { host })
        await settle()
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        const op = rig.service.view(A).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        if (op?.op !== 'listRemove' || op.deletedId === null) throw new Error('the delete left no deleted item')
        createStudioToasts({ service: () => rig.service, host }).postDeleted(A, op.deletedId)
        flushSync()
        expect(host.visible.map((toast) => toast.kind)).toEqual(['undo'])
        return { rig, host, deletedId: op.deletedId }
    }

    test('restoring the item from History ends its toast', async () => {
        const { host } = await deleteWithToast()
        // Still offered at the end of its window: it ends because the item was restored, not because it ran out.
        toastClock.advance(DEFAULT_TOAST_CONFIG.undoMs - 1)
        expect(host.visible).toHaveLength(1)
        click('studio-history-restore-item')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible).toHaveLength(0)
    })

    test('undoing the delete step from History ends its toast', async () => {
        const { host } = await deleteWithToast()
        click('studio-history-undo')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible).toHaveLength(0)
    })

    test('a refused Undo of the step leaves the toast and the deleted item', async () => {
        const { host, rig } = await deleteWithToast()
        // Both ops of the step fail their precondition: the list is shorter than the old position, and the
        // chat's first-message index is no longer the one the delete left.
        live().alternateGreetings.length = 0
        live().chats[0].fmIndex = 5
        flushSync()
        click('studio-history-undo')
        expect(part('studio-history-message')?.textContent).toBe('studioRefusalPrecondition')
        expect(host.visible).toHaveLength(1)
        expect(rig.service.view(A).deleted).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- the keyboard (Ctrl+Z)

describe('T-UI3 Ctrl+Z and the Studio screen', () => {
    function screenWith(host?: ToastHost): void {
        openStudio(basicTarget, null)
        mountInto(StudioScreen, host ? { toastHost: host } : {})
    }

    function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        flushSync()
        return event
    }

    const root = () => part('studio')!

    async function openForm(): Promise<Rig> {
        const rig = makeRig()
        screenWith()
        await settle()
        expect(part('studio-character-form')).not.toBeNull()
        return rig
    }

    test('outside a text field Ctrl+Z undoes the owner, and Ctrl+Shift+Z and Ctrl+Y redo it', async () => {
        await openForm()
        type(desc(), 'typed')
        desc().blur()
        flushSync()
        expect(live().desc).toBe('typed')
        const undo = key(root(), { key: 'z', ctrlKey: true })
        expect(undo.defaultPrevented).toBe(true)
        expect(live().desc).toBe('d0')
        expect(key(root(), { key: 'z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
        expect(live().desc).toBe('typed')
        key(root(), { key: 'z', ctrlKey: true })
        expect(live().desc).toBe('d0')
        expect(key(root(), { key: 'y', ctrlKey: true }).defaultPrevented).toBe(true)
        expect(live().desc).toBe('typed')
    })

    test('Cmd+Z is the same key as Ctrl+Z', async () => {
        await openForm()
        type(desc(), 'typed')
        desc().blur()
        key(root(), { key: 'z', metaKey: true })
        expect(live().desc).toBe('d0')
    })

    test('in a field that changed since it was focused the key belongs to the browser (M35)', async () => {
        await openForm()
        desc().focus()
        type(desc(), 'typed')
        const event = key(desc(), { key: 'z', ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(live().desc).toBe('typed')
    })

    test('in a field that is back at its focus value the owner history takes over, and keeps going', async () => {
        const rig = await openForm()
        edit(rig, 'e1')
        edit(rig, 'e2')
        flushSync()
        desc().focus()
        expect(desc().dataset.studioFocusValue).toBe('e2')
        expect(key(desc(), { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
        expect(live().desc).toBe('e1')
        expect(desc().value).toBe('e1')
        await settle()
        // The next Ctrl+Z in the same field continues through the history.
        expect(key(desc(), { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
        expect(live().desc).toBe('d0')
        await settle()
        // Nothing left to undo: the key goes back to the browser.
        expect(key(desc(), { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false)
    })

    test('a key typed in the search field is the browser\'s', async () => {
        const rig = await openForm()
        edit(rig, 'e1')
        click('studio-search-toggle')
        const field = part('studio-search-input') as HTMLInputElement
        const event = key(field, { key: 'z', ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(live().desc).toBe('e1')
    })

    test('a key that belongs to an IME composition is ignored', async () => {
        await openForm()
        type(desc(), 'typed')
        desc().blur()
        expect(key(root(), { key: 'z', ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false)
        expect(live().desc).toBe('typed')
    })

    test('with nothing selected that has a history the key is left alone', async () => {
        await openForm()
        type(desc(), 'typed')
        desc().blur()
        setStudioSelection('module:res', null, null)
        flushSync()
        expect(key(root(), { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false)
        expect(live().desc).toBe('typed')
    })

    test('a refused replay says why in the notice line', async () => {
        await openForm()
        type(desc(), 'typed')
        desc().blur()
        live().desc = 'changed outside Studio'
        flushSync()
        key(root(), { key: 'z', ctrlKey: true })
        expect(studioScreen.notice).toBe('studioRefusalPrecondition')
    })

    test('Ctrl+Z on the delete step ends its Undo toast (M56)', async () => {
        const host = makeToastHost()
        const rig = makeRig()
        screenWith(host)
        await settle()
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        const op = rig.service.view(A).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        if (op?.op !== 'listRemove' || op.deletedId === null) throw new Error('the delete left no deleted item')
        createStudioToasts({ service: () => rig.service, host }).postDeleted(A, op.deletedId)
        flushSync()
        expect(host.visible).toHaveLength(1)
        key(root(), { key: 'z', ctrlKey: true })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible).toHaveLength(0)
    })
})

// ---------------------------------------------------------------- the header entry point

describe('the History entry point of the header', () => {
    test('it opens and closes the panel, and is disabled while the selection has no history', async () => {
        makeRig()
        openStudio(basicTarget, null)
        mountInto(StudioScreen)
        await settle()
        const toggle = part('studio-history-toggle') as HTMLButtonElement
        expect(toggle.disabled).toBe(false)
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(part('studio-history')).toBeNull()
        click('studio-history-toggle')
        expect(part('studio-history')).not.toBeNull()
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        click('studio-history-toggle')
        expect(part('studio-history')).toBeNull()
        setStudioSelection('module:res', null, null)
        flushSync()
        expect(toggle.disabled).toBe(true)
    })

    test('the close button of the panel closes it', async () => {
        makeRig()
        openStudio(basicTarget, null)
        mountInto(StudioScreen)
        await settle()
        click('studio-history-toggle')
        click('studio-history-close')
        expect(studioScreen.historyOpen).toBe(false)
        expect(part('studio-history')).toBeNull()
    })

    test('Back closes the panel and then leaves Studio', async () => {
        makeRig()
        openStudio(basicTarget, null)
        mountInto(StudioScreen)
        await settle()
        click('studio-history-toggle')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.open).toBe(true)
    })
})
