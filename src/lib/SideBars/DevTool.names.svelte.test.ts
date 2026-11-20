// @vitest-environment jsdom

/**
 * `DevTool.svelte`: the autopilot remove, add and import buttons are named with hidden glyphs, and every
 * text field (a string variable, an autopilot line, the custom Jinja template) is named by its label with
 * the label first in `aria-describedby`. Mounts the REAL component with the real shared inputs and
 * accordion; the process modules, the tokenizer and the highlighter are mocks.
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
                chats: [{ scriptstate: { $greeting: 'hello', $count: 3 } }],
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
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import DevTool from './DevTool.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountTool(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(DevTool, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
    flushSync()
    return target
}

/** Opens every accordion so each section's controls are mounted. */
async function openAll(target: HTMLElement): Promise<void> {
    for (const header of Array.from(target.querySelectorAll<HTMLElement>('button')).filter((b) => b.textContent?.includes(language.devTool.autopilot) || b.textContent?.includes(language.devTool.variables) || b.textContent?.includes(language.devTool.previewPrompt))) {
        header.click()
        flushSync()
    }
    await tick()
    flushSync()
}

function autopilotButtons(target: HTMLElement): HTMLButtonElement[] {
    const row = Array.from(target.querySelectorAll<HTMLElement>('div.flex.justify-end')).find((d) => d.querySelector('svg'))
    if (!row) expect.fail('autopilot toolbar not found')
    return Array.from(row.querySelectorAll('button'))
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('DevTool accessible names', () => {
    test('regression reproducer: the autopilot trash, plus and import buttons are named in order', async () => {
        const target = await mountTool()
        await openAll(target)
        expect(autopilotButtons(target).map(controlName)).toEqual([language.remove, language.add, language.import])
    })

    test('regression reproducer: every glyph is hidden from the accessibility tree', async () => {
        const target = await mountTool()
        await openAll(target)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the string variable field, an autopilot line and the Jinja field are named', async () => {
        const target = await mountTool()
        await openAll(target)
        const plus = autopilotButtons(target)[1]
        plus.click()
        flushSync()
        const select = target.querySelector<HTMLSelectElement>('select')
        expect(select).not.toBeNull()
        // The Jinja template field renders only for the instruct preview with the custom template.
        const selects = Array.from(target.querySelectorAll<HTMLSelectElement>('select'))
        selects[0].value = 'instruct'
        selects[0].dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        const typeSelects = Array.from(target.querySelectorAll<HTMLSelectElement>('select'))
        typeSelects[1].value = 'jinja'
        typeSelects[1].dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        await tick()
        flushSync()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const fields = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        const names = fields.map(controlName)
        expect(names).toContain('$greeting')
        expect(names).toContain(language.devTool.autopilot)
        expect(names).toContain(language.devTool.customJinja)
        for (const el of fields) {
            expect(controlDescription(el).startsWith(controlName(el))).toBe(true)
        }
    })
})
