// @vitest-environment jsdom

/**
 * The data-driven `SettingCheck`, `SettingText` and `SettingTextarea` wrappers name their control by
 * the item's label and never by the Help button next to it: the checkbox through `aria-label`, the
 * text field and the textarea through `aria-labelledby` on an inner span that wraps only the label
 * text, with `aria-describedby` listing that span first. Items are shaped like the setting registry's
 * entries over a `$state` stand-in for `DBState`; `Help` and the textarea are the real components.
 * MOCKED: `alert` (`alertMd` only), `stores.svelte`, the textarea's highlighter and size stores.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selIdState: { state: -1 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: [],
}))
vi.mock('src/ts/platform', () => ({
    isMobile: false,
    isTauri: false,
    isNodeServer: false,
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlDescription, controlName, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SettingCheck from './SettingCheck.svelte'
import SettingText from './SettingText.svelte'
import SettingTextarea from './SettingTextarea.svelte'

type Wrapper = Component<{ item: SettingItem, ctx: SettingContext }>

const ctx = {} as unknown as SettingContext

const textItem: SettingItem = {
    id: 'test.text', type: 'text', labelKey: 'additionalPrompt', bindKey: 'additionalPrompt', helpKey: 'additionalPrompt',
}
const textareaItem: SettingItem = {
    id: 'test.textarea', type: 'textarea', labelKey: 'emotionPrompt', bindKey: 'emotionPrompt2', helpKey: 'emotionPrompt',
}
const checkItem: SettingItem = {
    id: 'test.check', type: 'check', labelKey: 'longPressToPopupEditor', bindKey: 'longPressToPopupEditor', helpKey: 'additionalPrompt',
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
        additionalPrompt: 'x',
        emotionPrompt2: 'y',
        longPressToPopupEditor: false,
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app as never)
        m.target.remove()
    }
})

describe('setting wrapper names', () => {
    test('regression reproducer: SettingCheck names its checkbox by the item label', () => {
        const target = render(SettingCheck, checkItem)
        const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(controlName(input)).toBe(language.longPressToPopupEditor)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: SettingText names its field by the label text only, Help excluded', () => {
        const target = render(SettingText, textItem)
        const input = target.querySelector<HTMLInputElement>('input')!
        expect(controlName(input)).toBe(language.additionalPrompt)
        expect(controlDescription(input)).toBe(language.additionalPrompt)
        const labelSpan = document.getElementById(input.getAttribute('aria-labelledby')!)!
        expect(labelSpan.querySelector('button')).toBeNull()
        expect(target.querySelector('button.help')).not.toBeNull()
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: SettingTextarea names its field by the label text only, Help excluded', () => {
        const target = render(SettingTextarea, textareaItem)
        const field = target.querySelector<HTMLTextAreaElement>('textarea')!
        expect(controlName(field)).toBe(language.emotionPrompt)
        expect(controlDescription(field)).toBe(language.emotionPrompt)
        const labelSpan = document.getElementById(field.getAttribute('aria-labelledby')!)!
        expect(labelSpan.querySelector('button')).toBeNull()
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: two mounted text wrappers keep distinct label ids', () => {
        const first = render(SettingText, textItem).querySelector('input')!
        const second = render(SettingText, textItem).querySelector('input')!
        expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'))
    })
})
