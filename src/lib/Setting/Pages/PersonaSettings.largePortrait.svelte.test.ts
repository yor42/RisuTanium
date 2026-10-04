// @vitest-environment happy-dom

/**
 * The portrait checkbox of `PersonaSettings.svelte`.
 *
 * Invariants pinned here:
 *  - showing the page for a persona that lacks `largePortrait` leaves the persona without
 *    that key, so nothing marks it changed, and the box shows unchecked;
 *  - toggling the box writes true, then false, on the selected persona only;
 *  - a stored true displays checked.
 *
 * Dirtiness is asserted through the object shape, since the change-tracking effects are not
 * mounted. The stores, character, persona, alert and util modules and the drag library are
 * stubs; the form components, `lang` and `warnOnReject` are real.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return { DBState: state, selIdState: selId } as unknown as typeof import('src/ts/stores.svelte')
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

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import PersonaSettings from './PersonaSettings.svelte'

type PersonaFixture = Record<string, unknown>

function setupDb(first: PersonaFixture = {}): void {
    DBState.db = {
        username: 'me',
        userNote: '',
        personaNote: false,
        personaPrompt: '',
        userIcon: 'user.png',
        selectedPersona: 0,
        personas: [
            { name: 'one', icon: 'one.png', personaPrompt: '', note: '', ...first },
            { name: 'two', icon: 'two.png', personaPrompt: '', note: '' },
        ],
    } as never
}

function persona(index: number): Record<string, unknown> {
    return (DBState.db as unknown as { personas: Record<string, unknown>[] }).personas[index]
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountPage(): Promise<HTMLElement> {
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

function portraitBox(root: HTMLElement): HTMLInputElement {
    const label = [...root.querySelectorAll('label')].find((l) => l.textContent?.includes(language.largePortrait))
    expect(label, 'the portrait checkbox label').toBeDefined()
    return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
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

describe('the persona portrait checkbox', () => {
    test('regression reproducer: showing the page for a persona without largePortrait does not add the key', async () => {
        setupDb()

        const root = await mountPage()

        expect(portraitBox(root).checked).toBe(false)
        expect(Object.keys(persona(0))).not.toContain('largePortrait')
    })

    test('guard: toggling the box writes true and then false on the selected persona only', async () => {
        setupDb()

        const root = await mountPage()
        const box = portraitBox(root)

        box.click()
        flushSync()
        expect(persona(0).largePortrait).toBe(true)
        expect(box.checked).toBe(true)

        box.click()
        flushSync()
        expect(persona(0).largePortrait).toBe(false)
        expect(box.checked).toBe(false)
        expect(Object.keys(persona(1))).not.toContain('largePortrait')
    })

    test('guard: a stored true displays checked', async () => {
        setupDb({ largePortrait: true })

        const root = await mountPage()

        expect(portraitBox(root).checked).toBe(true)
        expect(persona(0).largePortrait).toBe(true)
    })
})
