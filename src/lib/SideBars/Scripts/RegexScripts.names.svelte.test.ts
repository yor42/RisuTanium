// @vitest-environment jsdom

/**
 * `RegexList.svelte` and `RegexData.svelte`: the list's add, export and import buttons and each row's X are
 * named with hidden glyphs, the opened row's fields (name, regex, replacement) are named by their visible
 * labels with the label first in `aria-describedby`, and the custom-flag checkbox is named by `aria-label`.
 * Mounts the REAL list and row with the real shared inputs and accordion; the stores, the process module
 * and the highlighter are mocks, and the sortable library is a stub.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { customscript } from 'src/ts/storage/database.svelte'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [], longPressToPopupEditor: false } },
    ReloadGUIPointer: writable(0),
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/util', () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => false) }))
vi.mock('src/ts/process/scripts', () => ({ exportRegex: vi.fn(), importRegex: vi.fn() }))
vi.mock('sortablejs', () => ({ default: { create: () => ({ destroy() {} }) } }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import RegexList from './RegexList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const script = (over: Partial<customscript> = {}): customscript => ({
    comment: 'Rule', in: 'a', out: 'b', type: 'editinput', ableFlag: true, flag: 'g', ...over,
})

async function show(value: customscript[], buttons = true): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(RegexList, { target, props: { value, buttons } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
    flushSync()
    return target
}

async function openRow(target: HTMLElement): Promise<void> {
    target.querySelector<HTMLButtonElement>('button.endflex')!.click()
    flushSync()
    await tick()
    flushSync()
}

function field(target: HTMLElement, label: string): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        .find((el) => controlName(el) === label)
    if (!found) expect.fail('no field named ' + label)
    return found
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('RegexList and RegexData accessible names', () => {
    test('regression reproducer: the list buttons and the row X are named, glyphs hidden', async () => {
        const target = await show([script()])
        const row = target.querySelector('div.flex.gap-2.mt-2')!
        expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([language.add, language.export, language.import])
        const x = target.querySelector('div.flex.items-center > button.valuer:not(.endflex)')!
        expect(controlName(x)).toBe(language.remove)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the opened row names its three fields by their labels', async () => {
        const target = await show([script()])
        await openRow(target)
        for (const label of [language.name, language.sidebarUi.regexIn, language.sidebarUi.regexOut]) {
            const el = field(target, label)
            expect(controlDescription(el).startsWith(label)).toBe(true)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the custom-flag checkbox is named by its following visible text', async () => {
        const target = await show([script()])
        await openRow(target)
        const names = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
        expect(names).toContain(language.sidebarUi.customFlag)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})
