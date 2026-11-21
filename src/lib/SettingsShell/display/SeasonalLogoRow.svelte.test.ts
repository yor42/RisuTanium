// @vitest-environment jsdom

/**
 * The shell Display "Seasonal logo" row: it shows this device's stored choice, writes it through the prefs module
 * (the store the Home brand reads) and carries the device chip. Each test names the defect it guards.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { SEASONAL_LOGO_KEY, reloadSeasonalPrefs, seasonalLogoEnabled, setSeasonalLogoEnabled } from 'src/ts/seasonal/seasonalPrefs.svelte'
import SeasonalLogoRow from './SeasonalLogoRow.svelte'

let instances: unknown[] = []

function render(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(SeasonalLogoRow, { target, props: { ctx: {} as never } }))
    flushSync()
    return target
}

const boxOf = (root: HTMLElement): HTMLInputElement => root.querySelector('input[type="checkbox"]') as HTMLInputElement

function flip(box: HTMLInputElement, to: boolean): void {
    box.checked = to
    box.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    reloadSeasonalPrefs()
})

afterEach(async () => {
    for (const inst of instances.splice(0)) await unmount(inst as never).catch(() => {})
    document.body.innerHTML = ''
})

describe('SeasonalLogoRow', () => {
    // Guards: a fresh device showing the switch off (an absent key means on), and a missing label, chip or help line.
    test('is on by default, named, explained and marked as this device only', () => {
        const root = render()
        expect(boxOf(root).checked).toBe(true)
        expect(boxOf(root).getAttribute('aria-label')).toBe(language.seasonalLogoSetting)
        expect(root.querySelector('[data-part="device-chip"]')!.textContent).toBe(language.chatShellOnThisDevice)
        expect(root.querySelector('[data-part="seasonal-logo-help"]')!.textContent).toBe(language.seasonalLogoHelp)
    })

    // Guards: the switch ignoring a stored "off" at mount.
    test('shows a stored off choice', () => {
        localStorage.setItem(SEASONAL_LOGO_KEY, '0')
        reloadSeasonalPrefs()
        expect(boxOf(render()).checked).toBe(false)
    })

    // Guards: the row not calling setSeasonalLogoEnabled, so the device key and the store the Home brand reads stay unchanged.
    test('toggling writes the device preference and the shared store', () => {
        const root = render()
        flip(boxOf(root), false)
        expect(seasonalLogoEnabled()).toBe(false)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBe('0')
        flip(boxOf(root), true)
        expect(seasonalLogoEnabled()).toBe(true)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBeNull()
    })

    // Guards: the box going stale when the choice changes elsewhere (the classic toggle writes the same store).
    test('follows the stored choice when it changes elsewhere', () => {
        const root = render()
        setSeasonalLogoEnabled(false)
        flushSync()
        expect(boxOf(root).checked).toBe(false)
    })
})
