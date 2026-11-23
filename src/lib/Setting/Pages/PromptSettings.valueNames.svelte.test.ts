// @vitest-environment jsdom

/**
 * `PromptSettings.svelte` value controls: the thought-tag depth number input and the two role selects
 * are named by their visible label text through `aria-labelledby`; a label that also holds a Help
 * button names the control by the text alone. Mounts the REAL page with the real shared inputs, Help
 * and Accordion; the heavy children, tokenizer and highlighter are mocks of
 * `PromptSettings.names.svelte.test.ts`.
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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import PromptSettings from './PromptSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(subMenu: number, extra: Record<string, unknown> = {}): HTMLElement {
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
        ...extra,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptSettings, { target, props: { subMenu } }) as unknown as Record<string, unknown>
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
    await new Promise((resolve) => setTimeout(resolve, 0))
})

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

const SETTINGS_TABLE: FieldExpectation[] = [
    { name: language.maxThoughtTagDepth },
    { name: language.groupOtherBotRole },
    { name: language.systemRoleReplacement },
]

describe('PromptSettings value controls are named', () => {
    test('template tab has no value control', () => {
        check(mountPage(0), [])
    })

    test('settings tab: thought tag depth and the two role selects', () => {
        check(mountPage(1), SETTINGS_TABLE)
    })

    test('settings tab without the JSON schema fields and the unrecommended options keeps the same value controls', () => {
        check(mountPage(1, { jsonSchemaEnabled: false, showUnrecommended: false }), SETTINGS_TABLE)
    })
})
