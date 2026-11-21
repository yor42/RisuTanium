// @vitest-environment jsdom
/**
 * The long-text focus layer on the real Studio screen and the real history service: opening, the modal behaviour (inert
 * background, Tab trap, focus rescue, modal layer), Back and Esc, the header buttons that replay through the screen,
 * and the notice line inside the layer.
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
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { modalLayerCount } from 'src/lib/Nexus/pattern/modalLayers.svelte'
import { tabbables } from 'src/lib/Nexus/pattern/patternFocus'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { setTokenCounterForTests } from 'src/ts/studio/longText/tokenService'
import { makeCharacter, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { setPreviewEngineForTests, type PreviewEngine } from 'src/ts/studio/longText/previewEngineService'
import { openStudio, resetStudioScreenForTests, setStudioHistoryOpen, setStudioLayout, setStudioNotice, setStudioNotRestoredNotice, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
import LongTextField from './LongTextField.svelte'
import LongTextFocus from './LongTextFocus.svelte'
import type { PreviewSourceInput } from './LongTextPreview.svelte'
import type { character } from '../../ts/storage/database.svelte'
import StudioScreen from './StudioScreen.svelte'

function fixtureDb() {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A', name: 'Alice' }) }))
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0', 'g1'], chats: [] }
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
    const service = createOwnerHistoryService({ store: createMemoryStudioStore({}), claim: createClaimDouble(), clock, pageSession: `f${++rigCount}`, registerLeaveFlush: () => () => {} })
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
    setMacroIndexForTests(createMacroIndex([]))
    setTokenCounterForTests({ request: async (_key, text) => ({ kind: 'app-count', count: text.length, tokenizer: 'o200k_base', model: 'M' }) })
})

afterEach(async () => {
    studioOpen.set(false)
    setTokenCounterForTests(null)
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

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const layer = () => part('studio-lt-focus-layer')
const focusInput = () => part('studio-lt-focus-input') as HTMLTextAreaElement
const inlineDesc = () => part('studio-form-desc') as HTMLTextAreaElement
const live = () => db.db.characters[0]

function typeInto(area: HTMLTextAreaElement, value: string, composing = false): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText' }))
}

function keyOn(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

async function screen(desc = 'd0', greetings: string[] = ['g0', 'g1']): Promise<OwnerHistoryService> {
    const service = makeRig()
    live().desc = desc
    live().alternateGreetings = greetings
    openStudio(basicTarget, null)
    mountInto(StudioScreen)
    await settle()
    await service.whenReady(A)
    expect(inlineDesc().value).toBe(desc.replace(/\r\n/g, '\n'))
    return service
}

// The Maximize button of the description is the first one on the page, the first message's the second; the greeting rows follow.
function openLayer(index = 0): void {
    parts('studio-lt-focus')[index].click()
    flushSync()
}

describe('D-C1 opening and closing', () => {
    test('Maximize opens a modal dialog titled by the field, focus lands in the nested field, Esc closes it and returns focus', async () => {
        await screen()
        setStudioHistoryOpen(true)
        flushSync()
        openLayer()
        const dialog = layer() as HTMLElement
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        const title = part('studio-lt-focus-title') as HTMLElement
        expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
        expect(title.textContent).toBe('description')
        expect(focusInput().getAttribute('aria-labelledby')).toBe(title.id)
        expect(document.activeElement).toBe(focusInput())
        expect(parts('studio-form-desc')).toHaveLength(1)
        expect(part('studio-lt-focus')?.getAttribute('aria-expanded')).toBe('true')

        const esc = keyOn(focusInput(), 'Escape')
        expect(esc.defaultPrevented).toBe(true)
        expect(layer()).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        expect(document.activeElement).toBe(inlineDesc())
    })

    test('Ctrl+E on the inline field opens the layer; with isComposing it does not, and Esc with keyCode 229 does nothing', async () => {
        await screen()
        inlineDesc().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        keyOn(inlineDesc(), 'e', { ctrlKey: true, isComposing: true })
        expect(layer()).toBeNull()
        inlineDesc().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        const open = keyOn(inlineDesc(), 'e', { ctrlKey: true })
        expect(open.defaultPrevented).toBe(true)
        expect(layer()).not.toBeNull()
        keyOn(focusInput(), 'Escape', { keyCode: 229 })
        expect(layer()).not.toBeNull()
        keyOn(focusInput(), 'e', { ctrlKey: true })
        expect(modalLayerCount()).toBe(1)
        expect(parts('studio-lt-focus-layer')).toHaveLength(1)
    })

    test('the header names the owner in a breadcrumb and the Back button closes the layer', async () => {
        await screen()
        openLayer()
        expect((part('studio-lt-focus-owner') as HTMLElement).textContent).toBe('Alice')
        ;(part('studio-lt-focus-close') as HTMLElement).click()
        flushSync()
        expect(layer()).toBeNull()
        expect(document.activeElement).toBe(inlineDesc())
    })

    test('Ctrl+K inside the layer is swallowed: the search stays closed', async () => {
        await screen()
        openLayer()
        const event = keyOn(focusInput(), 'k', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(false)
        expect(layer()).not.toBeNull()
    })
})

describe('D-C2 D-C3 Back', () => {
    test('Back closes the layer first and leaves History open; a second Back closes History', async () => {
        await screen()
        setStudioHistoryOpen(true)
        flushSync()
        openLayer()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(layer()).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.historyOpen).toBe(false)
    })

    test('Back in the middle of a composition keeps the syllable', async () => {
        await screen()
        openLayer()
        focusInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(focusInput(), 'd0한', true)
        expect(live().desc).toBe('d0')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(live().desc).toBe('d0한')
        expect(layer()).toBeNull()
    })
})

describe('D-C4 typing in the layer writes through', () => {
    test('a description edit lands on the live character as a set step, and the inline field follows', async () => {
        const service = await screen()
        openLayer()
        typeInto(focusInput(), 'd0x')
        flushSync()
        expect(live().desc).toBe('d0x')
        expect(inlineDesc().value).toBe('d0x')
        const ops = service.view(A).done.at(-1)?.ops ?? []
        expect(ops.map((op) => op.op)).toEqual(['set'])
    })

    test('a greeting edit is one listSet at its index', async () => {
        const service = await screen()
        openLayer(3)
        typeInto(focusInput(), 'g1x')
        flushSync()
        expect(live().alternateGreetings).toEqual(['g0', 'g1x'])
        const ops = service.view(A).done.at(-1)?.ops ?? []
        expect(ops.map((op) => op.op === 'listSet' ? [op.op, op.index] : [op.op])).toEqual([['listSet', 1]])
    })
})

describe('modal behaviour', () => {
    test('D-C14 one modal layer while open, none after Esc and none after the screen unmounts with the layer open', async () => {
        await screen()
        expect(modalLayerCount()).toBe(0)
        openLayer()
        expect(modalLayerCount()).toBe(1)
        keyOn(focusInput(), 'Escape')
        expect(modalLayerCount()).toBe(0)
        openLayer()
        expect(modalLayerCount()).toBe(1)
        await unmountAll()
        expect(modalLayerCount()).toBe(0)
    })

    test('D-C11 the background is inert only while open, an element that was already inert stays inert, and Tab wraps in both directions', async () => {
        await screen()
        const notice = part('studio-notice') as HTMLElement
        notice.setAttribute('inert', '')
        openLayer()
        const inline = inlineDesc()
        expect(inline.closest('[inert]')).not.toBeNull()
        expect(layer()?.closest('[inert]')).toBeNull()
        const items = tabbables(layer() as HTMLElement)
        expect(items.length).toBeGreaterThan(2)
        const first = items[0]
        const last = items[items.length - 1]
        last.focus()
        expect(keyOn(last, 'Tab').defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(first)
        expect(keyOn(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(last)
        keyOn(focusInput(), 'Escape')
        expect(inline.closest('[inert]')).toBeNull()
        expect(notice.hasAttribute('inert')).toBe(true)
    })

    test('D-C10 a root Ctrl+Z that moves focus out of the layer is pulled back to the nested field', async () => {
        const service = await screen()
        openLayer()
        typeInto(focusInput(), 'd0x')
        service.closeOpenStep(A)
        flushSync()
        // A focus returns the field to the browser's own undo only until it differs from the value it had when focused.
        focusInput().blur()
        focusInput().focus()
        const event = keyOn(focusInput(), 'z', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(true)
        await settle()
        await settle()
        expect(live().desc).toBe('d0')
        expect(layer()?.contains(document.activeElement)).toBe(true)
        expect(document.activeElement).toBe(focusInput())
    })
})

describe('D-C12 Undo and Redo in the header', () => {
    test('both are disabled with nothing to step; Undo restores, Redo reapplies', async () => {
        const service = await screen()
        openLayer()
        const undo = part('studio-lt-focus-undo') as HTMLButtonElement
        const redo = part('studio-lt-focus-redo') as HTMLButtonElement
        expect(undo.disabled).toBe(true)
        expect(redo.disabled).toBe(true)
        typeInto(focusInput(), 'd0x')
        service.closeOpenStep(A)
        flushSync()
        expect(undo.disabled).toBe(false)
        undo.click()
        await settle()
        await settle()
        expect(live().desc).toBe('d0')
        expect(focusInput().value).toBe('d0')
        expect(redo.disabled).toBe(false)
        redo.click()
        await settle()
        await settle()
        expect(live().desc).toBe('d0x')
        expect(focusInput().value).toBe('d0x')
    })

    test('a field with no Studio screen above it has no Undo or Redo button', async () => {
        const owner = $state({ value: 'x' })
        const port: LongTextWritePort = { read: () => owner.value, write: (value) => { owner.value = value; return { ok: true } }, closeStep: () => {} }
        mountInto(LongTextField, { port, part: 'solo', label: 'Solo', kind: 'desc', mode: 'cbs', editable: true, busy: false, fieldClass: 'w-full', onresult: () => {} })
        ;(part('studio-lt-focus') as HTMLElement).click()
        flushSync()
        expect(layer()).not.toBeNull()
        expect(part('studio-lt-focus-undo')).toBeNull()
        expect(part('studio-lt-focus-redo')).toBeNull()
    })
})

const findPart = (name: string) => part(name) as HTMLElement
const queryInput = () => part('studio-lt-find-query') as HTMLInputElement
const replaceInput = () => part('studio-lt-find-replacement') as HTMLInputElement
const countText = () => part('studio-lt-find-count')?.textContent ?? ''
const liveText = () => part('studio-lt-find-live')?.textContent ?? ''
const stepsOf = (service: OwnerHistoryService) => service.view(A).done.length

function typeInfo(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function setCase(on: boolean): void {
    const box = part('studio-lt-find-case') as HTMLInputElement
    box.checked = on
    box.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

function openFind(replace = false): KeyboardEvent {
    return keyOn(focusInput(), replace ? 'h' : 'f', { ctrlKey: true })
}

describe('D-C16 find keys', () => {
    test('Ctrl+F opens find with focus in its field and no replace row; Ctrl+H adds the replace row; both are swallowed', async () => {
        await screen()
        openLayer()
        expect(part('studio-lt-find-bar')).toBeNull()
        const f = openFind()
        expect(f.defaultPrevented).toBe(true)
        expect(part('studio-lt-find-bar')).not.toBeNull()
        expect(document.activeElement).toBe(queryInput())
        expect(part('studio-lt-find-replace-all')).toBeNull()
        focusInput().focus()
        const h2 = openFind(true)
        expect(h2.defaultPrevented).toBe(true)
        expect(part('studio-lt-find-replace-all')).not.toBeNull()
        expect(document.activeElement).toBe(queryInput())
        expect(parts('studio-lt-find-bar')).toHaveLength(1)
    })

    test('Ctrl+F while an IME is composing does nothing', async () => {
        await screen()
        openLayer()
        focusInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        const event = keyOn(focusInput(), 'f', { ctrlKey: true, isComposing: true })
        expect(event.defaultPrevented).toBe(false)
        expect(part('studio-lt-find-bar')).toBeNull()
    })

    test('Esc inside find closes only find and puts focus back in the text; the next Esc closes the layer', async () => {
        await screen()
        openLayer()
        openFind()
        const esc = keyOn(queryInput(), 'Escape')
        expect(esc.defaultPrevented).toBe(true)
        expect(part('studio-lt-find-bar')).toBeNull()
        expect(layer()).not.toBeNull()
        expect(document.activeElement).toBe(focusInput())
        keyOn(focusInput(), 'Escape')
        expect(layer()).toBeNull()
    })

    test('Esc with keyCode 229 in the find field does nothing', async () => {
        await screen()
        openLayer()
        openFind()
        keyOn(queryInput(), 'Escape', { keyCode: 229 })
        expect(part('studio-lt-find-bar')).not.toBeNull()
        expect(layer()).not.toBeNull()
    })

    test('Ctrl+K inside the find field is swallowed: the search stays closed', async () => {
        await screen()
        openLayer()
        openFind()
        const event = keyOn(queryInput(), 'k', { ctrlKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(false)
    })

    test('the header Find button toggles the bar, and the inline Find button opens the layer with find already open', async () => {
        await screen()
        openLayer()
        ;(part('studio-lt-focus-find') as HTMLElement).click()
        flushSync()
        expect(part('studio-lt-find-bar')).not.toBeNull()
        ;(part('studio-lt-focus-find') as HTMLElement).click()
        flushSync()
        expect(part('studio-lt-find-bar')).toBeNull()
        keyOn(focusInput(), 'Escape')
        expect(layer()).toBeNull()
        ;(parts('studio-lt-find')[0]).click()
        flushSync()
        expect(layer()).not.toBeNull()
        expect(part('studio-lt-find-bar')).not.toBeNull()
        expect(document.activeElement).toBe(queryInput())
    })
})

describe('D-C7 find and replace one', () => {
    test('Next selects each match and returns focus to the find field; Replace changes only the current match as one step and moves on', async () => {
        const service = await screen('a X b X c X')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        expect(countText()).toBe('ltFindCount(1,3)')
        const steps = stepsOf(service)
        ;(part('studio-lt-find-next') as HTMLElement).click()
        flushSync()
        expect([focusInput().selectionStart, focusInput().selectionEnd]).toEqual([2, 3])
        expect(document.activeElement).toBe(queryInput())
        ;(part('studio-lt-find-next') as HTMLElement).click()
        flushSync()
        expect([focusInput().selectionStart, focusInput().selectionEnd]).toEqual([6, 7])
        ;(part('studio-lt-find-prev') as HTMLElement).click()
        flushSync()
        expect([focusInput().selectionStart, focusInput().selectionEnd]).toEqual([2, 3])
        expect(stepsOf(service)).toBe(steps)

        ;(part('studio-lt-find-replace') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a Y b X c X')
        expect(stepsOf(service)).toBe(steps + 1)
        expect([focusInput().selectionStart, focusInput().selectionEnd], 'it moves on to the next match').toEqual([6, 7])
        expect(countText()).toBe('ltFindCount(1,2)')

        // The count follows the text at the change exit: a new X typed at the end makes three again.
        typeInto(focusInput(), `${focusInput().value}X`)
        flushSync()
        expect(countText()).toMatch(/^ltFindCount\(\d,3\)$/)
    })

    test('Replace on a match the text has moved away from inserts nothing and finds again', async () => {
        const service = await screen('a X b X c X')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        ;(part('studio-lt-find-next') as HTMLElement).click()
        flushSync()
        ;(part('studio-lt-find-next') as HTMLElement).click()
        flushSync()
        typeInto(focusInput(), `zz${focusInput().value}`)
        flushSync()
        const steps = stepsOf(service)
        const marks = h.marks
        ;(part('studio-lt-find-replace') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('zza X b X c X')
        expect(stepsOf(service)).toBe(steps)
        expect(h.marks).toBe(marks)
    })

    test('the case option changes what is found', async () => {
        await screen('x X x')
        openLayer()
        openFind()
        typeInfo(queryInput(), 'x')
        expect(countText()).toBe('ltFindCount(1,3)')
        setCase(true)
        expect(countText()).toBe('ltFindCount(1,2)')
    })

    test('a query with no match says so, and an empty query shows no count', async () => {
        await screen()
        openLayer()
        openFind()
        expect(countText()).toBe('')
        typeInfo(queryInput(), 'zzz')
        expect(countText()).toBe('ltFindCount(0,0)')
    })
})

describe('D-C5 D-C6 replace all', () => {
    test('right after typing it is its own step: one set op, and one Ctrl+Z undoes only the replacement', async () => {
        const service = await screen('a X b X c X')
        openLayer()
        typeInto(focusInput(), 'a X b X c X!')
        flushSync()
        const steps = stepsOf(service)
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a Y b Y c Y!')
        expect(stepsOf(service)).toBe(steps + 1)
        expect(service.view(A).done.at(-1)?.ops.map((op) => op.op)).toEqual(['set'])
        expect(liveText()).toBe('ltReplacedCount(3)')
        expect(document.activeElement).toBe(focusInput())
        keyOn(focusInput(), 'z', { ctrlKey: true })
        await settle()
        await settle()
        expect(live().desc).toBe('a X b X c X!')
    })

    test('on a CRLF description the stored endings are kept', async () => {
        await screen('X\r\nX')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('Y\r\nY')
    })

    test('on a greeting it is one listSet at its index, with the CRLF kept', async () => {
        const service = await screen('d0', ['g0', 'X\r\nX'])
        openLayer(3)
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().alternateGreetings).toEqual(['g0', 'Y\r\nY'])
        const ops = service.view(A).done.at(-1)?.ops ?? []
        expect(ops.map((op) => op.op === 'listSet' ? [op.op, op.index] : [op.op])).toEqual([['listSet', 1]])
    })

    test('with no match nothing is written and no count is announced', async () => {
        const service = await screen('abc')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'zzz')
        typeInfo(replaceInput(), 'Y')
        const steps = stepsOf(service)
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('abc')
        expect(stepsOf(service)).toBe(steps)
        expect(liveText()).toBe('')
    })

    test('a replacement that leaves the text as it was writes nothing and announces nothing', async () => {
        const service = await screen('a X b')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'X')
        const steps = stepsOf(service)
        const marks = h.marks
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a X b')
        expect(stepsOf(service)).toBe(steps)
        expect(h.marks).toBe(marks)
        expect(liveText()).toBe('')
    })

    test('the replacement is literal, `$&` included', async () => {
        await screen('a X')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), '$&$$')
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a $&$$')
    })
})

describe('D-C8 revert to when opened', () => {
    test('it is disabled before any typing, undoes the typing as one undoable step, and is fresh at each opening', async () => {
        const service = await screen('abc')
        openLayer()
        const revert = () => part('studio-lt-focus-revert') as HTMLButtonElement
        expect(revert().disabled).toBe(true)
        typeInto(focusInput(), 'abcd')
        flushSync()
        expect(revert().disabled).toBe(false)
        const steps = stepsOf(service)
        revert().click()
        await settle()
        expect(live().desc).toBe('abc')
        expect(focusInput().value).toBe('abc')
        expect(stepsOf(service)).toBe(steps + 1)
        expect(service.view(A).done.at(-1)?.ops.map((op) => op.op)).toEqual(['set'])
        expect(revert().disabled).toBe(true)
        keyOn(focusInput(), 'z', { ctrlKey: true })
        await settle()
        await settle()
        expect(live().desc).toBe('abcd')

        keyOn(focusInput(), 'Escape')
        openLayer()
        expect(revert().disabled, 'the new opening starts from abcd').toBe(true)
        typeInto(focusInput(), 'abcde')
        flushSync()
        revert().click()
        await settle()
        expect(live().desc).toBe('abcd')
    })

    test('on a CRLF description it writes back the stored endings', async () => {
        await screen('a\r\nb')
        openLayer()
        typeInto(focusInput(), 'a\nbX')
        flushSync()
        ;(part('studio-lt-focus-revert') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a\r\nb')
    })
})

describe('D-C9 read-only and composing', () => {
    test('a read-only field opens the layer and searches, but Replace, Replace all and Revert are disabled', () => {
        const owner = $state({ value: 'a X b' })
        const port: LongTextWritePort = { read: () => owner.value, write: (value) => { owner.value = value; return { ok: true } }, closeStep: () => {} }
        mountInto(LongTextField, { port, part: 'solo', label: 'Solo', kind: 'desc', mode: 'cbs', editable: false, busy: false, fieldClass: 'w-full', onresult: () => {} })
        ;(part('studio-lt-find') as HTMLButtonElement).click()
        flushSync()
        expect(layer()).not.toBeNull()
        expect(part('studio-lt-find-bar')).not.toBeNull()
        typeInfo(queryInput(), 'X')
        expect(countText()).toBe('ltFindCount(1,1)')
        expect((part('studio-lt-find-next') as HTMLButtonElement).disabled).toBe(false)
        keyOn(queryInput(), 'h', { ctrlKey: true })
        expect((part('studio-lt-find-replace') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-lt-find-replace-all') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-lt-focus-revert') as HTMLButtonElement).disabled).toBe(true)
        ;(part('studio-lt-find-replace-all') as HTMLButtonElement).click()
        flushSync()
        expect(owner.value).toBe('a X b')
    })

    test('Replace all while composing writes nothing, adds no step and announces nothing; a later click works', async () => {
        const service = await screen('a X b')
        openLayer()
        openFind(true)
        typeInfo(queryInput(), 'X')
        typeInfo(replaceInput(), 'Y')
        focusInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        const steps = stepsOf(service)
        const marks = h.marks
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a X b')
        expect(stepsOf(service)).toBe(steps)
        expect(h.marks).toBe(marks)
        expect(liveText()).not.toContain('ltReplacedCount')
        focusInput().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        ;(part('studio-lt-find-replace-all') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('a Y b')
        expect(liveText()).toBe('ltReplacedCount(1)')
    })

    test('Revert while composing writes nothing', async () => {
        await screen('abc')
        openLayer()
        typeInto(focusInput(), 'abcd')
        flushSync()
        focusInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        const marks = h.marks
        ;(part('studio-lt-focus-revert') as HTMLElement).click()
        await settle()
        expect(live().desc).toBe('abcd')
        expect(h.marks).toBe(marks)
    })
})

describe('D-C15 a held composition in the layer', () => {
    test('closing the Studio writes the held text once, from the layer field only', async () => {
        studioOpen.set(true)
        await screen()
        openLayer()
        focusInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(focusInput(), 'd0한', true)
        expect(live().desc).toBe('d0')
        const marks = h.marks
        studioOpen.set(false)
        expect(live().desc).toBe('d0한')
        expect(h.marks).toBe(marks + 1)
        await settle()
        expect(h.marks).toBe(marks + 1)
    })
})

describe('D-C13 the notice line inside the layer', () => {
    test('a notice shows inside the layer, dismissing there clears the shared notice, and a not-restored list opens inside it', async () => {
        await screen()
        openLayer()
        const box = () => part('studio-lt-focus-notice') as HTMLElement
        setStudioNotice('Something happened')
        flushSync()
        expect(box().querySelector('[data-part="studio-notice-text"]')?.textContent).toBe('Something happened')
        ;(box().querySelector('[data-part="studio-notice-dismiss"]') as HTMLElement).click()
        flushSync()
        expect(studioScreen.notice).toBeNull()
        setStudioNotRestoredNotice(A, 'n', ['p'])
        flushSync()
        const show = box().querySelector('[data-part="studio-notice-show"]') as HTMLElement
        expect(show).not.toBeNull()
        show.click()
        flushSync()
        expect(box().querySelectorAll('[data-part="studio-notice-place"]')).toHaveLength(1)
    })
})

// A stand-in engine: the text comes back as it went in, so what the screen shows is the plumbing and not the parser.
function fakeEngine(): PreviewEngine {
    return {
        copiedChatValues: () => null,
        runPreview: (text) => ({ ok: true, text, writes: [], varies: false }),
        sandboxKeysOf: () => ({ chat: [], toggles: [] }),
        sandboxSourceOf: (live) => ({ name: live.name, defaultVariables: '', alternateGreetings: [], texts: {}, bindedPersona: null, modules: [], chatModules: [], customModuleToggle: '' }),
        sandboxUserName: () => 'Uma',
        variesIn: () => false,
        VARIES_NAMES: [],
        previewHtml: (text) => ({ html: text, mediaRemoved: 0 }),
    }
}

describe('S3e-E2b the preview on the screen', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        setPreviewEngineForTests(fakeEngine())
    })

    afterEach(() => {
        setPreviewEngineForTests(null)
        vi.useRealTimers()
    })

    // The engine loads first (microtasks), then the 400 ms pause passes, then the output renders.
    async function shown(): Promise<void> {
        await settle()
        await settle()
        vi.advanceTimersByTime(450)
        await settle()
        await settle()
    }

    const outputText = (): string | null => part('studio-lt-preview-output')?.textContent ?? null

    test('E2-C1 the eye opens the sheet; Esc closes only the sheet and History stays; Back does the same', async () => {
        await screen()
        setStudioHistoryOpen(true)
        flushSync()
        ;(part('studio-lt-preview') as HTMLElement).click()
        flushSync()
        expect(part('studio-lt-preview-sheet')).not.toBeNull()
        await shown()
        expect(outputText()).toBe('d0')
        keyOn(part('studio-lt-preview-sheet') as HTMLElement, 'Escape')
        expect(part('studio-lt-preview-sheet')).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        ;(part('studio-lt-preview') as HTMLElement).click()
        flushSync()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(part('studio-lt-preview-sheet')).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.historyOpen).toBe(false)
    })

    test('E2-C6 on a wide screen the layer shows a side pane next to the field, and no tabs', async () => {
        await screen()
        openLayer()
        expect(part('studio-lt-focus-preview')).not.toBeNull()
        expect(part('studio-lt-preview-pane')).toBeNull()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        await shown()
        expect(outputText()).toBe('d0')
        expect(layer()?.querySelector('[role="tablist"]')).toBeNull()
        expect(focusInput().isConnected).toBe(true)
        typeInto(focusInput(), 'd0x')
        flushSync()
        await shown()
        expect(outputText()).toBe('d0x')
    })

    test('E2-C6 on a stack screen the layer has Edit and Preview tabs; the Preview tab shows the output; Back closes the layer', async () => {
        await screen()
        setStudioLayout('stack')
        flushSync()
        openLayer()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        const tablist = layer()?.querySelector('[role="tablist"]') as HTMLElement
        expect(tablist).not.toBeNull()
        const edit = part('studio-lt-focus-tab-edit') as HTMLElement
        const preview = part('studio-lt-focus-tab-preview') as HTMLElement
        expect(edit.getAttribute('aria-selected')).toBe('false')
        expect(preview.getAttribute('aria-selected')).toBe('true')
        await shown()
        expect(outputText()).toBe('d0')
        edit.click()
        flushSync()
        expect(edit.getAttribute('aria-selected')).toBe('true')
        expect(part('studio-lt-preview-output')).toBeNull()
        expect(focusInput().isConnected).toBe(true)
        preview.click()
        flushSync()
        await shown()
        expect(outputText()).toBe('d0')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(layer()).toBeNull()
    })

    // The sample name fills `{{char}}`, and `{{getvar::hp}}` is a listed chat variable: the text a run makes depends on the values.
    function valuesEngine(): PreviewEngine {
        const base = fakeEngine()
        return {
            ...base,
            runPreview: (text, _kind, _source, values) => ({ ok: true, text: text.replaceAll('{{char}}', values.char).replaceAll('{{getvar::hp}}', values.chat.hp ?? ''), writes: [], varies: false }),
            sandboxKeysOf: (text) => ({ chat: text.includes('{{getvar::hp}}') ? ['hp'] : [], toggles: [] }),
        }
    }

    const layerChip = (): string => layer()?.querySelector('[data-part="studio-lt-tokens"]')?.textContent ?? ''
    const layerChipNote = (): string => layer()?.querySelector('[data-part="studio-lt-tokens-panel"]')?.textContent ?? ''

    async function counted(): Promise<void> {
        vi.advanceTimersByTime(550)
        await settle()
        await settle()
    }

    function composeStart(area: HTMLTextAreaElement): void { area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) }
    function composeEnd(area: HTMLTextAreaElement): void { area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) }

    // The layer on its own, outside the screen, so a layout change does not rebuild it.
    function layerProps(mode: 'plain' | 'cbs'): Record<string, unknown> {
        const port: LongTextWritePort = { read: () => 'x', write: () => ({ ok: true }), closeStep: () => {} }
        const source = (): PreviewSourceInput => ({ owner: { name: 'Alice' } as character, chat: null, globals: {} })
        return { port, kind: 'desc', mode, editable: true, busy: false, onresult: () => {}, title: 'T', previewSource: source, values: { char: '', chat: {}, toggles: {} }, onvalues: () => {}, returnTo: () => null, onclose: () => {} }
    }

    test('E2-C6 the layer toggle shows only for a mode with a preview: none for plain mode', async () => {
        makeRig()
        mountInto(LongTextFocus, layerProps('plain'))
        await settle()
        expect(part('studio-lt-focus-preview')).toBeNull()
        await unmountAll()
        mountInto(LongTextFocus, layerProps('cbs'))
        await settle()
        expect(part('studio-lt-focus-preview')).not.toBeNull()
    })

    test('E2-C6 a layout change to wide with the Edit tab selected shows the pane next to the field at once', async () => {
        makeRig()
        setStudioLayout('stack')
        mountInto(LongTextFocus, layerProps('cbs'))
        await settle()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        ;(part('studio-lt-focus-tab-edit') as HTMLElement).click()
        flushSync()
        expect(part('studio-lt-preview-pane') ?? part('studio-lt-preview-char')).toBeNull()
        setStudioLayout('wide')
        flushSync()
        await shown()
        expect(layer()?.querySelector('[role="tablist"]') ?? null).toBeNull()
        expect(part('studio-lt-preview-char')).not.toBeNull()
        expect(outputText()).toBe('x')
    })

    test('E2-C6 the toggle reports its state: aria-pressed false, true after a click, false after a second', async () => {
        await screen()
        openLayer()
        const toggle = part('studio-lt-focus-preview') as HTMLElement
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        toggle.click()
        flushSync()
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        toggle.click()
        flushSync()
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(part('studio-lt-preview-pane')).toBeNull()
    })

    test('E2-C6 on a stack screen the field is hidden on the Preview tab and stays in the document; the Edit tab shows it again', async () => {
        await screen()
        setStudioLayout('stack')
        flushSync()
        openLayer()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        expect(focusInput().isConnected).toBe(true)
        expect(focusInput().closest('.hidden')).not.toBeNull()
        ;(part('studio-lt-focus-tab-edit') as HTMLElement).click()
        flushSync()
        expect(focusInput().closest('.hidden')).toBeNull()
    })

    test('E2-C7 the nested field counts the filled text with the shared values: a pane edit of the sample name recounts the layer chip', async () => {
        setPreviewEngineForTests(valuesEngine())
        await screen('a {{char}}')
        openLayer()
        await counted()
        expect(layerChip()).toBe('ltTokens(7,M)')
        expect(layerChipNote()).toContain('ltTokNote')
        expect(layerChipNote()).not.toContain('ltTokNoteRaw')
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        await shown()
        const name = part('studio-lt-preview-char') as HTMLInputElement
        name.value = 'Zed'
        name.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        await shown()
        await counted()
        expect(outputText()).toBe('a Zed')
        expect(layerChip()).toBe('ltTokens(5,M)')
    })

    test('E2-C4 a value typed into the layer pane is still there in the inline sheet after the layer closes', async () => {
        setPreviewEngineForTests(valuesEngine())
        await screen('x{{getvar::hp}}')
        openLayer()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        await shown()
        const row = (): HTMLInputElement => document.querySelector('[data-part="studio-lt-preview-row"][data-key="hp"] input') as HTMLInputElement
        row().value = '5'
        row().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        await shown()
        expect(outputText()).toBe('x5')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(layer()).toBeNull()
        ;(part('studio-lt-preview') as HTMLElement).click()
        flushSync()
        await shown()
        expect(part('studio-lt-preview-sheet')).not.toBeNull()
        expect(row().value).toBe('5')
        expect(outputText()).toBe('x5')
    })

    test('E2-C5 in the layer a composition holds the pane: the output waits for compositionend and then 400 ms', async () => {
        await screen()
        openLayer()
        ;(part('studio-lt-focus-preview') as HTMLElement).click()
        flushSync()
        await shown()
        expect(outputText()).toBe('d0')
        composeStart(focusInput())
        typeInto(focusInput(), 'd0x', true)
        flushSync()
        await settle()
        vi.advanceTimersByTime(3000)
        await settle()
        expect(outputText()).toBe('d0')
        composeEnd(focusInput())
        flushSync()
        vi.advanceTimersByTime(399)
        await settle()
        expect(outputText()).toBe('d0')
        vi.advanceTimersByTime(1)
        await settle()
        expect(outputText()).toBe('d0x')
    })

    test('D-C17 (F3) with a preview source the inline order is braces, Find, Preview, Maximize', async () => {
        await screen()
        const braces = part('studio-lt-braces') as HTMLElement
        expect(braces.nextElementSibling).toBe(part('studio-lt-find'))
        expect(part('studio-lt-find')?.nextElementSibling).toBe(part('studio-lt-preview'))
        expect(part('studio-lt-preview')?.nextElementSibling).toBe(part('studio-lt-focus'))
    })
})

describe('F3c onfocuslayer reports the layer opening and closing once each', () => {
    function mountSolo(extra: Record<string, unknown> = {}): { opened: boolean[] } {
        const owner = $state({ value: 'x' })
        const opened: boolean[] = []
        const port: LongTextWritePort = { read: () => owner.value, write: (value) => { owner.value = value; return { ok: true } }, closeStep: () => {} }
        mountInto(LongTextField, { port, part: 'solo', label: 'Solo', kind: 'desc', mode: 'cbs', editable: true, busy: false, fieldClass: 'w-full', onresult: () => {}, onfocuslayer: (open: boolean) => { opened.push(open) }, ...extra })
        return { opened }
    }

    test('the Maximize button, Ctrl+E and the Find button each report true once when they open the layer', () => {
        const solo = mountSolo()
        ;(part('studio-lt-focus') as HTMLElement).click()
        flushSync()
        expect(solo.opened).toEqual([true])
        keyOn(focusInput(), 'Escape')
        expect(solo.opened).toEqual([true, false])
        keyOn(part('solo') as HTMLElement, 'e', { ctrlKey: true })
        expect(solo.opened).toEqual([true, false, true])
        keyOn(focusInput(), 'Escape')
        ;(part('studio-lt-find') as HTMLElement).click()
        flushSync()
        expect(solo.opened).toEqual([true, false, true, false, true])
    })

    test('Esc, the header Back button and the hardware Back each report false once, after the layer is gone', () => {
        const solo = mountSolo()
        for (const close of [
            () => { keyOn(focusInput(), 'Escape') },
            () => { ;(part('studio-lt-focus-close') as HTMLElement).click(); flushSync() },
            () => { expect(dispatchBack()).toBe(true); flushSync() },
        ]) {
            ;(part('studio-lt-focus') as HTMLElement).click()
            flushSync()
            close()
            expect(layer()).toBeNull()
        }
        expect(solo.opened).toEqual([true, false, true, false, true, false])
    })

    test('a field that is destroyed while its layer is open reports false once', async () => {
        const solo = mountSolo()
        ;(part('studio-lt-focus') as HTMLElement).click()
        flushSync()
        await unmountAll()
        expect(solo.opened).toEqual([true, false])
    })

    test('E6 the nested field draws the same turn notes as the card', async () => {
        mountSolo({ extraMarks: (text: string) => (text.startsWith('AB') ? [{ start: 0, end: 2, note: 'speaker' as const }] : []) })
        ;(part('studio-lt-focus') as HTMLElement).click()
        flushSync()
        typeInto(focusInput(), 'AB hi')
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 600))
        const inLayer = Array.from((layer() as HTMLElement).querySelectorAll('[data-note="speaker"]')).map((el) => el.textContent)
        expect(inLayer).toEqual(['AB'])
    })
})
