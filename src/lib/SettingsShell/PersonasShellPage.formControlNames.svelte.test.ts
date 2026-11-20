// @vitest-environment jsdom
/**
 * The large-portrait checkbox of the native Personas editor is named through aria-label equal to its visible text
 * (CheckInput `label`). REAL: PersonasShellPage, `personaList`. MOCKED: as the sibling page test does (a real `$state`
 * DBState, the persona file I/O, image lookups, alerts and the toast host).
 * Excluded from the assertion, with the reason: the editor's name, note and description fields are raw inputs named by
 * `for` labels, which is outside the A3c plan list (reported as a follow-up).
 */
import 'src/ts/polyfill'
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { controls, controlName } from '../a11yNames.test-helpers'

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
vi.mock('../../ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: async () => 'background-image: none', getIf: () => null, dispose: () => {} }),
}))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
vi.mock('../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { language } from '../../lang'
import { DBState } from '../../ts/stores.svelte'
import Page from './PersonasShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('PersonasShellPage form control names', () => {
    test('the large-portrait checkbox carries aria-label equal to its visible text and no aria-labelledby', () => {
        const personas = [{ name: 'Ann', icon: '', personaPrompt: 'p', note: 'n', id: 'p1' }]
        DBState.db = { personas, selectedPersona: 0, username: 'Ann', userIcon: '', personaPrompt: 'p', userNote: 'n', characters: [] } as unknown as Database
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
        window.dispatchEvent(new Event('resize'))
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push(mount(Page, { target }))
        flushSync()
        const editor = target.querySelector<HTMLElement>('[data-part="settings-persona-editor"]')!
        const box = editor.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(box).not.toBeNull()
        expect(box.getAttribute('aria-label')).toBe(language.settingsShellPersonaLarge)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe(language.settingsShellPersonaLarge)
        const unnamedChoices = controls(target, { fields: true }).filter((el) => el.matches('input[type="checkbox"], input[type="radio"]') && controlName(el) === '')
        expect(unnamedChoices).toEqual([])
    })
})
