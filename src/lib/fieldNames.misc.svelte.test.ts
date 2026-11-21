// @vitest-environment jsdom
/**
 * The remaining text fields of the A3c sweep are named through aria-labelledby to a label element, with that element
 * first in aria-describedby: the custom-sidebar settings search, the model grid search, the task-preset editor's name
 * and instructions fields and the multilingual field (named through the optional `labelId`/`label` it forwards).
 * REAL: the four components, TextInput, TextAreaInput (the highlight module is mocked, as TextAreaInput's own tests
 * do), CheckInput and the real language table. MOCKED: `stores.svelte`, the settings data lists, the model picker and
 * the confirm dialog, as the sibling tests do.
 * Excluded from the field assertions, with the reason: the editor's number inputs belong to #334 (MC-2562).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingItem } from 'src/ts/setting/types'
import { controlDescription, controlName, unnamedControls } from './a11yNames.test-helpers'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        customSideBarConfigDialogStore: { open: true },
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/setting/accessibilitySettingsData'), () => ({ accessibilitySettingsItems: [] }) as unknown as typeof import('src/ts/setting/accessibilitySettingsData'))
vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({ advancedSettingsItems: [] }) as unknown as typeof import('src/ts/setting/advancedSettingsData'))
vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    basicParameterItems: [], modelSpecificParameterItems: [], penaltyParameterItems: [], samplingParameterItems: [], seedSetting: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))
vi.mock(import('src/ts/setting/chatFormatSettingsData'), () => ({ chatFormatSettingsItems: [] }) as unknown as typeof import('src/ts/setting/chatFormatSettingsData'))
vi.mock(import('src/ts/setting/displaySettingsData.svelte'), () => ({ displaySettingsItems: [] }) as unknown as typeof import('src/ts/setting/displaySettingsData.svelte'))
vi.mock(import('src/ts/setting/utils'), async (importOriginal) => ({
    ...await importOriginal(),
    getFullSettingsData: () => [{ id: 'test.keyed', type: 'check', labelKey: 'visionQuality', fallbackLabel: 'Keyed Fallback' }] as unknown as SettingItem[],
}))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('./UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/gui/guisize', () => ({ textAreaSize: writable(0), textAreaTextSize: writable(1) }))
vi.mock('src/ts/gui/highlight', () => ({ highlighter: vi.fn(), getNewHighlightId: vi.fn(() => 1), removeHighlight: vi.fn(), AllCBS: ['random', 'randint'] }))
vi.mock('src/ts/platform', async (importOriginal) => ({ ...await importOriginal<typeof import('src/ts/platform')>(), isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import CustomSidebarConfig from './Others/CustomSidebarConfig.svelte'
import ModelGrid from './UI/ModelGrid.svelte'
import TaskPresetEditor from './Utility/TaskPresetEditor.svelte'
import MultiLangInput from './UI/GUI/MultiLangInput.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target, props }))
    flushSync()
    return target
}

const FIELDS = 'input[type="text"], input:not([type]), textarea, [role="textbox"]'
const fields = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>(FIELDS)]
const buttonWithText = (target: HTMLElement, text: string) => [...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === text)!

function expectNamed(el: HTMLElement, name: string): void {
    expect(controlName(el)).toBe(name)
    const labelId = el.getAttribute('aria-labelledby')!
    expect(labelId).not.toBe('')
    expect(el.getAttribute('aria-describedby')!.split(' ')[0]).toBe(labelId)
    expect(controlDescription(el).startsWith(name)).toBe(true)
}

beforeEach(() => { DBState.db = { customSidebarItems: [], taskPresets: [{ id: 'a', name: 'one', instructions: 'x', model: 'gpt4o' }] } as unknown as Database })
afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('misc field names', () => {
    test('CustomSidebarConfig: the settings search field is named by the search label', () => {
        const target = show(CustomSidebarConfig)
        buttonWithText(target, language.othersUi.addItem).click()
        flushSync()
        buttonWithText(target, language.settings).click()
        flushSync()
        expect(fields(target)).toHaveLength(1)
        expectNamed(fields(target)[0], language.settingsPage.searchEllipsis)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('ModelGrid: the search field is named by the model search label', () => {
        const items = [{ id: 'a/b', displayName: 'B', providerName: 'A', description: '', context_length: 1000, sortPrice: 1, prices: [] }]
        const target = show(ModelGrid, { items })
        expect(fields(target)).toHaveLength(1)
        expectNamed(fields(target)[0], language.openRouterSearchModel)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('TaskPresetEditor: the name and instructions fields are named by their label elements; the temperature switches are named', () => {
        const target = show(TaskPresetEditor)
        buttonWithText(target, 'one').click()
        flushSync()
        const [name, instructions] = fields(target)
        expectNamed(name, language.utility.editor.name)
        expectNamed(instructions, language.utility.editor.instructions)
        expect(fields(target)).toHaveLength(2)
        const boxes = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([language.utility.editor.useGlobalTemperature, language.utility.editor.useGlobalMaxTokens])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('MultiLangInput: labelId names the field; label names it when there is no visible label; neither leaves it as before', () => {
        const holder = document.createElement('div')
        holder.innerHTML = '<span id="notes-label">Creator notes</span>'
        document.body.appendChild(holder)
        mounted.push(mount(MultiLangInput, { target: holder, props: { value: '', labelId: 'notes-label' } }))
        flushSync()
        expectNamed(fields(holder)[0], 'Creator notes')

        const bare = show(MultiLangInput, { value: '', label: 'Hidden name' })
        expect(controlName(fields(bare)[0])).toBe('Hidden name')

        const plain = show(MultiLangInput, { value: '' })
        expect(fields(plain)[0].hasAttribute('aria-labelledby')).toBe(false)
        expect(fields(plain)[0].hasAttribute('aria-describedby')).toBe(false)
    })
})
