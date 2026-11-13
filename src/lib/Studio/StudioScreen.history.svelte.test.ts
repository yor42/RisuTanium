// @vitest-environment jsdom
/**
 * What the Studio screen and the History panel say when a replay moves or drops a step without writing: the real
 * screen, panel and history service on the memory doubles. Exactly one message is shown for one action, and the
 * refusal text never joins a note. "Settle" awaits resolved promises on one fake clock.
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

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { emptyRecord, type OwnerRecord, type Step } from '../../ts/studio/history/historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord } from '../../ts/studio/history/tests/studioStoreDoubles'
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

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat: LiveChat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2'], chats: [chat] }
    return { ...base, characters: [character] }
}

const A = characterOwnerKey('A')
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
    shared: Map<string, string>
    service: OwnerHistoryService
}

let rigCount = 0

function makeRig(shared: Map<string, string> = new Map()): Rig {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({ store, claim, clock, pageSession: `p${++rigCount}`, registerLeaveFlush: () => () => {} })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, shared, service }
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0]): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props: {} })
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

function live(): Live {
    return db.db.characters[0] as unknown as Live
}

// The Studio screen over the selected character, with the History panel open when asked.
async function mountScreen(options: { panel: boolean }): Promise<void> {
    openStudio(basicTarget, null)
    mountInto(StudioScreen)
    await settle()
    if (options.panel) {
        part('studio-history-toggle')?.click()
        await settle()
    }
}

// A press as a pointer makes it: the control takes focus, then the click runs.
async function press(name: string): Promise<void> {
    const button = part(name) as HTMLButtonElement
    button.focus()
    button.click()
    flushSync()
    await settle()
    await settle()
}

async function ctrl(init: KeyboardEventInit): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init })
    part('studio')!.dispatchEvent(event)
    flushSync()
    await settle()
    return event
}

// Edits that stay separate steps: each one closes the open step.
function edit(rig: Rig, text: string): void {
    expect(rig.service.editField(A, 'desc', text).ok).toBe(true)
    rig.service.closeOpenStep(A)
    flushSync()
}

// Everything the user can read about the last action: the notice line and the panel's message line.
function shownMessages(): { notice: string | null; panel: string | null } {
    return { notice: studioScreen.notice, panel: part('studio-history-message')?.textContent ?? null }
}

const stepsUndone = () => parts('studio-history-step').filter((row) => row.dataset.undone === 'true')

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

// ---------------------------------------------------------------- a field already at the replayed value

describe('a replay that finds the field already at the replayed value says so once', () => {
    test('Ctrl+Z moves the step to the redo side, writes nothing and shows the already-undone note alone', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        edit(rig, 'typed')
        live().desc = 'd0'
        flushSync()
        const marks = h.marks
        expect((await ctrl({ key: 'z' })).defaultPrevented).toBe(true)
        expect(shownMessages()).toEqual({ notice: 'studioHistoryAlreadyUndone', panel: null })
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(rig.service.view(A).undone).toHaveLength(1)
        expect(live().desc).toBe('d0')
        expect(h.marks).toBe(marks)
        expect(document.body.textContent).not.toContain('studioRefusalPrecondition')
    })

    test('the panel Undo shows the already-undone note alone and lists the step as undone', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        edit(rig, 'typed')
        live().desc = 'd0'
        flushSync()
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioHistoryAlreadyUndone' })
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(stepsUndone()).toHaveLength(1)
        expect(live().desc).toBe('d0')
    })

    test('Ctrl+Y and Ctrl+Shift+Z on a field already redone show the already-redone note alone', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        for (const redo of [{ key: 'y' }, { key: 'z', shiftKey: true }]) {
            edit(rig, `typed ${redo.key}`)
            expect(rig.service.undo(A).ok).toBe(true)
            live().desc = `typed ${redo.key}`
            flushSync()
            studioScreen.notice = null
            expect((await ctrl(redo)).defaultPrevented).toBe(true)
            expect(shownMessages()).toEqual({ notice: 'studioHistoryAlreadyRedone', panel: null })
            expect(rig.service.view(A).undone).toHaveLength(0)
            expect(rig.service.view(A).done.at(-1)?.ops).toMatchObject([{ op: 'set', path: 'desc', after: { had: true, value: `typed ${redo.key}` } }])
        }
    })

    test('the panel Redo shows the already-redone note alone', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        edit(rig, 'typed')
        expect(rig.service.undo(A).ok).toBe(true)
        live().desc = 'typed'
        flushSync()
        await press('studio-history-redo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioHistoryAlreadyRedone' })
        expect(rig.service.view(A).done).toHaveLength(1)
        expect(stepsUndone()).toHaveLength(0)
    })

    test('an Undo that applies shows no message, and a refused one shows the refusal alone', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        edit(rig, 'typed')
        await press('studio-history-undo')
        expect(live().desc).toBe('d0')
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        await ctrl({ key: 'y' })
        expect(live().desc).toBe('typed')
        await ctrl({ key: 'z' })
        expect(live().desc).toBe('d0')
        expect(shownMessages()).toEqual({ notice: null, panel: null })

        edit(rig, 'again')
        live().desc = 'changed outside Studio'
        flushSync()
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioRefusalPrecondition' })
        await ctrl({ key: 'z' })
        expect(shownMessages()).toEqual({ notice: 'studioRefusalPrecondition', panel: 'studioRefusalPrecondition' })
        expect(rig.service.view(A).done).toHaveLength(1)
    })

    test('a refused revert shows the refusal text alone, and the steps stay', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        edit(rig, 'a')
        edit(rig, 'b')
        edit(rig, 'c')
        live().desc = 'changed outside Studio'
        flushSync()
        const first = rig.service.view(A).done[0].id
        parts('studio-history-step').find((row) => row.dataset.stepId === first)!.querySelector<HTMLElement>('[data-part="studio-history-revert"]')!.click()
        flushSync()
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioRefusalPrecondition' })
        expect(rig.service.view(A).done).toHaveLength(3)
        expect(live().desc).toBe('changed outside Studio')
    })
})

// ---------------------------------------------------------------- a step that can no longer be undone here

// The record as the producer before the list fingerprint wrote it: a first-message delete of the real
// producer, saved, then loaded again with the fingerprint left off the step. The list holds an equal first
// message in the slot the Undo would fill, so without the fingerprint the Undo cannot tell whether the delete
// is still in place.
async function legacyDeleteRig(): Promise<Rig> {
    live().alternateGreetings = ['g0', 'g1', 'g1']
    const first = makeRig()
    await mountScreen({ panel: true })
    expect(first.service.greetingDelete(A, 1).ok).toBe(true)
    await first.clock.advance(SAVE_DEBOUNCE_MS)
    await unmountAll()
    resetStudioScreenForTests()
    setStudioEnabled(true)
    const stored = storedRecord(first.shared, A)
    if (stored === null) throw new Error('the delete was not saved')
    const legacySteps: Step[] = stored.record.done.map((step) => ({ id: step.id, at: step.at, label: step.label, ops: step.ops }))
    const record: OwnerRecord = { ...stored.record, done: legacySteps, undone: [] }
    const shared = new Map<string, string>()
    seedOwner(shared, record, 'w:legacy')
    resetStudioHistoryAccessorForTests()
    return makeRig(shared)
}

describe('a step that can no longer be undone here is dropped with its note', () => {
    test('Ctrl+Z over an older first-message delete that cannot be checked drops it, writes nothing and shows the dropped note alone', async () => {
        const rig = await legacyDeleteRig()
        expect(live().alternateGreetings).toEqual(['g0', 'g1'])
        await mountScreen({ panel: false })
        // The chat's first-message index is back where the Undo would put it.
        live().chats[0].fmIndex = 2
        flushSync()
        const marks = h.marks
        expect(rig.service.view(A).done).toHaveLength(1)
        expect((await ctrl({ key: 'z' })).defaultPrevented).toBe(true)
        expect(shownMessages()).toEqual({ notice: 'studioHistoryStepDropped', panel: null })
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(rig.service.view(A).undone).toHaveLength(0)
        expect(live().alternateGreetings).toEqual(['g0', 'g1'])
        expect(h.marks).toBe(marks)
    })

    test('the panel Undo shows the dropped note alone and the step leaves the list', async () => {
        const rig = await legacyDeleteRig()
        await mountScreen({ panel: true })
        live().chats[0].fmIndex = 2
        flushSync()
        expect(parts('studio-history-step')).toHaveLength(1)
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioHistoryStepDropped' })
        expect(parts('studio-history-step')).toHaveLength(0)
        expect(rig.service.view(A).undone).toHaveLength(0)
        expect(live().alternateGreetings).toEqual(['g0', 'g1'])
    })
})

// ---------------------------------------------------------------- focus after an Undo of a text-merge step

// A step of the shape a text merge records: one text edit of the description. No producer writes it yet, so the
// record is built by hand and stored through the store's own writer.
function mergedDescRig(): Rig {
    const step: Step = {
        id: 'seed:1',
        at: 1,
        label: { kind: 'assetMerge', from: 'a', to: 'b' },
        ops: [{ op: 'textEdit', target: 'desc', offset: 2, from: '', to: ' plus' }],
    }
    const shared = new Map<string, string>()
    seedOwner(shared, { ...emptyRecord(A, 1), done: [step] }, 'w:seed')
    live().desc = 'd0 plus'
    return makeRig(shared)
}

describe('focus after an Undo of a text-merge step', () => {
    test('the panel Undo puts the description back and focuses it, and focus never goes to a root', async () => {
        const rig = mergedDescRig()
        await mountScreen({ panel: true })
        const studioRoot = vi.spyOn(part('studio')!, 'focus')
        const panelRoot = vi.spyOn(part('studio-history')!, 'focus')
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        expect(live().desc).toBe('d0')
        expect(rig.service.view(A).undone).toHaveLength(1)
        expect(document.activeElement).toBe(part('studio-form-desc'))
        expect(studioRoot).not.toHaveBeenCalled()
        expect(panelRoot).not.toHaveBeenCalled()
    })

    test('Ctrl+Z puts the description back and focuses it, and focus never goes to the Studio root', async () => {
        mergedDescRig()
        await mountScreen({ panel: false })
        part('studio')!.focus()
        const studioRoot = vi.spyOn(part('studio')!, 'focus')
        await ctrl({ key: 'z' })
        expect(live().desc).toBe('d0')
        expect(document.activeElement).toBe(part('studio-form-desc'))
        expect(studioRoot).not.toHaveBeenCalled()
    })
})
