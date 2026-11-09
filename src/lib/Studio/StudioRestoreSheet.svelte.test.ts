// @vitest-environment jsdom
/**
 * The restore sheet inside the Studio screen, over a real history service on the memory doubles and a real toast
 * host on a fake clock. The sheet exists only while it is open: its toast suspension and its Back layer end with
 * it, by whichever close path.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get } from 'svelte/store'
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
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { clearStudioSelection, closeStudio, openStudio, resetStudioScreenForTests, selectStudioNode, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { DEFAULT_TOAST_CONFIG, createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

interface Live {
    desc: string
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
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const basicTarget = { owner: { type: 'character', id: 'A' }, kind: 'basic', item: 'A/basic:0', from: 'chat' } as const

// ---------------------------------------------------------------- rigs

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => 0,
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

function makeService(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
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

function mountScreen(host: ToastHost): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StudioScreen, { target, props: { toastHost: host } })
    mounted.push({ app, host: target })
    flushSync()
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

function click(name: string): void {
    part(name)?.click()
    flushSync()
}

function press(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

function live() {
    return db.db.characters[0]
}

interface Session {
    service: OwnerHistoryService
    host: ToastHost
}

// Studio open on the character's basic info, one edit made (so a restore point exists), the History panel open.
async function openHistory(): Promise<Session> {
    const service = makeService()
    const host = makeToastHost()
    openStudio(basicTarget, null)
    mountScreen(host)
    await settle()
    expect(service.editField(A, 'desc', 'edited').ok).toBe(true)
    service.closeOpenStep(A)
    expect(service.greetingAdd(A).ok).toBe(true)
    click('studio-history-toggle')
    await settle()
    expect(part('studio-history-restore-open')).not.toBeNull()
    return { service, host }
}

async function openSheet(): Promise<Session> {
    const session = await openHistory()
    expect(session.host.suspended).toBe(false)
    expect(part('studio-restore-sheet')).toBeNull()
    click('studio-history-restore-open')
    await settle()
    return session
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

// ---------------------------------------------------------------- T-UI7

describe('T-UI7 the sheet holds the toasts back for exactly as long as it is mounted', () => {
    test('opening it mounts the sheet and suspends the host; before that nothing is suspended', async () => {
        const { host } = await openHistory()
        expect(host.suspended).toBe(false)
        expect(part('studio-restore-sheet')).toBeNull()
        click('studio-history-restore-open')
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(host.suspended).toBe(true)
        // The panel under it stays mounted and is not what holds the toasts.
        expect(part('studio-history')).not.toBeNull()
    })

    test('a toast showing when the sheet opens is held for as long as the sheet is mounted, then runs out its time', async () => {
        const { host } = await openHistory()
        host.post({ text: 'earlier' })
        click('studio-history-restore-open')
        expect(host.suspended).toBe(true)
        toastClock.advance(DEFAULT_TOAST_CONFIG.infoMs * 4)
        expect(host.visible.map((toast) => toast.text)).toEqual(['earlier'])

        studioScreen.restoreSheetOpen = false
        flushSync()
        expect(host.suspended).toBe(false)
        toastClock.advance(DEFAULT_TOAST_CONFIG.infoMs - 1)
        expect(host.visible).toHaveLength(1)
        toastClock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    const closePaths: [string, () => void][] = [
        ['Cancel', () => click('studio-restore-cancel')],
        ['confirm', () => click('studio-restore-confirm')],
        ['Back', () => { dispatchBack(); flushSync() }],
        ['Escape on Cancel', () => { press(part('studio-restore-cancel')!, { key: 'Escape' }) }],
        ['closing the History panel', () => click('studio-history-close')],
        ['closing Studio', () => { closeStudio(); flushSync() }],
        ['selecting another owner', () => { selectStudioNode('chat:c1', null, null); flushSync() }],
        ['clearing the selection', () => { clearStudioSelection('gone'); flushSync() }],
    ]

    test.each(closePaths)('%s unmounts the sheet and releases the host', async (_name, close) => {
        const { host } = await openSheet()
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(host.suspended).toBe(true)
        close()
        expect(part('studio-restore-sheet')).toBeNull()
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(host.suspended).toBe(false)
    })

    test('the sheet can be opened and closed again, and suspends each time', async () => {
        const { host } = await openSheet()
        click('studio-restore-cancel')
        expect(host.suspended).toBe(false)
        click('studio-history-restore-open')
        expect(host.suspended).toBe(true)
        click('studio-restore-cancel')
        expect(host.suspended).toBe(false)
    })
})

// ---------------------------------------------------------------- T-UI9, T-UI10

describe('T-UI9 initial focus is Cancel, and nothing is made inert', () => {
    test('focus is on Cancel when the sheet opens', async () => {
        await openSheet()
        expect(document.activeElement).toBe(part('studio-restore-cancel'))
    })

    test('no element is inert and no focus trap holds Tab inside', async () => {
        await openSheet()
        expect(document.querySelector('[inert]')).toBeNull()
        const outside = part('studio-history-close')!
        outside.focus()
        expect(document.activeElement).toBe(outside)
    })

    test('after Cancel focus returns to the control that opened the sheet', async () => {
        await openSheet()
        click('studio-restore-cancel')
        await settle()
        expect(document.activeElement).toBe(part('studio-history-restore-open'))
    })
})

describe('T-UI10 the sheet is the innermost Back layer', () => {
    test('Back closes only the sheet; the panel and Studio stay; a second Back closes the panel', async () => {
        const { host } = await openSheet()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(part('studio-restore-sheet')).toBeNull()
        expect(part('studio-history')).not.toBeNull()
        expect(get(studioOpen)).toBe(true)
        expect(host.suspended).toBe(false)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.historyOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
    })

    test('Escape on Cancel closes only the sheet and never Studio', async () => {
        await openSheet()
        const event = press(part('studio-restore-cancel')!, { key: 'Escape' })
        expect(event.defaultPrevented).toBe(true)
        expect(part('studio-restore-sheet')).toBeNull()
        expect(part('studio-history')).not.toBeNull()
        expect(get(studioOpen)).toBe(true)
    })

    test('a sheet closed by the flag leaves no stale Back handler behind', async () => {
        await openSheet()
        click('studio-restore-cancel')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.historyOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
    })
})

// ---------------------------------------------------------------- what the sheet restores

describe('the sheet lists what it restores and lands one step', () => {
    test('it names the tracked fields and restores them on confirm, then closes', async () => {
        const { service } = await openSheet()
        expect(parts('studio-restore-field').map((row) => row.dataset.path)).toEqual(['desc', 'alternateGreetings'])
        expect(parts('studio-restore-keep')).toHaveLength(0)
        click('studio-restore-confirm')
        expect(live().desc).toBe('d0')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(service.view(A).done.at(-1)?.label.kind).toBe('restorePoint')
        expect(part('studio-restore-sheet')).toBeNull()
    })

    test('a field changed outside Studio is kept by default, and overwritten when the user unchecks it', async () => {
        await openSheet()
        live().desc = 'changed outside Studio'
        flushSync()
        const keep = part('studio-restore-keep') as HTMLInputElement
        expect(keep.dataset.path).toBe('desc')
        expect(keep.checked).toBe(true)
        click('studio-restore-confirm')
        expect(live().desc).toBe('changed outside Studio')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('unchecking the keep box restores the field too', async () => {
        await openSheet()
        live().desc = 'changed outside Studio'
        flushSync()
        const keep = part('studio-restore-keep') as HTMLInputElement
        keep.checked = false
        keep.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        click('studio-restore-confirm')
        expect(live().desc).toBe('d0')
    })

    test('a restore that cannot change anything is refused in the sheet, which stays open', async () => {
        const { host } = await openSheet()
        live().desc = 'd0'
        live().alternateGreetings = ['g0', 'g1', 'g2']
        flushSync()
        click('studio-restore-confirm')
        expect(part('studio-restore-refusal')?.textContent).toBe('studioRefusalPrecondition')
        expect(part('studio-restore-sheet')).not.toBeNull()
        expect(host.suspended).toBe(true)
    })

    test('with no restore point the confirm button is disabled', async () => {
        const service = makeService()
        const host = makeToastHost()
        openStudio(basicTarget, null)
        mountScreen(host)
        await settle()
        expect(service.view(A).restore).toBeNull()
        click('studio-history-toggle')
        studioScreen.restoreSheetOpen = true
        flushSync()
        expect((part('studio-restore-confirm') as HTMLButtonElement).disabled).toBe(true)
    })
})
