// @vitest-environment jsdom
/**
 * The long-text field follows its text through `syncValue`, also when the text changes with no DOM event: a Studio
 * undo or redo, a peer write, and a refusal that resets the textarea. Two rigs: the real Studio screen with the real
 * history service (undo and redo through the root key handler), and the field over a port that refuses its writes.
 * Marks, rows, the check and the chip arrive with later stages; the recolouring pass stands for them here, because
 * every scheduler of the field is touched by the same funnel.
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
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltTokens', 'ltTokensEst', 'ltTokEstOnline', 'ltTokEstUnavailable', 'ltTokEstError', 'ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches']) own[key] = withArguments(key)
    // The macro table's labels: one per row id, answering `row:<id>`.
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})
// The real colouring, wrapped so a test can see which texts it ran on.
vi.mock('src/ts/studio/longText/highlightSpans', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/studio/longText/highlightSpans')>()
    return { ...actual, tokenSpans: vi.fn(actual.tokenSpans) }
})

// The real checker, wrapped so a test can see which texts it ran on.
vi.mock('src/ts/studio/longText/cbsCheck', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/studio/longText/cbsCheck')>()
    return { ...actual, checkCbs: vi.fn(actual.checkCbs) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { flushStudioFields } from 'src/ts/studio/fieldFlush'
import { checkCbs } from 'src/ts/studio/longText/cbsCheck'
import { tokenSpans } from 'src/ts/studio/longText/highlightSpans'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { setPreviewEngineForTests, type PreviewEngine } from 'src/ts/studio/longText/previewEngineService'
import { setTokenCounterForTests } from 'src/ts/studio/longText/tokenService'
import { makeCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioHistoryOpen, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
import LongTextField from './LongTextField.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0'], chats: [] }
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
    const service = createOwnerHistoryService({ store: createMemoryStudioStore({}), claim: createClaimDouble(), clock, pageSession: `r${++rigCount}`, registerLeaveFlush: () => () => {} })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
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
    unobserve(): void {}
    disconnect(): void {}
}

// The texts the token chip asked to count.
const tokenTexts: string[] = []

// The forms give their fields a preview source, so the chip counts what the preview engine makes of the text. The real
// engine is a lazy import of the whole parser, which this rig does not load; a stand-in hands the text back as it is.
const passThroughEngine: PreviewEngine = {
    copiedChatValues: () => null,
    runPreview: (text) => ({ ok: true, text, writes: [], varies: false }),
    sandboxKeysOf: () => ({ chat: [], toggles: [] }),
    sandboxSourceOf: (live) => ({ name: live.name, defaultVariables: '', alternateGreetings: [], texts: {}, bindedPersona: null, modules: [], chatModules: [], customModuleToggle: '' }),
    sandboxUserName: () => 'User',
    variesIn: () => false,
    VARIES_NAMES: [],
    previewHtml: (text) => ({ html: text, mediaRemoved: 0 }),
}

beforeEach(() => {
    setPreviewEngineForTests(passThroughEngine)
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
    setWindowGeometryForTests(allRowsGeometry())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(tokenSpans).mockClear()
    vi.mocked(checkCbs).mockClear()
    setMacroIndexForTests(createMacroIndex([]))
    tokenTexts.length = 0
    setTokenCounterForTests({
        request: async (_key, text) => {
            tokenTexts.push(text)
            return { kind: 'app-count', count: text.length, tokenizer: 'o200k_base', model: 'M' }
        },
    })
})

afterEach(async () => {
    setPreviewEngineForTests(null)
    setTokenCounterForTests(null)
    setMacroIndexForTests(null)
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.useRealTimers()
    setWindowGeometryForTests(undefined)
    vi.unstubAllGlobals()
})

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const overlayOf = (area: HTMLTextAreaElement): HTMLElement => area.parentElement?.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
const overlayText = (area: HTMLTextAreaElement): string => (overlayOf(area).textContent ?? '').slice(0, -1)
const namesIn = (area: HTMLTextAreaElement): number => overlayOf(area).querySelectorAll('[data-kind="name"]').length
const colouredTexts = (): string[] => vi.mocked(tokenSpans).mock.calls.map((call) => call[0])
const checkedTexts = (): string[] => vi.mocked(checkCbs).mock.calls.map((call) => call[0])
const problemMarks = (area: HTMLTextAreaElement): number => overlayOf(area).querySelectorAll('[data-severity="info"]').length
const problemRowCount = (area: HTMLTextAreaElement): number => (area.parentElement?.parentElement ?? document.body).querySelectorAll('[data-part="studio-lt-problem-row"]').length

function advance(ms: number): void {
    vi.advanceTimersByTime(ms)
    flushSync()
}

function typeInto(area: HTMLTextAreaElement, value: string, composing = false): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText' }))
}

async function historyKey(init: KeyboardEventInit): Promise<void> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init })
    ;(part('studio') as HTMLElement).dispatchEvent(event)
    flushSync()
    await settle()
    await settle()
}

async function screenWithDesc(): Promise<{ service: OwnerHistoryService, area: HTMLTextAreaElement }> {
    const service = makeRig()
    openStudio(basicTarget, null)
    mountInto(StudioScreen)
    await settle()
    const area = part('studio-form-desc') as HTMLTextAreaElement
    expect(area.value).toBe('d0')
    advance(250)
    return { service, area }
}

describe('R6 the field follows its text with no DOM event', () => {
    test('R6-1 undo: the overlay shows exactly the restored text at once, drops the spans of the removed text, and recolours once after the pause', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0{{char}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        expect(namesIn(area)).toBe(1)
        vi.mocked(tokenSpans).mockClear()
        await historyKey({ key: 'z' })
        expect(area.value).toBe('d0')
        expect(overlayText(area)).toBe('d0')
        expect(namesIn(area)).toBe(0)
        advance(249)
        expect(vi.mocked(tokenSpans)).not.toHaveBeenCalled()
        advance(1)
        expect(colouredTexts()).toEqual(['d0'])
        advance(2000)
        expect(colouredTexts()).toEqual(['d0'])
    })

    test('R6-1 undo touches every scheduler: the chip counts the restored text once, 500 ms after the undo', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0{{char}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        // The greeting field beside the desc was counted at its own pause; its request reaches the counter a few
        // microtasks after the timer (the chip awaits the preview engine first), so let that settle before the reset.
        await settle()
        tokenTexts.length = 0
        await historyKey({ key: 'z' })
        expect(area.value).toBe('d0')
        advance(499)
        await settle()
        expect(tokenTexts).toEqual([])
        advance(1)
        await settle()
        expect(tokenTexts).toEqual(['d0'])
        advance(2000)
        await settle()
        expect(tokenTexts).toEqual(['d0'])
    })

    test('R6-2 redo touches every scheduler: the chip counts the redone text once', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0{{char}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        await historyKey({ key: 'z' })
        advance(500)
        await settle()
        tokenTexts.length = 0
        await historyKey({ key: 'z', shiftKey: true })
        expect(area.value).toBe('d0{{char}}')
        advance(500)
        await settle()
        expect(tokenTexts).toEqual(['d0{{char}}'])
    })

    test('R6-2 redo: the overlay shows the redone text at once and recolours once after the pause', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0{{char}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        await historyKey({ key: 'z' })
        advance(250)
        expect(area.value).toBe('d0')
        vi.mocked(tokenSpans).mockClear()
        await historyKey({ key: 'z', shiftKey: true })
        expect(area.value).toBe('d0{{char}}')
        expect(overlayText(area)).toBe('d0{{char}}')
        expect(namesIn(area)).toBe(0)
        advance(250)
        expect(colouredTexts()).toEqual(['d0{{char}}'])
        expect(namesIn(area)).toBe(1)
    })
})

describe('R6 problems and marks follow the text with no DOM event', () => {
    test('R6-1 undo: marks and rows of the removed text are gone at once, and exactly one check runs on the restored text after the pause', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        await settle()
        expect(problemMarks(area)).toBe(1)
        expect(problemRowCount(area)).toBe(1)
        vi.mocked(checkCbs).mockClear()
        await historyKey({ key: 'z' })
        expect(area.value).toBe('d0')
        expect(problemMarks(area)).toBe(0)
        expect(problemRowCount(area)).toBe(0)
        advance(249)
        await settle()
        expect(checkedTexts()).toEqual([])
        advance(1)
        await settle()
        expect(checkedTexts()).toEqual(['d0'])
        advance(2000)
        await settle()
        expect(checkedTexts()).toEqual(['d0'])
    })

    test('R6-2 redo: no mark or row points at the redone text until the one check after the pause', async () => {
        const { service, area } = await screenWithDesc()
        typeInto(area, 'd0}}')
        service.closeOpenStep(A)
        flushSync()
        advance(250)
        await settle()
        await historyKey({ key: 'z' })
        advance(250)
        await settle()
        expect(area.value).toBe('d0')
        vi.mocked(checkCbs).mockClear()
        await historyKey({ key: 'z', shiftKey: true })
        expect(area.value).toBe('d0}}')
        expect(overlayText(area)).toBe('d0}}')
        expect(problemMarks(area)).toBe(0)
        expect(problemRowCount(area)).toBe(0)
        advance(249)
        await settle()
        expect(checkedTexts()).toEqual([])
        advance(1)
        await settle()
        expect(checkedTexts()).toEqual(['d0}}'])
        expect(problemMarks(area)).toBe(1)
        expect(problemRowCount(area)).toBe(1)
    })
})

interface Owned {
    owner: { value: string }
    port: LongTextWritePort
}

function refusingField(stored: string): { area: HTMLTextAreaElement, owned: Owned } {
    const owner = $state({ value: stored })
    const refusal: StudioResult = { ok: false, reason: 'precondition' }
    const owned: Owned = { owner, port: { read: () => owner.value, write: () => refusal, closeStep: () => {} } }
    const host = mountInto(LongTextField, { port: owned.port, part: 'studio-form-desc', kind: 'desc', mode: 'cbs', editable: true, busy: false, fieldClass: 'w-full', onresult: () => {} })
    advance(250)
    return { area: host.querySelector('textarea') as HTMLTextAreaElement, owned }
}

describe('R6 a refusal reset reaches the overlay', () => {
    test('R6-3 composition refused at compositionend: the overlay shows the composed text, then the reset text, and colours only that', () => {
        const { area } = refusingField('d0{{char}}')
        advance(250)
        expect(namesIn(area)).toBe(1)
        vi.mocked(tokenSpans).mockClear()
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0{{char}}한', true)
        flushSync()
        expect(overlayText(area)).toBe('d0{{char}}한')
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        expect(area.value).toBe('d0{{char}}')
        expect(overlayText(area)).toBe('d0{{char}}')
        advance(250)
        expect(colouredTexts()).toEqual(['d0{{char}}'])
        expect(namesIn(area)).toBe(1)
    })

    test('R6-3 a refused non-composing input leaves the overlay on the field text and starts no recolouring', () => {
        const { area } = refusingField('d0')
        vi.mocked(tokenSpans).mockClear()
        typeInto(area, 'd0Q')
        flushSync()
        expect(area.value).toBe('d0')
        expect(overlayText(area)).toBe('d0')
        advance(1000)
        expect(vi.mocked(tokenSpans)).not.toHaveBeenCalled()
    })

    test('R-a a flush refused while composing keeps the composed text in the overlay; the reset at compositionend reaches it', () => {
        const { area } = refusingField('d0')
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0한', true)
        flushStudioFields('hide')
        flushSync()
        expect(area.value).toBe('d0한')
        expect(overlayText(area)).toBe('d0한')
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        expect(area.value).toBe('d0')
        expect(overlayText(area)).toBe('d0')
    })

    test('R6-5 a peer write during a composition reaches the overlay as the textarea takes it', () => {
        const { area, owned } = refusingField('d0')
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0한', true)
        flushSync()
        owned.owner.value = 'peer'
        flushSync()
        expect(overlayText(area)).toBe(area.value)
        expect(area.value).toBe('peer')
    })

    test('R6-3 a refused composition counts only the reset text', async () => {
        const { area } = refusingField('d0{{char}}')
        advance(250)
        await settle()
        tokenTexts.length = 0
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0{{char}}한', true)
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        advance(500)
        await settle()
        expect(tokenTexts).toEqual(['d0{{char}}'])
    })

    test('R6-3 a refused composition that replaced a marked text: no mark or row for the composed text, one check on the reset text only', async () => {
        const { area } = refusingField('d0}}')
        advance(250)
        await settle()
        expect(problemMarks(area)).toBe(1)
        vi.mocked(checkCbs).mockClear()
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0한', true)
        flushSync()
        expect(problemMarks(area)).toBe(0)
        expect(problemRowCount(area)).toBe(0)
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        expect(area.value).toBe('d0}}')
        expect(problemMarks(area)).toBe(0)
        expect(problemRowCount(area)).toBe(0)
        advance(250)
        await settle()
        expect(checkedTexts()).toEqual(['d0}}'])
        expect(problemMarks(area)).toBe(1)
        expect(problemRowCount(area)).toBe(1)
    })

    test('R6-3 a refused non-composing input starts no check', async () => {
        const { area } = refusingField('d0')
        advance(250)
        await settle()
        vi.mocked(checkCbs).mockClear()
        typeInto(area, 'd0Q')
        flushSync()
        expect(area.value).toBe('d0')
        advance(1000)
        await settle()
        expect(checkedTexts()).toEqual([])
    })

    test('R6-5 a peer write outside composition recolours once after the pause', () => {
        const { area, owned } = refusingField('d0')
        vi.mocked(tokenSpans).mockClear()
        owned.owner.value = '{{user}} peer'
        flushSync()
        expect(overlayText(area)).toBe('{{user}} peer')
        advance(249)
        expect(vi.mocked(tokenSpans)).not.toHaveBeenCalled()
        advance(1)
        expect(colouredTexts()).toEqual(['{{user}} peer'])
        expect(namesIn(area)).toBe(1)
    })
})

const pickerPart = (): HTMLElement | null => part('studio-lt-picker')
const sheetPart = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"][data-part="studio-lt-sheet"]')

function escapeOn(target: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    flushSync()
    return event
}

describe('C2 the picker and the sheet inside the Studio screen', () => {
    test('R6-3(b) a composition refused at compositionend closes the picker that its text had opened', async () => {
        const { area } = refusingField('d0')
        area.focus()
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0{{ge', true)
        flushSync()
        await settle()
        expect(pickerPart()).not.toBeNull()
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        expect(area.value).toBe('d0')
        expect(pickerPart()).toBeNull()
    })

    test('C2-C8(a) with History open, Esc closes the picker and History stays open', async () => {
        const { area } = await screenWithDesc()
        setStudioHistoryOpen(true)
        flushSync()
        area.focus()
        typeInto(area, '{{')
        flushSync()
        await settle()
        expect(pickerPart()).not.toBeNull()
        const closing = escapeOn(area)
        expect(closing.defaultPrevented).toBe(true)
        expect(pickerPart()).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
    })

    test('C2-C8(b) with History open, Esc closes the sheet and History stays open', async () => {
        const { area } = await screenWithDesc()
        setStudioHistoryOpen(true)
        flushSync()
        area.focus()
        area.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
        flushSync()
        await settle()
        const dialog = sheetPart()
        expect(dialog).not.toBeNull()
        escapeOn(dialog?.querySelector('[data-part="studio-lt-sheet-search"]') as HTMLElement)
        expect(sheetPart()).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
    })

    test('C2-C8(c) with nothing open, Esc in the description reaches the screen and closes History', async () => {
        const { area } = await screenWithDesc()
        setStudioHistoryOpen(true)
        flushSync()
        area.focus()
        expect(escapeOn(area).defaultPrevented).toBe(true)
        expect(studioScreen.historyOpen).toBe(false)
    })

    // A field whose port accepts every write, with the owner's value in reach for a write that has no DOM event.
    function acceptingField(stored: string): { area: HTMLTextAreaElement, owner: { value: string } } {
        const owner = $state({ value: stored })
        const port: LongTextWritePort = { read: () => owner.value, write: (value) => { owner.value = value; return { ok: true } }, closeStep: () => {} }
        const host = mountInto(LongTextField, { port, part: 'studio-form-desc', kind: 'desc', mode: 'cbs', editable: true, busy: false, fieldClass: 'w-full', onresult: () => {} })
        advance(250)
        return { area: host.querySelector('textarea') as HTMLTextAreaElement, owner }
    }

    const optionTexts = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-lt-picker-name"]')).map((name) => name.textContent ?? '')
    const arrowDown = (area: HTMLTextAreaElement): void => {
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
        flushSync()
    }

    test('C2-x73 an owner write that changes only the name after the {{ filters the open picker by the new name', async () => {
        const { area, owner } = acceptingField('')
        area.focus()
        typeInto(area, '{{ge')
        flushSync()
        await settle()
        expect(optionTexts()).not.toContain('greater')
        owner.value = '{{g'
        flushSync()
        expect(pickerPart()).not.toBeNull()
        expect(optionTexts()).toContain('greater')
    })

    test('C2-x74 an owner write that changes the name clears the arrow choice', async () => {
        const { area, owner } = acceptingField('')
        area.focus()
        typeInto(area, '{{ge')
        flushSync()
        await settle()
        arrowDown(area)
        expect(area.getAttribute('aria-activedescendant')).not.toBeNull()
        owner.value = '{{g'
        flushSync()
        expect(pickerPart()).not.toBeNull()
        expect(area.getAttribute('aria-activedescendant')).toBeNull()
    })

    test('C2-x72 an owner write that puts the caret inside another {{ closes the picker of the first one', async () => {
        const { area, owner } = acceptingField('')
        area.focus()
        typeInto(area, '{{g')
        flushSync()
        await settle()
        expect(pickerPart()).not.toBeNull()
        owner.value = '{{a}} {{g'
        flushSync()
        expect(pickerPart()).toBeNull()
    })

    test('C2-x71 an input event that moves the caret into another {{ of the same name clears the arrow choice', async () => {
        const { area } = acceptingField('')
        area.focus()
        area.value = '{{g {{g'
        area.setSelectionRange(3, 3)
        area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        await settle()
        arrowDown(area)
        expect(area.getAttribute('aria-activedescendant')).not.toBeNull()
        area.setSelectionRange(7, 7)
        area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        expect(pickerPart()).not.toBeNull()
        expect(area.getAttribute('aria-activedescendant')).toBeNull()
    })
})
