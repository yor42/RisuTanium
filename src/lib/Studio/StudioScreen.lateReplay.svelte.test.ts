// @vitest-environment jsdom
/**
 * A keyboard replay that settles after the screen is gone, or after the visit changed, says nothing and moves no focus:
 * the notice would belong to a screen that no longer exists or to the next visit. A rejected replay is still shown to
 * the person. The real screen and history service on the memory doubles; the service's `replay` is a promise the test
 * settles itself.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

// What the page's error alert was asked to show.
const alerts = vi.hoisted(() => ({ errors: [] as (string | Error)[] }))

// The focus placement the screen asks for after a replay; it moves no focus in these tests.
const focus = vi.hoisted(() => ({ placed: vi.fn(async () => {}) }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertError: (message: string | Error) => { alerts.errors.push(message) } }))
vi.mock('src/ts/studio/historyFocus', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/studio/historyFocus')>()),
    placeFocusAfterHistory: focus.placed,
}))

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

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { closeStudio, openStudio, resetStudioScreenForTests, selectedHistoryOwner, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0' }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const basicTarget = { owner: { type: 'character', id: 'A' }, kind: 'basic', item: 'A/basic:0', from: 'chat' } as const

// ---------------------------------------------------------------- rig

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

// A replay the test settles itself: the service's own `view` and writes, with `replay` held until `resolve` or `reject`.
interface HeldReplay {
    service: OwnerHistoryService
    resolve(result: StudioResult): void
    reject(error: Error): void
}

function holdReplay(base: OwnerHistoryService): HeldReplay {
    let settle: { resolve(result: StudioResult): void; reject(error: Error): void } | null = null
    const service: OwnerHistoryService = {
        ...base,
        replay: (_owner, _desc, around) => {
            around?.(() => ({ ok: true }))
            return new Promise<StudioResult>((resolve, reject) => {
                settle = { resolve, reject }
            })
        },
    }
    const held = (): NonNullable<typeof settle> => {
        if (settle === null) {
            throw new Error('no replay is waiting')
        }
        return settle
    }
    return { service, resolve: (result) => held().resolve(result), reject: (error) => held().reject(error) }
}

// The service the screen runs on: a real one whose `replay` the test holds. `heldRig` is the replay of this test.
let heldRig: HeldReplay | null = null

function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const base = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    heldRig = holdReplay(base)
    setStudioHistoryServiceForTests(heldRig.service)
    setStudioVisitAckForTests(makeAck(clock))
    return base
}

function held(): HeldReplay {
    if (heldRig === null) {
        throw new Error('no rig')
    }
    return heldRig
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountScreen(): void {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(StudioScreen, { target: host, props: {} })
    mounted.push({ app, host })
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

// Studio open on the basic form of the selected character, with one step to undo.
async function openWithOneStep(): Promise<void> {
    const base = makeRig()
    openStudio(basicTarget, null)
    mountScreen()
    await settle()
    await base.whenReady(A)
    expect(base.editField(A, 'desc', 'typed').ok).toBe(true)
    base.closeOpenStep(A)
    flushSync()
}

// Ctrl+Z on the Studio root: the replay starts and stays pending until the test settles it.
async function pressUndo(): Promise<void> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z' })
    part('studio')!.dispatchEvent(event)
    flushSync()
    await settle()
    expect(event.defaultPrevented).toBe(true)
}

beforeEach(() => {
    h.marks = 0
    alerts.errors.length = 0
    focus.placed.mockClear()
    heldRig = null
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

// ---------------------------------------------------------------- late replays

describe('a keyboard replay that settles late', () => {
    test('while the screen is still the visit that asked, the refusal is shown and focus is placed', async () => {
        await openWithOneStep()
        await pressUndo()

        held().resolve({ ok: false, reason: 'precondition' })
        await settle()

        expect(studioScreen.notice).toBe('studioRefusalPrecondition')
        expect(focus.placed).toHaveBeenCalledTimes(1)
    })

    test('after the screen is unmounted, no notice is set and no focus is placed', async () => {
        await openWithOneStep()
        await pressUndo()
        await unmountAll()

        held().resolve({ ok: false, reason: 'precondition' })
        await settle()

        expect(studioScreen.notice).toBeNull()
        expect(focus.placed).not.toHaveBeenCalled()
    })

    test('after the visit changed on the same mounted screen, no notice is set and no focus is placed', async () => {
        await openWithOneStep()
        await pressUndo()

        // A second open while open starts a new visit and puts the same owner back on the screen.
        openStudio(basicTarget, null)
        flushSync()
        await settle()
        expect(selectedHistoryOwner()).toBe(A)

        held().resolve({ ok: true, dropped: true })
        await settle()

        expect(studioScreen.notice).toBeNull()
        expect(focus.placed).not.toHaveBeenCalled()
    })

    test('after the screen closed and a new screen opened the same owner, the new visit shows no notice', async () => {
        await openWithOneStep()
        await pressUndo()
        closeStudio()
        await unmountAll()
        openStudio(basicTarget, null)
        mountScreen()
        await settle()
        expect(selectedHistoryOwner()).toBe(A)

        held().resolve({ ok: true, dropped: true })
        await settle()

        expect(studioScreen.notice).toBeNull()
        expect(focus.placed).not.toHaveBeenCalled()
    })

    test('a replay that rejects after the screen is unmounted still shows the error once', async () => {
        await openWithOneStep()
        await pressUndo()
        await unmountAll()
        const failure = new Error('replay failed')

        held().reject(failure)
        await settle()

        expect(alerts.errors).toEqual([failure])
        expect(studioScreen.notice).toBeNull()
        expect(focus.placed).not.toHaveBeenCalled()
    })
})
