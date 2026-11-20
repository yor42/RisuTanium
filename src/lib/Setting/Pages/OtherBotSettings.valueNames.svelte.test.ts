// @vitest-environment jsdom

/**
 * `OtherBotSettings.svelte` value controls (selects, number inputs, sliders and the native preset select of
 * every provider and memory-engine branch): each is named by its visible label text through
 * `aria-labelledby`, with that label first in `aria-describedby`, and no naming element is shared between
 * two controls. A label that also holds a Help button names the control by an inner text span only. The
 * WaveSpeed model select and the LoRA weight sliders have no visible text of their own and take a
 * screen-reader-only name. Mounts the REAL page over a real `$state` database with the real shared inputs,
 * Help, Accordion and the real HypaV3 preset helpers. Mocks follow `OtherBotSettings.names.svelte.test.ts`,
 * except SliderInput, which is real here; the key list input stays a stub because its inner control belongs
 * to its own file.
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
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
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

async function render(overrides: Record<string, unknown>, headers: string[] = []): Promise<HTMLElement> {
    DBState.db = baseDb(overrides)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    for (const text of [language.imageGeneration, 'TTS', language.emotionImage, language.longTermMemory, ...headers]) {
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

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

const PROVIDER = `${language.imageGeneration} ${language.provider}`
const EMBEDDING = language.embedding
/** The emotion method select and the memory engine select follow the image section on every page. */
const EMOTION_AND_ENGINE = [language.emotionMethod, language.type]
const SUPA_MODEL = `${language.SuperMemory} ${language.model}`
const NAI_COMMON = [
    language.model, language.settingsPage.width, language.settingsPage.height, 'Sampler', 'Noise Schedule',
    'steps', 'CFG scale', 'CFG rescale', language.settingsPage.imageReference,
]

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('OtherBotSettings image generation value controls are named', () => {
    test('WebUI with hires: size numbers, steps, CFG, hires numbers', async () => {
        const target = await render({ sdProvider: 'webui' })
        check(target, names(
            PROVIDER, 'Steps', 'CFG Scale', language.settingsPage.width, language.settingsPage.height,
            'denoising_strength', 'hr_scale', ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('WebUI without hires drops the two hires numbers', async () => {
        const target = await render({ sdProvider: 'webui', sdConfig: { enable_hr: false, width: 512, height: 512 } })
        check(target, names(
            PROVIDER, 'Steps', 'CFG Scale', language.settingsPage.width, language.settingsPage.height,
            ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('Novel AI 4.5 with vibe reference and image to image', async () => {
        const target = await render({
            sdProvider: 'novelai',
            NAII2I: true,
            NAIImgConfig: {
                width: 832, height: 1216, sampler: 'k_euler', noise_schedule: 'native', steps: 28, scale: 5, cfg_rescale: 0,
                reference_mode: 'vibe', reference_strength_multiple: [0.7], vibe_model_selection: 'v4-5full',
                vibe_data: {
                    thumbnail: 'data:image/png;base64,AA==',
                    encodings: { 'v4-5full': { a: { params: { information_extracted: 1 } } } },
                },
                image: 'img1', strength: 0.5, noise: 0,
            },
        })
        check(target, names(
            PROVIDER, ...NAI_COMMON, 'Vibe Model', 'Information Extracted', 'Reference Strength Multiple',
            'Strength', 'Noise', ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('Novel AI 3 uses the second sampler select', async () => {
        const target = await render({ sdProvider: 'novelai', NAIImgModel: 'nai-diffusion-3' })
        check(target, names(PROVIDER, ...NAI_COMMON, ...EMOTION_AND_ENGINE, EMBEDDING))
    })

    test('Dall-E quality', async () => {
        const target = await render({ sdProvider: 'dalle' })
        check(target, names(
            PROVIDER, fillLang(language.settingsPage.nameQuality, { name: 'Dall-E' }), ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('Stability model and the SD Core style', async () => {
        const target = await render({ sdProvider: 'stability' })
        check(target, names(
            PROVIDER,
            fillLang(language.settingsPage.nameModel, { name: 'Stability' }),
            fillLang(language.settingsPage.nameStyle, { name: 'SD Core' }),
            ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('ComfyUI timeout', async () => {
        const target = await render({ sdProvider: 'comfyui' })
        check(target, names(PROVIDER, language.settingsPage.timeoutSec, ...EMOTION_AND_ENGINE, EMBEDDING))
    })

    test('ComfyUI legacy timeout', async () => {
        const target = await render({ sdProvider: 'comfy' })
        check(target, names(PROVIDER, language.settingsPage.timeoutSec, ...EMOTION_AND_ENGINE, EMBEDDING))
    })

    test('Fal size, model and the LoRA weight slider', async () => {
        const target = await render({ sdProvider: 'fal' })
        check(target, names(
            PROVIDER, language.settingsPage.width, language.settingsPage.height, language.model,
            language.settingsPage.loraWeight, ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('Imagen model, size, aspect ratio and person generation', async () => {
        const target = await render({ sdProvider: 'Imagen' })
        check(target, names(
            PROVIDER, language.model, language.settingsPage.imagenImageSize, language.settingsPage.aspectRatio,
            language.settingsPage.personGeneration, ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('OpenAI compatible size and quality', async () => {
        const target = await render({ sdProvider: 'openai-compat' })
        check(target, names(
            PROVIDER, language.settingsPage.imageSize, language.settingsPage.quality, ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })

    test('WaveSpeed before the model list is loaded: only the model select', async () => {
        const target = await render({ sdProvider: 'wavespeed' })
        check(target, names(PROVIDER, language.model, ...EMOTION_AND_ENGINE, EMBEDDING))
    })

    test('WaveSpeed with a LoRA and image-input model: LoRA weights and the reference select', async () => {
        const target = await render({ sdProvider: 'wavespeed', wavespeedImage: { key: 'k', model: 'm1' } })
        const refresh = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.settingsPage.refreshModels)
        refresh?.click()
        await settle()
        check(target, names(
            PROVIDER, language.model,
            ...[1, 2, 3].map((index) => fillLang(language.settingsPage.loraWeightIndexed, { index })),
            language.settingsPage.imageReference, ...EMOTION_AND_ENGINE, EMBEDDING,
        ))
    })
})

describe('OtherBotSettings memory value controls are named', () => {
    test('Hanurai chunk size', async () => {
        const target = await render({ hanuraiEnable: true })
        check(target, names(PROVIDER, ...EMOTION_AND_ENGINE, language.hypaChunkSize, EMBEDDING))
    })

    test('HypaMemory V2 model, chunk size and allocated tokens', async () => {
        const target = await render({ hypav2: true })
        check(target, names(
            PROVIDER, ...EMOTION_AND_ENGINE, SUPA_MODEL, language.hypaChunkSize, language.hypaAllocatedTokens, EMBEDDING,
        ))
    })

    test('legacy supa memory model and chunk size', async () => {
        const target = await render({ supaModelType: 'instruct35' })
        check(target, names(PROVIDER, ...EMOTION_AND_ENGINE, SUPA_MODEL, language.maxSupaChunkSize, EMBEDDING))
    })

    test('HypaV3 without recency weighting and with the simple implementation', async () => {
        const target = await render({ hypaV3: true }, [language.advancedSettings])
        check(target, names(
            PROVIDER, ...EMOTION_AND_ENGINE, language.settingsPage.preset, SUPA_MODEL,
            language.hypaV3Settings.maxMemoryTokensRatioLabel,
            language.hypaV3Settings.memoryTokensRatioLabel,
            language.hypaV3Settings.extraSummarizationRatioLabel,
            language.hypaV3Settings.maxChatsPerSummaryLabel,
            language.hypaV3Settings.queryChatCountLabel,
            language.hypaV3Settings.recentMemoryRatioLabel,
            language.hypaV3Settings.similarMemoryRatioLabel,
            language.hypaV3Settings.randomMemoryRatioLabel,
            EMBEDDING,
        ))
    })

    test('HypaV3 with recency weighting and the experimental implementation', async () => {
        const presets = [createHypaV3Preset('A'), createHypaV3Preset('B')]
        presets[0].settings.enableRecencyWeighting = true
        presets[0].settings.useExperimentalImpl = true
        const target = await render({ hypaV3: true, hypaV3Presets: presets }, [language.advancedSettings])
        check(target, names(
            PROVIDER, ...EMOTION_AND_ENGINE, language.settingsPage.preset, SUPA_MODEL,
            language.hypaV3Settings.maxMemoryTokensRatioLabel,
            language.hypaV3Settings.memoryTokensRatioLabel,
            language.hypaV3Settings.extraSummarizationRatioLabel,
            language.hypaV3Settings.maxChatsPerSummaryLabel,
            language.hypaV3Settings.queryChatCountLabel,
            language.hypaV3Settings.recentMemoryRatioLabel,
            language.hypaV3Settings.similarMemoryRatioLabel,
            language.hypaV3Settings.randomMemoryRatioLabel,
            language.hypaV3Settings.recencyHalfLifeDaysLabel,
            language.settingsPage.summarizationRequestsPerMinute,
            language.settingsPage.summarizationMaxConcurrent,
            language.settingsPage.embeddingRequestsPerMinute,
            language.settingsPage.embeddingMaxConcurrent,
            EMBEDDING,
        ))
    })
})
