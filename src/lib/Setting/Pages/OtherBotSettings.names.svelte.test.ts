// @vitest-environment jsdom

/**
 * `OtherBotSettings.svelte` (all tabs at once, the legacy layout): every text field of the image,
 * speech and memory sections is named by its visible label, or by the key its placeholder already
 * uses, with the label listed first in `aria-describedby` (a label that holds a Help button names the
 * field by the label text only); the HypaV3 preset toolbar buttons are named with their glyphs hidden;
 * scheme tokens replace the palette classes, including the red delete buttons of the reference
 * images. Mounts the REAL page over a real `$state` database with the real shared inputs, Help,
 * Accordion and the real HypaV3 preset helpers. Mocks follow `OtherBotSettings.hypaV3Toolbar.svelte.test.ts`
 * (the key list and slider inputs are stubs: their inner controls belong to other tickets), plus the
 * highlighter, size and hotkey modules of `TextAreaInput.ime.svelte.test.ts`.
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
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import { DBState } from 'src/ts/stores.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const FIELDS = 'input[type="text"], input[type="password"], textarea, [role="textbox"]'

function baseDb(overrides: Record<string, unknown>): Database {
    return {
        useLegacyGUI: true,
        hideApiKey: false,
        hotkeys: [],
        longPressToPopupEditor: false,
        sdProvider: '',
        sdConfig: { enable_hr: true, width: 512, height: 512 },
        webUiUrl: '',
        NAIImgUrl: '',
        NAIApiKey: '',
        NAIImgModel: 'nai-diffusion-4-5-full',
        NAIImgConfig: {
            reference_mode: 'vibe',
            reference_strength_multiple: [0.7],
            vibe_data: { thumbnail: 'data:image/png;base64,AA==' },
            image: 'img1',
        },
        NAII2I: true,
        stabilityKey: '',
        comfyUiUrl: '',
        comfyConfig: { workflow: '', posNodeID: '', posInputName: '', negNodeID: '', negInputName: '' },
        falToken: '',
        falModel: 'fal-ai/flux-lora',
        falLora: '',
        openaiCompatImage: { url: '', key: '', model: '' },
        wavespeedImage: { key: '', model: 'x' },
        ttsAutoSpeech: false,
        elevenLabKey: '',
        voicevoxUrl: '',
        huggingfaceKey: '',
        fishSpeechKey: '',
        emotionProcesser: 'submodel',
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        supaMemoryKey: '',
        supaMemoryPrompt: '',
        hypaModel: 'MiniLM',
        hypaCustomSettings: { url: '', key: '', model: '' },
        voyageApiKey: '',
        hypaV3Presets: [createHypaV3Preset('A'), createHypaV3Preset('B')],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        ...overrides,
    } as unknown as Database
}

async function render(overrides: Record<string, unknown>, headers: string[]): Promise<HTMLElement> {
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
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return target
}

function fieldNames(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll<HTMLElement>(FIELDS)).map(controlName)
}

const SPEECH_FIELDS = [
    fillLang(language.settingsPage.nameApiKeyLower, { name: 'ElevenLabs' }),
    fillLang(language.settingsPage.nameUrl, { name: 'VOICEVOX' }),
    fillLang(language.settingsPage.nameApiKeyLower, { name: 'NovelAI' }),
    fillLang(language.settingsPage.nameKey, { name: 'Huggingface' }),
    fillLang(language.settingsPage.nameApiKey, { name: 'fish-speech' }),
]

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('OtherBotSettings image generation fields are named', () => {
    test.each([
        ['WebUI', 'webui', [
            'WebUI ' + language.providerURL, 'Sampler', 'Upscaler',
        ]],
        ['Novel AI', 'novelai', [
            'Novel AI ' + language.providerURL, language.apiKey,
        ]],
        ['Stability', 'stability', [
            fillLang(language.settingsPage.nameApiKey, { name: 'Stability' }),
        ]],
        ['ComfyUI', 'comfyui', [
            'ComfyUI ' + language.providerURL, language.comfyWorkflow,
        ]],
        ['ComfyUI legacy', 'comfy', [
            'ComfyUI ' + language.providerURL,
            language.settingsPage.workflow,
            language.settingsPage.positiveNodeId,
            language.settingsPage.positiveNodeField,
            language.settingsPage.negativeNodeId,
            language.settingsPage.positiveNodeField,
        ]],
        ['Fal', 'fal', [
            fillLang(language.settingsPage.nameApiKey, { name: 'Fal.ai' }),
            language.settingsPage.loraModelUrl,
        ]],
        ['OpenAI compatible', 'openai-compat', [
            'API URL', language.apiKey, language.model,
        ]],
        ['WaveSpeed', 'wavespeed', [
            language.apiKey, language.settingsPage.searchModels,
        ]],
    ])('regression reproducer: %s', async (_label, provider, specific) => {
        const target = await render({ sdProvider: provider }, [])
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(fieldNames(target)).toEqual([...specific, ...SPEECH_FIELDS])
        for (const field of target.querySelectorAll<HTMLElement>(FIELDS)) {
            expect(controlDescription(field).startsWith(controlName(field))).toBe(true)
        }
    })
})

describe('OtherBotSettings memory fields are named', () => {
    test('regression reproducer: HypaV3 prompts and the chunk separator, with the toolbar named', async () => {
        const target = await render({ hypaV3: true }, [language.advancedSettings])
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(fieldNames(target)).toEqual([
            ...SPEECH_FIELDS,
            language.summarizationPrompt,
            language.reSummarizationPrompt,
            language.hypaV3Settings.summaryChunkSeparatorLabel,
        ])
        const toolbar = Array.from(target.querySelectorAll('div.flex.items-center.mb-8 > button'))
        expect(toolbar.map(controlName)).toEqual([
            language.add, language.edit, language.remove, language.export, language.import,
            language.hypaV3Settings.duplicatePresetLabel,
        ])
    })

    test('regression reproducer: the V2 summary prompt and the legacy supa memory fields', async () => {
        const v2 = await render({ hypav2: true, supaModelType: 'instruct35' }, [])
        expect(fieldNames(v2)).toEqual([
            ...SPEECH_FIELDS,
            fillLang(language.settingsPage.nameKey, { name: `${language.SuperMemory} OpenAI` }),
            language.summarizationPrompt,
        ])
        const supa = await render({ supaModelType: 'instruct35' }, [])
        expect(fieldNames(supa)).toEqual([
            ...SPEECH_FIELDS,
            fillLang(language.settingsPage.nameKey, { name: `${language.SuperMemory} OpenAI` }),
            fillLang(language.settingsPage.namePrompt, { name: language.SuperMemory }),
        ])
    })

    test('regression reproducer: the embedding provider fields', async () => {
        // The database is shared, so each mount is checked before the next one replaces it.
        const custom = await render({ hypaModel: 'custom' }, [])
        expect(fieldNames(custom)).toEqual([...SPEECH_FIELDS, 'URL', language.proxyAPIKey, language.proxyRequestModel])
        expect(unnamedControls(custom, { fields: true })).toEqual([])
        const keyed = await render({ hypaModel: 'openai3small' }, [])
        expect(fieldNames(keyed)).toEqual([...SPEECH_FIELDS, fillLang(language.settingsPage.nameApiKey, { name: 'OpenAI' })])
        expect(unnamedControls(keyed, { fields: true })).toEqual([])
        const voyage = await render({ hypaModel: 'voyageContext3' }, [])
        expect(fieldNames(voyage)).toEqual([...SPEECH_FIELDS, fillLang(language.settingsPage.nameApiKey, { name: 'Voyage' })])
        expect(unnamedControls(voyage, { fields: true })).toEqual([])
    })
})

describe('OtherBotSettings glyphs and colours', () => {
    test('regression reproducer: glyphs are hidden and the delete buttons of the reference images use scheme tokens', async () => {
        const target = await render({ sdProvider: 'novelai', hypaV3: true }, [language.advancedSettings])
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target)).toEqual([])
        const deletes = Array.from(target.querySelectorAll('button.absolute'))
        expect(deletes.length).toBeGreaterThanOrEqual(2)
        for (const button of deletes) {
            expect(button.classList.contains('border-draculared')).toBe(true)
            expect(button.classList.contains('text-draculared')).toBe(true)
        }
    })

    test('regression reproducer: the error text and the comfy, wavespeed tiles use scheme tokens', async () => {
        const target = await render({ sdProvider: 'wavespeed', wavespeedImage: { key: 'k', model: 'x', reference_mode: 'image', reference_image: 'r1' } }, [])
        expect(paletteClasses(target)).toEqual([])
    })
})
