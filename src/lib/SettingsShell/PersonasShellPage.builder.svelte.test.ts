// @vitest-environment jsdom

/**
 * The guided persona builder inside the real Personas page over real `personaList` helpers. Mocked: the
 * same collaborators as PersonasShellPage.svelte.test.ts (stores, persona file I/O, image lookups, toast host).
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, RisuPersona } from '../../ts/storage/database.svelte'

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
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { selectUserImg } from '../../ts/persona'
import { buildPersonaCard, parsePersonaCard } from '../../ts/personaCard'
import { Buffer } from 'buffer'
import { setSettingsSubLevel, settingsShellBackStep } from '../../ts/settingsShell/settingsNavigation'
import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { postToast, postUndoToast } from '../../ts/toast/toastHost.svelte'
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

function mountPage(component: typeof Page = Page, width = 1280): HTMLElement {
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

function builderRoot(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-persona-builder]')
}

function stepOf(target: HTMLElement): string | null {
    return target.querySelector('[data-persona-builder-step]')?.getAttribute('data-persona-builder-step') ?? null
}

function field(target: HTMLElement, labelText: string): HTMLInputElement | HTMLTextAreaElement {
    const label = Array.from(target.querySelectorAll<HTMLLabelElement>('[data-persona-builder] label')).find((entry) => entry.textContent?.trim() === labelText)
    if (!label) throw new Error(`no label ${labelText}`)
    return document.getElementById(label.htmlFor) as HTMLInputElement | HTMLTextAreaElement
}

function footerButton(target: HTMLElement, text: string): HTMLButtonElement {
    return buttonByText(target.querySelector<HTMLElement>('[data-persona-builder-footer]')!, text)
}

async function openBuilder(target: HTMLElement): Promise<void> {
    buttonByText(target, `+ ${language.settingsShellPersonaAdd}`).click()
    await settle()
    menuItem(language.settingsShellPersonaGuided).click()
    await settle()
}

async function press(button: HTMLElement): Promise<void> {
    button.click()
    await settle()
}

async function answer(part: 'primary' | 'cancel'): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    tapLate(warnPart(part))
    await settle()
}

const labels = {
    appearance: language.settingsShellPersonaBuilderAppearance,
    personality: language.settingsShellPersonaBuilderPersonality,
    background: language.settingsShellPersonaBuilderBackground,
}

beforeEach(() => {
    vi.mocked(postUndoToast).mockClear()
    vi.mocked(postToast).mockClear()
    vi.mocked(selectUserImg).mockClear()
    resetBackHandlersForTests()
    settingsOpen.set(true)
    SettingsMenuIndex.set(12)
    seed([persona('a', 'Ann'), persona('b', 'Bob')])
})

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    setWidth(1280)
})

describe('guided persona builder', () => {
    test('a full run writes name, description and leaves the persona not in use', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        expect(list().length).toBe(3)
        const made = list()[2]
        expect(made.name).toBe(language.settingsShellPersonaNewName)
        expect(made.personaPrompt).toBe('')
        expect(stepOf(target)).toBe('who')

        type(field(target, language.settingsShellPersonaName), '한울')
        expect(made.name).toBe('한울')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        expect(stepOf(target)).toBe('about')
        type(field(target, language.settingsShellPersonaBuilderAppearance), '  키가 크다  ')
        type(field(target, language.settingsShellPersonaBuilderBackground), '해안 출신')
        type(field(target, language.settingsShellPersonaBuilderOther), '말투는 담백하다')
        expect(made.personaPrompt).toBe('')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))

        expect(stepOf(target)).toBe('finish')
        const expected = `${labels.appearance}: 키가 크다\n${labels.background}: 해안 출신\n말투는 담백하다`
        expect(made.personaPrompt).toBe(expected)
        expect(field(target, language.settingsShellPersonaDesc).value).toBe(expected)
        expect(target.textContent).toContain(language.settingsShellPersonaBuilderUseHint)

        type(field(target, language.settingsShellPersonaDesc), `${expected}\n끝`)
        expect(made.personaPrompt).toBe(`${expected}\n끝`)
        await press(footerButton(target, language.settingsShellPersonaBuilderCreate))
        expect(builderRoot(target)).toBeNull()
        expect(nameField(target).value).toBe('한울')
        expect(list().length).toBe(3)
        expect(DBState.db.selectedPersona).toBe(0)
        expect(made.icon).toBe('')
    })

    test('the mirror fields follow the built persona once it is in use', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        type(field(target, language.settingsShellPersonaName), 'Mira')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        type(field(target, language.settingsShellPersonaBuilderPersonality), 'calm')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        await press(footerButton(target, language.settingsShellPersonaBuilderCreate))
        await press(buttonByText(editor(target), language.settingsShellPersonaUse))
        expect(DBState.db.selectedPersona).toBe(2)
        expect(DBState.db.username).toBe('Mira')
        expect(DBState.db.personaPrompt).toBe(`${labels.personality}: calm`)
    })

    test('skipping every step leaves one default-named persona with an empty prompt', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        await press(footerButton(target, language.settingsShellPersonaBuilderCreate))
        expect(list().length).toBe(3)
        expect(list()[2]).toMatchObject({ name: language.settingsShellPersonaNewName, icon: '', personaPrompt: '' })
        expect(builderRoot(target)).toBeNull()
    })

    test('the portrait button hands the new persona id to the picture picker', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        await press(target.querySelector<HTMLElement>('[data-persona-builder] button[aria-label]')!)
        expect(selectUserImg).toHaveBeenCalledWith(list()[2].id)
    })

    test('Back goes one step and leaves the builder from step 1; the step heading takes focus', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        expect(document.activeElement).toBe(target.querySelector('[data-step-heading]'))
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        expect(target.querySelector('[data-persona-builder-progress]')?.textContent).toBe(language.settingsShellPersonaBuilderProgress(2, 3, language.settingsShellPersonaBuilderStep2))
        expect(document.activeElement).toBe(target.querySelector('[data-step-heading]'))
        await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
        expect(stepOf(target)).toBe('who')
        await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
        expect(builderRoot(target)).toBeNull()
        expect(list().length).toBe(2)
    })

    test('the footer buttons are 44 px targets', async () => {
        const target = mountPage(Page, 390)
        await openBuilder(target)
        const buttons = Array.from(target.querySelectorAll<HTMLElement>('[data-persona-builder-footer] button'))
        expect(buttons.length).toBeGreaterThanOrEqual(3)
        for (const button of buttons) expect(button.classList.contains('min-h-11')).toBe(true)
        expect(target.querySelector('[data-persona-builder-footer]')?.classList.contains('sticky')).toBe(true)
    })

    describe('cancel', () => {
        test('an untouched persona is removed with an undo toast', async () => {
            const target = mountPage(Page, 1280)
            await openBuilder(target)
            await press(footerButton(target, language.cancel))
            expect(list().map((entry) => entry.id)).toEqual(['a', 'b'])
            expect(postUndoToast).toHaveBeenCalledTimes(1)
            const toast = vi.mocked(postUndoToast).mock.calls[0][0]
            expect(toast.text).toBe(language.settingsShellPersonaDeleted)
            expect(builderRoot(target)).toBeNull()
        })

        test('after typing it asks, and Delete removes the persona', async () => {
            const target = mountPage(Page, 1280)
            await openBuilder(target)
            type(field(target, language.settingsShellPersonaName), 'Half')
            await press(footerButton(target, language.cancel))
            expect(list().length).toBe(3)
            expect(document.body.textContent).toContain(language.settingsShellPersonaBuilderDiscardTitle)
            await answer('primary')
            expect(list().length).toBe(2)
            expect(postUndoToast).toHaveBeenCalledTimes(1)
        })

        test('after typing it asks, and Keep leaves the persona and opens it in the editor', async () => {
            const target = mountPage(Page, 1280)
            await openBuilder(target)
            type(field(target, language.settingsShellPersonaName), 'Half')
            await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
            await answer('cancel')
            expect(list().length).toBe(3)
            expect(list()[2].name).toBe('Half')
            expect(builderRoot(target)).toBeNull()
            expect(nameField(target).value).toBe('Half')
            expect(postUndoToast).not.toHaveBeenCalled()
        })
    })

    describe('step 2 answers not yet in the persona', () => {
        async function typeAboutOnly(target: HTMLElement): Promise<void> {
            await openBuilder(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            type(field(target, language.settingsShellPersonaBuilderPersonality), 'calm')
        }

        test('cancel asks instead of silently removing a persona whose answers are only typed', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await press(footerButton(target, language.cancel))
            expect(document.body.textContent).toContain(language.settingsShellPersonaBuilderDiscardTitle)
            expect(list().length).toBe(3)
            expect(postUndoToast).not.toHaveBeenCalled()
        })

        test('Keep writes the typed answers into the empty description', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await press(footerButton(target, language.cancel))
            await answer('cancel')
            expect(list()[2].personaPrompt).toBe(`${labels.personality}: calm`)
            expect(descField(target).value).toBe(`${labels.personality}: calm`)
        })

        test('choosing another card keeps the typed answers in the persona', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await press(cardButton(target, 0))
            expect(builderRoot(target)).toBeNull()
            expect(list()[2].personaPrompt).toBe(`${labels.personality}: calm`)
        })

        test('unmounting the page keeps the typed answers in the persona', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await unmount(mounted.pop()!)
            expect(list().length).toBe(3)
            expect(list()[2].personaPrompt).toBe(`${labels.personality}: calm`)
        })

        test('a step 3 text the person emptied is not refilled on Create', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            type(field(target, language.settingsShellPersonaDesc), '')
            await press(footerButton(target, language.settingsShellPersonaBuilderCreate))
            expect(list()[2].personaPrompt).toBe('')
        })

        test('a typed step 3 text is not overwritten by leaving', async () => {
            const target = mountPage(Page, 1280)
            await typeAboutOnly(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            type(field(target, language.settingsShellPersonaDesc), 'mine')
            await press(cardButton(target, 0))
            expect(list()[2].personaPrompt).toBe('mine')
        })
    })

    describe('recomposing step 3', () => {
        async function reachFinish(target: HTMLElement): Promise<void> {
            await openBuilder(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            type(field(target, language.settingsShellPersonaBuilderPersonality), 'calm')
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        }

        test('a text never hand-edited is recomposed without asking', async () => {
            const target = mountPage(Page, 1280)
            await reachFinish(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
            type(field(target, language.settingsShellPersonaBuilderPersonality), 'loud')
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            expect(document.querySelector('[data-part="pattern-warn-primary"]')).toBeNull()
            expect(list()[2].personaPrompt).toBe(`${labels.personality}: loud`)
        })

        test('going back and forward without a change keeps a hand-edited text and does not ask', async () => {
            const target = mountPage(Page, 1280)
            await reachFinish(target)
            type(field(target, language.settingsShellPersonaDesc), 'my own words')
            await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            expect(document.querySelector('[data-part="pattern-warn-primary"]')).toBeNull()
            expect(list()[2].personaPrompt).toBe('my own words')
        })

        test('a changed field over a hand-edited text asks; keeping leaves the edit', async () => {
            const target = mountPage(Page, 1280)
            await reachFinish(target)
            type(field(target, language.settingsShellPersonaDesc), 'my own words')
            await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
            type(field(target, language.settingsShellPersonaBuilderPersonality), 'loud')
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            expect(document.body.textContent).toContain(language.settingsShellPersonaBuilderReplaceTitle)
            expect(list()[2].personaPrompt).toBe('my own words')
            await answer('cancel')
            expect(stepOf(target)).toBe('finish')
            expect(list()[2].personaPrompt).toBe('my own words')
        })

        test('a changed field over a hand-edited text asks; replacing writes the new composition', async () => {
            const target = mountPage(Page, 1280)
            await reachFinish(target)
            type(field(target, language.settingsShellPersonaDesc), 'my own words')
            await press(footerButton(target, language.settingsShellPersonaBuilderPrev))
            type(field(target, language.settingsShellPersonaBuilderPersonality), 'loud')
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            await answer('primary')
            expect(list()[2].personaPrompt).toBe(`${labels.personality}: loud`)
        })
    })

    describe('Enter on the name field', () => {
        function enterKey(input: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
            input.dispatchEvent(event)
            flushSync()
            return event
        }

        test('Enter during an IME composition does not advance', async () => {
            const target = mountPage(Page, 390)
            await openBuilder(target)
            const input = field(target, language.settingsShellPersonaName)
            enterKey(input, { isComposing: true })
            enterKey(input, { keyCode: 229 })
            await settle()
            expect(stepOf(target)).toBe('who')
        })

        test('Enter after the composition has ended advances', async () => {
            const target = mountPage(Page, 390)
            await openBuilder(target)
            const event = enterKey(field(target, language.settingsShellPersonaName), {})
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(stepOf(target)).toBe('about')
        })

        test('Enter in a multi-line field never advances', async () => {
            const target = mountPage(Page, 390)
            await openBuilder(target)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            enterKey(field(target, language.settingsShellPersonaBuilderAppearance), {})
            await settle()
            expect(stepOf(target)).toBe('about')
        })
    })

    describe('phone back', () => {
        test('Settings Back goes one step, then leaves the builder, and the list returns', async () => {
            const target = mountPage(Page, 390)
            await openBuilder(target)
            expect(target.querySelector('[data-persona-root] > div')?.classList.contains('hidden')).toBe(true)
            await press(footerButton(target, language.settingsShellPersonaBuilderNext))
            settingsShellBackStep()
            await settle()
            expect(stepOf(target)).toBe('who')
            settingsShellBackStep()
            await settle()
            expect(builderRoot(target)).toBeNull()
            expect(list().length).toBe(2)
            expect(target.querySelector('[data-persona-root] > div')?.classList.contains('hidden')).toBe(false)
        })
    })

    test('a built persona exports and re-reads unchanged', async () => {
        const target = mountPage(Page, 1280)
        await openBuilder(target)
        type(field(target, language.settingsShellPersonaName), 'Mira')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        type(field(target, language.settingsShellPersonaBuilderOther), 'plain talk')
        await press(footerButton(target, language.settingsShellPersonaBuilderNext))
        const made = list()[2]
        const card = buildPersonaCard(made)
        const parsed = parsePersonaCard(Buffer.from(JSON.stringify(card), 'utf-8').toString('base64'))
        expect(parsed).toMatchObject({ name: 'Mira', personaPrompt: 'plain talk' })
    })
})
