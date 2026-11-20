// @vitest-environment jsdom

/**
 * `NullableTextColorToggle.svelte`: with a colour set, the native colour input is named by the visible
 * text beside it and its "use this value" checkbox carries the same name; with no colour only the
 * checkbox renders and is named by its own text. Mounts the REAL component over a real `$state`
 * database with the real `CheckInput`.
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

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import NullableTextColorToggle from './NullableTextColorToggle.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(textScreenColor: string | null, textScreenBorder: string | null, labelKey: 'textBackgrounds' | 'textScreenBorder', field: 'textScreenColor' | 'textScreenBorder'): HTMLElement {
    DBState.db = { textScreenColor, textScreenBorder } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(NullableTextColorToggle, { target, props: { field, labelKey, defaultColor: '#123456' } }) as unknown as Record<string, unknown>
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

describe('NullableTextColorToggle value-control names', () => {
    test('regression reproducer: the set colour input is named by the text beside it and its checkbox likewise', () => {
        const target = render('#112233', null, 'textBackgrounds', 'textScreenColor')
        expect(fieldNameProblems(target, [{ name: language.textBackgrounds, toggle: true }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('regression reproducer: the border variant names its input by its own label', () => {
        const target = render(null, '#445566', 'textScreenBorder', 'textScreenBorder')
        expect(fieldNameProblems(target, [{ name: language.textScreenBorder, toggle: true }])).toEqual([])
    })

    test('guard: with no colour only the named checkbox renders (passes before and after)', () => {
        const target = render(null, null, 'textBackgrounds', 'textScreenColor')
        expect(fieldNameProblems(target, [])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
