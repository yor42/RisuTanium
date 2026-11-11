// @vitest-environment jsdom

/**
 * The mode group on the Settings page and the Show-all confirm it hosts, with the real SettingsShellPage,
 * ModeVisibilityGroup, ModeVisibilityConfirm, PatternWarning and homeModes: the group sits first in the Display view
 * and nowhere else; the confirm is a sibling of the scroll column; Cancel, Escape and Back write nothing and return
 * focus; Confirm applies show-all. All guards for new behaviour. The scroll-memory scenarios live in
 * `SettingsShellPage.scenarios.test-helpers.svelte.ts` and also run under the async scheduler in
 * `SettingsShellPage.asyncOrder.svelte.test.ts`.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores, `alertStore` read by the Back dispatcher), `alertBack`, and the legacy Settings pages
 * (empty stubs). The legacy Display page is not modified by this change.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { language } from '../../lang'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { DBState } from '../../ts/stores.svelte'
import SettingsShellPage from './SettingsShellPage.svelte'
import { registerSettingsScrollMemorySuite } from './SettingsShellPage.scenarios.test-helpers.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function show(index: number): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(SettingsShellPage, { target, props: { index, phone: false, scrollMemory: new Map<number, number>() } }))
    flushSync()
    return target
}

const confirmLayer = () => document.querySelector<HTMLElement>('[data-part="pattern-layer"]')
const showAllButton = (target: HTMLElement) => target.querySelector<HTMLElement>('[data-part="mode-show-all"]')!
const cancelButton = () => document.querySelector<HTMLElement>('[data-part="pattern-warn-cancel"]')!
const primaryButton = () => document.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!
const pageMain = (target: HTMLElement) => target.querySelector('[data-part="settings-page"]')

async function openConfirm(): Promise<HTMLElement> {
    DBState.db = { visibleModes: ['hybrid'], hideUnusedModes: true } as unknown as Database
    const target = show(3)
    showAllButton(target).click()
    await settle()
    expect(confirmLayer()).not.toBeNull()
    return target
}

beforeEach(() => {
    resetBackHandlersForTests()
    DBState.db = { visibleModes: ['rp', 'hybrid', 'utility'], hideUnusedModes: false } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('placement', () => {
    test('the group is the first element of the Display view', () => {
        const target = show(3)
        const view = target.querySelector('[data-part="settings-view"]')!
        expect(view.firstElementChild?.getAttribute('data-part')).toBe('mode-visibility')
        expect(view.querySelectorAll('[data-part="mode-visibility"]')).toHaveLength(1)
    })

    test('no other page renders the group', () => {
        for (const index of [0, 1, 2, 4, 6, 10, 11, 12, 13, 14, 15]) {
            const target = show(index)
            expect(target.querySelector('[data-part="mode-visibility"]')).toBeNull()
        }
    })
})

describe('the Show-all confirm', () => {
    test('opens outside the scroll column and the keyed view, with Cancel focused and the hidden modes named', async () => {
        const target = await openConfirm()
        const layer = confirmLayer()!
        expect(layer.closest('[data-part="settings-page-scroll"]')).toBeNull()
        expect(layer.closest('[data-part="settings-view"]')).toBeNull()
        expect(pageMain(target)!.contains(layer)).toBe(true)
        expect(layer.querySelector('[data-pattern-severity="confirm"]')).not.toBeNull()
        expect(layer.textContent).toContain(language.settingsShellModesConfirmBody(`${language.settingsShellModesNameRp}, ${language.settingsShellModesNameUtility}`))
        expect(document.activeElement).toBe(cancelButton())
        expect(target.querySelector('[data-part="settings-page-scroll"]')!.hasAttribute('inert')).toBe(true)
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(true)
    })

    test('Cancel closes it with no write, returns focus to the show-all button and keeps the page', async () => {
        const target = await openConfirm()
        cancelButton().click()
        await settle()
        expect(confirmLayer()).toBeNull()
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(true)
        expect(document.activeElement).toBe(showAllButton(target))
        expect(pageMain(target)).not.toBeNull()
        expect(target.querySelector('[data-part="settings-page-scroll"]')!.hasAttribute('inert')).toBe(false)
    })

    test('Escape closes it with no write, returns focus and keeps the page mounted', async () => {
        const target = await openConfirm()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(confirmLayer()).toBeNull()
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(true)
        expect(document.activeElement).toBe(showAllButton(target))
        expect(pageMain(target)).not.toBeNull()
    })

    test('Back closes it with no write, returns focus and keeps the page mounted', async () => {
        const target = await openConfirm()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(confirmLayer()).toBeNull()
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(true)
        expect(document.activeElement).toBe(showAllButton(target))
        expect(pageMain(target)).not.toBeNull()
    })

    test('Confirm writes all three modes and hiding off, then focus returns', async () => {
        const target = await openConfirm()
        primaryButton().click()
        await settle()
        expect(confirmLayer()).toBeNull()
        expect(DBState.db.visibleModes).toEqual(['rp', 'hybrid', 'utility'])
        expect(DBState.db.hideUnusedModes).toBe(false)
        expect(document.activeElement).toBe(showAllButton(target))
        expect(showAllButton(target).getAttribute('aria-disabled')).toBe('true')
    })
})

registerSettingsScrollMemorySuite()
