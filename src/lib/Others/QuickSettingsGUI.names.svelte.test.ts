// @vitest-environment jsdom

/**
 * `QuickSettingsGUI.svelte`: the three tab buttons are named, expose `aria-pressed` that follows
 * `QuickSettings.index`, hide their glyphs and mark the active tab with a fill and a ring. Mounts the
 * REAL component; the three settings pages are stubs (their own names are asserted in their own
 * files) and the store module is replaced.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const QuickSettings = $state({ index: 0 })
    return { QuickSettings } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => { } }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => { } }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => { } }))

import { language } from 'src/lang'
import { QuickSettings } from 'src/ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import QuickSettingsGUI from './QuickSettingsGUI.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountTabs(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(QuickSettingsGUI, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    QuickSettings.index = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const tabs = (target: HTMLElement) => Array.from(target.querySelectorAll(':scope > div.flex > button')) as HTMLButtonElement[]

describe('QuickSettingsGUI tabs', () => {
    test('regression reproducer: the tabs are named by the page they open', () => {
        const target = mountTabs()
        expect(tabs(target).map(controlName)).toEqual([language.chatBot, language.otherBots, language.modules])
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: aria-pressed follows the active tab before and after a click', () => {
        const target = mountTabs()
        expect(tabs(target).map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
        tabs(target)[2].click()
        flushSync()
        expect(tabs(target).map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    })

    test('regression reproducer: the active tab carries a fill and a ring as a non-colour cue', () => {
        const target = mountTabs()
        const [active, inactive] = tabs(target)
        for (const token of ['bg-selected', 'text-textcolor', 'ring-1', 'ring-borderc']) {
            expect(active.classList.contains(token), token).toBe(true)
        }
        expect(inactive.classList.contains('ring-1')).toBe(false)
        expect(paletteClasses(target)).toEqual([])
    })
})
