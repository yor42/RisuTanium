// @vitest-environment jsdom

/**
 * The data-driven `SettingNumber`, `SettingSelect`, `SettingSlider` and `SettingColor` wrappers name
 * their control by the item's label text alone, through an inner span that holds only that text, and
 * never by the Help button or the max counter next to it. Items are shaped like the setting registry's
 * entries over a `$state` stand-in for `DBState`; `Help`, the select options, the slider with its
 * `CheckInput` and the colour picker are the real components.
 * MOCKED: `alert` (`alertMd` only) and `stores.svelte`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selIdState: { state: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/platform', () => ({
    isMobile: false,
    isTauri: false,
    isNodeServer: false,
}))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { fieldNameProblems, hideClosedColorPickerDialogs, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SettingNumber from './SettingNumber.svelte'
import SettingSelect from './SettingSelect.svelte'
import SettingSlider from './SettingSlider.svelte'
import SettingColor from './SettingColor.svelte'

type Wrapper = Component<{ item: SettingItem, ctx: SettingContext }>

const ctx = {} as unknown as SettingContext

const numberItem: SettingItem = {
    id: 'test.number', type: 'number', labelKey: 'temperature', bindKey: 'temperature', helpKey: 'additionalPrompt',
}
const counterItem: SettingItem = {
    id: 'test.counter', type: 'number', labelKey: 'frequencyPenalty', bindKey: 'frequencyPenalty', helpKey: 'additionalPrompt',
    options: { actualMax: () => 8000 },
}
const selectItem: SettingItem = {
    id: 'test.select', type: 'select', labelKey: 'theme', bindKey: 'theme', helpKey: 'additionalPrompt',
    options: { selectOptions: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
}
const sliderItem: SettingItem = {
    id: 'test.slider', type: 'slider', labelKey: 'temperature', bindKey: 'temperature', helpKey: 'additionalPrompt',
    options: { min: 0, max: 200, step: 1 },
}
const disableableItem: SettingItem = {
    id: 'test.disableable', type: 'slider', labelKey: 'frequencyPenalty', bindKey: 'frequencyPenalty',
    options: { min: 0, max: 200, step: 1, disableable: true },
}
const colorItem: SettingItem = {
    id: 'test.color', type: 'color', labelKey: 'textColor', bindKey: 'theme',
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(wrapper: Wrapper, item: SettingItem): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(wrapper, { target, props: { item, ctx } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = {
        temperature: 80,
        frequencyPenalty: 50,
        theme: 'a',
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app as never)
        m.target.remove()
    }
})

describe('setting wrapper value-control names', () => {
    test('regression reproducer: SettingNumber names its input by the label text, Help excluded', () => {
        const target = render(SettingNumber, numberItem)
        expect(target.querySelector('button.help')).not.toBeNull()
        expect(fieldNameProblems(target, [{ name: language.temperature }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('regression reproducer: SettingNumber with its max counter still names the input by the label text only', () => {
        const target = render(SettingNumber, counterItem)
        expect(target.querySelector('[data-testid="setting-actual-max"]')).not.toBeNull()
        expect(fieldNameProblems(target, [{ name: language.frequencyPenalty }])).toEqual([])
    })

    test('regression reproducer: SettingSelect names its select by the label text, Help excluded', () => {
        const target = render(SettingSelect, selectItem)
        expect(target.querySelectorAll('option').length).toBe(2)
        expect(fieldNameProblems(target, [{ name: language.theme }])).toEqual([])
    })

    test('regression reproducer: SettingSlider names its slider and, when disableable, its checkbox', () => {
        const plain = render(SettingSlider, sliderItem)
        expect(fieldNameProblems(plain, [{ name: language.temperature }])).toEqual([])
        const disableable = render(SettingSlider, disableableItem)
        expect(fieldNameProblems(disableable, [{ name: language.frequencyPenalty, toggle: true }])).toEqual([])
        expect(unnamedControls(disableable, { fields: true, values: true })).toEqual([])
    })

    test('regression reproducer: SettingColor names the library colour input by the label beside it', () => {
        const target = render(SettingColor, { ...colorItem, bindKey: 'theme' })
        DBState.db.theme = '#112233'
        flushSync()
        hideClosedColorPickerDialogs(target)
        expect(fieldNameProblems(target, [{ name: language.textColor }])).toEqual([])
    })
})
