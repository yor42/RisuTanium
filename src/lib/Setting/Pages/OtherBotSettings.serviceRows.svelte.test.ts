// @vitest-environment jsdom

/**
 * The "connection used" row under every key editor of `OtherBotSettings.svelte`: each of the 14 editors is followed by
 * the row of its own slot. Mounts the REAL page over a real `$state` database; mocks follow
 * `OtherBotSettings.valueNames.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
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
        selIdState: { selId: 0 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isMobile: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/media/charImageLookups'), () => ({
    useCharImageLookups: () => ({ get: async () => 'data:image/png;base64,AA==' }),
}) as unknown as typeof import('src/ts/media/charImageLookups'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/process/wavespeedModels'), () => ({
    requestWavespeedModels: vi.fn(async () => ({
        ok: true,
        data: {
            code: 200,
            data: [{
                model_id: 'm1',
                name: 'M1',
                base_price: 1,
                type: 'image-to-image',
                api_schema: { api_schemas: [{ request_schema: { properties: { loras: {} } } }] },
            }],
        },
    })),
}) as unknown as typeof import('src/ts/process/wavespeedModels'))

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
// The real KeyListInput is covered by its own test; here the stub records the `labelId` the page
// passes, as a non-form marker so the control counts of the other tests stay unchanged.
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({
    default: (anchor: Comment, props: { labelId?: string }) => {
        const marker = document.createElement('span')
        marker.setAttribute('data-key-list-label', props.labelId ?? '')
        anchor.before(marker)
    },
}))

import { language } from 'src/lang'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import { DBState } from 'src/ts/stores.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function baseDb(overrides: Record<string, unknown>): Database {
    return {
        useLegacyGUI: true,
        hideApiKey: false,
        hotkeys: [],
        longPressToPopupEditor: false,
        sdProvider: '',
        sdSteps: 20,
        sdCFG: 7,
        sdConfig: { enable_hr: true, width: 512, height: 512, denoising_strength: 0.5, hr_scale: 2 },
        webUiUrl: '',
        NAIImgUrl: '',
        NAIApiKey: '',
        NAIImgModel: 'nai-diffusion-4-5-full',
        NAIImgConfig: { width: 832, height: 1216, sampler: 'k_euler', noise_schedule: 'native', steps: 28, scale: 5, cfg_rescale: 0, reference_mode: '', strength: 0.5, noise: 0 },
        NAII2I: false,
        stabilityKey: '',
        stabilityModel: 'core',
        stabllityStyle: '',
        dallEQuality: 'standard',
        comfyUiUrl: '',
        comfyConfig: { workflow: '', posNodeID: '', posInputName: '', negNodeID: '', negInputName: '', timeout: 30 },
        falToken: '',
        falModel: 'fal-ai/flux-lora',
        falLora: '',
        falLoraScale: 1,
        ImagenModel: 'imagen-4.0-generate-001',
        ImagenImageSize: '1K',
        ImagenAspectRatio: '1:1',
        ImagenPersonGeneration: 'allow_all',
        google: { accessToken: '' },
        openaiCompatImage: { url: '', key: '', model: '', size: '1024x1024', quality: 'auto' },
        wavespeedImage: { key: '', model: '' },
        ttsAutoSpeech: false,
        elevenLabKey: '',
        voicevoxUrl: '',
        huggingfaceKey: '',
        fishSpeechKey: '',
        emotionProcesser: 'submodel',
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        hanuraiTokens: 1000,
        hypaChunkSize: 3000,
        hypaAllocatedTokens: 3000,
        maxSupaChunkSize: 3000,
        supaModelType: 'none',
        supaMemoryKey: '',
        supaMemoryPrompt: '',
        hypaMemory: false,
        hypaModel: 'MiniLM',
        hypaCustomSettings: { url: '', key: '', model: '' },
        voyageApiKey: '',
        hypaV3Presets: [createHypaV3Preset('A'), createHypaV3Preset('B')],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        ...overrides,
    } as unknown as Database
}


async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

async function render(overrides: Record<string, unknown>): Promise<HTMLElement> {
    DBState.db = baseDb(overrides)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    for (const text of [language.imageGeneration, 'TTS', language.emotionImage, language.longTermMemory]) {
        const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
        header?.click()
        flushSync()
    }
    await settle()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

/** The first row that follows an editor in document order: the one that belongs to it. */
function rowAfter(target: HTMLElement, slot: string): HTMLElement | null {
    const input = target.querySelector<HTMLElement>(`[data-slot-key="field"][data-slot="${slot}"]`)
    if (!input) return null
    const rows = Array.from(target.querySelectorAll<HTMLElement>('[data-part="settings-service-connection"]'))
    return rows.find((row) => input.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null
}

const SITES: Array<{ name: string, overrides: Record<string, unknown>, labelSuffix: string, slot: string }> = [
    { name: 'NovelAI image', overrides: { sdProvider: 'novelai' }, labelSuffix: '-f5', slot: 'NAIApiKey' },
    { name: 'Stability', overrides: { sdProvider: 'stability' }, labelSuffix: '-f6', slot: 'stabilityKey' },
    { name: 'fal', overrides: { sdProvider: 'fal' }, labelSuffix: '-f15', slot: 'falToken' },
    { name: 'OpenAI-compatible image', overrides: { sdProvider: 'openai-compat' }, labelSuffix: '-f18', slot: 'openaiCompatImage.key' },
    { name: 'WaveSpeed', overrides: { sdProvider: 'wavespeed' }, labelSuffix: '-f20', slot: 'wavespeedImage.key' },
    { name: 'ElevenLabs', overrides: {}, labelSuffix: '-f21', slot: 'elevenLabKey' },
    { name: 'NovelAI voice', overrides: {}, labelSuffix: '-f23', slot: 'NAIApiKey' },
    { name: 'Hugging Face', overrides: {}, labelSuffix: '-f24', slot: 'huggingfaceKey' },
    { name: 'Fish Audio', overrides: {}, labelSuffix: '-f25', slot: 'fishSpeechKey' },
    { name: 'Memory (OpenAI), HypaV2 branch', overrides: { hypav2: true, supaModelType: 'davinci' }, labelSuffix: '-f26', slot: 'supaMemoryKey' },
    { name: 'Memory (OpenAI), SuperMemory branch', overrides: { supaModelType: 'davinci' }, labelSuffix: '-f31', slot: 'supaMemoryKey' },
    { name: 'Memory (OpenAI), embedding branch', overrides: { hypaV3: true, supaModelType: 'davinci', hypaModel: 'openai3small' }, labelSuffix: '-f33', slot: 'supaMemoryKey' },
    { name: 'Custom embedding', overrides: { hypaV3: true, supaModelType: 'davinci', hypaModel: 'custom' }, labelSuffix: '-f35', slot: 'hypaCustomSettings.key' },
    { name: 'Voyage', overrides: { hypaV3: true, supaModelType: 'davinci', hypaModel: 'voyageContext3' }, labelSuffix: '-f37', slot: 'voyageApiKey' },
]

describe('E-OBS: a connection row under each key editor', () => {
    test.each(SITES)('$name: the editor is followed by the row of slot $slot', async ({ overrides, labelSuffix, slot }) => {
        const target = await render(overrides)
        expect(target.querySelector(`[data-slot-key="field"][data-slot="${slot}"]`)).not.toBeNull()
        // A blank key opens the Replace key field, whose label is the one this site passes.
        expect(target.querySelector(`[data-key-list-label$="${labelSuffix}"]`)).not.toBeNull()
        expect(rowAfter(target, slot)?.getAttribute('data-slot')).toBe(slot)
    })

    test('the row shows the connection that holds the key', async () => {
        const target = await render({ sdProvider: 'fal', connections: [{ id: 'conn-1', name: 'My fal', provider: 'fal', key: 'SYN-fal-key-0000' }] })
        expect(rowAfter(target, 'falToken')?.textContent).toContain(language.connectionsServiceUses.replace('{name}', 'My fal'))
    })

    test('an editor with no connection shows the no-connection line', async () => {
        const target = await render({ sdProvider: 'fal' })
        expect(rowAfter(target, 'falToken')?.textContent).toContain(language.connectionsServiceNone)
    })
})