// @vitest-environment jsdom
/**
 * The toggle list builder over a real history service on the memory doubles, with a toast host on a fake clock. Time
 * only moves when the test says so.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, rowViewCalls: [] as number[] }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    license?: string
    customModuleToggle?: string
    chats: { id: string, note: string }[]
    chatPage: number
}

const db = $state({ db: { characters: [] as LiveCharacter[] } })
const selection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN']) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})
// The number of times a row's view is computed, by line id: an edit of one row must not compute another's.
vi.mock('src/ts/studio/toggleBuilderModel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/studio/toggleBuilderModel')>()
    return { ...actual, rowViewOf: (line: Parameters<typeof actual.rowViewOf>[0]) => { h.rowViewCalls.push(line.id); return actual.rowViewOf(line) } }
})

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { installStudioBack } from 'src/ts/studio/studioBack.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { compositionEnd, compositionStart, composeText } from '../../ts/ime/tests/imeEventSequence'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Rig {
    clock: FakeClock
    service: OwnerHistoryService
}

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

function makeRig(): Rig {
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
    return { clock, service }
}

function makeToastHost(): { host: ToastHost, advance(ms: number): void } {
    let time = 0
    const clock: ToastClock = { now: () => time, after: () => () => {} }
    return { host: createToastHost({ clock }), advance(ms) { time += ms } }
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function mountBuilder(props: { host?: ToastHost } = {}): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleBuilder, { target: host, props: { target: { kind: 'character', chaId: 'A' }, ...props } }), host })
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
const rowsOf = () => parts('studio-toggle-row')
const field = (name: string) => part(name) as HTMLInputElement
const text = () => db.db.characters[0].customModuleToggle ?? ''
const steps = (rig: Rig) => rig.service.view(A).done.length

function type(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function setText(value: string | undefined, extra: Partial<LiveCharacter> = {}): void {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', customModuleToggle: value, chats: [], chatPage: 0, ...extra }]
}

function keydown(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

// jsdom has no layout: the builder's measured width is whatever the test sets, reported once when it is observed.
let fakeWidth = 0
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
}

beforeEach(() => {
    fakeWidth = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => fakeWidth })
    h.marks = 0
    h.rowViewCalls.length = 0
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
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})

describe('R-C1 editing a character toggle in the list', () => {
    test('a name edit changes only that line, as one step, and marks the character for saving', async () => {
        setText('a=On\r\nb=Off\r\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        expect(rowsOf().map((row) => row.querySelector('[data-part="studio-toggle-name"]')?.textContent)).toEqual(['On', 'Off'])
        rowsOf()[0].click()
        flushSync()
        type(field('studio-toggle-label'), 'On 2')
        type(field('studio-toggle-label'), 'On 22')
        expect(text()).toBe('a=On 22\nb=Off\r\n')
        expect(steps(rig)).toBe(1)
        expect(h.marks).toBeGreaterThan(0)
    })

    test('opening the list writes nothing', async () => {
        setText('a=On\r\nb=Off\r\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        expect(text()).toBe('a=On\r\nb=Off\r\n')
        expect(steps(rig)).toBe(0)
        expect(h.marks).toBe(0)
    })
})

describe('R-C12 an owner undo re-reads the list', () => {
    test('the restored name shows and the re-read writes nothing', async () => {
        fakeWidth = 1200
        setText('a=On\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        type(field('studio-toggle-label'), 'Changed')
        expect(rowsOf()[0].textContent).toContain('Changed')
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        expect(text()).toBe('a=On\n')
        expect(rowsOf()[0].textContent).toContain('On')
        expect(rowsOf()[0].textContent).not.toContain('Changed')
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(rig.service.view(A).undone).toHaveLength(1)
    })
})

describe('R-C3 and G-C3 keyboard', () => {
    const TEXT = 'a=A\nb=B\nc=C\n'

    test('the list has one tab stop; arrows move focus; Enter opens the editor', async () => {
        setText(TEXT)
        makeRig()
        mountBuilder()
        await settle()
        const rows = rowsOf()
        expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
        keydown(rows[0], 'ArrowDown')
        await settle()
        expect(document.activeElement).toBe(rowsOf()[1])
        keydown(rowsOf()[1], 'Enter')
        expect(part('studio-toggle-editor')).not.toBeNull()
    })

    test('Alt+ArrowDown moves the row one slot as one step and announces it', async () => {
        setText(TEXT)
        const rig = makeRig()
        mountBuilder()
        await settle()
        const event = keydown(rowsOf()[0], 'ArrowDown', { altKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(text()).toBe('b=B\na=A\nc=C\n')
        expect(steps(rig)).toBe(1)
        expect(part('studio-toggle-announce')?.textContent).toBe('studioTgMoved(A,2)')
    })

    test('Alt+ArrowUp on the first row announces that it cannot move and writes nothing', async () => {
        setText(TEXT)
        const rig = makeRig()
        mountBuilder()
        await settle()
        keydown(rowsOf()[0], 'ArrowUp', { altKey: true })
        expect(text()).toBe(TEXT)
        expect(steps(rig)).toBe(0)
        expect(part('studio-toggle-announce')?.textContent).toBe('studioTgCantMove')
    })

    test('Delete removes the row and offers Undo', async () => {
        setText(TEXT)
        makeRig()
        const toast = makeToastHost()
        mountBuilder({ host: toast.host })
        await settle()
        keydown(rowsOf()[1], 'Delete')
        await settle()
        expect(text()).toBe('a=A\nc=C\n')
        expect(toast.host.visible.map((entry) => entry.kind)).toEqual(['undo'])
        expect(toast.host.visible[0].text).toBe('studioTgDeleted(B)')
    })

    test('Shift+F10 opens the row menu and Escape closes it', async () => {
        setText(TEXT)
        makeRig()
        mountBuilder()
        await settle()
        keydown(rowsOf()[0], 'F10', { shiftKey: true })
        expect(part('studio-toggle-row-menu')).not.toBeNull()
        keydown(part('studio-toggle-row-menu') as HTMLElement, 'Escape')
        expect(part('studio-toggle-row-menu')).toBeNull()
    })

    test('the row menu moves a row into a group and out of it', async () => {
        setText('a=A\ng=G=group\nc=C\ng_end=G=groupEnd\n')
        makeRig()
        mountBuilder()
        await settle()
        keydown(rowsOf()[0], 'F10', { shiftKey: true })
        part('studio-toggle-menu-to-group')?.click()
        flushSync()
        expect(text()).toBe('g=G=group\nc=C\na=A\ng_end=G=groupEnd\n')
        const moved = rowsOf().find((row) => row.textContent?.includes('A') && row.getAttribute('aria-level') === '2')
        expect(moved).toBeDefined()
        keydown(moved as HTMLElement, 'F10', { shiftKey: true })
        part('studio-toggle-menu-out')?.click()
        flushSync()
        expect(text()).toBe('g=G=group\nc=C\ng_end=G=groupEnd\na=A\n')
    })
})

describe('R-C4 adding a row', () => {
    test('the picker makes an unwritten row; the first name writes it and the key follows the name', async () => {
        setText('a=A\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-add')?.click()
        flushSync()
        expect(parts('studio-toggle-type').map((button) => button.dataset.kind)).toEqual(['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'])
        parts('studio-toggle-type')[0].click()
        flushSync()
        expect(text()).toBe('a=A\n')
        expect(steps(rig)).toBe(0)
        type(field('studio-toggle-pending-name'), 'Combat mode')
        await settle()
        expect(text()).toBe('a=A\ncombat_mode=Combat mode\n')
        expect(field('studio-toggle-label').value).toBe('Combat mode')
        expect(document.activeElement).toBe(field('studio-toggle-label'))
        // Typing after the insert is the same open field; the insert itself is its own step.
        type(field('studio-toggle-label'), 'Combat mode 2')
        expect(text()).toBe('a=A\ncombat_mode_2=Combat mode 2\n')
        expect(steps(rig)).toBe(2)
    })

    test('an addition after an open group closes the group in the same write', async () => {
        setText('g=G=group\nm=M\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-add')?.click()
        flushSync()
        parts('studio-toggle-type')[0].click()
        flushSync()
        type(field('studio-toggle-pending-name'), 'New')
        await settle()
        expect(text()).toBe('g=G=group\nm=M\ng_end=G=groupEnd\nnew=New\n')
        expect(steps(rig)).toBe(1)
    })

    test('the add button of a group adds inside it, and offers no group type there', async () => {
        setText('g=G=group\nm=M\ng_end=G=groupEnd\n')
        makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-add-in-group')?.click()
        flushSync()
        expect(parts('studio-toggle-type').map((button) => button.dataset.kind)).not.toContain('group')
        parts('studio-toggle-type')[0].click()
        flushSync()
        type(field('studio-toggle-pending-name'), 'Inner')
        await settle()
        expect(text()).toBe('g=G=group\nm=M\ninner=Inner\ng_end=G=groupEnd\n')
    })

    test('an empty definition shows its empty state and the picker adds the first row', async () => {
        setText(undefined)
        makeRig()
        mountBuilder()
        await settle()
        expect(part('studio-toggle-empty')).not.toBeNull()
        part('studio-toggle-add')?.click()
        flushSync()
        parts('studio-toggle-type')[5].click()
        await settle()
        expect(text()).toBe('==divider')
        expect(part('studio-toggle-empty')).toBeNull()
    })
})

describe('R-C5 an unreadable line', () => {
    test('shows as a flagged row with its raw text, and the raw field fixes it', async () => {
        setText('broken\na=A\n')
        makeRig()
        mountBuilder()
        await settle()
        const row = rowsOf()[0]
        expect(row.dataset.type).toBe('unreadable')
        expect(row.dataset.flags).toBe('unreadable')
        expect(part('studio-toggle-unreadable')?.textContent).toBe('studioTgUnreadableCount(1)')
        row.click()
        flushSync()
        expect(field('studio-toggle-raw').value).toBe('broken')
        type(field('studio-toggle-raw'), 'k=Fixed')
        expect(text()).toBe('k=Fixed\na=A\n')
    })
})

describe('R-C7 the key lock', () => {
    test('a row of the first visit keeps its key, kind and option controls disabled with the explanation', async () => {
        setText('a=A\np=Pick=select=x,y\n')
        makeRig()
        mountBuilder()
        await settle()
        rowsOf()[1].click()
        flushSync()
        expect(field('studio-toggle-key').disabled).toBe(true)
        expect((part('studio-toggle-kind') as HTMLSelectElement).disabled).toBe(true)
        expect(parts('studio-toggle-option-remove').every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
        expect(parts('studio-toggle-option-up').every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
        expect((part('studio-toggle-option-add') as HTMLButtonElement).disabled).toBe(false)
        expect(part('studio-toggle-locked')?.textContent).toBe('studioTgKeyLocked')
    })

    test('a row added in this visit is not locked, and its key can be edited', async () => {
        setText('a=A\n')
        makeRig()
        mountBuilder()
        await settle()
        part('studio-toggle-add')?.click()
        flushSync()
        parts('studio-toggle-type')[0].click()
        flushSync()
        type(field('studio-toggle-pending-name'), 'Fresh')
        await settle()
        expect(field('studio-toggle-key').disabled).toBe(false)
        expect(part('studio-toggle-locked')).toBeNull()
        type(field('studio-toggle-key'), 'mine')
        expect(text()).toBe('a=A\nmine=Fresh\n')
    })
})

describe('R-C8 values the format cannot hold', () => {
    test('a name with the field separator is not written, stays in its field with an error, and a valid one writes', async () => {
        setText('a=A\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        type(field('studio-toggle-label'), 'x=y')
        expect(text()).toBe('a=A\n')
        expect(steps(rig)).toBe(0)
        expect(field('studio-toggle-label').value).toBe('x=y')
        expect(part('studio-toggle-error')?.textContent).toBe('studioTgErrEq')
        // An outside change while the field holds the refused text does not overwrite it.
        db.db.characters[0].customModuleToggle = 'a=Z\n'
        await settle()
        expect(field('studio-toggle-label').value).toBe('x=y')
        type(field('studio-toggle-label'), 'xy')
        expect(text()).toBe('a=xy\n')
        expect(part('studio-toggle-error')).toBeNull()
    })

    test('a comma in an option is refused', async () => {
        setText('p=Pick=select=x,y\n')
        makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        type(parts('studio-toggle-option')[0] as HTMLInputElement, 'x,z')
        expect(text()).toBe('p=Pick=select=x,y\n')
        expect(part('studio-toggle-error')?.textContent).toBe('studioTgErrComma')
    })
})

describe('R-C9 an IME composition', () => {
    test('nothing is written while composing; the composition end writes once', async () => {
        setText('a=A\n')
        const rig = makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        const label = field('studio-toggle-label')
        compositionStart(label)
        composeText(label, '한')
        flushSync()
        expect(text()).toBe('a=A\n')
        expect(steps(rig)).toBe(0)
        compositionEnd(label, '한')
        flushSync()
        expect(text()).toBe('a=한\n')
        expect(steps(rig)).toBe(1)
    })

    test('leaving the page mid-composition writes the held value', async () => {
        setText('a=A\n')
        makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        const label = field('studio-toggle-label')
        compositionStart(label)
        composeText(label, '하')
        expect(text()).toBe('a=A\n')
        await unmountAll()
        expect(text()).toBe('a=하\n')
    })
})

describe('R-C10 deleting a group', () => {
    test('members go with it as one step; Undo puts the lines back and keeps a later edit', async () => {
        setText('a=A\ng=G=group\nb=B\ng_end=G=groupEnd\nz=Z\n')
        const rig = makeRig()
        const toast = makeToastHost()
        mountBuilder({ host: toast.host })
        await settle()
        keydown(rowsOf()[1], 'Delete')
        await settle()
        expect(text()).toBe('a=A\nz=Z\n')
        expect(steps(rig)).toBe(1)
        rowsOf()[1].click()
        flushSync()
        type(field('studio-toggle-label'), 'ZZ')
        expect(text()).toBe('a=A\nz=ZZ\n')
        await toast.host.activate(toast.host.visible[0].id)
        await settle()
        expect(text()).toBe('a=A\ng=G=group\nb=B\ng_end=G=groupEnd\nz=ZZ\n')
        expect(toast.host.visible.at(-1)?.text).toBe('studioTgRestored')
        expect(rig.service.view(A).done.length).toBe(3)
    })
})

describe('R-C11 the narrow page editor', () => {
    test('a row opens the editor as a page and Back closes it, also after a search opened and closed', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        studioScreen.pickedInVisit = true
        studioScreen.detailShown = true
        const stop = $effect.root(() => { installStudioBack() })
        try {
            mountBuilder()
            await settle()
            expect(part('studio-toggle-builder')?.dataset.layout).toBe('narrow')
            // The search opened first; the editor opens over it afterwards and must not take Back before the search.
            studioScreen.searchOpen = true
            flushSync()
            rowsOf()[0].click()
            flushSync()
            expect(part('studio-toggle-list')).toBeNull()
            expect(part('studio-toggle-editor')).not.toBeNull()
            expect(dispatchBack()).toBe(true)
            flushSync()
            expect(studioScreen.searchOpen).toBe(false)
            expect(part('studio-toggle-editor')).not.toBeNull()
            expect(dispatchBack()).toBe(true)
            flushSync()
            expect(part('studio-toggle-editor')).toBeNull()
            expect(part('studio-toggle-list')).not.toBeNull()
            expect(studioScreen.open).toBe(true)
        } finally {
            stop()
        }
    })

    test('a wide builder shows the list and the editor side by side, with no Back button', async () => {
        fakeWidth = 1200
        setText('a=A\nb=B\n')
        makeRig()
        mountBuilder()
        await settle()
        expect(part('studio-toggle-builder')?.dataset.layout).toBe('wide')
        rowsOf()[0].click()
        flushSync()
        expect(part('studio-toggle-list')).not.toBeNull()
        expect(part('studio-toggle-editor')).not.toBeNull()
        expect(part('studio-toggle-back')).toBeNull()
    })

    test('the Back button closes the editor and focus returns to its row', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        mountBuilder()
        await settle()
        rowsOf()[1].click()
        flushSync()
        part('studio-toggle-back')?.click()
        await settle()
        expect(part('studio-toggle-editor')).toBeNull()
        expect(document.activeElement).toBe(rowsOf()[1])
    })
})

describe('D-C1 per-row rendering', () => {
    test('typing in one row of sixty computes the view of that row only', async () => {
        fakeWidth = 1200
        setText(Array.from({ length: 60 }, (_, index) => `k${index}=Row ${index}`).join('\n') + '\n')
        makeRig()
        mountBuilder()
        await settle()
        expect(rowsOf()).toHaveLength(60)
        rowsOf()[30].click()
        flushSync()
        h.rowViewCalls.length = 0
        type(field('studio-toggle-label'), 'Row thirty')
        expect(text()).toContain('k30=Row thirty\n')
        expect([...new Set(h.rowViewCalls)]).toEqual([30])
    })
})

describe('refused writes', () => {
    test('while the history is loading the controls are disabled and nothing is written', async () => {
        setText('a=A\n')
        mountBuilder()
        await settle()
        expect(part('studio-toggle-add')).not.toBeNull()
        expect((part('studio-toggle-add') as HTMLButtonElement).disabled).toBe(true)
        expect(part('studio-form-loading')).not.toBeNull()
    })

    test('a private character shows nothing', async () => {
        setText('a=A\n', { license: 'private' })
        makeRig()
        mountBuilder()
        await settle()
        expect(part('studio-toggle-builder')).toBeNull()
    })
})
