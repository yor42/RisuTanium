// @vitest-environment jsdom

/**
 * `BotSettings.svelte` (all tabs at once, the legacy layout): every text field is named by its visible
 * label, or by the key its placeholder or table header already uses, with the label listed first in
 * `aria-describedby` (a label that holds a Help button names the field by the label text only); the
 * icon-only add, remove, export, import and upload buttons are named with their glyphs hidden; the
 * hovers use scheme tokens. Mounts the REAL page over a real `$state` database with the real shared
 * inputs, Help, Accordion and SegmentedControl. Mocks are those of `BotSettings.keyList.svelte.test.ts`
 * (the key list, slider and model grid are stubs: their inner controls belong to other tickets) with a
 * model catalog whose provider and format constants match the branches each run needs, plus the
 * highlighter, size and hotkey modules of `TextAreaInput.ime.svelte.test.ts`.
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
    const byId: Record<string, { provider: number, format: number }> = {
        vertex: { provider: LLMProvider.VertexAI, format: -1 },
        nai: { provider: -1, format: LLMFormat.NovelAI },
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
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => {} }))
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
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(aiModel: string, subModel: string): HTMLElement {
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
        ooba: { formating: {} },
        localStopStrings: ['stop'],
        NAIsettings: { starter: '', seperator: '' },
        ainconfig: {},
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

function fieldNames(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], input[type="password"], textarea, [role="textbox"]'))
        .map(controlName)
}

const COMMON_FIELDS = [
    language.settingsPage.bias,
    language.key,
    language.value,
    language.moduleIntergration,
    language.mainPrompt,
    language.jailbreakPrompt,
    language.globalNote,
]

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('BotSettings text fields are named', () => {
    test.each([
        ['reverse proxy and Vertex', 'reverse_proxy', 'vertex', [
            language.settingsPage.projectId,
            fillLang(language.settingsPage.nameClientEmail, { name: 'Vertex' }),
            fillLang(language.settingsPage.namePrivateKey, { name: 'Vertex' }),
            'URL',
            language.proxyRequestModel,
        ]],
        ['Ollama local and Kobold', 'ollama-hosted', 'kobold', [
            fillLang(language.settingsPage.nameUrl, { name: 'Ollama' }),
            fillLang(language.settingsPage.nameModel, { name: 'Ollama' }),
            fillLang(language.settingsPage.nameUrl, { name: 'Kobold' }),
        ]],
        ['Ollama cloud and the echo model', 'ollama-cloud', 'echo_model', [
            'Ollama ' + language.model,
            language.settingsPage.echoMessage,
        ]],
        ['text generation web UI and NanoGPT', 'textgen_webui', 'nanogpt', [
            'NanoGPT ' + language.model,
            fillLang(language.settingsPage.blockingProviderUrl, { url: language.providerURL }),
            fillLang(language.settingsPage.streamProviderUrl, { url: language.providerURL }),
            language.customStopWords,
        ]],
        ['NovelAI and Ooba', 'nai', 'ooba', [
            'Ooba ' + language.providerURL,
            language.settingsPage.starter,
            language.settingsPage.seperator,
        ]],
    ])('regression reproducer: %s', (_label, aiModel, subModel, specific) => {
        const target = mountPage(aiModel, subModel)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(fieldNames(target)).toEqual([...specific, ...COMMON_FIELDS])
        for (const field of target.querySelectorAll<HTMLElement>('input[type="text"], input[type="password"], textarea, [role="textbox"]')) {
            expect(controlDescription(field).startsWith(controlName(field))).toBe(true)
        }
    })
})

describe('BotSettings icon buttons and colours', () => {
    test('regression reproducer: the stop string, bias, additional parameter and icon buttons are named and the glyphs hidden', () => {
        const target = mountPage('textgen_webui', 'nanogpt')
        const names = (selector: string) => Array.from(target.querySelectorAll(selector)).map(controlName)
        expect(names('div.flex.flex-col.p-2.rounded-sm button')).toEqual([language.add, language.remove])
        expect(names('table th button, table td button')).toEqual([
            language.add, language.remove, language.add, language.remove,
        ])
        expect(names('div.text-textcolor2.mt-2.flex.items-center.gap-2 > button')).toEqual([language.export, language.import])
        expect(Array.from(target.querySelectorAll('button')).map(controlName)).toContain(language.chooseIconImage)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no Tailwind palette class remains', () => {
        expect(paletteClasses(mountPage('textgen_webui', 'nanogpt'))).toEqual([])
        expect(paletteClasses(mountPage('nai', 'ooba'))).toEqual([])
    })
})
