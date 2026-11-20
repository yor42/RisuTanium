// @vitest-environment jsdom

/**
 * `TranslatorPresetSettings.svelte`: the five toolbar buttons are named with their glyphs hidden,
 * the prompt field is named by its label without the Help name, and the hovers use scheme tokens.
 * Mounts the REAL page over the real preset normalizer and a real `$state` database with the real
 * shared inputs and Help; mocks are those of `TranslatorPresetSettings.deleteTarget.svelte.test.ts`
 * plus the highlighter, size and hotkey modules of `TextAreaInput.ime.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState: { selId: 0 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    encryptBuffer: vi.fn(),
    decryptBuffer: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(),
    decodeRPack: vi.fn(),
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
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import TranslatorPresetSettings from './TranslatorPresetSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(): HTMLElement {
    DBState.db = {
        translatorPresets: [{ name: 'A', prompt: 'p', maxResponse: 500 }],
        translatorPresetId: 0,
        translatorPrompt: 'p',
        translatorMaxResponse: 500,
        hotkeys: [],
        longPressToPopupEditor: false,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(TranslatorPresetSettings, { target, props: {} }) as unknown as Record<string, unknown>
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

describe('TranslatorPresetSettings accessible names', () => {
    test('regression reproducer: the toolbar buttons are named and their glyphs hidden', () => {
        const target = render()
        const buttons = Array.from(target.querySelectorAll('div.flex.items-center.mb-4 > button'))
        expect(buttons.map(controlName)).toEqual([language.add, language.edit, language.remove, language.export, language.import])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the prompt field is named by its label without Help', () => {
        const target = render()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const prompt = target.querySelector('textarea') as HTMLTextAreaElement
        expect(controlName(prompt)).toBe(language.translatorPrompt)
        expect(controlDescription(prompt).startsWith(language.translatorPrompt)).toBe(true)
    })

    test('regression reproducer: the hovers use scheme tokens', () => {
        const target = render()
        expect(paletteClasses(target)).toEqual([])
    })
})
