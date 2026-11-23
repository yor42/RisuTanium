// @vitest-environment jsdom
/**
 * The risky section and its question sheet on the real Studio screen, the advanced form, the History panel and the
 * restore sheet over a real history service on the memory doubles (T2-RF-UI-1, -2, -2e, -2f, -4, -5, T2-RF-9,
 * T2-RC-2, T2-RC-3, AS-B10). Pressing an off switch asks and writes nothing; only the sheet's confirmation writes, as a
 * step of its own. Every route that would turn a flag on without a press (a redo, a revert, a restore point) asks too,
 * and a cancel is silent. While a question is pending it owns Esc, Back and the history keys.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))
const alerts = vi.hoisted(() => ({ errors: [] as (string | Error)[] }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertError: (message: string | Error) => { alerts.errors.push(message) } }))
vi.mock('src/ts/util', () => ({ languageCodes: ['af', 'en', 'ja', 'ko'] }))

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
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = { help: { lowLevelAccess: 'help.lowLevelAccess', utilityBot: 'help.utilityBot' } }
    for (const key of ['ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { registerShell } from 'src/lib/Nexus/pattern/patternFocus'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { askRiskyTurnOn, cancelRiskyQuestion, riskyQuestion } from 'src/ts/studio/edit/riskyConfirm.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { ownerKeyOf } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioHistoryOpen, setStudioRestoreSheetOpen, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import type { StudioHistoryStep } from 'src/ts/studio/historyStepContext'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioRiskyHost from './StudioRiskyHost.harness.test.svelte'
import StudioRiskySection from './StudioRiskySection.svelte'

type Extra = Record<string, unknown>

function fixtureDb(extra: Extra = {}) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0', systemPrompt: 'SYS', replaceGlobalNote: 'RGN', additionalText: 'ADD', defaultVariables: '', translatorNote: '', creatorNotes: 'note', utilityBot: false, ...extra }
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

function makeRig(): OwnerHistoryService {
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

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []
let stepContext: StudioHistoryStep | null = null

function mountHost(): void {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(StudioRiskyHost, { target: host, props: { expose: (context: StudioHistoryStep) => { stepContext = context } } })
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
const flagSwitch = (path: string) => document.querySelector<HTMLButtonElement>(`[data-part="studio-risky-switch"][data-path="${path}"]`)!
const dialog = () => part('studio-risky-confirm')
const live = (): Record<string, unknown> => db.db.characters[0] as unknown as Record<string, unknown>

// Studio open on the advanced form of the selected character, with the owner's history ready.
async function openScreen(extra: Extra = {}): Promise<OwnerHistoryService> {
    db.db = fixtureDb(extra)
    const service = makeRig()
    openStudio(basicTarget, null)
    // The tree selects the owner; the harness has no tree, so the selection is set the way a pick sets it.
    studioScreen.selectedOwnerKey = ownerKeyOf('character', 'A')
    mountHost()
    await settle()
    await service.whenReady(A)
    await settle()
    return service
}

async function press(element: HTMLElement | null): Promise<void> {
    element!.click()
    flushSync()
    await settle()
}

function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

const root = () => part('studio')!
const stepsOf = (service: OwnerHistoryService) => service.view(A).done

beforeEach(() => {
    h.marks = 0
    alerts.errors.length = 0
    stepContext = null
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    selection.selId = 0
    setStudioEnabled(true)
    setMacroIndexForTests(createMacroIndex([{ name: 'char', aliases: [], summary: 'char', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]))
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    cancelRiskyQuestion()
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- T2-RF-UI-1

describe('T2-RF-UI-1: the question of a turn-on (AS-B1)', () => {
    test('the section is the last part of the details, critical, and every flag starts off with its explanation', async () => {
        await openScreen()
        const section = part('studio-risky')!
        expect(section.hasAttribute('data-part-critical')).toBe(true)
        expect(section.closest('[data-part="studio-advanced-form"][data-section="details"]')).not.toBeNull()
        expect(section.parentElement!.lastElementChild).toBe(section)
        expect(part('studio-risky-warning')!.textContent).toBe('studioRiskyWarn')
        expect([...section.querySelectorAll('[data-part="studio-risky-switch"]')].map((element) => element.getAttribute('data-path'))).toEqual(['lowLevelAccess', 'utilityBot', 'escapeOutput'])
        expect(section.querySelectorAll('[data-part="studio-risky-explain"]')).toHaveLength(3)
        for (const path of ['lowLevelAccess', 'utilityBot', 'escapeOutput']) {
            expect(flagSwitch(path).getAttribute('role')).toBe('switch')
            expect(flagSwitch(path).getAttribute('aria-checked')).toBe('false')
        }
    })

    test('pressing an off switch opens the sheet with focus on Cancel, writes nothing and leaves the switch off', async () => {
        const service = await openScreen()
        await press(flagSwitch('lowLevelAccess'))
        const sheet = dialog()!
        expect(sheet.getAttribute('role')).toBe('alertdialog')
        expect(sheet.hasAttribute('data-part-critical')).toBe(true)
        expect(document.activeElement).toBe(part('studio-risky-confirm-cancel'))
        expect(part('studio-risky-confirm-title')!.textContent).toBe('studioRiskyAskLow')
        expect(part('studio-risky-confirm-body')!.textContent).toContain('studioRiskyLowConsequence')
        expect('lowLevelAccess' in live()).toBe(false)
        expect(flagSwitch('lowLevelAccess').getAttribute('aria-checked')).toBe('false')
        expect(stepsOf(service)).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('Tab and Shift+Tab cycle between the two buttons', async () => {
        await openScreen()
        await press(flagSwitch('lowLevelAccess'))
        const cancel = part('studio-risky-confirm-cancel')!
        const ok = part('studio-risky-confirm-ok')!
        expect(key(document.activeElement!, { key: 'Tab' }).defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(ok)
        key(document.activeElement!, { key: 'Tab' })
        expect(document.activeElement).toBe(cancel)
        key(document.activeElement!, { key: 'Tab', shiftKey: true })
        expect(document.activeElement).toBe(ok)
        key(document.activeElement!, { key: 'Tab', shiftKey: true })
        expect(document.activeElement).toBe(cancel)
    })

    const cancels: [string, () => void][] = [
        ['Cancel', () => part('studio-risky-confirm-cancel')!.click()],
        ['Esc', () => { key(document.activeElement!, { key: 'Escape' }) }],
        ['Back', () => { dispatchBack() }],
        ['a tap on the scrim', () => dialog()!.parentElement!.click()],
    ]
    test.each(cancels)('%s leaves the flag off with no step and returns focus to the switch', async (_name, cancel) => {
        const service = await openScreen()
        await press(flagSwitch('lowLevelAccess'))
        expect(dialog()).not.toBeNull()
        cancel()
        flushSync()
        await settle()
        expect(dialog()).toBeNull()
        expect(riskyQuestion()).toBeNull()
        expect('lowLevelAccess' in live()).toBe(false)
        expect(stepsOf(service)).toHaveLength(0)
        expect(h.marks).toBe(0)
        expect(document.activeElement).toBe(flagSwitch('lowLevelAccess'))
        expect(part('studio-risky')!.querySelector('[role="alert"]')).toBeNull()
    })

    test('Turn on writes one step of its own, announces the flag and returns focus to the switch', async () => {
        const service = await openScreen()
        await press(flagSwitch('lowLevelAccess'))
        await press(part('studio-risky-confirm-ok'))
        expect(dialog()).toBeNull()
        expect(live().lowLevelAccess).toBe(true)
        expect(stepsOf(service)).toHaveLength(1)
        expect(stepsOf(service)[0].ops).toEqual([{ op: 'set', path: 'lowLevelAccess', before: { had: false }, after: { had: true, value: true } }])
        expect(part('studio-risky')!.querySelector('[role="status"]')!.textContent).toBe('studioRiskyAnnounce(lowLevelAccess)')
        expect(flagSwitch('lowLevelAccess').getAttribute('aria-checked')).toBe('true')
        expect(document.activeElement).toBe(flagSwitch('lowLevelAccess'))
    })

    test('turning a flag off asks nothing and makes one step (AS-B2)', async () => {
        const service = await openScreen({ lowLevelAccess: true })
        await press(flagSwitch('lowLevelAccess'))
        expect(dialog()).toBeNull()
        expect(live().lowLevelAccess).toBe(false)
        expect(stepsOf(service)).toHaveLength(1)
    })
})

describe('T2-RF-9: the switch makes a step of its own', () => {
    test('an off step and a confirmed on step within the coalescing window stay two steps', async () => {
        const service = await openScreen({ utilityBot: true })
        await press(flagSwitch('utilityBot'))
        expect(live().utilityBot).toBe(false)
        await press(flagSwitch('utilityBot'))
        await press(part('studio-risky-confirm-ok'))
        expect(live().utilityBot).toBe(true)
        expect(stepsOf(service)).toHaveLength(2)
    })
})

// ---------------------------------------------------------------- T2-RF-UI-2

describe('T2-RF-UI-2: the routes that turn a flag on without a press ask too (AS-B3, AS-B4)', () => {
    async function withUndoneTurnOn(): Promise<OwnerHistoryService> {
        const service = await openScreen({ utilityBot: false })
        expect(service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null }).ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        flushSync()
        return service
    }

    test('Ctrl+Shift+Z on the Studio root asks; Cancel changes nothing and says nothing; Turn on applies the redo', async () => {
        const service = await withUndoneTurnOn()
        const event = key(root(), { key: 'z', ctrlKey: true, shiftKey: true })
        expect(event.defaultPrevented).toBe(true)
        await settle()
        expect(dialog()).not.toBeNull()
        expect(part('studio-risky-confirm-title')!.textContent).toBe('studioRiskyAskUtility')
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(dialog()).toBeNull()
        expect(live().utilityBot).toBe(false)
        expect(service.view(A).undone).toHaveLength(1)
        expect(studioScreen.notice).toBeNull()

        key(root(), { key: 'z', ctrlKey: true, shiftKey: true })
        await settle()
        await press(part('studio-risky-confirm-ok'))
        expect(live().utilityBot).toBe(true)
        expect(service.view(A).undone).toHaveLength(0)
        expect(studioScreen.notice).toBeNull()
    })

    test('Ctrl+Z undoing a turn-off asks (the undo writes the flag on)', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        key(root(), { key: 'z', ctrlKey: true })
        await settle()
        expect(dialog()).not.toBeNull()
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(live().utilityBot).toBe(false)
        expect(stepsOf(service)).toHaveLength(1)
        expect(studioScreen.notice).toBeNull()
    })

    test("the History panel's Redo asks; a cancel leaves no message", async () => {
        const service = await withUndoneTurnOn()
        setStudioHistoryOpen(true)
        flushSync()
        await settle()
        await press(part('studio-history-redo'))
        expect(dialog()).not.toBeNull()
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(dialog()).toBeNull()
        expect(live().utilityBot).toBe(false)
        expect(service.view(A).undone).toHaveLength(1)
        expect(part('studio-history-message')).toBeNull()
    })

    test('a History revert across a turn-off asks; Cancel changes nothing; Turn on reverts', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editText(A, 'desc', 'd1', 'single')
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        const first = stepsOf(service)[0].id
        setStudioHistoryOpen(true)
        flushSync()
        await settle()
        const revert = () => document.querySelector<HTMLElement>(`[data-step-id="${first}"] [data-part="studio-history-revert"]`)
        await press(revert())
        expect(dialog()).not.toBeNull()
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(live().utilityBot).toBe(false)
        expect(part('studio-history-message')).toBeNull()
        await press(revert())
        await press(part('studio-risky-confirm-ok'))
        expect(live().utilityBot).toBe(true)
        expect(live().desc).toBe('d1')
    })

    test('the restore sheet asks from its confirm; Cancel leaves the sheet open with no refusal line and focus on its confirm button', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        flushSync()
        await settle()
        await press(part('studio-restore-confirm'))
        expect(dialog()).not.toBeNull()
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(dialog()).toBeNull()
        expect(studioScreen.restoreSheetOpen).toBe(true)
        expect(part('studio-restore-refusal')).toBeNull()
        expect(document.activeElement).toBe(part('studio-restore-confirm'))
        expect(live().utilityBot).toBe(false)
        await press(part('studio-restore-confirm'))
        await press(part('studio-risky-confirm-ok'))
        expect(live().utilityBot).toBe(true)
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })
})

describe('T2-RF-UI-2e: a question over the restore sheet owns Esc and Back (AS-B8)', () => {
    async function withSheetAndQuestion(): Promise<void> {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        flushSync()
        await settle()
        await press(part('studio-restore-confirm'))
        expect(dialog()).not.toBeNull()
    }

    test('Esc cancels only the question; a second Esc closes the sheet', async () => {
        await withSheetAndQuestion()
        const first = key(document.activeElement!, { key: 'Escape' })
        await settle()
        expect(first.defaultPrevented).toBe(true)
        expect(dialog()).toBeNull()
        expect(studioScreen.restoreSheetOpen).toBe(true)
        key(root(), { key: 'Escape' })
        await settle()
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })

    test('Back cancels only the question; a second Back closes the sheet', async () => {
        await withSheetAndQuestion()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(dialog()).toBeNull()
        expect(studioScreen.restoreSheetOpen).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })
})

describe('T2-RF-UI-2f: the restore sheet reads `before` after the answer', () => {
    test('a field written during the question does not take the focus: it goes to the flag that came back on', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        flushSync()
        await settle()
        await press(part('studio-restore-confirm'))
        expect(dialog()).not.toBeNull()
        live().systemPrompt = 'written meanwhile'
        await press(part('studio-risky-confirm-ok'))
        await settle()
        await settle()
        expect(live().utilityBot).toBe(true)
        expect(document.activeElement).toBe(flagSwitch('utilityBot'))
    })
})

// ---------------------------------------------------------------- the retry stays on its target (R2, AS-B6)

describe('the retry of a refused replay is pinned at each call site', () => {
    test('the Studio screen: a step that lands during the question is not undone by the confirmed retry', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        key(root(), { key: 'z', ctrlKey: true })
        await settle()
        expect(dialog()).not.toBeNull()
        expect(service.editText(A, 'systemPrompt', 'typed', 'single').ok).toBe(true)
        const landed = stepsOf(service).at(-1)!.id
        await press(part('studio-risky-confirm-ok'))
        await settle()
        expect(stepsOf(service).at(-1)!.id).toBe(landed)
        expect(live().systemPrompt).toBe('typed')
        expect(live().utilityBot).toBe(false)
        expect(studioScreen.notice).toBe('studioRefusalPrecondition')
    })

    test('the History panel: a step that lands during the question is not reverted by the confirmed retry', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editText(A, 'desc', 'd1', 'single')
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        const first = stepsOf(service)[0].id
        setStudioHistoryOpen(true)
        flushSync()
        await settle()
        await press(document.querySelector<HTMLElement>(`[data-step-id="${first}"] [data-part="studio-history-revert"]`))
        expect(dialog()).not.toBeNull()
        expect(service.editText(A, 'systemPrompt', 'typed', 'single').ok).toBe(true)
        const landed = stepsOf(service).at(-1)!.id
        await press(part('studio-risky-confirm-ok'))
        await settle()
        expect(stepsOf(service).at(-1)!.id).toBe(landed)
        expect(live().systemPrompt).toBe('typed')
        expect(live().desc).toBe('d1')
        expect(live().utilityBot).toBe(false)
        expect(part('studio-history-message')!.textContent).toBe('studioRefusalPrecondition')
    })
})

// ---------------------------------------------------------------- T2-FOC-F

describe('T2-FOC-F: a History action on a flag focuses the switch of that flag', () => {
    test('the undo of the turn-on of the second flag focuses its switch, not the first one', async () => {
        const service = await openScreen({ utilityBot: false })
        expect(service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null }).ok).toBe(true)
        flushSync()
        key(root(), { key: 'z', ctrlKey: true })
        await settle()
        await settle()
        expect(live().utilityBot).toBe(false)
        expect(dialog()).toBeNull()
        expect(document.activeElement).toBe(flagSwitch('utilityBot'))
        expect(document.activeElement).not.toBe(flagSwitch('lowLevelAccess'))
    })
})

// ---------------------------------------------------------------- T2-RF-UI-4

describe('T2-RF-UI-4: a pending question makes the history inert (AS-B9)', () => {
    async function withUndoneText(): Promise<OwnerHistoryService> {
        const service = await openScreen({ utilityBot: false })
        expect(service.editText(A, 'systemPrompt', 'NEW', 'single').ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        flushSync()
        expect(stepContext).not.toBeNull()
        return service
    }

    test('the context step and can refuse, and the focus-mode Undo and Redo are disabled', async () => {
        const service = await withUndoneText()
        expect(stepContext!.can('redo')).toBe(true)
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        expect(riskyQuestion()).not.toBeNull()
        expect(stepContext!.can('redo')).toBe(false)
        expect(stepContext!.can('undo')).toBe(false)
        expect(stepContext!.step('redo', null)).toBe(false)
        await settle()
        expect(service.view(A).undone).toHaveLength(1)
        expect(live().systemPrompt).toBe('SYS')

        await press(document.querySelector<HTMLElement>('[data-part="studio-lt-focus"]'))
        expect(part('studio-lt-focus-layer')).not.toBeNull()
        expect((part('studio-lt-focus-redo') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-lt-focus-undo') as HTMLButtonElement).disabled).toBe(true)
        ask.cancel()
    })

    test('Ctrl+Z, Ctrl+Shift+Z and Ctrl+K are dropped while the question is pending, and work after', async () => {
        const service = await withUndoneText()
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        for (const init of [{ key: 'z', ctrlKey: true }, { key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true }, { key: 'k', ctrlKey: true }]) {
            expect(key(root(), init).defaultPrevented, JSON.stringify(init)).toBe(true)
        }
        await settle()
        expect(service.view(A).undone).toHaveLength(1)
        expect(service.view(A).done).toHaveLength(0)
        expect(studioScreen.searchOpen).toBe(false)
        ask.cancel()
        flushSync()
        key(root(), { key: 'k', ctrlKey: true })
        expect(studioScreen.searchOpen).toBe(true)
        key(root(), { key: 'z', ctrlKey: true, shiftKey: true })
        await settle()
        expect(service.view(A).undone).toHaveLength(0)
        expect(live().systemPrompt).toBe('NEW')
    })
})

// ---------------------------------------------------------------- T2-RF-UI-5

describe('T2-RF-UI-5: a flag stored as a non-boolean shows the engine reading and cannot be changed (AS-B11)', () => {
    test('1 and a string read on, disabled, with the unreadable line; false reads off and stays enabled; nothing is written', async () => {
        const service = await openScreen({ lowLevelAccess: 1, utilityBot: 'yes', escapeOutput: false })
        for (const path of ['lowLevelAccess', 'utilityBot']) {
            const element = flagSwitch(path)
            expect(element.getAttribute('aria-checked'), path).toBe('true')
            expect(element.disabled, path).toBe(true)
            expect(element.closest('[data-part="studio-risky-flag"]')!.querySelector('[role="note"]')!.textContent, path).toBe('studioRiskyUnreadable')
        }
        expect(flagSwitch('escapeOutput').getAttribute('aria-checked')).toBe('false')
        expect(flagSwitch('escapeOutput').disabled).toBe(false)
        expect(flagSwitch('escapeOutput').closest('[data-part="studio-risky-flag"]')!.querySelector('[role="note"]')).toBeNull()
        await press(flagSwitch('lowLevelAccess'))
        expect(dialog()).toBeNull()
        expect(live().lowLevelAccess).toBe(1)
        expect(live().utilityBot).toBe('yes')
        expect(h.marks).toBe(0)
        expect(stepsOf(service)).toHaveLength(0)
    })

    test('a non-boolean escapeOutput reads mixed: the two engine paths disagree about it', async () => {
        await openScreen({ escapeOutput: 1 })
        expect(flagSwitch('escapeOutput').getAttribute('aria-checked')).toBe('mixed')
        expect(flagSwitch('escapeOutput').disabled).toBe(true)
    })
})

// ---------------------------------------------------------------- T2-RC-2, T2-RC-3

describe('T2-RC-2: the lifecycle of the question (I-B8)', () => {
    test("the asker's cancel, and a second ask while one is pending", async () => {
        await openScreen()
        const first = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        expect(riskyQuestion()).not.toBeNull()
        expect(await askRiskyTurnOn(A, ['lowLevelAccess']).answer).toBe('no')
        expect(riskyQuestion()!.path).toBe('utilityBot')
        first.cancel()
        expect(await first.answer).toBe('no')
        expect(riskyQuestion()).toBeNull()
    })

    test('the unmount of the screen resolves it no', async () => {
        await openScreen()
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        await unmountAll()
        expect(await ask.answer).toBe('no')
        expect(riskyQuestion()).toBeNull()
    })

    test('a visit change resolves it no', async () => {
        await openScreen()
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        openStudio(basicTarget, null)
        flushSync()
        await settle()
        expect(await ask.answer).toBe('no')
        expect(riskyQuestion()).toBeNull()
    })

    test('a change of the selected character resolves it no', async () => {
        await openScreen()
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        flushSync()
        studioScreen.chaId = 'B'
        flushSync()
        await settle()
        expect(await ask.answer).toBe('no')
        expect(riskyQuestion()).toBeNull()
    })

    test("the section's own destruction ends the question it asked", async () => {
        const service = makeRig()
        db.db = fixtureDb()
        studioScreen.chaId = 'A'
        studioScreen.visitId = 'v1'
        studioScreen.open = true
        await service.whenReady(A)
        const host = document.createElement('div')
        document.body.appendChild(host)
        const app = mount(StudioRiskySection, { target: host, props: { chaId: 'A', owner: A, service, editable: true } })
        flushSync()
        host.querySelector<HTMLElement>('[data-path="utilityBot"]')!.click()
        await settle()
        expect(riskyQuestion()).not.toBeNull()
        await unmount(app)
        host.remove()
        expect(riskyQuestion()).toBeNull()
    })

    test('a question answered yes for one flag moves to the next and resolves yes only after the last', async () => {
        await openScreen()
        const ask = askRiskyTurnOn(A, ['utilityBot', 'lowLevelAccess'])
        flushSync()
        let answer: string | null = null
        void ask.answer.then((value) => { answer = value })
        await press(part('studio-risky-confirm-ok'))
        expect(answer).toBeNull()
        expect(riskyQuestion()!.path).toBe('lowLevelAccess')
        expect(document.activeElement).toBe(part('studio-risky-confirm-cancel'))
        await press(part('studio-risky-confirm-ok'))
        expect(answer).toBe('yes')
    })

    test('cancelling the second flag of two leaves both off (AS-B5)', async () => {
        const service = await openScreen({ utilityBot: true, lowLevelAccess: true })
        service.editText(A, 'desc', 'd1', 'single')
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        service.editField(A, 'lowLevelAccess', false, { coalesceKey: null })
        const base = stepsOf(service)[0].id
        setStudioHistoryOpen(true)
        flushSync()
        await settle()
        await press(document.querySelector<HTMLElement>(`[data-step-id="${base}"] [data-part="studio-history-revert"]`))
        expect(dialog()).not.toBeNull()
        await press(part('studio-risky-confirm-ok'))
        expect(dialog()).not.toBeNull()
        part('studio-risky-confirm-cancel')!.click()
        await settle()
        expect(dialog()).toBeNull()
        expect(live().utilityBot).toBe(false)
        expect(live().lowLevelAccess).toBe(false)
    })
})

describe('T2-RC-3: no question under a shell layer (Q15, AS-B10)', () => {
    test('with a shell registered the ask is blocked and no question opens', async () => {
        await openScreen()
        const release = registerShell({})
        const ask = askRiskyTurnOn(A, ['utilityBot'])
        expect(await ask.answer).toBe('blocked')
        expect(riskyQuestion()).toBeNull()
        release()
    })

    test('the focus-mode Undo of a turn-off opens no question, writes nothing and shows the refusal inside focus mode', async () => {
        const service = await openScreen({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        await press(document.querySelector<HTMLElement>('[data-part="studio-lt-focus"]'))
        expect(part('studio-lt-focus-layer')).not.toBeNull()
        await press(part('studio-lt-focus-undo'))
        await settle()
        expect(riskyQuestion()).toBeNull()
        expect(dialog()).toBeNull()
        expect(live().utilityBot).toBe(false)
        expect(stepsOf(service)).toHaveLength(1)
        expect(part('studio-lt-focus-notice')!.textContent).toContain('studioRefusalRiskyConfirm')
    })

    test('a switch pressed while a shell is open shows the refusal line and writes nothing', async () => {
        const service = await openScreen()
        const release = registerShell({})
        await press(flagSwitch('lowLevelAccess'))
        expect(dialog()).toBeNull()
        expect(part('studio-risky')!.querySelector('[role="alert"]')!.textContent).toBe('studioRefusalRiskyConfirm')
        expect('lowLevelAccess' in live()).toBe(false)
        expect(stepsOf(service)).toHaveLength(0)
        release()
    })
})
