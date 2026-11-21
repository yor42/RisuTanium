// @vitest-environment jsdom

/**
 * `LoreBookData.svelte` value controls: the activation probability and insert order numbers of an opened
 * entry are named by their visible label text through `aria-labelledby`, with that label first in
 * `aria-describedby`. The insert order label also holds a Help button, so its number is named by an inner
 * text span only. Folder and lorebook-plus rows have no value control. Mounts the REAL component with the
 * real shared inputs and Help; mocks follow `LoreBookData.names.svelte.test.ts`.
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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import LoreBookData from './LoreBookData.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountRow(value: loreBook, props: { isOpen?: boolean, lorePlus?: boolean } = {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoreBookData, {
        target,
        props: { value, idx: 0, idgroup: 'g', externalLoreBooks: [value], isOpen: props.isOpen ?? true, lorePlus: props.lorePlus ?? false },
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

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('LoreBookData value controls are named', () => {
    test('a normal entry names its insert order number', async () => {
        check(await mountRow(normal()), names(language.insertOrder))
    })

    test('an entry with an activation probability adds that number before insert order', async () => {
        check(await mountRow(normal({ activationPercent: 50 })), names(language.activationProbability, language.insertOrder))
    })

    test('a lorebook-plus entry has no value control', async () => {
        check(await mountRow(normal({ activationPercent: 50 }), { lorePlus: true }), [])
    })

    test('a folder row has no value control', async () => {
        check(await mountRow(normal({ mode: 'folder', key: 'f1', comment: 'Folder' })), [])
    })

    test('a closed row has no value control', async () => {
        check(await mountRow(normal(), { isOpen: false }), [])
    })
})
