// @vitest-environment jsdom

/**
 * The auxiliary model selectors live on the Model tab only: `PromptSettings.svelte` never mounts them,
 * whatever `auxModelUnderModelSettings` holds. Mounts the REAL page with the selectors replaced by a marker
 * element; mocks as in `PromptSettings.names.svelte.test.ts`.
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

vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/PromptDataItem.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Model/AuxModelSelectors.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('i')
        marker.setAttribute('data-aux-selectors', '')
        anchor.before(marker)
    },
}))

import { DBState } from 'src/ts/stores.svelte'
import PromptSettings from './PromptSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountSettingsTab(auxModelUnderModelSettings: boolean | undefined): HTMLElement {
    DBState.db = {
        hotkeys: [],
        longPressToPopupEditor: false,
        promptTemplate: [],
        promptSettings: { postEndInnerFormat: '', maxThoughtTagDepth: 0 },
        showUnrecommended: true,
        jsonSchemaEnabled: true,
        auxModelUnderModelSettings,
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
    const app = mount(PromptSettings, { target, props: { mode: 'inline', subMenu: 1 } }) as unknown as Record<string, unknown>
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

describe('PromptSettings does not host the aux selectors', () => {
    test.each([false, undefined, true])('PP1: no selectors on the settings tab when the placement flag is %s', (flag) => {
        const target = mountSettingsTab(flag)

        expect(target.querySelectorAll('[data-aux-selectors]')).toHaveLength(0)
    })
})
