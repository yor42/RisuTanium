// @vitest-environment jsdom

/**
 * `CustomTextThemeEditor.svelte`: each of the six colour pickers is named by the visible text beside it.
 * Mounts the REAL component with the real `ColorInput` and the real colour picker library over a real
 * `$state` database; the library's closed popup dialog is hidden as its stylesheet does.
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
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

import { language } from 'src/lang'
import { fieldNameProblems, hideClosedColorPickerDialogs, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import CustomTextThemeEditor from './CustomTextThemeEditor.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(): HTMLElement {
    DBState.db = {
        textTheme: 'custom',
        customTextTheme: {
            FontColorStandard: '#111111',
            FontColorItalic: '#222222',
            FontColorBold: '#333333',
            FontColorItalicBold: '#444444',
            FontColorQuote1: '#555555',
            FontColorQuote2: null,
        },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomTextThemeEditor, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    hideClosedColorPickerDialogs(target)
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
    { name: language.settingsPage.normalText },
    { name: language.settingsPage.italicText },
    { name: language.settingsPage.boldText },
    { name: language.settingsPage.italicBoldText },
    { name: language.settingsPage.singleQuoteText },
    { name: language.settingsPage.doubleQuoteText },
]

describe('CustomTextThemeEditor value-control names', () => {
    test('regression reproducer: the six colour pickers are named by their visible text in source order', () => {
        const target = render()
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
