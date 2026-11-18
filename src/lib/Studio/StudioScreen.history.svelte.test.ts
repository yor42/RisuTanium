// @vitest-environment jsdom
/**
 * What the Studio screen and the History panel say when a replay moves or drops a step without writing: the real
 * screen, panel and history service on the memory doubles. Exactly one message is shown for one action, and the
 * refusal text never joins a note. "Settle" awaits resolved promises on one fake clock.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

// What the page's error alert was asked to show.
const alerts = vi.hoisted(() => ({ errors: [] as (string | Error)[] }))

// What the file reader of the history service answers, for the rigs that read files and for the service the accessor
// builds: a path is present unless listed; each question first waits for the next entry of `waits`.
const files = vi.hoisted(() => ({
    states: new Map<string, 'present' | 'gone' | 'unknown'>(),
    waits: [] as (Promise<void> | null)[],
    opened: 0,
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
// The service the accessor builds runs over these stand-ins for the device store and the claim.
vi.mock('src/ts/studio/history/studioStoreProxy', async () => {
    const doubles = await import('src/ts/studio/history/tests/studioStoreDoubles')
    return { createStudioStoreProxy: () => doubles.createMemoryStudioStore() }
})
vi.mock('src/ts/studio/history/studioClaimLocks', () => ({ createStudioClaimLocks: () => ({ tryClaim: async () => 'granted' }) }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => {
        files.opened += 1
        return {
            concurrency: 1,
            stateOf: async (path: string) => {
                const wait = files.waits.shift()
                if (wait) {
                    await wait
                }
                return files.states.get(path) ?? 'present'
            },
        }
    },
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
vi.mock('src/ts/alert', () => ({ alertError: (message: string | Error) => { alerts.errors.push(message) } }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    // The texts that name a row answer with the key and the names.
    const named: Record<string, unknown> = {
        studioAssetFileGone: (name: string) => `studioAssetFileGone(${name})`,
        studioAssetFileUnchecked: (name: string) => `studioAssetFileUnchecked(${name})`,
        studioStepAssetDeleteOne: (name: string) => `studioStepAssetDeleteOne(${name})`,
        studioStepAssetRename: (from: string, to: string) => `studioStepAssetRename(${from},${to})`,
        studioStepAssetMerge: (from: string, to: string) => `studioStepAssetMerge(${from},${to})`,
        studioStepAssetAdd: (n: number) => `studioStepAssetAdd(${n})`,
        studioAssetNotRestored: (j: number) => `studioAssetNotRestored(${j})`,
        studioAssetPlaceNumbered: (label: string, n: number) => `studioAssetPlaceNumbered(${label},${n})`,
        ltCardHandle: (n: number) => `ltCardHandle(${n})`,
        ltCardMenu: (n: number) => `ltCardMenu(${n})`,
        ltCardMoved: (n: number, total: number) => `ltCardMoved(${n},${total})`,
    }
    return { language: new Proxy(named, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import type { ChatSource } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { DEFAULT_SETTINGS } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { buildMergePreview } from 'src/ts/studio/assets/mergePreview'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { emptyRecord, type OwnerRecord, type Step } from '../../ts/studio/history/historyModel'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../../ts/studio/history/ownerPhase'
import { loadStudioHistoryService, resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioScreen from './StudioScreen.svelte'

interface LiveChat extends ChatSource {
    note: string
    fmIndex?: number
}

interface Live {
    desc: string
    firstMessage?: string
    exampleMessage?: string
    systemPrompt: string
    alternateGreetings: string[]
    chats: LiveChat[]
    additionalAssets: string[][]
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

// `reading` gives the service the file reader double above; without it nothing is checked.
function makeRig(shared: Map<string, string> = new Map(), reading = false): Rig {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        ...(reading ? { openAssetFileReader: async () => (await import('src/ts/studio/assets/assetFileState')).openAssetFileReader() } : {}),
    })
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
    alerts.errors.length = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = fixtureDb()
    selection.selId = 0
    files.states.clear()
    files.waits.length = 0
    files.opened = 0
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
        // A revert runs in the replay queue, so its outcome arrives a few microtasks later.
        await settle()
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioRefusalPrecondition' })
        expect(rig.service.view(A).done).toHaveLength(3)
        expect(live().desc).toBe('changed outside Studio')
    })
})

// ---------------------------------------------------------------- the list reason joins the outcome

describe('a skipped first-message list says why, after the outcome sentence', () => {
    test('Ctrl+Z over a first-message delete whose list was changed elsewhere is refused and names the list', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        expect(rig.service.greetingDelete(A, 2).ok).toBe(true)
        live().alternateGreetings.unshift('p')
        flushSync()
        await ctrl({ key: 'z' })
        expect(shownMessages()).toEqual({ notice: 'studioRefusalPrecondition studioHistoryListChangedElsewhere', panel: null })
        expect(rig.service.view(A).done).toHaveLength(1)
        expect(live().alternateGreetings).toEqual(['p', 'g0', 'g1'])
    })

    test('the panel Undo over the same list shows the refusal and the reason', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        expect(rig.service.greetingDelete(A, 2).ok).toBe(true)
        live().alternateGreetings.unshift('p')
        flushSync()
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioRefusalPrecondition studioHistoryListChangedElsewhere' })
    })

    test('Ctrl+Z after a lost delete write moves the step and adds the unfinished-save sentence', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        expect(rig.service.greetingDelete(A, 2).ok).toBe(true)
        live().alternateGreetings = ['g0', 'g1', 'g2']
        live().chats[0].fmIndex = 2
        flushSync()
        await ctrl({ key: 'z' })
        expect(shownMessages()).toEqual({ notice: 'studioHistoryAlreadyUndone studioHistoryListSaveUnfinished', panel: null })
        expect(rig.service.view(A).undone).toHaveLength(1)
    })

    test('the panel Undo after a lost delete write shows the note and the unfinished-save sentence', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        expect(rig.service.greetingDelete(A, 2).ok).toBe(true)
        live().alternateGreetings = ['g0', 'g1', 'g2']
        live().chats[0].fmIndex = 2
        flushSync()
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioHistoryAlreadyUndone studioHistoryListSaveUnfinished' })
    })

    test('a description refusal keeps the single sentence', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        edit(rig, 'typed')
        live().desc = 'changed outside Studio'
        flushSync()
        await ctrl({ key: 'z' })
        expect(shownMessages()).toEqual({ notice: 'studioRefusalPrecondition', panel: null })
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

// A step of the shape a text merge records: one name edit of a reference in the description. No producer writes it
// yet, so the record is built by hand and stored through the store's own writer.
function mergedDescRig(): Rig {
    const step: Step = {
        id: 'seed:1',
        at: 1,
        label: { kind: 'assetMerge', from: 'a', to: 'b' },
        ops: [{ op: 'textEdit', target: 'desc', offset: 9, from: 'd0', to: 'd0 plus' }],
    }
    const shared = new Map<string, string>()
    seedOwner(shared, { ...emptyRecord(A, 1), done: [step] }, 'w:seed')
    live().desc = '{{image::d0 plus}}'
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
        expect(live().desc).toBe('{{image::d0}}')
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
        expect(live().desc).toBe('{{image::d0}}')
        expect(document.activeElement).toBe(part('studio-form-desc'))
        expect(studioRoot).not.toHaveBeenCalled()
    })
})

describe('F1-HF2 focus after an Undo of a first-message edit', () => {
    test('Ctrl+Z puts the first message back and focuses its field, with no field holding a different value', async () => {
        live().firstMessage = 'f0'
        const rig = makeRig()
        await mountScreen({ panel: false })
        expect(rig.service.editText(A, 'firstMessage', 'f1', 'single').ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        // The field is blurred first: the shortcut defers to the browser while a focused field differs from its focus value.
        ;(document.activeElement as HTMLElement | null)?.blur()
        part('studio')!.focus()
        await ctrl({ key: 'z' })
        expect(live().firstMessage).toBe('f0')
        expect(document.activeElement).toBe(part('studio-form-first-message'))
    })
})

describe('X-13 focus after an Undo of an example-text edit', () => {
    const advancedTarget = { owner: { type: 'character', id: 'A' }, kind: 'advanced', item: 'A/advanced:0', from: 'chat' } as const
    const SEED = '<START>\nA\n<START>\nB'

    async function mountAdvanced(): Promise<Rig> {
        live().exampleMessage = SEED
        const rig = makeRig()
        openStudio(advancedTarget, null)
        mountInto(StudioScreen)
        await settle()
        return rig
    }

    // The field is blurred first: the shortcut defers to the browser while a focused field differs from its focus value.
    async function undoFromRoot(): Promise<void> {
        ;(document.activeElement as HTMLElement | null)?.blur()
        part('studio')!.focus()
        await ctrl({ key: 'z' })
    }

    const cards = () => parts('studio-example-input')

    test('the undo of a card edit puts the text back and focuses that card', async () => {
        const rig = await mountAdvanced()
        expect(rig.service.editText(A, 'exampleMessage', '<START>\nA\n<START>\nb', 'single').ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        await undoFromRoot()
        expect(live().exampleMessage).toBe(SEED)
        expect(document.activeElement).toBe(cards()[1])
    })

    test('the undo of an added card focuses the card before it', async () => {
        const rig = await mountAdvanced()
        expect(rig.service.editText(A, 'exampleMessage', `${SEED}\n<START>\n`, 'single').ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        expect(cards()).toHaveLength(3)
        await undoFromRoot()
        expect(live().exampleMessage).toBe(SEED)
        expect(document.activeElement).toBe(cards()[1])
    })

    test('with the text view shown, the undo focuses the text view', async () => {
        const rig = await mountAdvanced()
        ;(part('studio-example-view-text') as HTMLButtonElement).click()
        await settle()
        expect(rig.service.editText(A, 'exampleMessage', '<START>\nA\n<START>\nb', 'single').ok).toBe(true)
        rig.service.closeOpenStep(A)
        flushSync()
        await undoFromRoot()
        expect(live().exampleMessage).toBe(SEED)
        expect(document.activeElement).toBe(part('studio-example-text'))
    })
})

// ---------------------------------------------------------------- asset rows: the files are asked first

describe('Ctrl+Z over asset rows asks the files first', () => {
    const SMILE = ['smile', 'assets/smile.png', 'png']
    const GRIN = ['grin', 'assets/grin.png', 'png']
    const names = (): string[] => live().additionalAssets.map((row) => row[0])

    function giveAssets(): void {
        live().additionalAssets = [[...SMILE], [...GRIN]]
        flushSync()
    }

    function deleteGrin(service: OwnerHistoryService): void {
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        flushSync()
    }

    test('on the service the accessor builds, a gone file leaves the row out and the notice says the file is gone, not that the step dropped', async () => {
        setStudioVisitAckForTests(makeAck(createFakeClock()))
        giveAssets()
        await mountScreen({ panel: false })
        const service = await loadStudioHistoryService()
        await service.whenReady(A)
        deleteGrin(service)
        files.states.set('assets/grin.png', 'gone')
        expect((await ctrl({ key: 'z' })).defaultPrevented).toBe(true)
        expect(shownMessages()).toEqual({ notice: 'studioAssetFileGone(grin)', panel: null })
        expect(names()).toEqual(['smile'])
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a file that cannot be checked refuses with the line that names the row and changes nothing', async () => {
        const rig = makeRig(undefined, true)
        giveAssets()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        deleteGrin(rig.service)
        files.states.set('assets/grin.png', 'unknown')
        const marks = h.marks
        await ctrl({ key: 'z' })
        expect(shownMessages()).toEqual({ notice: 'studioAssetFileUnchecked(grin)', panel: null })
        expect(names()).toEqual(['smile'])
        expect(rig.service.view(A).done).toHaveLength(1)
        expect(h.marks).toBe(marks)
    })

    test('a present file puts the row back and a text step asks no file at all', async () => {
        const rig = makeRig(undefined, true)
        giveAssets()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        deleteGrin(rig.service)
        await ctrl({ key: 'z' })
        expect(names()).toEqual(['smile', 'grin'])
        expect(files.opened).toBe(1)
        edit(rig, 'typed')
        await ctrl({ key: 'z' })
        expect(live().desc).toBe('d0')
        expect(files.opened).toBe(1)
    })

    test('a step that lands while the files are asked is not undone, and the notice names the row', async () => {
        const rig = makeRig(undefined, true)
        giveAssets()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        deleteGrin(rig.service)
        let release!: () => void
        files.waits.push(new Promise<void>((done) => { release = done }))
        const pressed = ctrl({ key: 'z' })
        await drainMicrotasks()
        expect(rig.service.editField(A, 'desc', 'typed').ok).toBe(true)
        release()
        await pressed
        await settle()
        expect(shownMessages().notice).toBe('studioAssetFileUnchecked(grin)')
        expect(names()).toEqual(['smile'])
        expect(live().desc).toBe('typed')
    })

    test('a second Ctrl+Z queued behind the first finds nothing left and says nothing', async () => {
        const rig = makeRig(undefined, true)
        giveAssets()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        deleteGrin(rig.service)
        const press = (): KeyboardEvent => {
            const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z' })
            part('studio')!.dispatchEvent(event)
            return event
        }
        expect(press().defaultPrevented).toBe(true)
        expect(press().defaultPrevented).toBe(true)
        await settle()
        await settle()
        expect(names()).toEqual(['smile', 'grin'])
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(studioScreen.notice).toBeNull()
    })

    test('a replay that finishes after the selection moved leaves the new screen without a notice', async () => {
        const rig = makeRig(undefined, true)
        giveAssets()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        deleteGrin(rig.service)
        files.states.set('assets/grin.png', 'gone')
        let release!: () => void
        files.waits.push(new Promise<void>((done) => { release = done }))
        const pressed = ctrl({ key: 'z' })
        await drainMicrotasks()
        studioScreen.selectedOwnerKey = null
        flushSync()
        release()
        await pressed
        await settle()
        expect(studioScreen.notice).toBeNull()
        expect(names()).toEqual(['smile'])
    })
})

describe('the History panel over asset rows asks the files first', () => {
    const SMILE = ['smile', 'assets/smile.png', 'png']
    const GRIN = ['grin', 'assets/grin.png', 'png']
    const names = (): string[] => live().additionalAssets.map((row) => row[0])

    async function panelRig(): Promise<Rig> {
        const rig = makeRig(undefined, true)
        live().additionalAssets = [[...SMILE], [...GRIN]]
        flushSync()
        await mountScreen({ panel: true })
        await rig.service.whenReady(A)
        return rig
    }

    test('Undo with the file gone says so, leaves the row out and drops the step', async () => {
        const rig = await panelRig()
        expect(rig.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        flushSync()
        files.states.set('assets/grin.png', 'gone')
        await press('studio-history-undo')
        expect(shownMessages().panel).toContain('studioAssetFileGone(grin)')
        expect(names()).toEqual(['smile'])
        expect(rig.service.view(A).done).toHaveLength(0)
    })

    test('Redo of an insert whose file is gone says so and leaves the row out', async () => {
        const rig = await panelRig()
        expect(rig.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        expect(rig.service.undo(A).ok).toBe(true)
        flushSync()
        files.states.set('assets/fresh.png', 'gone')
        await press('studio-history-redo')
        expect(shownMessages().panel).toContain('studioAssetFileGone(fresh)')
        expect(names()).toEqual(['smile', 'grin'])
    })

    test('Revert across a delete of a gone file lands nothing and says so', async () => {
        const rig = await panelRig()
        expect(rig.service.assetRename(A, 'additionalAssets', 0, 'smile1').ok).toBe(true)
        expect(rig.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        flushSync()
        files.states.set('assets/grin.png', 'gone')
        await settle()
        await press('studio-history-revert')
        expect(shownMessages().panel).toContain('studioAssetFileGone(grin)')
        expect(names()).toEqual(['smile1'])
        expect(rig.service.view(A).done).toHaveLength(2)
    })

    test('a file that cannot be checked refuses with the line that names the row and changes nothing', async () => {
        const rig = await panelRig()
        expect(rig.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        flushSync()
        files.states.set('assets/grin.png', 'unknown')
        await press('studio-history-undo')
        expect(shownMessages().panel).toBe('studioAssetFileUnchecked(grin)')
        expect(names()).toEqual(['smile'])
        expect(rig.service.view(A).done).toHaveLength(1)
    })

    test('a step that lands while the files are asked is refused with the same line and nothing is undone', async () => {
        const rig = await panelRig()
        expect(rig.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        flushSync()
        let release!: () => void
        files.waits.push(new Promise<void>((done) => { release = done }))
        const pressed = press('studio-history-undo')
        await drainMicrotasks()
        expect(rig.service.editField(A, 'desc', 'typed').ok).toBe(true)
        release()
        await pressed
        expect(shownMessages().panel).toBe('studioAssetFileUnchecked(grin)')
        expect(names()).toEqual(['smile'])
        expect(live().desc).toBe('typed')
    })
})

// ---------------------------------------------------------------- a replay that rejects

describe('a replay that rejects reaches the error alert', () => {
    async function rejectingRig(): Promise<Rig> {
        const rig = makeRig()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        edit(rig, 'typed')
        return rig
    }

    test('Ctrl+Z shows the error once and no notice', async () => {
        const rig = await rejectingRig()
        const failure = new Error('replay failed')
        vi.spyOn(rig.service, 'replay').mockRejectedValue(failure)
        expect((await ctrl({ key: 'z' })).defaultPrevented).toBe(true)
        expect(alerts.errors).toEqual([failure])
        expect(studioScreen.notice).toBeNull()
    })

    test('a value that is not an Error is shown as its text', async () => {
        const rig = await rejectingRig()
        vi.spyOn(rig.service, 'replay').mockRejectedValue('plain refusal')
        await ctrl({ key: 'z' })
        expect(alerts.errors).toEqual(['plain refusal'])
    })

    test('Ctrl+Z shows the error even when the selected owner changed before the rejection', async () => {
        const rig = await rejectingRig()
        const failure = new Error('late failure')
        let fail!: (error: Error) => void
        vi.spyOn(rig.service, 'replay').mockImplementation(() => new Promise<StudioResult>((_resolve, reject) => { fail = reject }))
        const pressed = ctrl({ key: 'z' })
        await drainMicrotasks()
        studioScreen.selectedOwnerKey = null
        flushSync()
        fail(failure)
        await pressed
        await settle()
        expect(alerts.errors).toEqual([failure])
    })

})

// ---------------------------------------------------------------- a merge undo that leaves places as they were (MC-2105)

describe('an Undo of a merge that leaves places as they were says how many, and Show lists them', () => {
    const SMILE: [string, string, string] = ['smile', 'assets/a.png', 'png']
    const GRIN: [string, string, string] = ['grin', 'assets/a.png', 'png']

    // The merge of `grin` into `smile` over the live character the screen shows, as the preview builds it.
    function mergeGrin(service: OwnerHistoryService, editOutside = true, withTexts = true): void {
        // Two texts name `grin`: the undo leaves the description (edited outside) and restores the system prompt, so it is a
        // partial one, and a gone file for the row can be told from it.
        // Without texts the merge holds rows only.
        const promptText = withTexts ? 'sp {{image::grin}}' : 'sp'
        Object.assign(live(), { additionalAssets: [[...SMILE], [...GRIN]], desc: withTexts ? 'a {{image::grin}} b' : 'a b', systemPrompt: promptText })
        flushSync()
        const rows = live().additionalAssets
        const group = groupDuplicates(rows.map((row, index) => ({ name: row[0], path: row[1], index, folder: null }))).find((candidate) => candidate.cls === 'sameFileDifferentNames')
        if (!group) throw new Error('no candidate group')
        const model = buildMergePreview({ kind: 'character', source: { desc: live().desc, systemPrompt: promptText, additionalAssets: [[...SMILE], [...GRIN]] } }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
        expect(service.assetMerge(A, model, { hashOf: () => undefined }).ok).toBe(true)
        flushSync()
        // An outside edit of the description: the undo puts the row back and leaves the description.
        if (editOutside) {
            live().desc = 'changed outside'
            flushSync()
        }
    }

    const names = (): string[] => live().additionalAssets.map((row) => row[0])

    test('Ctrl+Z restores the row, shows "1 places not restored" alone, and Show lists the description', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        mergeGrin(rig.service)
        await ctrl({ key: 'z' })
        expect(names()).toEqual(['smile', 'grin'])
        expect(live().desc).toBe('changed outside')
        expect(shownMessages()).toEqual({ notice: 'studioAssetNotRestored(1)', panel: null })
        expect(part('studio-notice-text')!.textContent).toBe('studioAssetNotRestored(1)')
        expect(parts('studio-notice-place')).toHaveLength(0)
        part('studio-notice-show')!.click()
        flushSync()
        expect(parts('studio-notice-place').map((entry) => entry.textContent)).toEqual(['description'])
    })

    test('the History panel\'s Undo shows the same notice, and its panel message stays empty', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        await rig.service.whenReady(A)
        mergeGrin(rig.service)
        await press('studio-history-undo')
        expect(names()).toEqual(['smile', 'grin'])
        expect(shownMessages()).toEqual({ notice: 'studioAssetNotRestored(1)', panel: null })
        expect(studioScreen.noticePlaces).toEqual({ ownerKind: 'character', places: ['desc'] })
    })

    // The step is undone whole (nothing to say), then the description is edited outside, so the Redo rewrites the row and the
    // system prompt and leaves the description: the replay result lists it, and a Redo shows nothing of that.
    test('a Redo that leaves a place, by Ctrl+Y, shows nothing of its own', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        await rig.service.whenReady(A)
        mergeGrin(rig.service, false)
        await ctrl({ key: 'z' })
        expect(names()).toEqual(['smile', 'grin'])
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        live().desc = 'changed outside'
        flushSync()
        await ctrl({ key: 'y' })
        expect(names()).toEqual(['smile'])
        expect(live().desc).toBe('changed outside')
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('a Redo that leaves a place, by the panel, shows nothing of its own', async () => {
        const rig = makeRig()
        await mountScreen({ panel: true })
        await rig.service.whenReady(A)
        mergeGrin(rig.service, false)
        await press('studio-history-undo')
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        live().desc = 'changed outside'
        flushSync()
        await press('studio-history-redo')
        expect(names()).toEqual(['smile'])
        expect(live().desc).toBe('changed outside')
        expect(shownMessages()).toEqual({ notice: null, panel: null })
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('a newer notice replaces it, and the list goes with it', async () => {
        const rig = makeRig()
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        mergeGrin(rig.service)
        await ctrl({ key: 'z' })
        expect(studioScreen.noticePlaces).not.toBeNull()
        // A later Undo that finds its field already at the undone value brings its own note, which replaces the list.
        edit(rig, 'typed')
        live().desc = 'changed outside'
        await ctrl({ key: 'z' })
        expect(shownMessages().notice).toBe('studioHistoryAlreadyUndone')
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('the History panel says a gone file in its own line and puts no list in the notice', async () => {
        const rig = makeRig(undefined, true)
        await mountScreen({ panel: true })
        await rig.service.whenReady(A)
        mergeGrin(rig.service, false, false)
        files.states.set('assets/a.png', 'gone')
        await press('studio-history-undo')
        // A rows-only step has nothing else to put back, so the step is dropped after the gone line.
        expect(shownMessages()).toEqual({ notice: null, panel: 'studioAssetFileGone(grin) studioHistoryStepDropped' })
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('a merge with texts whose removed row\'s file is gone is refused whole, with the refusal notice and nothing changed', async () => {
        const rig = makeRig(undefined, true)
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        mergeGrin(rig.service)
        files.states.set('assets/a.png', 'gone')
        await ctrl({ key: 'z' })
        expect(shownMessages().notice).toBe('studioRefusalPrecondition')
        expect(studioScreen.noticePlaces).toBeNull()
        expect(names()).toEqual(['smile'])
        expect(live().desc).toBe('changed outside')
        expect(live().systemPrompt).toBe('sp {{image::smile}}')
    })

    // A gone file and left places cannot occur together: a step holding rows and texts is refused whole on a gone file.
    test('a gone file in a rows-only merge is said alone: the row is left out and the notice names the file', async () => {
        const rig = makeRig(undefined, true)
        await mountScreen({ panel: false })
        await rig.service.whenReady(A)
        mergeGrin(rig.service, true, false)
        files.states.set('assets/a.png', 'gone')
        await ctrl({ key: 'z' })
        expect(shownMessages().notice).toBe('studioAssetFileGone(grin)')
        expect(studioScreen.noticePlaces).toBeNull()
    })
})
