// @vitest-environment happy-dom

/**
 * S4d-T3: the classic icon button of `BotSettings.svelte` writes the current preset's image through the shared
 * `pickPresetIcon` helper (a 48x48 JPEG at quality 0.7). Mounts the REAL page over a real `$state` database; the
 * heavy children are stubbed and the accordion renders its content.
 *
 * MOCKED: `alert`, `stores.svelte`, `globalApi.svelte`, `platform`, `util` (the file picker), `tokenizer`,
 * `plugins.svelte`, the model-list modules, the canvas, the image and the object URL (happy-dom has none).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ pick: vi.fn<(ext: string[]) => Promise<{ name: string; data: Uint8Array } | null>>() }))

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
        SettingsMenuIndex: writable(-1),
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
    selectSingleFile: h.pick,
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
    getModelInfo: vi.fn(() => ({ name: 'stub', flags: [], provider: -1, format: -1 })),
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
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
vi.mock('src/lib/UI/Accordion.svelte', () => ({ default: (anchor: Node, props: { children?: (anchor: Node) => void }) => props.children?.(anchor) }))
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
import { language } from 'src/lang'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
const calls: string[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    calls.length = 0
    h.pick.mockReset()
    DBState.db = {
        useLegacyGUI: true,
        aiModel: 'stub',
        subModel: 'stub',
        hideApiKey: true,
        nanogptRequestModel: '',
        nanogptRequestModelName: '',
        nanogptUseSubscriptionEndpoint: false,
        nanogptKey: '',
        thinkingType: '',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        textgenWebUIStreamURL: '',
        bias: [],
        additionalParams: [],
        modelTools: [],
        presetRegex: [],
        botPresets: [{ name: 'A' }, { name: 'B', image: 'data:old' }],
        botPresetsId: 0,
    } as unknown as Database
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (_img: unknown, x: number, y: number, w: number, hh: number) => { calls.push(`draw ${x},${y},${w},${hh}`) } }),
        toDataURL: (type: string, quality: number) => { calls.push(`encode ${canvas.width}x${canvas.height} ${type} ${quality}`); return 'data:image/jpeg;base64,CLASSIC' },
    }
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => (tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : create(tag)))
    vi.stubGlobal('Image', class { src = ''; decode = async () => { calls.push('decode') } })
    const urls = globalThis.URL
    vi.stubGlobal('URL', Object.assign(function URLStub() {}, urls, { createObjectURL: () => 'blob:icon' }))
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('S4d-T3: the classic icon button writes through the shared 48x48 JPEG helper', () => {
    test('a picked image becomes the current preset image through the helper call sequence', async () => {
        h.pick.mockResolvedValue({ name: 'a.png', data: new Uint8Array([1]) })
        const target = mountPage()
        const button = target.querySelector<HTMLElement>(`button[aria-label="${language.chooseIconImage}"]`)
        expect(button).not.toBeNull()
        button?.click()
        await vi.waitFor(() => expect(DBState.db.botPresets[0].image).toBe('data:image/jpeg;base64,CLASSIC'))
        expect(calls).toEqual(['decode', 'draw 0,0,48,48', 'encode 48x48 image/jpeg 0.7'])
        expect(DBState.db.botPresets[1].image).toBe('data:old')
    })

    test('a cancelled pick leaves the image alone', async () => {
        h.pick.mockResolvedValue(null)
        const target = mountPage()
        target.querySelector<HTMLElement>(`button[aria-label="${language.chooseIconImage}"]`)?.click()
        await vi.waitFor(() => expect(h.pick).toHaveBeenCalledTimes(1))
        await Promise.resolve()
        expect(DBState.db.botPresets[0].image).toBeUndefined()
        expect(calls).toEqual([])
    })
})