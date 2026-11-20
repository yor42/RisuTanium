// @vitest-environment jsdom

/**
 * `CustomSidebar.svelte`: the persona row's pin button is named, hides its glyph and reports whether the
 * persona is bound to the chat through `aria-pressed`. Mounts the REAL component; the stores, the model
 * list and the persona helpers are mocks, because the row only reads the bound persona.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const persona = vi.hoisted(() => ({ bound: false }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
        selectedCharID: writable(0),
        loadoutModalStore: { open: false },
        openPersonaList: writable(false),
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/lite', () => ({ isLite: writable(false) }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({}) }))
vi.mock('../UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/util', () => ({
    checkPersonaBinded: () => (persona.bound ? 'p-1' : ''),
    livePersona: (id: string) => (id ? { id: 'p-1', name: 'Bound persona', note: '' } : undefined),
    getUserName: () => 'User',
}))

import { language } from 'src/lang'
import { controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import CustomSidebar from './CustomSidebar.svelte'

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

function show(bound: boolean): void {
    persona.bound = bound
    DBState.db = {
        customSidebarItems: [{ id: 'row-persona', type: 'persona', label: 'persona' }],
        characters: [{ chatPage: 0, chats: [{ bindedPersona: bound ? 'p-1' : '' }] }],
        personas: [{ id: 'p-1', name: 'Bound persona', note: '' }],
        selectedPersona: 0,
        username: 'User',
        botPresets: [],
    } as unknown as Database
    target = document.createElement('div')
    document.body.append(target)
    app = mount(CustomSidebar, { target, props: {} })
    flushSync()
}

function pin(): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll<HTMLButtonElement>('button button'))[0]
    if (!found) expect.fail('no pin button')
    return found
}

afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = null
    target?.remove()
})

describe('CustomSidebar persona pin', () => {
    test('regression reproducer: the pin button is named bindPersona and its glyph is hidden', () => {
        show(false)
        expect(controlName(pin())).toBe(language.bindPersona)
        expect(exposedIcons(target)).toEqual([])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: aria-pressed follows the bound state, before and after a click', () => {
        show(false)
        expect(pin().getAttribute('aria-pressed')).toBe('false')
        pin().click()
        flushSync()
        const bound = (DBState.db.characters[0] as unknown as { chats: Array<{ bindedPersona: string }> }).chats[0].bindedPersona
        expect(bound).toBe('p-1')
    })

    test('regression reproducer: a bound persona reports aria-pressed true', () => {
        show(true)
        expect(pin().getAttribute('aria-pressed')).toBe('true')
    })
})
