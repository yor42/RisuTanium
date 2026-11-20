// @vitest-environment jsdom

/**
 * `PersonaSettings.svelte`: the name, note and description fields are named by their visible labels,
 * the large-portrait checkbox is named by its visible child text, the add button is named, and the
 * persona tiles use scheme tokens. Mounts the REAL page with the real shared inputs; stores, persona,
 * character, alert and util modules and the drag library are stubs (as in
 * `PersonaSettings.largePortrait.svelte.test.ts`), and the highlighter, size and hotkey modules are
 * mocks of `TextAreaInput.ime.svelte.test.ts`.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/persona'), () => ({
    changeUserPersona: vi.fn(),
    exportUserPersona: vi.fn(),
    importUserPersona: vi.fn(),
    saveUserPersona: vi.fn(),
    selectUserImg: vi.fn(),
}) as unknown as typeof import('src/ts/persona'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => '0'),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: {},
}) as unknown as typeof import('src/ts/util'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: { create: vi.fn(() => ({ destroy: () => {} })) },
}))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/platform', () => ({
    isMobile: false,
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlDescription, controlName, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PersonaSettings from './PersonaSettings.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountPage(): Promise<HTMLElement> {
    DBState.db = {
        username: 'me',
        userNote: '',
        personaPrompt: '',
        hotkeys: [],
        longPressToPopupEditor: false,
        userIcon: 'user.png',
        selectedPersona: 0,
        personas: [
            { name: 'one', icon: '', personaPrompt: '', note: '' },
            { name: 'two', icon: '', personaPrompt: '', note: '' },
        ],
    } as never
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(PersonaSettings, { target }))
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return target
}

function fieldNamed(root: HTMLElement, label: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        .find((el) => controlName(el) === label)
    if (!found) expect.fail('no field named ' + label)
    return found
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
})

describe('PersonaSettings accessible names and colours', () => {
    test('regression reproducer: the name, note and description fields are named by their labels', async () => {
        const root = await mountPage()
        for (const label of [language.name, language.note, language.description]) {
            const field = fieldNamed(root, label)
            expect(controlDescription(field).startsWith(label)).toBe(true)
        }
    })

    test('regression reproducer: the large-portrait checkbox is named by its visible text', async () => {
        const root = await mountPage()
        const labelled = Array.from(root.querySelectorAll('input[type="checkbox"]'))
        expect(labelled.map(controlName)).toEqual([language.largePortrait])
    })

    test('regression reproducer: the add persona button is named', async () => {
        const root = await mountPage()
        const add = root.querySelector('div.flex.justify-center.items-center.ml-2.mr-2 button') as HTMLButtonElement
        expect(controlName(add)).toBe(language.add)
        expect(add.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    test('regression reproducer: the persona tiles are named and expose the selection, and no control or field is unnamed', async () => {
        const root = await mountPage()
        expect(unnamedControls(root, { fields: true })).toEqual([])
        const tiles = Array.from(root.querySelectorAll<HTMLElement>('[data-risu-idx]'))
        expect(tiles.map(controlName)).toEqual(['one', 'two'])
        expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
        const icon = Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => controlName(b) === language.chooseIconImage)
        expect(icon).toBeDefined()
    })

    test('regression reproducer: the persona tiles use scheme tokens instead of palette hovers', async () => {
        const root = await mountPage()
        // The danger Button and the shared checkbox keep palette classes of their own primitives.
        const primitives = [/^bg-red-700$/, /^border-red-600$/, /^focus:ring-red-600$/, /^hover:bg-red-600$/, /^hover:border-gray-300$/, /^text-gray-300$/]
        expect(paletteClasses(root, { allow: primitives })).toEqual([])
        expect(root.querySelector('.bg-textcolor2.hover\\:text-textcolor')).not.toBeNull()
    })
})
