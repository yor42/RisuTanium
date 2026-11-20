// @vitest-environment jsdom

/**
 * `CustomColorSchemeEditor.svelte`: the scheme-type select has no visible label and is named by a
 * screen-reader-only span; each native colour input is named by the visible text beside it, through
 * aria-labelledby plus that text first in aria-describedby. Mounts the REAL component over a real
 * `$state` database with the real shared select; the colour module is a stub.
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
import { fillLang } from 'src/lang/fill'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
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

const KNOWN_UNNAMED: string[] = []

const TABLE = [
    { name: language.colorSchemeType },
    { name: language.settingsPage.background },
    { name: language.settingsPage.darkBackground },
    { name: fillLang(language.settingsPage.colorNumber, { n: 1 }) },
    { name: fillLang(language.settingsPage.colorNumber, { n: 2 }) },
    { name: fillLang(language.settingsPage.colorNumber, { n: 3 }) },
    { name: fillLang(language.settingsPage.colorNumber, { n: 4 }) },
    { name: fillLang(language.settingsPage.colorNumber, { n: 5 }) },
    { name: language.textColor },
    { name: fillLang(language.settingsPage.textColorNumber, { n: 2 }) },
]

describe('CustomColorSchemeEditor value-control names', () => {
    test('regression reproducer: the scheme select and the nine colour inputs are named in source order', () => {
        const target = render()
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('regression reproducer: the colour inputs are named by labelledby, not by aria-label', () => {
        const target = render()
        const inputs = Array.from(target.querySelectorAll('input[type="color"]'))
        expect(inputs).toHaveLength(9)
        for (const input of inputs) {
            expect(input.hasAttribute('aria-labelledby')).toBe(true)
            expect(input.hasAttribute('aria-label')).toBe(false)
        }
    })
})
