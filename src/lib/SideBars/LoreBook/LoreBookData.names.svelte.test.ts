// @vitest-environment jsdom

/**
 * `LoreBookData.svelte`: the always-active toggle, the remove X of every row kind and the folder's
 * external add button are named with hidden glyphs, the toggle reports its state through `aria-pressed`
 * before and after a click, and every text field of an opened row is named by its visible label (Help
 * excluded) with the label first in `aria-describedby`. Mounts the REAL component with the real shared
 * inputs and Help; the nested list, the tokenizer and the highlighter are mocks.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { loreBook } from 'src/ts/storage/database.svelte'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        db: {
            hotkeys: [],
            longPressToPopupEditor: false,
            localActivationInGlobalLorebook: false,
        },
    },
    selIdState: { selId: 0 },
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({ globalLore: [] })),
    getCurrentChat: vi.fn(() => ({ localLore: [] })),
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
vi.mock('src/ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => false), alertMd: vi.fn() }))
vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))
vi.mock('./LoreBookList.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import LoreBookData from './LoreBookData.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountRow(value: loreBook, props: { isOpen?: boolean, externalLoreBooks?: loreBook[] } = {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoreBookData, {
        target,
        props: { value, idx: 0, idgroup: 'g', externalLoreBooks: props.externalLoreBooks ?? [value], isOpen: props.isOpen ?? false },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
    flushSync()
    return target
}

const normal = (over: Partial<loreBook> = {}): loreBook => ({
    key: 'k', comment: 'Entry', content: 'text', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: 'k2', selective: true, ...over,
})

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

describe('LoreBookData accessible names', () => {
    test('regression reproducer: the always-active toggle and the X are named, glyphs hidden', async () => {
        const target = await mountRow(normal())
        const buttons = Array.from(target.querySelectorAll('div.flex.items-center > button'))
        expect(buttons.map(controlName)).toEqual([expect.any(String), language.alwaysActive, language.remove])
        expect(exposedIcons(target)).toEqual([])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: aria-pressed on the always-active toggle follows a click', async () => {
        const value = $state(normal())
        const target = await mountRow(value)
        const toggle = () => target.querySelectorAll<HTMLButtonElement>('div.flex.items-center > button')[1]
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        toggle().click()
        flushSync()
        expect(value.alwaysActive).toBe(true)
        expect(toggle().getAttribute('aria-pressed')).toBe('true')
        expect(controlName(toggle())).toBe(language.alwaysActive)
    })

    test('regression reproducer: the child row X is named', async () => {
        const target = await mountRow(normal({ mode: 'child', id: 'x' }))
        const names = Array.from(target.querySelectorAll('div.flex.items-center > button')).map(controlName)
        expect(names[names.length - 1]).toBe(language.remove)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: an opened row names its fields by their labels, Help excluded', async () => {
        const target = await mountRow(normal(), { isOpen: true })
        expect(unnamedControls(target, { fields: true })).toEqual([])
        for (const label of [language.name, language.activationKeys, language.SecondaryKeys, language.prompt]) {
            const el = field(target, label)
            expect(controlDescription(el).startsWith(label)).toBe(true)
        }
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: an opened folder names its folder name field and its external add button', async () => {
        const folder = normal({ mode: 'folder', key: 'f1', comment: 'Folder' })
        const target = await mountRow(folder, { isOpen: true })
        expect(unnamedControls(target, { fields: true })).toEqual([])
        field(target, language.folderName)
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names).toContain(language.add)
        expect(exposedIcons(target)).toEqual([])
    })

    test('guard: the checkboxes keep their visible names (passes before and after)', async () => {
        const target = await mountRow(normal(), { isOpen: true })
        const names = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
        expect(names).toContain(language.alwaysActive)
        expect(names).toContain(language.selective)
    })
})
