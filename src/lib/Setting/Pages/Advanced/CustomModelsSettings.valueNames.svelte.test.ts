// @vitest-environment jsdom

/**
 * `CustomModelsSettings.svelte` value controls: the tokenizer and format selects of each opened model
 * are named by their visible label spans, with ids that are unique per model row. Mounts the REAL
 * component (without its outer accordion) over a real `$state` database with the real shared inputs;
 * the key list input is a stub (its own file) and the highlighter, size and hotkey modules are mocks of
 * `CustomModelsSettings.names.svelte.test.ts`.
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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import CustomModelsSettings from './CustomModelsSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function model(id: string) {
    return { id, name: 'M' + id, internalId: '', url: '', tokenizer: 0, format: 0, key: '', params: '', flags: [] }
}

function render(models: number): HTMLElement {
    DBState.db = {
        hotkeys: [],
        longPressToPopupEditor: false,
        customModels: Array.from({ length: models }, (_, i) => model('xcustom:::' + i)),
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomModelsSettings, { target, props: { noAccordion: true } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    for (const header of Array.from(target.querySelectorAll<HTMLButtonElement>('div.flex.flex-col.mt-2 > button'))) {
        header.click()
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

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only[id]')).toHaveLength(0)
}

const MODEL_TABLE: FieldExpectation[] = [{ name: language.tokenizer }, { name: language.format }]

describe('CustomModelsSettings value controls are named', () => {
    test('one opened model: tokenizer and format selects', () => {
        check(render(1), MODEL_TABLE)
    })

    test('two opened models give each select its own naming span', () => {
        check(render(2), [...MODEL_TABLE, ...MODEL_TABLE])
    })
})
