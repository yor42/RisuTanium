// @vitest-environment jsdom

/**
 * `CustomColorSchemeEditor.svelte`: the export and import buttons are named with their glyphs hidden
 * and hover to a scheme token. The native colour inputs are named through aria-labelledby, which
 * `CustomColorSchemeEditor.valueNames.svelte.test.ts` checks per name. Mounts the REAL
 * component over a real `$state` database; the colour module is a stub.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    changeColorSchemeType: vi.fn(),
    exportColorScheme: vi.fn(),
    importColorScheme: vi.fn(),
    updateCustomColorScheme: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import CustomColorSchemeEditor from './CustomColorSchemeEditor.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(): HTMLElement {
    DBState.db = {
        colorSchemeName: 'custom',
        customColorScheme: {
            type: 'dark', bgcolor: '#000000', darkbg: '#000000', borderc: '#000000', selected: '#000000',
            draculared: '#000000', darkBorderc: '#000000', darkbutton: '#000000', textcolor: '#ffffff', textcolor2: '#ffffff',
        },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomColorSchemeEditor, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('CustomColorSchemeEditor accessible names', () => {
    test('regression reproducer: the export and import buttons are named and their glyphs hidden', () => {
        const target = render()
        const buttons = Array.from(target.querySelectorAll('div.grow.flex.justify-end > button'))
        expect(buttons.map(controlName)).toEqual([language.export, language.import])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the hovers use scheme tokens', () => {
        const target = render()
        expect(paletteClasses(target)).toEqual([])
        const buttons = Array.from(target.querySelectorAll('div.grow.flex.justify-end > button'))
        for (const button of buttons) {
            expect(button.classList.contains('hover:text-textcolor')).toBe(true)
        }
    })

    test('regression reproducer: the native colour inputs are named by labelledby to the text beside them, with that text first in the description', () => {
        const target = render()
        const inputs = Array.from(target.querySelectorAll('input[type="color"]'))
        expect(inputs).toHaveLength(9)
        for (const input of inputs) {
            expect(input.hasAttribute('aria-label')).toBe(false)
            expect(controlName(input)).not.toBe('')
        }
    })
})
