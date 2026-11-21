// @vitest-environment jsdom
/**
 * The toggle preview sheet over a real builder, real history service on the memory doubles and the real chat panel
 * sources. Guards by construction: the sheet and its rows are new (class G); the evidence is the mutant each row kills.
 * Time moves only where a test says so.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, modules: [] as { id: string, name: string, customModuleToggle?: string }[] }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    readImage: () => Promise.resolve(undefined),
    getFileSrc: () => Promise.resolve(''),
    aiWatermarkingLawApplies: () => false,
}))

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    license?: string
    customModuleToggle?: string
    chats: { id: string, note: string }[]
    chatPage: number
}

const db = $state({
    db: {
        characters: [] as LiveCharacter[],
        globalChatVariables: undefined as Record<string, string> | undefined,
        botPresets: [] as { name: string }[],
        botPresetsId: 0,
        customPromptTemplateToggle: '',
        modules: [] as unknown[],
    },
})
const selection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => db.db }))
vi.mock('src/ts/process/modules', () => ({ getModules: () => h.modules, getModuleToggles: () => '', getModuleAssets: () => [] }))
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of [
        'studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN',
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
        'studioTgPreviewKeyTip', 'studioTgPreviewGroupCount', 'studioTgPreviewHidden', 'studioTgPreviewSelected',
    ]) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

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
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function mountBuilder(): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleBuilder, { target: host, props: { target: { kind: 'character', chaId: 'A' } } }), host })
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

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const listRows = () => parts('studio-toggle-row')
const previewRow = (key: string) => document.querySelector<HTMLElement>(`[data-part="studio-tg-preview-row"][data-key="${key}"]`)
const previewRows = () => parts('studio-tg-preview-row')
const field = (name: string) => part(name) as HTMLInputElement
const text = () => db.db.characters[0].customModuleToggle ?? ''

function type(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function setText(value: string | undefined, extra: Partial<LiveCharacter> = {}): void {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', customModuleToggle: value, chats: [], chatPage: 0, ...extra }]
}

// jsdom has no layout: the builder's measured width is whatever the test sets, reported once when it is observed.
let fakeWidth = 0
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
}

async function openSheet(): Promise<void> {
    part('studio-toggle-preview-eye')?.click()
    flushSync()
    await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
    await settle()
}

function focusIn(element: Element): void {
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    flushSync()
}

function openedLabel(): string | null {
    return part('studio-toggle-editor') === null ? null : field('studio-toggle-label')?.value ?? null
}

async function settleFocus(): Promise<void> {
    await settle()
    await settle()
    await settle()
}

// The builder loads the sheet on the first opening; its first load transforms the chat panel's whole import chain.
beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
}, 120_000)

beforeEach(() => {
    fakeWidth = 1200
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => fakeWidth })
    h.marks = 0
    h.modules = []
    db.db.botPresets = []
    db.db.botPresetsId = 0
    db.db.customPromptTemplateToggle = ''
    db.db.globalChatVariables = undefined
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
})

afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    await unmountAll()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})

describe('PU-4 the rows draw as the chat panel draws them', () => {
    test('an unset choice shows its first option checked without the on dot; an inline choice moves the dot with its index', async () => {
        setText('c=Check\ns=Pick=select=x,y,z\nl=Long=select=a,b,c,d\nt=Text=text\nta=Area=textarea\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        const radios = Array.from(previewRow('s')!.querySelectorAll<HTMLElement>('[role="radio"]'))
        expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
        expect(previewRow('s')!.querySelector('[data-part="studio-tg-preview-dot"]')).toBeNull()
        expect(previewRow('s')!.hasAttribute('data-on')).toBe(false)
        radios[1].click()
        flushSync()
        expect(previewRow('s')!.querySelector('[data-part="studio-tg-preview-dot"]')).not.toBeNull()
        expect(previewRow('s')!.hasAttribute('data-on')).toBe(true)
        expect(Array.from(previewRow('s')!.querySelectorAll<HTMLElement>('[role="radio"]')).map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
        previewRow('s')!.querySelectorAll<HTMLElement>('[role="radio"]')[0].click()
        flushSync()
        expect(previewRow('s')!.querySelector('[data-part="studio-tg-preview-dot"]')).toBeNull()
    })

    test('a choice of many options is a native select that starts on option 0; a check row has the dot only while on', async () => {
        setText('c=Check\nl=Long=select=a,b,c,d\nt=Text=text\nta=Area=textarea\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        const select = previewRow('l')!.querySelector<HTMLSelectElement>('select')!
        expect(select.value).toBe('0')
        expect(previewRow('l')!.querySelector('[data-part="studio-tg-preview-dot"]')).toBeNull()
        const switchInput = previewRow('c')!.querySelector<HTMLInputElement>('[role="switch"]')!
        expect(previewRow('c')!.querySelector('[data-part="studio-tg-preview-dot"]')).toBeNull()
        switchInput.click()
        flushSync()
        expect(previewRow('c')!.querySelector('[data-part="studio-tg-preview-dot"]')).not.toBeNull()
        expect(previewRow('t')!.querySelector('input[type="text"]')).not.toBeNull()
        expect(previewRow('ta')!.querySelector('textarea')).not.toBeNull()
    })
})

describe('PU-2 the sandbox', () => {
    test('one value per key is shared by every control of the key, and nothing is written anywhere', async () => {
        setText('tone=Tone=check\n')
        db.db.customPromptTemplateToggle = 'tone=Tone=check\n'
        const rig = makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        part('studio-tg-preview-scope-all')?.click()
        flushSync()
        const rows = parts('studio-tg-preview-row').filter((row) => row.dataset.key === 'tone')
        expect(rows).toHaveLength(2)
        const before = JSON.stringify(db.db)
        rows[0].querySelector<HTMLInputElement>('[role="switch"]')!.click()
        flushSync()
        expect(rows.map((row) => row.hasAttribute('data-on'))).toEqual([true, true])
        expect(rows.map((row) => row.querySelector<HTMLInputElement>('[role="switch"]')!.checked)).toEqual([true, true])
        expect(JSON.stringify(db.db)).toBe(before)
        expect(db.db.globalChatVariables).toBeUndefined()
        expect(h.marks).toBe(0)
        expect(tracker.character).toEqual([])
        expect(rig.view(characterOwnerKey('A')).done).toHaveLength(0)
    })
})

describe('PU-8 the sandbox ends with the sheet', () => {
    test('closing and opening again shows every control unset', async () => {
        setText('c=Check\ns=Pick=select=x,y\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        previewRow('c')!.querySelector<HTMLInputElement>('[role="switch"]')!.click()
        previewRow('s')!.querySelectorAll<HTMLElement>('[role="radio"]')[1].click()
        flushSync()
        expect(previewRows().filter((row) => row.hasAttribute('data-on'))).toHaveLength(2)
        part('studio-toggle-preview-close')?.click()
        await settle()
        expect(part('studio-toggle-preview')).toBeNull()
        await openSheet()
        expect(previewRows().filter((row) => row.hasAttribute('data-on'))).toHaveLength(0)
        expect(previewRow('c')!.querySelector<HTMLInputElement>('[role="switch"]')!.checked).toBe(false)
    })
})

describe('PU-5 groups', () => {
    const GROUPED = 'a=A\ng=Group=group\nin=In\nout=Out\ng_end=x=groupEnd\nz=Z\n'

    test('groups start folded, a header toggles aria-expanded, and the group that holds the open row starts open', async () => {
        setText(GROUPED)
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        expect(previewRow('in')).toBeNull()
        const header = part('studio-tg-preview-group')!
        expect(header.getAttribute('aria-expanded')).toBe('false')
        expect(header.textContent).toContain('studioTgPreviewGroupCount(2)')
        header.click()
        flushSync()
        expect(part('studio-tg-preview-group')!.getAttribute('aria-expanded')).toBe('true')
        expect(previewRow('in')).not.toBeNull()
        part('studio-tg-preview-group')!.click()
        flushSync()
        expect(previewRow('in')).toBeNull()
    })

    test('a row open in the list opens its group in the sheet at open', async () => {
        setText(GROUPED)
        makeRig()
        mountBuilder()
        await settle()
        listRows().find((row) => row.querySelector('[data-part="studio-toggle-name"]')?.textContent === 'In')!.click()
        flushSync()
        await openSheet()
        expect(part('studio-tg-preview-group')!.getAttribute('aria-expanded')).toBe('true')
        expect(previewRow('in')).not.toBeNull()
    })
})

describe('PU-9 keys and tooltips', () => {
    test('a repeated label shows its key, a unique one does not, and every row carries the key tooltip', async () => {
        setText('x1=Same=check\nx2=Same=check\nu=Unique=check\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        expect(previewRow('x1')!.querySelector('[data-part="studio-tg-preview-key"]')?.textContent).toBe('x1')
        expect(previewRow('x2')!.querySelector('[data-part="studio-tg-preview-key"]')?.textContent).toBe('x2')
        expect(previewRow('u')!.querySelector('[data-part="studio-tg-preview-key"]')).toBeNull()
        expect(previewRows().map((row) => row.getAttribute('title'))).toEqual(['studioTgPreviewKeyTip(x1)', 'studioTgPreviewKeyTip(x2)', 'studioTgPreviewKeyTip(u)'])
    })

    test('unreadable lines are counted in a note, and a definition with nothing to show says so', async () => {
        setText('a=A\nthis line is nothing\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        expect(part('studio-tg-preview-hidden')?.textContent).toBe('studioTgPreviewHidden(1)')
        expect(part('studio-tg-preview-none')).toBeNull()
        part('studio-toggle-preview-close')?.click()
        await settle()
        setText('')
        await settle()
        await openSheet()
        expect(part('studio-tg-preview-none')).not.toBeNull()
        expect(part('studio-tg-preview-note')).not.toBeNull()
    })
})

describe('PU-6 selecting from the preview', () => {
    const TEXT = 'a=A\ng=Group=group\nin=In\ng_end=x=groupEnd\nz=Z\n'

    async function ready(extra: () => void = () => {}): Promise<void> {
        setText(TEXT)
        extra()
        makeRig()
        mountBuilder()
        await settle()
    }

    const listRowNamed = (name: string) => listRows().find((row) => row.querySelector('[data-part="studio-toggle-name"]')?.textContent === name)!

    test('opening the sheet selects nothing and moves no focus into it (initial focus)', async () => {
        await ready()
        expect(part('studio-toggle-editor')).toBeNull()
        await openSheet()
        await settleFocus()
        expect(part('studio-toggle-editor')).toBeNull()
        expect(previewRows().some((row) => row.contains(document.activeElement))).toBe(false)
        part('studio-toggle-preview-close')?.click()
        await settle()
        listRowNamed('Z').click()
        flushSync()
        await openSheet()
        await settleFocus()
        expect(openedLabel()).toBe('Z')
    })

    test('focus on a row of the open owner opens its row and its group in the list, writes nothing and leaves focus where it is', async () => {
        await ready()
        // The group is folded in the list and folded in the sheet.
        listRowNamed('Group').querySelector<HTMLElement>('[data-part="studio-toggle-expand"]')!.click()
        flushSync()
        expect(listRowNamed('Group').getAttribute('aria-expanded')).toBe('false')
        expect(listRows().some((row) => row.dataset.rowId !== undefined && row.querySelector('[data-part="studio-toggle-name"]')?.textContent === 'In')).toBe(false)
        await openSheet()
        part('studio-tg-preview-group')!.click()
        flushSync()
        const row = previewRow('in')!
        const control = row.querySelector<HTMLInputElement>('[role="switch"]')!
        control.focus()
        focusIn(control)
        expect(listRowNamed('Group').getAttribute('aria-expanded')).toBe('true')
        expect(openedLabel()).toBe('In')
        await settleFocus()
        expect(document.activeElement).toBe(control)
        expect(text()).toBe(TEXT)
        expect(h.marks).toBe(0)
        expect(tracker.character).toEqual([])
        expect(part('studio-tg-preview-announce')?.textContent).toBe('studioTgPreviewSelected(In)')
        // The next list click focuses the editor as it always does.
        listRowNamed('Z').click()
        await settleFocus()
        expect(document.activeElement).toBe(field('studio-toggle-label'))
        expect(field('studio-toggle-label').value).toBe('Z')
    })

    test('a pending new row is kept: the preview selects nothing while one is being named', async () => {
        await ready()
        await openSheet()
        part('studio-toggle-add')?.click()
        flushSync()
        part('studio-toggle-type')?.click()
        flushSync()
        expect(part('studio-toggle-pending-name')).not.toBeNull()
        focusIn(previewRow('a')!.querySelector('[role="switch"]')!)
        expect(part('studio-toggle-pending-name')).not.toBeNull()
        expect(part('studio-toggle-label')).toBeNull()
        // A selection the builder refuses is not announced as made.
        expect(part('studio-tg-preview-announce')?.textContent).toBe('')
    })

    test('in the text view a focus on a preview row changes nothing', async () => {
        await ready()
        listRowNamed('Z').click()
        flushSync()
        await openSheet()
        part('studio-toggle-view-text')?.click()
        await settle()
        part('studio-tg-preview-group')!.click()
        flushSync()
        focusIn(previewRow('in')!.querySelector('[role="switch"]')!)
        // The list is hidden in the text view, so nothing was selected and nothing is announced.
        expect(part('studio-tg-preview-announce')?.textContent).toBe('')
        part('studio-toggle-view-list')?.click()
        await settle()
        expect(openedLabel()).toBe('Z')
        // Back in the list view the same focus is accepted and announced.
        focusIn(previewRow('in')!.querySelector('[role="switch"]')!)
        expect(openedLabel()).toBe('In')
        expect(part('studio-tg-preview-announce')?.textContent).toBe('studioTgPreviewSelected(In)')
    })

    test('a row of another owner and a stale copy of the text select nothing', async () => {
        await ready(() => { db.db.customPromptTemplateToggle = 'p=Prompt\n' })
        await openSheet()
        part('studio-tg-preview-scope-all')?.click()
        flushSync()
        focusIn(previewRow('p')!.querySelector('[role="switch"]')!)
        expect(part('studio-toggle-editor')).toBeNull()
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(part('studio-tg-preview-announce')?.textContent).toBe('')
        part('studio-tg-preview-scope-owner')?.click()
        flushSync()
        // The author types in the list; the copy lags until the pause ends, so a focus in that gap selects nothing.
        listRowNamed('A').click()
        flushSync()
        type(field('studio-toggle-label'), 'A2')
        focusIn(previewRow('z')!.querySelector('[role="switch"]')!)
        expect(field('studio-toggle-label').value).toBe('A2')
        expect(part('studio-tg-preview-announce')?.textContent).toBe('')
    })
})

describe('PU-7 the copy of the text follows after a pause', () => {
    test('it is unchanged until 150 ms after the last change and then updated', async () => {
        setText('a=A\n')
        makeRig()
        mountBuilder()
        await settle()
        listRows()[0].click()
        flushSync()
        await openSheet()
        vi.useFakeTimers()
        const labelOfPreview = () => previewRow('a')!.textContent?.trim()
        expect(labelOfPreview()).toBe('A')
        type(field('studio-toggle-label'), 'A1')
        vi.advanceTimersByTime(100)
        type(field('studio-toggle-label'), 'A12')
        vi.advanceTimersByTime(100)
        type(field('studio-toggle-label'), 'A123')
        flushSync()
        vi.advanceTimersByTime(149)
        flushSync()
        expect(labelOfPreview()).toBe('A')
        vi.advanceTimersByTime(1)
        flushSync()
        expect(labelOfPreview()).toBe('A123')
    })
})

describe('the joined scope', () => {
    test('shows the chat panel sources with the open owner outlined, and a source with no rows is hidden', async () => {
        setText('own=Own=check\n')
        db.db.customPromptTemplateToggle = 'pre=Prompt=check\n'
        h.modules = [{ id: 'M1', name: 'Mod', customModuleToggle: 'mod=Module=check\n' }, { id: 'M2', name: 'Empty' }]
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        expect(parts('studio-tg-preview-source')).toHaveLength(1)
        part('studio-tg-preview-scope-all')?.click()
        flushSync()
        expect(parts('studio-tg-preview-source').map((source) => source.dataset.source)).toEqual(['prompt', 'module:M1', 'character:A'])
        expect(previewRows().map((row) => [row.dataset.key, row.hasAttribute('data-current')])).toEqual([['pre', false], ['mod', false], ['own', true]])
        expect(part('studio-tg-preview-not-in-chat')).toBeNull()
    })
})

describe('T5.4 the sheet starts at the author defaults', () => {
    const DEFAULTS = 'c=Check===1\nn=Plain\ns=Pick=select=x,y=y\n'
    const radios = (key: string) => Array.from(previewRow(key)!.querySelectorAll<HTMLElement>('[role="radio"]')).map((radio) => radio.getAttribute('aria-checked'))

    test('regression reproducer: the owner scope shows a default-on check on and a default option selected; a sheet value wins', async () => {
        setText(DEFAULTS)
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        expect(previewRow('c')!.hasAttribute('data-on')).toBe(true)
        expect(previewRow('n')!.hasAttribute('data-on')).toBe(false)
        expect(radios('s')).toEqual(['false', 'true'])
        previewRow('c')!.querySelector<HTMLInputElement>('[role="switch"]')!.click()
        previewRow('s')!.querySelectorAll<HTMLElement>('[role="radio"]')[0].click()
        flushSync()
        expect(previewRow('c')!.hasAttribute('data-on')).toBe(false)
        expect(radios('s')).toEqual(['true', 'false'])
    })

    test('regression reproducer: the joined scope starts at the same defaults', async () => {
        setText(DEFAULTS)
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        part('studio-tg-preview-scope-all')?.click()
        flushSync()
        expect(previewRow('c')!.hasAttribute('data-on')).toBe(true)
        expect(radios('s')).toEqual(['false', 'true'])
    })

    test('regression reproducer: editing the default in the text moves the sheet after the quiet period', async () => {
        setText(DEFAULTS)
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        setText('c=Check\nn=Plain\ns=Pick=select=x,y=x\n')
        await vi.waitFor(() => expect(previewRow('c')!.hasAttribute('data-on')).toBe(false))
        expect(radios('s')).toEqual(['true', 'false'])
    })
})
