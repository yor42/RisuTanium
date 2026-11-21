// @vitest-environment jsdom

/**
 * `RegexData.svelte` value controls: the modification type select and the flag order number of an opened
 * script are named by their visible label text through `aria-labelledby`, with that label first in
 * `aria-describedby`. The order number exists only inside the opened flags accordion of a script with custom
 * flags. Mounts the REAL component with the real shared inputs and accordion; mocks follow
 * `RegexScripts.names.svelte.test.ts`.
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
}))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => false) }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import RegexData from './RegexData.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const script = (over: Partial<customscript> = {}): customscript => ({
    comment: 'Rule', in: 'a', out: 'b', type: 'editinput', ableFlag: false, flag: 'g', ...over,
})

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

async function show(value: customscript, open: boolean, openFlags = false): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(RegexData, { target, props: { value, idx: 0 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    if (open) {
        target.querySelector<HTMLButtonElement>('button.endflex')!.click()
        await settle()
    }
    if (openFlags) {
        const header = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(language.sidebarUi.flagsHeading))
        if (!header) expect.fail('flags accordion header not found')
        header.click()
        await settle()
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

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('RegexData value controls are named', () => {
    test('a closed row has no value control', async () => {
        check(await show(script(), false), [])
    })

    test('an opened script without custom flags names its modification type select', async () => {
        check(await show(script(), true), names(language.sidebarUi.modificationType))
    })

    test('custom flags with the flags accordion closed add no control', async () => {
        check(await show(script({ ableFlag: true }), true), names(language.sidebarUi.modificationType))
    })

    test('custom flags with the flags accordion open add the order number', async () => {
        check(await show(script({ ableFlag: true }), true, true), names(language.sidebarUi.modificationType, language.sidebarUi.orderFlag))
    })
})
