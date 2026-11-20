// @vitest-environment jsdom

/**
 * The auxiliary model selectors always render once, at the end of the Model tab, whatever
 * `auxModelUnderModelSettings` holds, and also in the legacy single-page layout. Mounts the REAL
 * `BotSettings.svelte` with the selectors replaced by a marker element; mocks as in
 * `BotSettings.keyList.svelte.test.ts`.
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
    return {
        DBState: state,
        selectedCharID: writable(0),
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/process/request/secretKey'), () => ({
    currentKey: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/request/secretKey'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
    tokenizerList: [],
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/model/openrouter'), () => ({
    getOpenRouterModels: vi.fn(async () => []),
    toModelGridItem: vi.fn(),
}) as unknown as typeof import('src/ts/model/openrouter'))

vi.mock(import('src/ts/model/nanogpt'), () => ({
    getNanoGPTModels: vi.fn(async () => []),
    getNanoGPTSubscriptionModels: vi.fn(async () => []),
    toModelGridItem: vi.fn(),
}) as unknown as typeof import('src/ts/model/nanogpt'))

vi.mock(import('src/ts/model/ollama'), () => ({
    getOllamaModels: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/model/ollama'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ name: 'stub', flags: [], provider: 1, format: -1 })),
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: { Anthropic: 1 },
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/model/types'), () => ({
    resolveClaudeThinkingType: vi.fn((_flags: unknown, current: unknown) => current),
}) as unknown as typeof import('src/ts/model/types'))

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    allBasicParameterItems: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))

vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/DropList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelGrid.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTDashboard.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTProviderPicker.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/Accordion.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/SettingRenderer.svelte', () => ({ default: () => {} }))
vi.mock('./OobaSettings.svelte', () => ({ default: () => {} }))
vi.mock('./OpenrouterSettings.svelte', () => ({ default: () => {} }))
vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))
vi.mock('./PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('./SeparateParametersSection.svelte', () => ({ default: () => {} }))
vi.mock('./Model/ModelDataRefresh.svelte', () => ({ default: () => {} }))
vi.mock('./Model/AuxModelSelectors.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('i')
        marker.setAttribute('data-aux-selectors', '')
        anchor.before(marker)
    },
}))

import { DBState } from 'src/ts/stores.svelte'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function markerCount(auxModelUnderModelSettings: boolean | undefined, useLegacyGUI: boolean): number {
    DBState.db = {
        useLegacyGUI,
        aiModel: 'stub',
        subModel: 'stub',
        hideApiKey: true,
        auxModelUnderModelSettings,
        claudeAPIKey: '',
        nanogptRequestModel: '',
        nanogptRequestModelName: '',
        nanogptUseSubscriptionEndpoint: false,
        nanogptKey: '',
        thinkingType: '',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        textgenWebUIStreamURL: '',
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target.querySelectorAll('[data-aux-selectors]').length
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('BotSettings hosts the aux selectors on the Model tab', () => {
    test.each([false, undefined, true])('BP1: exactly one selector block when the placement flag is %s', (flag) => {
        expect(markerCount(flag, false)).toBe(1)
    })

    test('BP1: the legacy single-page layout shows the selectors once', () => {
        expect(markerCount(false, true)).toBe(1)
    })
})
