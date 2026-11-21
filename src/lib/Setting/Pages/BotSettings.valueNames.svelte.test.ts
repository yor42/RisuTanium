// @vitest-environment jsdom

/**
 * `BotSettings.svelte` value controls (selects, number inputs and the parameter sliders of every
 * provider branch): each is named by its visible label text through `aria-labelledby`, with that label
 * first in `aria-describedby`, and no naming element is shared between two controls. Mounts the REAL page
 * over a real `$state` database with the real SliderInput, NumberInput, SelectInput, CheckInput, Help and
 * Accordion. Mocks are those of `BotSettings.names.svelte.test.ts` except SliderInput, which is real here;
 * the data-driven parameter renderer and the child settings panels stay stubs because their value controls
 * belong to their own files. The bias row's number input has no visible text of its own, so it takes the
 * column header text as a screen-reader-only name.
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
        selIdState: { selId: 0 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isMobile: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/process/request/secretKey'), () => ({
    currentKey: vi.fn(() => ''),
    currentKeyForUi: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/request/secretKey'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
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

const catalog = vi.hoisted(() => {
    const LLMProvider = { GoogleCloud: 1, VertexAI: 2, NovelList: 3, Anthropic: 4, AWS: 5, Mistral: 6, NovelAI: 7, Cohere: 8, OpenAI: 9 }
    const LLMFormat = { OpenAICompatible: 0, OpenAIResponseAPI: 18, Anthropic: 2, Mistral: 4, GoogleCloud: 5, Cohere: 8, Ollama: 19, NovelAI: 9, NovelList: 7 }
    const byId: Record<string, { provider: number, format: number, name?: string, keyIdentifier?: string }> = {
        google: { provider: LLMProvider.GoogleCloud, format: -1 },
        anthropic: { provider: LLMProvider.Anthropic, format: -1 },
        mistral: { provider: LLMProvider.Mistral, format: -1 },
        cohere: { provider: LLMProvider.Cohere, format: -1 },
        openai: { provider: LLMProvider.OpenAI, format: -1 },
        'novellist-key': { provider: LLMProvider.NovelList, format: -1 },
        'nai-token': { provider: LLMProvider.NovelAI, format: -1 },
        keyed: { provider: -1, format: -1, name: 'Keyed model', keyIdentifier: 'kid1' },
        keyedsub: { provider: -1, format: -1, name: 'Keyed sub', keyIdentifier: 'kid2' },
        vertex: { provider: LLMProvider.VertexAI, format: -1 },
        nai: { provider: -1, format: LLMFormat.NovelAI },
        novellist: { provider: -1, format: LLMFormat.NovelList },
    }
    return { LLMProvider, LLMFormat, byId }
})

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn((id: string) => ({ name: 'stub', flags: [], keyIdentifier: '', ...(catalog.byId[id] ?? { provider: -1, format: -1 }) })),
    LLMFlags: { hasStreaming: 8, geminiThinking: 15 },
    LLMFormat: catalog.LLMFormat,
    LLMProvider: catalog.LLMProvider,
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/model/types'), () => ({
    resolveClaudeThinkingType: vi.fn((_flags: unknown, current: unknown) => current),
}) as unknown as typeof import('src/ts/model/types'))

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    allBasicParameterItems: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))

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
vi.mock('src/lib/SideBars/DropList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelGrid.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTDashboard.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTProviderPicker.svelte', () => ({ default: () => {} }))
// The real KeyListInput is covered by its own test; here the stub records the `labelId` the page
// passes, as a non-form marker so the control counts of the other tests stay unchanged.
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({
    default: (anchor: Comment, props: { labelId?: string }) => {
        const marker = document.createElement('span')
        marker.setAttribute('data-key-list-label', props.labelId ?? '')
        anchor.before(marker)
    },
}))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/SettingRenderer.svelte', () => ({ default: () => {} }))
vi.mock('./OobaSettings.svelte', () => ({ default: () => {} }))
vi.mock('./OpenrouterSettings.svelte', () => ({ default: () => {} }))
vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))
vi.mock('./PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('./SeparateParametersSection.svelte', () => ({ default: () => {} }))
vi.mock('./Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))
vi.mock('./Model/ModelDataRefresh.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(aiModel: string, subModel: string, overrides: Record<string, unknown> = {}): HTMLElement {
    DBState.db = {
        useLegacyGUI: true,
        aiModel,
        subModel,
        hideApiKey: false,
        hotkeys: [],
        longPressToPopupEditor: false,
        google: { accessToken: '', projectId: '' },
        vertexClientEmail: '',
        vertexPrivateKey: '',
        vertexRegion: 'global',
        vertexAccessToken: '',
        vertexAccessTokenExpires: 0,
        forceReplaceUrl: '',
        customProxyRequestModel: '',
        proxyKey: '',
        customAPIFormat: 0,
        customTokenizer: '',
        currentPluginProvider: '',
        ollamaURL: '',
        ollamaModel: '',
        ollamaCloudModel: '',
        ollamaCloudModelName: '',
        ollamaModelName: '',
        ollamaModelSource: 'local',
        ollamaApiKey: '',
        ollamaInputMode: 'manual',
        ollamaRequestFormat: 0,
        ollamaThinkingMode: 'auto',
        nanogptKey: '',
        nanogptRequestModel: 'x',
        nanogptRequestModelName: '',
        nanogptUseSubscriptionEndpoint: false,
        nanogptSubscriptionState: '',
        nanogptProvider: '',
        koboldURL: '',
        echoMessage: '',
        echoDelay: 0,
        textgenWebUIBlockingURL: '',
        textgenWebUIStreamURL: '',
        hordeConfig: { apiKey: '' },
        reverseProxyOobaMode: false,
        useStreaming: false,
        streamGeminiThoughts: false,
        ooba: {
            formating: {},
            repetition_penalty: 1, length_penalty: 0, top_k: 0, top_p: 0, typical_p: 0, top_a: 0, no_repeat_ngram_size: 0,
        },
        localStopStrings: ['stop'],
        NAIsettings: {
            starter: '', seperator: '', topP: 0, topK: 0, topA: 0, tailFreeSampling: 0, typicalp: 0,
            repetitionPenalty: 0, repetitionPenaltyRange: 0, repetitionPenaltySlope: 0, frequencyPenalty: 0,
            presencePenalty: 0, mirostat_lr: 0, mirostat_tau: 0, cfg_scale: 1,
        },
        ainconfig: { top_p: 0, rep_pen: 0, rep_pen_range: 0, rep_pen_slope: 0, top_k: 1, top_a: 0, typical_p: 0 },
        bias: [['token', 0]],
        additionalParams: [['key', 'value']],
        customFlags: [],
        enableCustomFlags: false,
        modelTools: [],
        moduleIntergration: '',
        presetRegex: [],
        botPresets: [{ name: 'P', image: '' }],
        botPresetsId: 0,
        thinkingType: '',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        formatingOrder: [],
        promptPreprocess: false,
        auxModelUnderModelSettings: false,
        ...overrides,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    for (const text of [language.settingsPage.bias, language.additionalParams, language.moduleIntergration, language.icon]) {
        const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
        header?.click()
        flushSync()
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

const BIAS_VALUE: FieldExpectation = { name: language.value }
const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

describe('BotSettings value controls are named by their visible labels', () => {
    test.each([
        ['reverse proxy and Vertex: region, API format, tokenizer', 'reverse_proxy', 'vertex', {}, [
            { name: language.settingsPage.region },
            { name: language.format },
            { name: language.tokenizer },
        ]],
        ['Ollama cloud (non-Ollama request format) and the echo model: format, echo delay', 'ollama-cloud', 'echo_model', {}, [
            { name: 'Ollama ' + language.format },
            { name: language.settingsPage.echoDelaySeconds },
        ]],
        ['Ollama cloud with the Ollama request format: format and thinking', 'ollama-cloud', 'x', { ollamaRequestFormat: 19 }, [
            { name: 'Ollama ' + language.format },
            { name: fillLang(language.settingsPage.nameThinking, { name: 'Ollama' }) },
        ]],
        ['Ollama local: thinking', 'ollama-hosted', 'kobold', {}, [
            { name: fillLang(language.settingsPage.nameThinking, { name: 'Ollama' }) },
        ]],
        ['plugin model: plugin provider', 'custom', 'x', {}, [
            { name: language.plugin },
        ]],
        ['OpenRouter: tokenizer', 'openrouter', 'x', {}, [
            { name: language.tokenizer },
        ]],
    ] as Array<[string, string, string, Record<string, unknown>, FieldExpectation[]]>)('%s', (_label, aiModel, subModel, overrides, specific) => {
        const target = mountPage(aiModel, subModel, overrides)
        expect(fieldNameProblems(target, [...specific, BIAS_VALUE])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('text generation web UI (Ooba parameter sliders)', () => {
        const target = mountPage('textgen_webui', 'nanogpt')
        expect(fieldNameProblems(target, [
            ...names('Repetition Penalty', 'Length Penalty', 'Top K', 'Top P', 'Typical P', 'Top A', 'No Repeat n-gram Size'),
            BIAS_VALUE,
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('NovelAI format (NovelAI parameter sliders)', () => {
        const target = mountPage('nai', 'ooba')
        expect(fieldNameProblems(target, [
            ...names(
                'Top P', 'Top K', 'Top A', 'Tailfree Sampling', 'Typical P', 'Repetition Penalty',
                'Repetition Penalty Range', 'Repetition Penalty Slope', 'Frequency Penalty', 'Presence Penalty',
                'Mirostat LR', 'Mirostat Tau', 'Cfg Scale',
            ),
            BIAS_VALUE,
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('NovelList format (NovelList parameter sliders)', () => {
        const target = mountPage('novellist', 'x')
        expect(fieldNameProblems(target, [
            ...names(
                'Top P', 'Reputation Penalty', 'Reputation Penalty Range', 'Reputation Penalty Slope',
                'Top K', 'Top A', 'Typical P',
            ),
            BIAS_VALUE,
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('several bias rows: each number input has its own name element', () => {
        const target = mountPage('x', 'x', { bias: [['a', 1], ['b', 2], ['c', 3]] })
        expect(fieldNameProblems(target, [BIAS_VALUE, BIAS_VALUE, BIAS_VALUE])).toEqual([])
    })
})

/** The visible label text each KeyListInput on the page is pointed at, in document order. */
function keyListLabels(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('[data-key-list-label]')).map((marker) => {
        const label = document.getElementById(marker.getAttribute('data-key-list-label') ?? '')
        return label === null ? '' : (label.textContent ?? '').replace(/\s+/g, ' ').trim()
    })
}

describe('BotSettings key lists are named by their visible labels', () => {
    const key = language.apiKey
    test.each([
        ['GoogleAI', 'google', 'x', [fillLang(language.settingsPage.nameApiKey, { name: 'GoogleAI' })]],
        ['NovelList', 'novellist-key', 'x', [`NovelList ${key}`]],
        ['Mancer', 'mancer', 'x', [`Mancer ${key}`]],
        ['Claude', 'anthropic', 'x', [`Claude ${key}`]],
        ['Mistral', 'mistral', 'x', [`Mistral ${key}`]],
        ['NovelAI', 'nai-token', 'x', [fillLang(language.settingsPage.nameBearerToken, { name: 'NovelAI' })]],
        ['reverse proxy', 'reverse_proxy', 'x', [language.proxyAPIKey]],
        ['Cohere', 'cohere', 'x', [`Cohere ${key}`]],
        ['Ollama cloud', 'ollama-cloud', 'x', [`Ollama ${key}`]],
        ['NanoGPT', 'nanogpt', 'x', [`NanoGPT ${key}`]],
        ['OpenRouter', 'openrouter', 'x', [`OpenRouter ${key}`]],
        ['OpenAI keeps its Help button out of the name', 'openai', 'x', [`OpenAI ${key}`]],
        ['keyed model and keyed sub model', 'keyed', 'keyedsub', [`Keyed model ${key}`, `Keyed sub ${key}`]],
        ['Horde', 'horde', 'x', [`Horde ${key}`]],
    ] as Array<[string, string, string, string[]]>)('%s', (_label, aiModel, subModel, expected) => {
        const target = mountPage(aiModel, subModel, { OaiCompAPIKeys: {}, novelai: { token: '' } })
        expect(keyListLabels(target)).toEqual(expected)
    })
})

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []
