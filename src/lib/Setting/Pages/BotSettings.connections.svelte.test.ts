// @vitest-environment jsdom

/**
 * The model tab's NanoGPT section over a database whose key lives in a connection. Mounts the REAL
 * `BotSettings.svelte` over a real `$state` database with the real `secretKey` reader; the database
 * module, the model-list modules and every child component that is not part of the key box are mocked.
 * The NanoGPT dashboard stub records the `apiKey` prop it is rendered with.
 *
 * T19 compatibility guard (passes before and after; the key sits in both the legacy field and the connection so
 * either reader shows it): clearing the key field resets the five NanoGPT
 * fields. T22 reproducer: the dashboard receives the first line of the connection's key; a reader that
 * only looks at the legacy root field hands it an empty string.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database, StoredDatabase } from 'src/ts/storage/database.svelte'

const box = vi.hoisted(() => ({ dashboardKey: undefined as string | undefined }))

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
        selIdState: { selId: -1 },
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The real module: T10b drives the real setDatabase and changeToPreset over the mocked DBState.
vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => await importOriginal())

vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal()),
    selectSingleFile: vi.fn(),
}))

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

vi.mock(import('src/ts/model/modellist'), async (importOriginal) => ({
    ...(await importOriginal()),
    getModelInfo: vi.fn(() => ({ name: 'stub', flags: [], provider: 1, format: -1 })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/model/types'), async (importOriginal) => ({
    ...(await importOriginal()),
    resolveClaudeThinkingType: vi.fn((_flags: unknown, current: unknown) => current),
}) as unknown as typeof import('src/ts/model/types'))

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    allBasicParameterItems: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))

vi.mock('src/lib/UI/NanoGPTDashboard.svelte', () => ({
    default: (_anchor: unknown, props: { apiKey: string }) => {
        box.dashboardKey = props.apiKey
    },
}))

vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/DropList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelGrid.svelte', () => ({ default: () => {} }))
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
vi.mock('./Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))
vi.mock('./Model/ModelDataRefresh.svelte', () => ({ default: () => {} }))

import { DBState } from 'src/ts/stores.svelte'
import BotSettings from './BotSettings.svelte'
import { changeToPreset, setDatabase } from 'src/ts/storage/database.svelte'
import { leaseRequestKey } from 'src/ts/process/request/secretKey'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountNanoGPT(key: string, legacyKey = ''): HTMLElement {
    box.dashboardKey = undefined
    DBState.db = {
        useLegacyGUI: false,
        aiModel: 'nanogpt',
        subModel: 'nanogpt',
        hideApiKey: true,
        connections: [{ id: 'conn-1', name: 'NanoGPT', provider: 'nanogpt', key }],
        nanogptKey: legacyKey,
        nanogptRequestModel: 'model-a',
        nanogptRequestModelName: 'Model A',
        nanogptUseSubscriptionEndpoint: true,
        nanogptSubscriptionState: 'active',
        nanogptProvider: 'provider-a',
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
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the NanoGPT section reads its key from the connection', () => {
    test('T19 compatibility guard (passes before and after): clearing the key field resets the five NanoGPT fields', () => {
        const target = mountNanoGPT('nano-key', 'nano-key')
        const input = Array.from(target.querySelectorAll<HTMLInputElement>('input[type=password]')).find((node) => node.value === 'nano-key')
        expect(input).toBeDefined()

        input!.focus()
        input!.value = ''
        input!.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }))
        flushSync()

        expect(DBState.db.nanogptUseSubscriptionEndpoint).toBe(false)
        expect(DBState.db.nanogptSubscriptionState).toBe('')
        expect(DBState.db.nanogptRequestModel).toBe('')
        expect(DBState.db.nanogptRequestModelName).toBe('')
        expect(DBState.db.nanogptProvider).toBe('')
    })

    test('T22 the dashboard gets the first line of the connection key, not an empty legacy field', () => {
        mountNanoGPT('L1\nL2')

        expect(box.dashboardKey).toBe('L1')
    })

    test('an unrelated connection edit with a blank NanoGPT key leaves the NanoGPT fields alone', () => {
        mountNanoGPT('')
        const conns = DBState.db.connections as unknown as Array<Record<string, unknown>>
        DBState.db.connections = [...conns, { id: 'conn-2', name: 'OpenAI', provider: 'openai', key: '' }] as never
        flushSync()
        ;(DBState.db.connections as unknown as Array<Record<string, unknown>>)[1].key = 'sk-x'
        flushSync()

        expect(DBState.db.nanogptRequestModel).toBe('model-a')
        expect(DBState.db.nanogptUseSubscriptionEndpoint).toBe(true)
        expect(DBState.db.nanogptSubscriptionState).toBe('active')
        expect(DBState.db.nanogptRequestModelName).toBe('Model A')
        expect(DBState.db.nanogptProvider).toBe('provider-a')
    })
})

describe('the working proxy key is shared by every preset that names its connection', () => {
    test('T10b typing a new proxy key in the model tab reaches a preset switch to a preset that shared the pair', () => {
        const db = {
            characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', requestRetrys: 0, banCharacterset: [],
            useLegacyGUI: false, hideApiKey: true, aiModel: 'reverse_proxy', subModel: 'reverse_proxy', customProxyRequestModel: 'm',
            maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
            seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
            cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: '',
            instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
            google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
            claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '',
            OaiCompAPIKeys: {}, modelTools: [], customAPIFormat: 0, mainPrompt: '', jailbreak: '', globalNote: '', textgenWebUIStreamURL: '',
            proxyKey: 'K-old', forceReplaceUrl: 'https://p.invalid/v1',
            botPresets: [{ name: 'A' }, { name: 'B' }], botPresetsId: 0,
        } as unknown as StoredDatabase
        // Upstream's own save fills each stored preset from the working fields, as the producer does.
        upstreamSaveCurrentPreset(db)
        db.botPresetsId = 1
        upstreamSaveCurrentPreset(db)
        db.botPresetsId = 0
        setDatabase(db)

        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        const input = Array.from(target.querySelectorAll<HTMLInputElement>('input[type=password]')).find((node) => node.value === 'K-old')
        expect(input).toBeDefined()
        input!.focus()
        input!.value = 'K-new'
        input!.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'K-new' }))
        flushSync()
        changeToPreset(1)

        expect(DBState.db.botPresetsId).toBe(1)
        return leaseRequestKey({}, 'proxyKey').then((key) => expect(key).toBe('K-new'))
    })
})
