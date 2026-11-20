// @vitest-environment jsdom

/**
 * `TriggerList.svelte`, `TriggerV1List.svelte`, `TriggerV1Data.svelte` and the list level of
 * `TriggerV2List.svelte`: every icon-only button (add, export, import, back, X, condition and effect
 * add and remove) is named with a hidden glyph, every text field of an opened V1 trigger is named by its
 * visible label with the label first in `aria-describedby`, the two prompt fields whose labels contain Help
 * are named by the label text alone, and Help inside the `text-textcolor2` label resolves to the measured
 * textcolor2 to textcolor pair. The V2 effect editors' own fields (menu pages 2 and 3, #333) are out of
 * scope: those pages are asserted for their buttons only.
 *
 * Mounts the REAL components with the real shared inputs, Help, accordion and portal. The stores, the alert
 * module, the trigger process module, the highlighter and the sortable library are mocks.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { triggerscript } from 'src/ts/process/triggers'

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState'],
}) as unknown as typeof import('src/ts/process/triggers'))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [], longPressToPopupEditor: false, showDeprecatedTriggerV1: true, showDeprecatedTriggerV2: false } },
    selIdState: { selId: 0 },
    ReloadGUIPointer: writable(0),
    alertStore: writable({ type: 'none', msg: '' }),
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
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => false), alertMd: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ openURL: vi.fn() }))
vi.mock('sortablejs', () => ({ default: { create: () => ({ destroy() {} }) } }))

import { language } from 'src/lang'
import { controlDescription, controlName, controls, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import TriggerList from './TriggerList.svelte'
import TriggerV1List from './TriggerV1List.svelte'
import TriggerV2List from './TriggerV2List.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise<void>((r) => setTimeout(r, 20))
    flushSync()
}

async function show(component: unknown, props: Record<string, unknown>): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

function field(target: HTMLElement, label: string, index = 0): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        .filter((el) => controlName(el) === label)[index]
    if (!found) expect.fail('no field named ' + label + ' #' + index)
    return found
}

/** Every effect type of the V1 effect switch, in the shape the switch writes. */
function v1Effects(): triggerscript['effect'] {
    return [
        { type: 'systemprompt', value: '', location: 'historyend' },
        { type: 'setvar', var: '', value: '', operator: '=' },
        { type: 'runtrigger', value: '' },
        { type: 'command', value: '' },
        { type: 'runLLM', value: '', inputVar: '' },
        { type: 'checkSimilarity', source: '', value: '', inputVar: '' },
        { type: 'showAlert', alertType: 'normal', value: '', inputVar: '' },
        { type: 'impersonate', role: 'char', value: '' },
        { type: 'extractRegex', value: '', regex: '', flags: '', inputVar: '', result: '' },
        { type: 'runImgGen', value: '', negValue: '', inputVar: '' },
        { type: 'cutchat', start: '', end: '' },
        { type: 'modifychat', value: '', index: '' },
        { type: 'runAxLLM', value: '', inputVar: '' },
    ] as unknown as triggerscript['effect']
}

function v1Trigger(): triggerscript {
    return {
        comment: 'Trigger',
        type: 'start',
        conditions: [
            { type: 'exists', value: '', type2: 'loose', depth: 3 },
            { type: 'var', var: '', value: '', operator: '=' },
            { type: 'value', var: '', value: '', operator: '=' },
        ],
        effect: v1Effects(),
    } as unknown as triggerscript
}

async function openFirstRow(target: HTMLElement): Promise<void> {
    target.querySelector<HTMLButtonElement>('button.endflex')!.click()
    await settle()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    document.body.replaceChildren()
})

describe('V1 trigger list and row names', () => {
    test('regression reproducer: the list add button and the row X are named, glyphs hidden', async () => {
        const target = await show(TriggerV1List, { value: [{ comment: 'T', type: 'start', conditions: [], effect: [] }], lowLevelAble: true })
        const buttons = Array.from(target.querySelectorAll('button'))
        const names = buttons.map(controlName)
        expect(names).toContain(language.remove)
        expect(names[names.length - 1]).toBe(language.add)
        expect(exposedIcons(target)).toEqual([])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: every control of an opened trigger is named (AS1)', async () => {
        const target = await show(TriggerV1List, { value: [v1Trigger()], lowLevelAble: true })
        await openFirstRow(target)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the condition and effect add and remove buttons are named and none keeps a dangling labelledby', async () => {
        const target = await show(TriggerV1List, { value: [v1Trigger()], lowLevelAble: true })
        await openFirstRow(target)
        const floats = Array.from(target.querySelectorAll<HTMLButtonElement>('button.float-right'))
        // 1 condition add, 3 condition removes, 1 effect add, 13 effect removes
        expect(floats).toHaveLength(18)
        expect(floats[0].getAttribute('aria-label')).toBe(language.add)
        expect(floats.filter((b) => controlName(b) === language.remove)).toHaveLength(16)
        expect(floats.filter((b) => b.hasAttribute('aria-labelledby'))).toHaveLength(0)
    })

    test('regression reproducer: the fields of every condition and effect are named by their labels', async () => {
        const target = await show(TriggerV1List, { value: [v1Trigger()], lowLevelAble: true })
        await openFirstRow(target)
        const fields = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        // the name, 5 condition fields (exists 1, var 2, value 2) and 27 effect fields
        expect(fields).toHaveLength(33)
        for (const el of fields) {
            expect(controlName(el)).not.toBe('')
            expect(controlDescription(el).startsWith(controlName(el))).toBe(true)
        }
        const ids = fields.map((el) => el.getAttribute('aria-labelledby'))
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('compatibility guard on the real producer: Help in the runLLM and runAxLLM labels has the textcolor2 to textcolor pair (passes before and after)', async () => {
        const target = await show(TriggerV1List, { value: [v1Trigger()], lowLevelAble: true })
        await openFirstRow(target)
        const helps = Array.from(target.querySelectorAll<HTMLElement>('button.help'))
        expect(helps).toHaveLength(2)
        for (const help of helps) {
            const glyph = help.querySelector('svg')!.parentElement!
            const tokens = textColourTokens(glyph)
            expect([tokens.rest, tokens.hover]).toEqual(['textcolor2', 'textcolor'])
        }
    })

    test('regression reproducer: the runLLM and runAxLLM prompt fields are named by the label text alone', async () => {
        const target = await show(TriggerV1List, { value: [v1Trigger()], lowLevelAble: true })
        await openFirstRow(target)
        // Found through the Help button of each label, so a name that wrongly includes Help still selects its field.
        const helps = Array.from(target.querySelectorAll<HTMLElement>('button.help'))
        expect(helps).toHaveLength(2)
        for (const help of helps) {
            const next = help.closest('span.text-textcolor2')!.nextElementSibling as HTMLElement
            const el = next.matches('textarea, [role="textbox"]') ? next : next.querySelector<HTMLElement>('textarea, [role="textbox"]')!
            expect(controlName(el)).toBe(language.prompt)
            expect(controlName(el)).not.toContain(language.showHelp)
            // The helper reads text content, which skips a nested button's aria-label, so the label element
            // itself must not contain the Help button: a screen reader would add its name to the field's.
            const labelElement = document.getElementById(el.getAttribute('aria-labelledby')!)!
            expect(labelElement.querySelector('button.help')).toBeNull()
            expect(el.getAttribute('aria-describedby')!.split(' ')[0]).toBe(el.getAttribute('aria-labelledby'))
        }
    })
})

describe('TriggerList names', () => {
    test('regression reproducer: the Lua code field is named', async () => {
        const lua = [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '' }] }] as unknown as triggerscript[]
        const target = await show(TriggerList, { value: lua, lowLevelAble: true })
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})

describe('V2 trigger list names (list level; per-effect fields are #333)', () => {
    const header = (): triggerscript => ({ comment: '', type: 'manual', conditions: [], effect: [{ type: 'v2Header', code: '', indent: 0 }] }) as unknown as triggerscript
    const event = (): triggerscript => ({ comment: 'Event', type: 'manual', conditions: [], effect: [{ type: 'v2Comment', value: 'note', indent: 0 }] }) as unknown as triggerscript

    async function openEditor(): Promise<HTMLElement> {
        const target = await show(TriggerV2List, { value: [header(), event()] })
        target.querySelector<HTMLButtonElement>('button')!.click()
        await settle()
        return document.body
    }

    test('regression reproducer: the add, export and import buttons and the name field are named', async () => {
        const root = await openEditor()
        const row = Array.from(root.querySelectorAll<HTMLElement>('div.flex.gap-2')).find((d) => d.querySelectorAll('button svg').length === 3)!
        expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([language.add, language.export, language.import])
        expect(unnamedControls(root, { fields: true })).toEqual([])
        field(root, language.name)
        expect(exposedIcons(root)).toEqual([])
        // The effect rows' own markup comes from `formatEffectDisplay` (triggerEffectDisplay.ts, not an A3a
        // file), so the row buttons are skipped; the scrim is the one accepted palette class (E2).
        const scrim = root.querySelector<HTMLElement>('div.bg-black\\/50')
        expect(scrim).not.toBeNull()
        expect(paletteClasses(scrim!, { allow: [/^bg-black\/50$/], skip: ['button.break-all'] })).toEqual([])
    })

    test('regression reproducer: the back arrows of the effect picker and the effect editor are named', async () => {
        const root = await openEditor()
        const effect = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('note') || b.className.includes('flex-1 p-2'))!
        effect.click()
        await settle()
        effect.click()
        await settle()
        expect(controls(root).filter((el) => controlName(el) === '').map((el) => el.outerHTML)).toEqual([])
        const back = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.querySelector('svg'))
        expect(back.map(controlName)).toContain(language.settingsPage.back)
        expect(exposedIcons(root)).toEqual([])
    })
})
