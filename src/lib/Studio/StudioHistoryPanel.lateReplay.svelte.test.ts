// @vitest-environment jsdom
/**
 * A History panel action that settles after the panel is closed puts nothing on screen and moves no focus: a closed
 * panel has no root, so the focus placement would fall back to the whole document and pull focus into a Studio field.
 * A rejected replay is still shown to the person. The real screen, panel and history service on the memory doubles; the
 * service's `replay` is a promise the test settles itself.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

// What the page's error alert was asked to show.
const alerts = vi.hoisted(() => ({ errors: [] as (string | Error)[] }))

// The focus placement the panel asks for after a replay: the real one, watched.
const focus = vi.hoisted(() => ({ placed: null as null | ReturnType<typeof vi.fn> }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertError: (message: string | Error) => { alerts.errors.push(message) } }))
vi.mock('src/ts/studio/historyFocus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/studio/historyFocus')>()
    focus.placed = vi.fn(actual.placeFocusAfterHistory)
    return { ...actual, placeFocusAfterHistory: focus.placed }
})

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
import { openStudio, resetStudioScreenForTests, setStudioHistoryOpen } from 'src/ts/studio/studioScreen.svelte'
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

// The panel's replay of this test: the service's own `view` and writes, with `replay` held until `resolve` or `reject`.
interface HeldReplay {
    resolve(result: StudioResult): void
    reject(error: Error): void
}

let heldRig: HeldReplay | null = null

function held(): HeldReplay {
    if (heldRig === null) {
        throw new Error('no rig')
    }
    return heldRig
}

function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const base = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
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
    const pending = (): NonNullable<typeof settle> => {
        if (settle === null) {
            throw new Error('no replay is waiting')
        }
        return settle
    }
    heldRig = { resolve: (result) => pending().resolve(result), reject: (error) => pending().reject(error) }
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return base
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

function placed(): ReturnType<typeof vi.fn> {
    if (focus.placed === null) {
        throw new Error('the focus placement was not mocked')
    }
    return focus.placed
}

// Studio open on the basic form with the History panel open and one step to undo.
async function openPanelWithOneStep(): Promise<void> {
    const base = makeRig()
    openStudio(basicTarget, null)
    mountScreen()
    await settle()
    await base.whenReady(A)
    expect(base.editField(A, 'desc', 'typed').ok).toBe(true)
    base.closeOpenStep(A)
    flushSync()
    part('studio-history-toggle')?.click()
    await settle()
}

// The panel's Undo, as a press: the replay starts and stays pending until the test settles it.
async function pressPanelUndo(): Promise<void> {
    const button = part('studio-history-undo') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.focus()
    button.click()
    flushSync()
    await settle()
}

beforeEach(() => {
    h.marks = 0
    alerts.errors.length = 0
    placed().mockClear()
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

describe('a History panel action that settles late', () => {
    test('after the panel is closed, focus is not pulled into the field the replay changed', async () => {
        await openPanelWithOneStep()
        await pressPanelUndo()
        const root = part('studio')!
        root.focus()
        setStudioHistoryOpen(false)
        flushSync()
        expect(part('studio-history')).toBeNull()
        placed().mockClear()

        db.db.characters[0].desc = 'changed by the replay'
        held().resolve({ ok: true })
        await settle()
        await settle()

        expect(placed()).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(root)
        expect(document.activeElement?.getAttribute('data-part')).not.toBe('studio-form-desc')
    })

    test('while the panel is open, its Undo outcome places focus on the changed field', async () => {
        await openPanelWithOneStep()
        await pressPanelUndo()

        db.db.characters[0].desc = 'changed by the replay'
        held().resolve({ ok: true })
        await settle()
        await settle()

        expect(placed()).toHaveBeenCalledTimes(1)
        expect(document.activeElement?.getAttribute('data-part')).toBe('studio-form-desc')
    })

    test('a replay that rejects after the panel is closed still shows the error once', async () => {
        await openPanelWithOneStep()
        await pressPanelUndo()
        setStudioHistoryOpen(false)
        flushSync()
        const failure = new Error('replay failed')

        held().reject(failure)
        await settle()

        expect(alerts.errors).toEqual([failure])
        expect(placed()).not.toHaveBeenCalled()
    })
})
