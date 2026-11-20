// @vitest-environment jsdom
/**
 * The radio rows of the Settings shell display and input pages (asset width, reduced motion, chat theme, new-message
 * button) are named through aria-label equal to the visible choice text; none uses aria-labelledby. REAL: the four
 * row components, the motion preferences and the setting registry entry. MOCKED: `stores.svelte` (plain stand-ins).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { SettingContext } from '../../ts/setting/types'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
    } as unknown as typeof import('../../ts/stores.svelte')
})

import { language } from '../../lang'
import { settingsLabel } from '../../ts/settingsShell/settingsPages'
import AssetWidthRow from './display/AssetWidthRow.svelte'
import ReducedMotionRow from './display/ReducedMotionRow.svelte'
import ThemeCards from './display/ThemeCards.svelte'
import NewMessageButtonRow from './input/NewMessageButtonRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(component: typeof AssetWidthRow, db: Record<string, unknown>): HTMLElement {
    const ctx = { db: db as unknown as Database } as SettingContext
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target, props: { ctx } }))
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

const radios = (target: HTMLElement) => [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
const labelText = (radio: HTMLInputElement) => radio.closest('label')!.querySelector('span:not([aria-hidden])')!.textContent!.trim()

describe('Settings shell radio rows form control names', () => {
    test('AssetWidthRow: each choice is named by its visible text', () => {
        const target = show(AssetWidthRow, { assetWidth: -1 })
        expect(radios(target).map((radio) => radio.getAttribute('aria-label'))).toEqual([language.settingsShellAssetUnlimited, language.settingsShellAssetHidden, language.settingsShellAssetCustom])
        expect(radios(target).every((radio) => !radio.hasAttribute('aria-labelledby') && controlName(radio) === labelText(radio))).toBe(true)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('ReducedMotionRow: each choice is named by its visible text', () => {
        const target = show(ReducedMotionRow, {})
        expect(radios(target).map((radio) => radio.getAttribute('aria-label'))).toEqual([language.settingsShellReducedMotionSystem, language.settingsShellReducedMotionOn, language.settingsShellReducedMotionOff])
        expect(radios(target).every((radio) => !radio.hasAttribute('aria-labelledby') && controlName(radio) === labelText(radio))).toBe(true)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('ThemeCards: each card radio is named by the theme name, not its description', () => {
        const target = show(ThemeCards, { theme: '' })
        const names = language.settingsShellThemeNames as Record<string, string>
        expect(radios(target).map((radio) => radio.getAttribute('aria-label'))).toEqual(['standard', 'waifu', 'mobilechat', 'cardboard', 'customHTML'].map((key) => names[key]))
        expect(radios(target).every((radio) => !radio.hasAttribute('aria-labelledby'))).toBe(true)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('NewMessageButtonRow: each of the six placements is named by its visible text', () => {
        const target = show(NewMessageButtonRow, { newMessageButtonStyle: 'bottom-center' })
        const boxes = radios(target)
        expect(boxes).toHaveLength(6)
        for (const radio of boxes) {
            expect(radio.getAttribute('aria-label')).toBe(radio.closest('label')!.textContent!.trim())
            expect(radio.getAttribute('aria-label')).not.toBe('')
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
        }
        expect(boxes[0].getAttribute('aria-label')).toBe(settingsLabel('newMessageButtonBottomCenter'))
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
