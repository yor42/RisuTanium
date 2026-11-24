// @vitest-environment jsdom

/**
 * `PromptSettings.svelte`: the back button and the icon-only add/remove buttons are named with their
 * glyphs hidden, every text field is named by its visible label (a label that holds a Help button
 * names the field by the label text only), and the warning box and the remove buttons use scheme
 * tokens. Mounts the REAL page with the real shared inputs, Help and Accordion; the heavy children,
 * tokenizer and the highlighter are mocks (those of `PromptSettings.falsyTemplate.svelte.test.ts`
 * and `TextAreaInput.ime.svelte.test.ts`).
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
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(0),
        openPresetList: writable(false),
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    return new Proxy({} as Record<string, unknown>, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
    tokenizerList: [],
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

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

vi.mock('src/lib/Studio/StudioToggleLink.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/PromptDataItem.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import PromptSettings from './PromptSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(subMenu: number): HTMLElement {
    DBState.db = {
        hotkeys: [],
        longPressToPopupEditor: false,
        promptTemplate: [],
        promptSettings: { postEndInnerFormat: '', maxThoughtTagDepth: 0 },
        showUnrecommended: true,
        jsonSchemaEnabled: true,
        auxModelUnderModelSettings: true,
        customPromptTemplateToggle: '',
        templateDefaultVariables: '',
        OAIPrediction: '',
        autoSuggestPrompt: '',
        groupTemplate: '',
        systemContentReplacement: '',
        jsonSchema: '',
        extractJson: '',
        groupOtherBotRole: 'user',
        systemRoleReplacement: 'user',
        fallbackModels: { model: ['a'], memory: [], translate: [], emotion: [], otherAx: [] },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptSettings, { target, props: { subMenu } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function fieldNamed(root: HTMLElement, label: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>('input[type="text"], input:not([type]), textarea, [role="textbox"]'))
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
    await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('PromptSettings accessible names', () => {
    test('regression reproducer: the back and add-template buttons are named and every glyph is hidden', () => {
        const target = mountPage(0)
        const back = target.querySelector('h2 > button') as HTMLButtonElement
        expect(controlName(back)).toBe(language.settingsPage.back)
        const add = Array.from(target.querySelectorAll(':scope > button')).find((b) => b.querySelector('svg') && !b.textContent?.trim())
        expect(controlName(add!)).toBe(language.add)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the text fields are named by their labels without the Help name', () => {
        const target = mountPage(1)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        for (const label of [
            language.postEndInnerFormat,
            language.customPromptTemplateToggle,
            language.defaultVariables,
            language.predictedOutput,
            language.autoSuggest,
            language.groupInnerFormat,
            language.systemContentReplacement,
            language.jsonSchema,
            language.extractJson,
        ]) {
            const field = fieldNamed(target, label)
            expect(controlDescription(field).startsWith(label)).toBe(true)
        }
    })

    test('regression reproducer: the fallback model add and remove buttons are named and use scheme tokens', () => {
        const target = mountPage(1)
        const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.fallbackModel)!
        header.click()
        flushSync()
        const modelHeader = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.model)!
        modelHeader.click()
        flushSync()
        const row = target.querySelector('div.flex.gap-2') as HTMLElement
        const buttons = Array.from(row.querySelectorAll('button'))
        expect(buttons.map(controlName)).toEqual([language.add, language.remove])
        expect(buttons[1].classList.contains('border-draculared')).toBe(true)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no Tailwind palette class remains on either tab', () => {
        expect(paletteClasses(mountPage(0))).toEqual([])
        expect(paletteClasses(mountPage(1))).toEqual([])
    })

    test('regression reproducer: the warning box uses the danger token for text and borders', () => {
        const target = mountPage(0)
        const box = target.querySelector('div.flex.flex-col.items-start.p-2') as HTMLElement
        expect(box.classList.contains('text-draculared')).toBe(true)
        expect(box.classList.contains('border-draculared')).toBe(true)
        expect(target.querySelector('.border-b-draculared')).not.toBeNull()
    })
})
