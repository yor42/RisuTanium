// @vitest-environment jsdom

/**
 * `CustomModelsSettings.svelte`: the add button and the move up, move down and remove buttons of each
 * model row are named with their glyphs hidden, and the four text fields of an opened model are named
 * by their visible labels. Mounts the REAL component (without its outer accordion) over a real
 * `$state` database with the real shared inputs; the key list input is a stub and the highlighter,
 * size and hotkey modules are mocks of `TextAreaInput.ime.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selIdState: { selId: 0 },
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
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import CustomModelsSettings from './CustomModelsSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(open: boolean): HTMLElement {
    DBState.db = {
        hotkeys: [],
        longPressToPopupEditor: false,
        customModels: [{ id: 'xcustom:::1', name: 'M', internalId: '', url: '', tokenizer: 0, format: 0, key: '', params: '', flags: [] }],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomModelsSettings, { target, props: { noAccordion: true } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    if (open) {
        ;(target.querySelector('div.flex.flex-col.mt-2 > button') as HTMLButtonElement).click()
        flushSync()
    }
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('CustomModelsSettings accessible names', () => {
    test('regression reproducer: the row buttons and the add button are named and their glyphs hidden', () => {
        const target = render(false)
        const rowButtons = Array.from(target.querySelectorAll('div.flex.items-center.gap-1 > button'))
        expect(rowButtons.map(controlName)).toEqual([language.chatShellMoveUp, language.chatShellMoveDown, language.remove])
        const add = Array.from(target.querySelectorAll(':scope > div.flex.flex-col.mt-2:last-child > button'))
        expect(add.map(controlName)).toEqual([language.add])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the four text fields of an opened model are named by their labels', () => {
        const target = render(true)
        const expected = [language.name, language.proxyRequestModel, 'URL', language.additionalParams]
        const fields = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        expect(fields.map(controlName)).toEqual(expected)
        for (const [index, field] of fields.entries()) {
            expect(controlDescription(field).startsWith(expected[index])).toBe(true)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
