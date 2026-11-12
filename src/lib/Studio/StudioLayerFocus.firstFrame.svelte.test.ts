// @vitest-environment jsdom
/**
 * First-frame focus of the Studio layers: when a layer closes, focus has to be back on a live control before the
 * first animation frame after the action, or the page shows focus on the body for one frame. The History panel
 * closes through Back and through its X, and the restore sheet through Cancel. requestAnimationFrame is a manual
 * queue, so a wait that needs a frame or a timer has not finished when the first frame reads the focus.
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
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from 'src/ts/tests/firstFrame.test-helpers'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat: LiveChat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2'], chats: [chat] }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const basicTarget = { owner: { type: 'character', id: 'A' }, kind: 'basic', item: 'A/basic:0', from: 'chat' } as const

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

let rigCount = 0

function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountScreen(): void {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioScreen, { target: host }), host })
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

// Real time passes here, with the native frame callback: every wait the setup started has finished before the
// test installs its frame queue.
async function settleReal(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30))
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

function click(name: string): void {
    part(name)?.click()
    flushSync()
}

async function screenWithPanel(): Promise<OwnerHistoryService> {
    const service = makeRig()
    openStudio(basicTarget, null)
    mountScreen()
    await settleReal()
    click('studio-history-toggle')
    await settleReal()
    return service
}

// Runs the action with the frame queue installed and returns what focus was at the first frame after it.
async function focusAtFirstFrame(action: () => void): Promise<Element | null> {
    installFrameQueue()
    const atFrame = readAtFirstFrame(() => document.activeElement)
    action()
    flushSync()
    await drainMicrotasks()
    runFrame()
    return atFrame
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
    runFrame()
    uninstallFrameQueue()
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

describe('focus at the first frame after a Studio layer closes', () => {
    test('T1 Back from inside the History panel: the toggle holds focus at the first frame', async () => {
        await screenWithPanel()
        part('studio-history-close')!.focus()
        await settleReal()
        const active = await focusAtFirstFrame(() => { expect(dispatchBack()).toBe(true) })
        expect(studioScreen.historyOpen).toBe(false)
        expect(active).toBe(part('studio-history-toggle'))
    })

    test('T2 the History panel X: the toggle holds focus at the first frame', async () => {
        await screenWithPanel()
        const close = part('studio-history-close')!
        close.focus()
        await settleReal()
        const active = await focusAtFirstFrame(() => close.click())
        expect(studioScreen.historyOpen).toBe(false)
        expect(active).toBe(part('studio-history-toggle'))
    })

    test('T3 restore sheet Cancel: the Restore button holds focus at the first frame', async () => {
        const service = await screenWithPanel()
        expect(service.editField(A, 'desc', 'e1').ok).toBe(true)
        service.closeOpenStep(A)
        flushSync()
        const opener = part('studio-history-restore-open')!
        opener.focus()
        opener.click()
        flushSync()
        await settleReal()
        const cancel = part('studio-restore-cancel')!
        expect(document.activeElement).toBe(cancel)
        const active = await focusAtFirstFrame(() => cancel.click())
        expect(part('studio-restore-sheet')).toBeNull()
        expect(active).toBe(part('studio-history-restore-open'))
    })
})
