// @vitest-environment jsdom

/**
 * The native Personas page over the real `personaList` helpers and a real `$state` store. Guards for new
 * behaviour (G-new) throughout.
 *
 * MOCKED: `stores.svelte` (DBState is a real `$state` object, the navigation stores are writables), the
 * persona file I/O (`persona.ts`), image lookups, `alertError`, the toast host (calls are recorded and the
 * Undo action is run by the test), the danger arm delay. The page, `ShellSheet`, `PatternWarning`,
 * `personaList`, `personaUndo` and the Back stack are real.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Database, RisuPersona } from '../../ts/storage/database.svelte'
import type { PersonaImportItem } from '../../ts/persona'
import type { UndoToastInit } from '../../ts/toast/toastHost.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('../../ts/persona', () => ({
    exportPersona: vi.fn(async () => {}),
    selectUserImg: vi.fn(async () => {}),
    readPersonaFiles: vi.fn(async () => []),
    addPersonasFromPng: vi.fn(async () => []),
}))
const lookupGet = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 'background-image: none'))
vi.mock('../../ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: lookupGet, getIf: () => null, dispose: () => {} }),
}))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
vi.mock('../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { language } from '../../lang'
import { alertError } from '../../ts/alert'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { addPersonasFromPng, exportPersona, readPersonaFiles } from '../../ts/persona'
import { setSettingsSubLevel, settingsShellBackSnapshot, settingsShellBackStep } from '../../ts/settingsShell/settingsNavigation'
import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { postToast, postUndoToast } from '../../ts/toast/toastHost.svelte'
import Host from './PersonasShellPage.testHost.svelte'
import Page from './PersonasShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function persona(id: string | undefined, name: string, extra: Partial<RisuPersona> = {}): RisuPersona {
    return { name, icon: '', personaPrompt: `${name}-prompt`, note: `${name}-note`, ...(id === undefined ? {} : { id }), ...extra }
}

function seed(personas: RisuPersona[], selected = 0, characters: unknown[] = []): void {
    const active = personas[selected]
    DBState.db = {
        personas,
        selectedPersona: selected,
        username: active.name,
        userIcon: active.icon,
        personaPrompt: active.personaPrompt,
        userNote: active.note,
        characters,
    } as unknown as Database
}

function list(): RisuPersona[] {
    return DBState.db.personas
}

function mountPage(component: typeof Page | typeof Host = Page, width = 1280): HTMLElement {
    setWidth(width)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target }))
    flushSync()
    return target
}

function cards(target: HTMLElement): HTMLElement[] {
    return Array.from(target.querySelectorAll<HTMLElement>('[data-part="settings-persona-card"]'))
}

function cardButton(target: HTMLElement, index: number): HTMLButtonElement {
    return cards(target)[index].querySelectorAll('button')[0]
}

function menuButton(target: HTMLElement, index: number): HTMLButtonElement {
    return cards(target)[index].querySelectorAll('button')[1]
}

function editor(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="settings-persona-editor"]')!
}

function nameField(target: HTMLElement): HTMLInputElement {
    return editor(target).querySelectorAll('input[type="text"]')[0] as HTMLInputElement
}

function descField(target: HTMLElement): HTMLTextAreaElement {
    return editor(target).querySelector('textarea')!
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function buttonByText(root: HTMLElement | Document, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text)
    if (!found) throw new Error(`no button ${text}`)
    return found
}

function menuItem(text: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent?.trim() === text)
    if (!found) throw new Error(`no menu item ${text}`)
    return found
}

/** A click whose own event time is far ahead, so the danger arm delay never rejects it. */
function tapLate(button: HTMLElement): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: Number.MAX_SAFE_INTEGER })
    button.dispatchEvent(tap)
    flushSync()
}

function warnPart(name: string): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`[data-part="pattern-warn-${name}"]`)!
}

async function confirmDelete(target: HTMLElement): Promise<void> {
    buttonByText(editor(target), language.settingsShellPersonaDelete).click()
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 10))
    tapLate(warnPart('primary'))
    await settle()
}

beforeEach(() => {
    vi.mocked(postUndoToast).mockClear()
    vi.mocked(postToast).mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(exportPersona).mockClear()
    vi.mocked(readPersonaFiles).mockReset()
    vi.mocked(addPersonasFromPng).mockReset()
    resetBackHandlersForTests()
    settingsOpen.set(true)
    SettingsMenuIndex.set(12)
    seed([persona('a', 'Ann'), persona('b', 'Bob'), persona('c', 'Cy')])
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    setWidth(1280)
})

describe('cards (P1, P14)', () => {
    test('(R) #450: card icons are list rows that queue every size; the editor icon is a single image', async () => {
        lookupGet.mockClear()
        seed([persona('a', 'Ann', { icon: 'assets/ann.webp' }), persona('b', 'Bob', { icon: 'assets/bob.webp' })])
        mountPage()
        await settle()
        const cardCalls = lookupGet.mock.calls.filter((call) => String(call[0]).startsWith('persona:'))
        expect(cardCalls.map((call) => call[1]).sort()).toEqual(['assets/ann.webp', 'assets/bob.webp'])
        expect(cardCalls.every((call) => (call[3] as { everySize?: boolean } | undefined)?.everySize === true)).toBe(true)
        const editorCalls = lookupGet.mock.calls.filter((call) => call[0] === 'persona-editor')
        expect(editorCalls.length).toBeGreaterThan(0)
        expect(editorCalls.every((call) => call[3] === undefined)).toBe(true)
    })

    test('each persona is a list item with one primary button, its note, its count and the in-use mark', () => {
        seed([persona('a', 'Ann'), persona('b', 'Bob'), persona('c', 'Cy')], 0, [
            { name: 'X', chats: [{ name: 'one', bindedPersona: 'b' }, { name: 'two', bindedPersona: 'b' }, { name: 'three' }] },
        ])
        const target = mountPage()
        const items = cards(target)
        expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI', 'LI'])
        expect(items[0].closest('ul')?.getAttribute('data-part')).toBe('settings-persona-list')
        expect(items[1].textContent).toContain('Bob-note')
        expect(items[1].textContent).toContain(language.settingsShellPersonaChats(2))
        expect(items[0].textContent).toContain(language.settingsShellPersonaChatsActive(0))
        expect(items[0].querySelector('[data-part="settings-persona-active"]')).not.toBeNull()
        expect(items[1].querySelector('[data-part="settings-persona-active"]')).toBeNull()
        expect(items[1].querySelectorAll('[data-persona-open]').length).toBe(1)
    })

    test('a cold stub makes the counts read "or more"', () => {
        seed([persona('a', 'Ann'), persona('b', 'Bob')], 0, [{ name: 'Stub', coldstorage: 'u1', chats: [] }])
        const target = mountPage()
        expect(cards(target)[1].textContent).toContain(language.settingsShellPersonaChatsOrMore(0))
    })
})

describe('open versus use (P2, P3, P12)', () => {
    test('opening a card shows its editor and does not activate it; Use activates', async () => {
        const target = mountPage()
        cardButton(target, 1).click()
        await settle()
        expect(nameField(target).value).toBe('Bob')
        expect(DBState.db.selectedPersona).toBe(0)
        buttonByText(editor(target), language.settingsShellPersonaUse).click()
        flushSync()
        expect(DBState.db.selectedPersona).toBe(1)
        expect(DBState.db.username).toBe('Bob')
    })

    test('typing updates the entry and the card at once, and the mirror only for the persona in use', async () => {
        const target = mountPage()
        cardButton(target, 1).click()
        await settle()
        type(nameField(target), 'Bobby')
        expect(list()[1].name).toBe('Bobby')
        expect(DBState.db.username).toBe('Ann')
        expect(cards(target)[1].textContent).toContain('Bobby')
        cardButton(target, 0).click()
        await settle()
        type(descField(target), 'new prompt')
        expect(list()[0].personaPrompt).toBe('new prompt')
        expect(DBState.db.personaPrompt).toBe('new prompt')
    })

    test('Export passes the opened persona, not the one in use', async () => {
        const target = mountPage()
        cardButton(target, 2).click()
        await settle()
        buttonByText(editor(target), language.settingsShellPersonaExport).click()
        expect(exportPersona).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cy', personaPrompt: 'Cy-prompt' }))
    })
})

describe('create and duplicate (P10, P-DUP)', () => {
    test('Create adds a persona with an id, opens it and does not activate it', async () => {
        const target = mountPage()
        buttonByText(target, `+ ${language.settingsShellPersonaAdd}`).click()
        await settle()
        menuItem(language.settingsShellPersonaNew).click()
        await settle()
        expect(list().length).toBe(4)
        expect(list()[3].name).toBe(language.settingsShellPersonaNewName)
        expect(list()[3].id).toBeTruthy()
        expect(nameField(target).value).toBe(language.settingsShellPersonaNewName)
        expect(DBState.db.selectedPersona).toBe(0)
    })

    test('Duplicate over the reactive store adds an independent copy and opens it', async () => {
        const target = mountPage()
        buttonByText(editor(target), language.settingsShellPersonaDup).click()
        await settle()
        expect(list().length).toBe(4)
        expect(list()[3].name).toBe('Ann')
        expect(list()[3].id).not.toBe('a')
        expect(DBState.db.selectedPersona).toBe(0)
        type(nameField(target), 'Copy')
        expect(list()[3].name).toBe('Copy')
        expect(list()[0].name).toBe('Ann')
    })
})

describe('delete and undo (P4, P5, P-E9a, P-E9b)', () => {
    test('P4: the last persona cannot be deleted and the guard line shows', () => {
        seed([persona('a', 'Ann')])
        const target = mountPage()
        expect(buttonByText(editor(target), language.settingsShellPersonaDelete).disabled).toBe(true)
        expect(target.querySelector('[data-part="settings-persona-guard"]')?.textContent).toBe(language.settingsShellPersonaLast)
    })

    test('P5: the confirm names the persona, the bound chats and the new persona in use; Undo restores it', async () => {
        seed([persona('a', 'Ann'), persona('b', 'Bob')], 1, [{ name: 'X', chats: [{ name: 'one', bindedPersona: 'b' }] }])
        const target = mountPage()
        buttonByText(editor(target), language.settingsShellPersonaDelete).click()
        await settle()
        const lines = Array.from(document.querySelectorAll('[data-part="pattern-warn-consequence"]')).map((line) => line.textContent)
        expect(lines).toEqual([
            'Bob',
            language.settingsShellPersonaBoundQ(1, 'Ann'),
            language.settingsShellPersonaNewActive('Ann'),
        ])
        await new Promise((resolve) => setTimeout(resolve, 10))
        tapLate(warnPart('primary'))
        await settle()
        expect(list().map((entry) => entry.id)).toEqual(['a'])
        expect(DBState.db.selectedPersona).toBe(0)
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        expect(toast.text).toBe(language.settingsShellPersonaDeleted)
        const outcome = await toast.action.run()
        expect(outcome.ok).toBe(true)
        expect(list().map((entry) => entry.id)).toEqual(['a', 'b'])
        expect(DBState.db.selectedPersona).toBe(1)
        expect(DBState.db.username).toBe('Bob')
        expect((await toast.action.run()).ok).toBe(false)
    })

    test('P-E9a: after deleting the open persona the editor shows the one in use; Undo does not pull the editor back', async () => {
        const target = mountPage()
        cardButton(target, 1).click()
        await settle()
        await confirmDelete(target)
        expect(list().map((entry) => entry.id)).toEqual(['a', 'c'])
        expect(nameField(target).value).toBe('Ann')
        expect(descField(target).value).toBe('Ann-prompt')
        cardButton(target, 1).click()
        await settle()
        expect(nameField(target).value).toBe('Cy')
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        await toast.action.run()
        flushSync()
        expect(list().map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
        expect(nameField(target).value).toBe('Cy')
    })

    test('P-E9a (no other card opened): after Undo the editor shows the persona in use', async () => {
        const target = mountPage()
        cardButton(target, 1).click()
        await settle()
        await confirmDelete(target)
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        await toast.action.run()
        flushSync()
        expect(nameField(target).value).toBe('Ann')
    })

    test('P-E9b: deleting the open persona in use shows the new first persona; Undo shows it again', async () => {
        seed([persona('x', 'Xi'), persona('a', 'Ann'), persona('y', 'Yo')], 1)
        const target = mountPage()
        expect(nameField(target).value).toBe('Ann')
        await confirmDelete(target)
        expect(DBState.db.selectedPersona).toBe(0)
        expect(nameField(target).value).toBe('Xi')
        expect(descField(target).value).toBe('Xi-prompt')
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        await toast.action.run()
        flushSync()
        expect(DBState.db.selectedPersona).toBe(1)
        expect(nameField(target).value).toBe('Ann')
        expect(descField(target).value).toBe('Ann-prompt')
    })

    test('P13: the delete dialog and its layer have no inert ancestor', async () => {
        const target = mountPage()
        buttonByText(editor(target), language.settingsShellPersonaDelete).click()
        await settle()
        expect(warnPart('primary').closest('[inert]')).toBeNull()
    })
})

describe('search and move (P6, P7)', () => {
    function many(count: number): RisuPersona[] {
        return Array.from({ length: count }, (_, index) => persona(`p${index}`, index === 3 ? 'Zed' : `N${index}`))
    }

    test('P6: the search field appears from 8 personas and filters by name, ignoring case', async () => {
        seed(many(7))
        const seven = mountPage()
        expect(seven.querySelector('[data-part="settings-persona-search"]')).toBeNull()
        seed(many(8))
        const target = mountPage()
        const field = target.querySelector<HTMLInputElement>('[data-part="settings-persona-search"]')!
        type(field, 'zE')
        expect(cards(target).length).toBe(1)
        expect(cards(target)[0].textContent).toContain('Zed')
    })

    test('P7: Alt+ArrowDown on a card moves it, keeps the active identity and announces the position', async () => {
        const target = mountPage()
        cardButton(target, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
        await settle()
        expect(list().map((entry) => entry.id)).toEqual(['b', 'a', 'c'])
        expect(DBState.db.selectedPersona).toBe(1)
        expect(target.querySelector('[role="status"]')?.textContent).toBe(language.settingsShellPersonaMoved('Ann', 2, 3))
    })

    test('P7: the card menu moves a persona up', async () => {
        const target = mountPage()
        menuButton(target, 2).click()
        await settle()
        menuItem(language.settingsShellPersonaUp).click()
        await settle()
        expect(list().map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
        expect(target.querySelector('[role="status"]')?.textContent).toBe(language.settingsShellPersonaMoved('Cy', 2, 3))
    })
})

describe('drag reorder (S3-1)', () => {
    const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
    const stubbed = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const
    let release: Mock<(id: number) => void>
    let frames: FrameRequestCallback[]
    let cancelFrame: Mock<(id: number) => void>

    beforeEach(() => {
        release = vi.fn<(id: number) => void>()
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
        Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => true })
        Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: release })
        frames = []
        cancelFrame = vi.fn<(id: number) => void>()
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
        vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { cancelFrame(id) })
    })

    afterEach(async () => {
        // A drag left open tears down through the stubbed capture API, so unmount before removing it.
        for (const app of mounted.splice(0)) await unmount(app)
        for (const name of stubbed) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
        vi.restoreAllMocks()
    })

    function ids(): Array<string | undefined> {
        return list().map((entry) => entry.id)
    }

    function handle(target: HTMLElement, index: number): HTMLElement {
        return cards(target)[index].querySelector<HTMLElement>('[data-part="settings-persona-drag"]')!
    }

    /** Stacks the cards in one column, 100 tall with a 10 gap, so card i spans [110 i, 110 i + 100]. */
    function stackCards(target: HTMLElement): void {
        cards(target).forEach((card, index) => {
            const top = index * 110
            card.getBoundingClientRect = () => ({ left: 0, right: 300, top, bottom: top + 100, width: 300, height: 100, x: 0, y: top, toJSON: () => ({}) })
        })
    }

    function pointer(type: string, y: number, init: { button?: number, id?: number } = {}): Event {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: init.button ?? 0 })
        Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 })
        return event
    }

    function fire(element: HTMLElement, type: string, y: number, init: { button?: number, id?: number } = {}): void {
        element.dispatchEvent(pointer(type, y, init))
        flushSync()
    }

    test('the handle is a pointer-only part: not focusable and hidden from assistive technology', () => {
        const target = mountPage()
        const handles = target.querySelectorAll('[data-part="settings-persona-drag"]')
        expect(handles.length).toBe(3)
        for (const part of handles) {
            expect(part.matches(FOCUSABLE)).toBe(false)
            expect(part.getAttribute('aria-hidden')).toBe('true')
        }
    })

    test('release writes once: nothing changes during the drag, then the card lands where the pointer is', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 160)
        expect(ids()).toEqual(['a', 'b', 'c'])
        fire(handle(target, 0), 'pointermove', 270)
        expect(ids()).toEqual(['a', 'b', 'c'])
        expect(DBState.db.selectedPersona).toBe(0)
        fire(handle(target, 0), 'pointerup', 270)
        await settle()
        expect(ids()).toEqual(['b', 'c', 'a'])
        expect(DBState.db.selectedPersona).toBe(2)
        expect(DBState.db.username).toBe('Ann')
        expect(target.querySelector('[role="status"]')?.textContent).toBe(language.settingsShellPersonaMoved('Ann', 3, 3))
    })

    test('the drop target follows the pointer back up, so the last position wins', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 2), 'pointerdown', 270)
        fire(handle(target, 2), 'pointermove', 50)
        fire(handle(target, 2), 'pointermove', 160)
        fire(handle(target, 2), 'pointerup', 160)
        await settle()
        expect(ids()).toEqual(['a', 'c', 'b'])
        expect(DBState.db.selectedPersona).toBe(0)
    })

    test('releasing over the starting card writes nothing and announces nothing', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 1), 'pointerdown', 160)
        fire(handle(target, 1), 'pointermove', 400)
        fire(handle(target, 1), 'pointermove', 150)
        fire(handle(target, 1), 'pointerup', 150)
        await settle()
        expect(ids()).toEqual(['a', 'b', 'c'])
        expect(target.querySelector('[role="status"]')?.textContent).toBe('')
    })

    test('pointercancel ends the drag without a write and releases the capture; a later release is inert', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 270)
        fire(handle(target, 0), 'pointercancel', 270)
        expect(release).toHaveBeenCalledWith(1)
        fire(handle(target, 0), 'pointerup', 270)
        await settle()
        expect(ids()).toEqual(['a', 'b', 'c'])
        expect(cancelFrame).toHaveBeenCalled()
    })

    test('losing the capture ends the drag without a write', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 270)
        fire(handle(target, 0), 'lostpointercapture', 270)
        fire(handle(target, 0), 'pointerup', 270)
        await settle()
        expect(ids()).toEqual(['a', 'b', 'c'])
    })

    test('unmounting mid-drag releases the capture and the frame and writes nothing', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 270)
        await unmount(mounted.pop()!)
        expect(release).toHaveBeenCalledWith(1)
        expect(cancelFrame).toHaveBeenCalled()
        expect(ids()).toEqual(['a', 'b', 'c'])
    })

    test('only the primary button starts a drag, and a second pointer does not steer it', async () => {
        const target = mountPage()
        stackCards(target)
        fire(handle(target, 0), 'pointerdown', 50, { button: 2 })
        fire(handle(target, 0), 'pointerup', 270, { button: 2 })
        expect(ids()).toEqual(['a', 'b', 'c'])
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 270, { id: 2 })
        fire(handle(target, 0), 'pointerup', 270, { id: 2 })
        await settle()
        expect(ids()).toEqual(['a', 'b', 'c'])
        fire(handle(target, 0), 'pointerup', 160)
        await settle()
        expect(ids()).toEqual(['b', 'a', 'c'])
    })

    test('a filtered list has no handles, and a single persona has none', () => {
        seed(Array.from({ length: 8 }, (_, index) => persona(`p${index}`, `N${index}`)))
        const target = mountPage()
        expect(target.querySelectorAll('[data-part="settings-persona-drag"]').length).toBe(8)
        type(target.querySelector<HTMLInputElement>('[data-part="settings-persona-search"]')!, 'n1')
        expect(target.querySelectorAll('[data-part="settings-persona-drag"]').length).toBe(0)
        seed([persona('only', 'Solo')])
        expect(mountPage().querySelectorAll('[data-part="settings-persona-drag"]').length).toBe(0)
    })

    test('near the bottom edge the scroll view advances each frame and the drop target follows; release stops the frames', async () => {
        const target = mountPage()
        stackCards(target)
        const view = { scrollTop: 0 }
        target.style.overflowY = 'auto'
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: 1000 })
        Object.defineProperty(target, 'clientHeight', { configurable: true, value: 400 })
        Object.defineProperty(target, 'scrollTop', { configurable: true, get: () => view.scrollTop, set: (value: number) => { view.scrollTop = value } })
        target.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 400, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) })
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 395)
        expect(frames.length).toBeGreaterThan(0)
        frames.shift()!(0)
        expect(view.scrollTop).toBeGreaterThan(0)
        expect(frames.length).toBeGreaterThan(0)
        const before = view.scrollTop
        frames.shift()!(0)
        expect(view.scrollTop).toBeGreaterThan(before)
        fire(handle(target, 0), 'pointerup', 395)
        await settle()
        expect(cancelFrame).toHaveBeenCalled()
        expect(ids()).toEqual(['b', 'c', 'a'])
    })

    test('in the middle of the view there is no scrolling', () => {
        const target = mountPage()
        stackCards(target)
        const view = { scrollTop: 0 }
        target.style.overflowY = 'auto'
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: 1000 })
        Object.defineProperty(target, 'clientHeight', { configurable: true, value: 400 })
        Object.defineProperty(target, 'scrollTop', { configurable: true, get: () => view.scrollTop, set: (value: number) => { view.scrollTop = value } })
        target.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 400, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) })
        fire(handle(target, 0), 'pointerdown', 50)
        fire(handle(target, 0), 'pointermove', 200)
        frames.shift()!(0)
        expect(view.scrollTop).toBe(0)
    })
})

describe('layout and Back (P8, P8b, P-MENU)', () => {
    test('P8: below 1024 a chosen card replaces the list; Back closes the editor and focus returns to the card', async () => {
        const target = mountPage(Page, 800)
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(true)
        cardButton(target, 1).click()
        await settle()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(false)
        expect(document.activeElement).toBe(editor(target))
        settingsShellBackStep()
        await settle()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(true)
        expect(document.activeElement).toBe(cardButton(target, 1))
        expect(get(settingsOpen)).toBe(true)
    })

    test('P8c: leaving the page clears its sub-level, so Back follows the shell order', async () => {
        const target = mountPage(Page, 800)
        cardButton(target, 1).click()
        await settle()
        expect(settingsShellBackSnapshot()).toContain('|sub')
        await unmount(mounted.pop()!)
        await settle()
        expect(settingsShellBackSnapshot()).not.toContain('|sub')
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
    })

    test('P8: at 1280 both panes show and there is no sub-level', () => {
        const target = mountPage(Page, 1280)
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(false)
        cardButton(target, 1).click()
        flushSync()
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
    })

    test('P8b: a resize to 1280 while drilled in shows both panes and Back closes Settings', async () => {
        const target = mountPage(Page, 800)
        cardButton(target, 1).click()
        await settle()
        setWidth(1280)
        await settle()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(false)
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
    })

    test('P-MENU: Escape closes only the card menu and never reaches the document; Back closes the menu, then the editor', async () => {
        const target = mountPage(Page, 800)
        cardButton(target, 1).click()
        await settle()
        const spy = vi.fn()
        document.addEventListener('keydown', spy)
        const opener = menuButton(target, 1)
        // the list is hidden while drilled in, so the menu opens from the card's own button
        opener.click()
        await settle()
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(document.querySelector('[role="menu"]')).toBeNull()
        expect(spy).not.toHaveBeenCalled()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(false)
        document.removeEventListener('keydown', spy)

        opener.click()
        await settle()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(document.querySelector('[role="menu"]')).toBeNull()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(false)
        settingsShellBackStep()
        await settle()
        expect(editor(target).parentElement?.classList.contains('hidden')).toBe(true)
    })

    test('P-MENU: the "+ Persona" menu consumes Escape and closes on Back', async () => {
        const target = mountPage()
        const spy = vi.fn()
        document.addEventListener('keydown', spy)
        const add = buttonByText(target, `+ ${language.settingsShellPersonaAdd}`)
        add.click()
        await settle()
        expect(menuItem(language.settingsShellPersonaNew).closest('[inert]')).toBeNull()
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(document.querySelector('[role="menu"]')).toBeNull()
        expect(spy).not.toHaveBeenCalled()
        document.removeEventListener('keydown', spy)
        add.click()
        await settle()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(document.querySelector('[role="menu"]')).toBeNull()
    })
})

describe('store-first mount (P9, P-F1a to P-F1d)', () => {
    test('P9: an external write shows without a reload', async () => {
        const target = mountPage()
        DBState.db.personas.push(persona('d', 'Dee'))
        await settle()
        expect(cards(target).length).toBe(4)
    })

    test('P-F1a: a mirror that leads the entry is adopted before the first paint and typing extends it', async () => {
        seed([persona('a', 'A', { personaPrompt: 'D1', note: 'n1' }), persona('b', 'Bob')])
        DBState.db.username = 'A2'
        DBState.db.personaPrompt = 'D2'
        DBState.db.userNote = 'n2'
        const target = mountPage()
        expect(cards(target)[0].textContent).toContain('A2')
        expect(cards(target)[0].textContent).toContain('n2')
        expect(descField(target).value).toBe('D2')
        type(descField(target), 'D2x')
        expect(list()[0].personaPrompt).toBe('D2x')
        expect(DBState.db.personaPrompt).toBe('D2x')
        buttonByText(editor(target), language.settingsShellPersonaExport).click()
        expect(exportPersona).toHaveBeenCalledWith(expect.objectContaining({ name: 'A2', personaPrompt: 'D2x' }))
    })

    test('P-F1b: two id-less personas render and get distinct ids', () => {
        seed([persona(undefined, 'Ann'), persona(undefined, 'Bob')])
        const target = mountPage()
        expect(cards(target).length).toBe(2)
        const ids = list().map((entry) => entry.id)
        expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(ids).size).toBe(2)
    })

    test('P-F1c: id-less personas written after mount render without a duplicate-key error', async () => {
        const target = mountPage()
        DBState.db.personas.push(persona(undefined, 'No1'), persona(undefined, 'No2'))
        await settle()
        expect(cards(target).length).toBe(5)
    })

    test('P-F1d: inside the keyed host the store is normalized before the first card renders', () => {
        seed([persona('a', 'A', { personaPrompt: 'D1' }), persona(undefined, 'Bob')])
        DBState.db.username = 'A2'
        const target = mountPage(Host)
        expect(cards(target)[0].textContent).toContain('A2')
        expect(list()[1].id).toBeTruthy()
    })
})

describe('import (P11, P11b)', () => {
    function item(name: string): PersonaImportItem {
        return { fileName: `${name}.png`, card: { name, personaPrompt: 'p', note: 'n' }, bytes: new Uint8Array([1]) }
    }

    test('P11: one file previews its card; confirming adds it, opens it and posts the done toast', async () => {
        vi.mocked(readPersonaFiles).mockResolvedValue([item('Imp')])
        vi.mocked(addPersonasFromPng).mockImplementation(async () => {
            DBState.db.personas.push(persona('imp', 'Imp'))
            return ['imp']
        })
        const target = mountPage()
        buttonByText(target, `+ ${language.settingsShellPersonaAdd}`).click()
        await settle()
        menuItem(language.settingsShellPersonaImportMenu).click()
        await settle()
        expect(document.querySelector('[data-part="pattern-warn-headline"]')?.textContent).toBe(language.settingsShellPersonaImportTitle)
        expect(document.querySelector('[data-part="pattern-warn-consequences"]')?.textContent).toContain('Imp')
        tapLate(warnPart('primary'))
        await settle()
        expect(list().length).toBe(4)
        expect(postToast).toHaveBeenCalledWith(expect.objectContaining({ text: language.settingsShellPersonaImportDone(1) }))
        expect(nameField(target).value).toBe('Imp')
    })

    test('P11: several files show the batch summary', async () => {
        vi.mocked(readPersonaFiles).mockResolvedValue([item('A1'), item('A2'), { fileName: 'bad.png', card: null, bytes: new Uint8Array([1]) }])
        const target = mountPage()
        buttonByText(target, `+ ${language.settingsShellPersonaAdd}`).click()
        await settle()
        menuItem(language.settingsShellPersonaImportMenu).click()
        await settle()
        expect(document.querySelector('[data-part="pattern-warn-consequences"]')?.textContent).toContain(language.settingsShellPersonaImportSummary(2, 1))
    })

    test('P11b: a failing batch import shows the error, closes the dialog and adds nothing', async () => {
        const failure = new Error('disk full')
        vi.mocked(readPersonaFiles).mockResolvedValue([item('A1'), item('A2')])
        vi.mocked(addPersonasFromPng).mockRejectedValue(failure)
        const target = mountPage()
        buttonByText(target, `+ ${language.settingsShellPersonaAdd}`).click()
        await settle()
        menuItem(language.settingsShellPersonaImportMenu).click()
        await settle()
        tapLate(warnPart('primary'))
        await settle()
        expect(alertError).toHaveBeenCalledWith(failure)
        expect(document.querySelector('[data-part="pattern-warn-root"]')).toBeNull()
        expect(list().length).toBe(3)
    })
})
