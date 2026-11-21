// @vitest-environment jsdom

/**
 * `DevTool.svelte` value controls: the numeric script variable and the three preview-prompt selects (type,
 * instruction type, join) are named by their visible label text through `aria-labelledby`, with that label
 * first in `aria-describedby`, and no naming element is shared between two controls. The numeric variable
 * shares the label id scheme of the string variable, since a row renders only one of them. Mounts the REAL
 * component with the real shared inputs and accordion; mocks follow `DevTool.names.svelte.test.ts`.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        db: {
            hotkeys: [],
            longPressToPopupEditor: false,
            characters: [{
                chatPage: 0,
                chats: [{ scriptstate: { $greeting: 'hello', $count: 3, $other: 7, $nested: {} } }],
            }],
        },
    },
    selectedCharID: writable(0),
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
    selectSingleFile: vi.fn(),
}))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/globalApi.svelte', () => ({ getRequestLog: vi.fn(() => '') }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/tokenizer', () => ({
    getCharToken: vi.fn(async () => ({ persistant: 1, dynamic: 2 })),
    getChatToken: vi.fn(async () => 3),
}))
vi.mock('src/ts/process/prompt', () => ({ tokenizePreset: vi.fn(async () => 0) }))
vi.mock('src/ts/process/devToolActions', () => ({ runAutopilot: vi.fn(), runPreviewPrompt: vi.fn() }))
vi.mock('src/ts/process/templates/chatTemplate', () => ({ chatTemplates: { chatml: {} } }))
vi.mock('src/ts/process/lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModules: vi.fn(() => []) }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import DevTool from './DevTool.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function settle(): Promise<void> {
    await tick()
    flushSync()
}

async function mountOpen(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(DevTool, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await settle()
    for (const header of Array.from(target.querySelectorAll<HTMLElement>('button')).filter((b) => b.textContent?.includes(language.devTool.variables) || b.textContent?.includes(language.devTool.previewPrompt))) {
        header.click()
        flushSync()
    }
    await settle()
    return target
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await settle()
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

describe('DevTool value controls are named', () => {
    test('chat preview: the two numeric variables, the type select and the join select', async () => {
        const target = await mountOpen()
        check(target, names('$count', '$other', language.type, language.devTool.join))
    })

    test('instruct preview adds the instruction type select', async () => {
        const target = await mountOpen()
        await choose(target.querySelectorAll('select')[0], 'instruct')
        check(target, names('$count', '$other', language.type, language.devTool.instructionType, language.devTool.join))
    })

    test('custom Jinja adds a text area, which is not a value control', async () => {
        const target = await mountOpen()
        await choose(target.querySelectorAll('select')[0], 'instruct')
        await choose(target.querySelectorAll('select')[1], 'jinja')
        expect(target.querySelector('textarea, [role="textbox"]')).not.toBeNull()
        check(target, names('$count', '$other', language.type, language.devTool.instructionType, language.devTool.join))
    })
})
