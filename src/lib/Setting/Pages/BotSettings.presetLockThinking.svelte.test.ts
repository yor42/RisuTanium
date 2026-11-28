// @vitest-environment jsdom

/**
 * The thinking-type effect of the REAL `BotSettings.svelte` with the REAL `resolveClaudeThinkingType` and the real lock
 * accessors: on an adaptive-only Claude model a stored 'budget' is rewritten to 'adaptive' while reasoning is unlocked,
 * and kept as it is while reasoning is locked (the request resolves the thinking type at use). Unlocking re-runs the
 * effect and rewrites it. Mocks as in `BotSettings.auxPlace.svelte.test.ts`, except `getModelInfo` returns an
 * adaptive-only flag set and `resolveClaudeThinkingType` is not mocked.
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
    currentKeyForUi: vi.fn(() => ''),
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

// The real modellist pulls in the whole database module; the flag table lives in the light `model/types` module.
vi.mock(import('src/ts/model/modellist'), async () => {
    const { LLMFlags } = await vi.importActual<typeof import('src/ts/model/types')>('src/ts/model/types')
    return {
        getModelInfo: vi.fn(() => ({ name: 'stub', flags: [LLMFlags.claudeAdaptiveThinking], provider: 1, format: -1 })),
        LLMFlags,
        LLMFormat: {},
        LLMProvider: { Anthropic: 1 },
    } as unknown as typeof import('src/ts/model/modellist')
})

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
vi.mock('./Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))

import { DBState } from 'src/ts/stores.svelte'
import { setLocked } from 'src/ts/storage/presetLocks'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountWith(extra: Record<string, unknown>): void {
    DBState.db = {
        useLegacyGUI: false,
        aiModel: 'stub',
        subModel: 'stub',
        hideApiKey: true,
        claudeAPIKey: '',
        nanogptRequestModel: '',
        nanogptRequestModelName: '',
        nanogptUseSubscriptionEndpoint: false,
        nanogptKey: '',
        thinkingType: 'budget',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        textgenWebUIStreamURL: '',
        ...extra,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('BotSettings thinking-type effect and the reasoning lock', () => {
    test('unlocked: a budget thinking type on an adaptive-only Claude model is rewritten to adaptive', () => {
        mountWith({})
        expect(DBState.db.thinkingType).toBe('adaptive')
    })

    test('locked: the budget thinking type is kept as it is', () => {
        mountWith({ presetFieldLocks: ['reasoning'] })
        expect(DBState.db.thinkingType).toBe('budget')
    })

    test('a lock on another group does not keep it', () => {
        mountWith({ presetFieldLocks: ['sampling'], doNotChangeSeperateModels: true })
        expect(DBState.db.thinkingType).toBe('adaptive')
    })

    test('unlocking after mount re-runs the effect and rewrites it', () => {
        mountWith({ presetFieldLocks: ['reasoning'] })
        expect(DBState.db.thinkingType).toBe('budget')
        setLocked(DBState.db, 'reasoning', false)
        flushSync()
        expect(DBState.db.thinkingType).toBe('adaptive')
    })
})
