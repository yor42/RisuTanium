// @vitest-environment jsdom

/**
 * The Display "Seasonal logo" switch: it shows the device-local choice, writes it through the prefs module and
 * is offered on the Display page. Each test names the defect it guards.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { SEASONAL_LOGO_KEY, reloadSeasonalPrefs, seasonalLogoEnabled, setSeasonalLogoEnabled } from 'src/ts/seasonal/seasonalPrefs.svelte'
import SeasonalLogoToggle from './SeasonalLogoToggle.svelte'

let instances: unknown[] = []

function render(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(SeasonalLogoToggle, { target }))
    flushSync()
    return target
}

const boxOf = (root: HTMLElement): HTMLInputElement => root.querySelector('input[type="checkbox"]') as HTMLInputElement

beforeEach(() => {
    localStorage.clear()
    reloadSeasonalPrefs()
})

afterEach(async () => {
    for (const inst of instances.splice(0)) await unmount(inst as never).catch(() => {})
    document.body.innerHTML = ''
})

describe('SeasonalLogoToggle', () => {
    // Guards: a fresh device showing the switch off (the default is on), and a missing label or help line.
    test('is on by default, named and explained', () => {
        const root = render()
        expect(boxOf(root).checked).toBe(true)
        expect(boxOf(root).getAttribute('aria-label')).toBe(language.seasonalLogoSetting)
        expect(root.querySelector('[data-part="seasonal-logo-help"]')!.textContent).toBe(language.seasonalLogoHelp)
    })

    // Guards: the switch not writing the device-local key (the choice would be lost on reload) or writing it inverted.
    test('turning it off stores the choice and turning it on clears it', () => {
        const root = render()
        const box = boxOf(root)
        box.checked = false
        box.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(seasonalLogoEnabled()).toBe(false)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBe('0')
        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(seasonalLogoEnabled()).toBe(true)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBeNull()
    })

    // Guards: the switch showing the mount-time value while the stored choice changed elsewhere.
    test('follows the stored choice when it changes elsewhere', () => {
        const root = render()
        setSeasonalLogoEnabled(false)
        flushSync()
        expect(boxOf(root).checked).toBe(false)
    })
})
