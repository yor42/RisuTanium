// @vitest-environment jsdom

/**
 * The Vertex fields of the model tab invalidate the Vertex token through the single service entry:
 * editing the project id, the client email, the private key or the region calls
 * `invalidateVertexToken` with the live database. Mounts the REAL `BotSettings.svelte` over a real
 * `$state` database with the same module mocks as BotSettings.connections.svelte.test.ts; the token
 * service is replaced by a spy, so this is a contract test of the call sites, not of the service.
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
        selIdState: { selId: -1 },
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

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

vi.mock(import('src/ts/model/modellist'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getModelInfo: vi.fn(() => ({ name: 'stub', flags: [], provider: actual.LLMProvider.VertexAI, format: -1 })),
    } as unknown as typeof import('src/ts/model/modellist')
})

vi.mock(import('src/ts/model/types'), async (importOriginal) => ({
    ...(await importOriginal()),
    resolveClaudeThinkingType: vi.fn((_flags: unknown, current: unknown) => current),
}) as unknown as typeof import('src/ts/model/types'))

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    allBasicParameterItems: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))

vi.mock(import('src/ts/process/request/vertexToken'), () => ({
    invalidateVertexToken: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/vertexToken'))

vi.mock('src/lib/UI/NanoGPTDashboard.svelte', () => ({ default: () => {} }))
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
import { invalidateVertexToken } from 'src/ts/process/request/vertexToken'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountVertex(): HTMLElement {
    DBState.db = {
        useLegacyGUI: false,
        aiModel: 'vertex',
        subModel: 'vertex',
        hideApiKey: true,
        connections: [],
        google: { accessToken: '', projectId: '' },
        vertexClientEmail: '',
        vertexRegion: 'global',
        vertexAccessToken: 'cached',
        vertexAccessTokenExpires: 1,
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

function typeInto(target: HTMLElement, field: string, text: string) {
    const input = target.querySelector<HTMLInputElement>(`input[aria-labelledby$="-${field}"]`)
    expect(input, field).not.toBeNull()
    input!.focus()
    input!.value = text
    input!.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }))
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.mocked(invalidateVertexToken).mockClear()
})

describe('the Vertex fields invalidate the token through the service', () => {
    test('C1 typing the project id, the email or the private key calls the service with the live database', () => {
        const target = mountVertex()

        typeInto(target, 'f1', 'proj-1')
        expect(invalidateVertexToken).toHaveBeenCalledTimes(1)
        typeInto(target, 'f2', 'sa@proj.iam.gserviceaccount.com')
        expect(invalidateVertexToken).toHaveBeenCalledTimes(2)
        typeInto(target, 'f3', 'key-text')
        expect(invalidateVertexToken).toHaveBeenCalledTimes(3)

        for (const call of vi.mocked(invalidateVertexToken).mock.calls) {
            expect(call[0]).toBe(DBState.db)
        }
    })

    test('C1 changing the region calls the service with the live database', () => {
        const target = mountVertex()
        const select = target.querySelector<HTMLSelectElement>('select[aria-labelledby$="-vertexRegion"]')
        expect(select).not.toBeNull()

        select!.value = 'us-central1'
        select!.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()

        expect(DBState.db.vertexRegion).toBe('us-central1')
        expect(invalidateVertexToken).toHaveBeenCalledTimes(1)
        expect(vi.mocked(invalidateVertexToken).mock.calls[0][0]).toBe(DBState.db)
    })
})
