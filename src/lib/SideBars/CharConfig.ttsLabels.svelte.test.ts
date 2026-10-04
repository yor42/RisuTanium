// @vitest-environment happy-dom

/**
 * The TTS tab and the Bias section of the REAL `CharConfig.svelte`, mounted once per
 * voice mode.
 *
 * Invariants pinned here:
 *  - under English every label and option text is the tab's English text, and no label
 *    renders as "undefined";
 *  - under Korean the descriptive labels are the Korean locale values, while engine and
 *    parameter names stay English;
 *  - the `value` attribute of every `<option>` is the stored value and does not follow
 *    the display language;
 *  - the Bias label, the table header and the token placeholder follow the language.
 *
 * Every module `CharConfig.svelte` imports and every child component other than the
 * form inputs is a fake; the fish-speech model request is a stubbed `fetch` that
 * returns an empty list, so nothing reaches the network.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        CharConfigSubMenu: writable(5),
        MobileGUI: writable(false),
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    saveImage: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    addCharEmotion: vi.fn(),
    addingEmotion: writable(false),
    getCharImage: vi.fn(() => ''),
    rmCharEmotion: vi.fn(),
    selectCharImg: vi.fn(),
    makeGroupImage: vi.fn(),
    removeChar: vi.fn(),
    changeCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(() => null),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportChar: vi.fn(),
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/tts'), () => ({
    getElevenTTSVoices: vi.fn(async () => []),
    getWebSpeechTTSVoices: vi.fn(() => []),
    getVOICEVOXVoices: vi.fn(async () => []),
    getNovelAIVoices: vi.fn(() => []),
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/group'), () => ({
    addGroupChar: vi.fn(),
    rmCharFromGroup: vi.fn(),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/transformers'), () => ({
    registerOnnxModel: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/modules'), () => ({
    applyModule: vi.fn(),
    getModuleAssets: vi.fn(() => []),
    getModuleLorebooks: vi.fn(() => []),
    getModules: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('./LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./BarIcon.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../UI/GUI/MultiLangInput.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageKorean } from 'src/lang/ko'
import CharConfig from './CharConfig.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

//#region fixtures

type Patch = Record<string, unknown>

function install(ttsMode: string, patch: Patch = {}): void {
    DBState.db = {
        characters: [{
            chaId: 'char-a',
            name: 'Alpha',
            type: 'character',
            ttsMode,
            ttsSpeech: '',
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }],
            vits: null,
            oaiVoice: 'alloy',
            bias: [],
            personality: '',
            scenario: '',
            additionalData: {},
            depth_prompt: { depth: 0, prompt: '' },
            alternateGreetings: [],
            voicevoxConfig: { SPEED_SCALE: 1, PITCH_SCALE: 0, INTONATION_SCALE: 1, VOLUME_SCALE: 1, speaker: '[{"id":1,"name":"Normal"}]' },
            hfTTS: { model: '', language: 'en' },
            naittsConfig: { customvoice: false, voice: 'Aini', version: 'v2' },
            oaiTTSConfig: { enabled: true, format: 'mp3' },
            gptSoVitsConfig: {
                url: '',
                use_auto_path: false,
                ref_audio_path: '',
                use_long_audio: false,
                use_prompt: true,
                ref_audio_data: { fileName: 'ref.wav', assetId: 'asset-1' },
                volume: 1,
                text_lang: 'auto',
                text: 'en',
                prompt: '',
                prompt_lang: 'en',
                top_p: 1,
                temperature: 0.7,
                speed: 1,
                top_k: 5,
                text_split_method: 'cut0',
            },
            fishSpeechConfig: { model: { _id: '', title: '', description: '' }, chunk_length: 200, normalize: false },
            additionalAssets: [],
            emotionImages: [],
            ...patch,
        }],
        personas: [],
        modules: [],
    } as never
}

async function mountConfig(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: {} }))
    flushSync()
    await tick()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return target
}

/** The Korean locale value at a dotted path, from the locale file itself (not merged over English). */
function koValue(path: string): string {
    let node: unknown = languageKorean
    for (const part of path.split('.')) {
        node = (node as Record<string, unknown> | undefined)?.[part]
    }
    expect(node, `the Korean locale value at ${path}`).toBeTypeOf('string')
    return node as string
}

function enValue(path: string, english: string): string {
    // The English text is pinned literally by each case; the Korean value must differ from it.
    expect(koValue(path), `the Korean value at ${path} differs from English`).not.toBe(english)
    return koValue(path)
}

function labelTexts(root: HTMLElement): string[] {
    return [...root.querySelectorAll('span, th, option')].map((el) => el.textContent?.trim() ?? '')
}

function optionTexts(select: HTMLSelectElement): string[] {
    return [...select.options].map((o) => (o.textContent ?? '').trim())
}

function optionValues(select: HTMLSelectElement): string[] {
    return [...select.options].map((o) => o.getAttribute('value') ?? '')
}

function selectHaving(root: HTMLElement, optionValue: string, nth = 0): HTMLSelectElement {
    const found = [...root.querySelectorAll('select')].filter((s) => optionValues(s).includes(optionValue))
    expect(found.length, `selects holding an option valued ${optionValue}`).toBeGreaterThan(nth)
    return found[nth]
}

/** A label: its exact English text, the dotted Korean locale path or `null` when the name stays English. */
interface Label {
    en: string
    ko: string | null
}

interface ModeCase {
    name: string
    mode: string
    patch?: Patch
    labels: Label[]
}

const CASES: ModeCase[] = [
    {
        name: 'VOICEVOX',
        mode: 'VOICEVOX',
        labels: [
            { en: 'Speaker', ko: 'sidebarUi.ttsSpeaker' },
            { en: 'Style', ko: 'sidebarUi.ttsStyle' },
            { en: 'Speed scale', ko: null },
            { en: 'Pitch scale', ko: null },
            { en: 'Volume scale', ko: null },
            { en: 'Intonation scale', ko: null },
        ],
    },
    {
        name: 'OpenAI advanced endpoint',
        mode: 'openai',
        labels: [
            { en: 'Voice', ko: 'sidebarUi.ttsVoice' },
            { en: 'Base URL', ko: null },
            { en: 'Model', ko: 'model' },
            { en: 'Response Format', ko: null },
        ],
    },
    {
        name: 'NovelAI with a preset voice',
        mode: 'novelai',
        labels: [
            { en: 'Custom Voice Seed', ko: 'sidebarUi.ttsCustomVoiceSeed' },
            { en: 'Voice', ko: 'sidebarUi.ttsVoice' },
            { en: 'Version', ko: 'sidebarUi.ttsVersion' },
            { en: 'v1', ko: null },
            { en: 'v2', ko: null },
        ],
    },
    {
        name: 'NovelAI with a custom voice seed',
        mode: 'novelai',
        patch: { naittsConfig: { customvoice: true, voice: 'seed', version: 'v2' } },
        labels: [
            { en: 'Custom Voice Seed', ko: 'sidebarUi.ttsCustomVoiceSeed' },
            { en: 'Voice', ko: 'sidebarUi.ttsVoice' },
            { en: 'Version', ko: 'sidebarUi.ttsVersion' },
        ],
    },
    {
        name: 'Huggingface',
        mode: 'huggingface',
        labels: [
            { en: 'Model', ko: 'model' },
            { en: 'Language', ko: 'language' },
        ],
    },
    {
        name: 'GPT-SoVITS',
        mode: 'gptsovits',
        labels: [
            { en: 'Volume', ko: 'sidebarUi.ttsVolume' },
            { en: 'URL', ko: null },
            { en: 'Use Auto Path', ko: 'sidebarUi.ttsUseAutoPath' },
            { en: 'Reference Audio Path (e.g. C:/Users/user/Downloads/GPT-SoVITS-v2-240821)', ko: 'sidebarUi.ttsRefAudioPath' },
            { en: 'Use Long Audio', ko: 'sidebarUi.ttsUseLongAudio' },
            { en: 'Reference Audio Data (3~10s audio file)', ko: 'sidebarUi.ttsRefAudioData' },
            { en: 'Text Language', ko: 'sidebarUi.ttsTextLanguage' },
            { en: 'Use Reference Audio Script', ko: 'sidebarUi.ttsUseRefAudioScript' },
            { en: 'Reference Audio Script', ko: 'sidebarUi.ttsRefAudioScript' },
            { en: 'Reference Audio Language', ko: 'sidebarUi.ttsRefAudioLanguage' },
            { en: 'Top P', ko: null },
            { en: 'Temperature', ko: 'temperature' },
            { en: 'Speed', ko: 'sidebarUi.ttsSpeed' },
            { en: 'Top K', ko: null },
            { en: 'Text Split Method', ko: 'sidebarUi.ttsTextSplitMethod' },
        ],
    },
    {
        name: 'fish-speech',
        mode: 'fishspeech',
        labels: [
            { en: 'Model', ko: 'model' },
            { en: 'Chunk Length', ko: null },
            { en: 'Normalize', ko: null },
        ],
    },
]

const SOVITS_LANG_VALUES = ['auto', 'auto_yue', 'en', 'zh', 'ja', 'yue', 'ko', 'all_zh', 'all_ja', 'all_yue', 'all_ko']
const SOVITS_LANG_EN = [
    'Multi-language Mixed',
    'Multi-language Mixed (Cantonese)',
    'English',
    'Chinese-English Mixed',
    'Japanese-English Mixed',
    'Cantonese-English Mixed',
    'Korean-English Mixed',
    'Chinese',
    'Japanese',
    'Cantonese',
    'Korean',
]
const SOVITS_LANG_KO_PATHS = [
    'sidebarUi.ttsLangMultiMixed',
    'sidebarUi.ttsLangMultiMixedCantonese',
    'languageNameEnglish',
    'sidebarUi.ttsLangZhEnMixed',
    'sidebarUi.ttsLangJaEnMixed',
    'sidebarUi.ttsLangYueEnMixed',
    'sidebarUi.ttsLangKoEnMixed',
    'languageNameChinese',
    'languageNameJapanese',
    'sidebarUi.ttsLangCantonese',
    'languageNameKorean',
]
const SOVITS_CUT_VALUES = ['cut0', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5']
const SOVITS_CUT_EN = [
    'Cut 0 (No splitting)',
    'Cut 1 (Split every 4 sentences)',
    'Cut 2 (Split every 50 characters)',
    'Cut 3 (Split by Chinese periods)',
    'Cut 4 (Split by English periods)',
    'Cut 5 (Split by various punctuation marks)',
]
const SOVITS_CUT_KO_PATHS = ['ttsCut0', 'ttsCut1', 'ttsCut2', 'ttsCut3', 'ttsCut4', 'ttsCut5'].map((k) => 'sidebarUi.' + k)

//#endregion

let realFetch: typeof fetch

beforeEach(() => {
    window.innerWidth = 1024
    CharConfigSubMenu.set(5)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ items: [] }) })) as unknown as typeof fetch
})

afterEach(async () => {
    changeLanguage('en')
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
})

describe('the TTS tab labels under English', () => {
    test.each(CASES)('compatibility guard: $name shows the English labels and no "undefined"', async (c) => {
        changeLanguage('en')
        install(c.mode, c.patch)

        const root = await mountConfig()

        const texts = labelTexts(root)
        for (const label of c.labels) {
            expect.soft(texts, `the label ${label.en}`).toContain(label.en)
        }
        expect(root.textContent).not.toContain('undefined')
    })

    test('compatibility guard: GPT-SoVITS language and split selects show the English option texts', async () => {
        changeLanguage('en')
        install('gptsovits')

        const root = await mountConfig()

        expect(optionTexts(selectHaving(root, 'auto_yue', 0))).toEqual(SOVITS_LANG_EN)
        expect(optionTexts(selectHaving(root, 'auto_yue', 1))).toEqual(SOVITS_LANG_EN)
        expect(optionTexts(selectHaving(root, 'cut0'))).toEqual(SOVITS_CUT_EN)
    })
})

describe('the TTS tab labels under Korean', () => {
    test.each(CASES)('regression reproducer: $name shows the Korean labels and keeps engine and parameter names in English', async (c) => {
        changeLanguage('ko')
        install(c.mode, c.patch)

        const root = await mountConfig()

        const texts = labelTexts(root)
        for (const label of c.labels) {
            const expected = label.ko === null ? label.en : enValue(label.ko, label.en)
            expect.soft(texts, `the label ${label.en}`).toContain(expected)
        }
        expect(root.textContent).not.toContain('undefined')
    })

    test('regression reproducer: GPT-SoVITS language and split selects show the Korean option texts', async () => {
        changeLanguage('ko')
        install('gptsovits')

        const root = await mountConfig()

        const langKo = SOVITS_LANG_KO_PATHS.map((path, i) => enValue(path, SOVITS_LANG_EN[i]))
        const cutKo = SOVITS_CUT_KO_PATHS.map((path, i) => enValue(path, SOVITS_CUT_EN[i]))
        expect(optionTexts(selectHaving(root, 'auto_yue', 0))).toEqual(langKo)
        expect(optionTexts(selectHaving(root, 'auto_yue', 1))).toEqual(langKo)
        expect(optionTexts(selectHaving(root, 'cut0'))).toEqual(cutKo)
    })

    test('compatibility guard: GPT-SoVITS option value attributes are the stored values under Korean', async () => {
        changeLanguage('ko')
        install('gptsovits')

        const root = await mountConfig()

        expect(optionValues(selectHaving(root, 'auto_yue', 0))).toEqual(SOVITS_LANG_VALUES)
        expect(optionValues(selectHaving(root, 'auto_yue', 1))).toEqual(SOVITS_LANG_VALUES)
        expect(optionValues(selectHaving(root, 'cut0'))).toEqual(SOVITS_CUT_VALUES)
    })

    test('compatibility guard: NovelAI version and OpenAI format option values are unchanged under Korean', async () => {
        changeLanguage('ko')
        install('novelai')
        const novelRoot = await mountConfig()
        expect(optionValues(selectHaving(novelRoot, 'v1'))).toEqual(['v1', 'v2'])

        await unmount(mountedInstances.pop() as never)
        mountedTargets.pop()?.remove()
        install('openai')
        const openaiRoot = await mountConfig()
        expect(optionValues(selectHaving(openaiRoot, 'mp3'))).toEqual(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'])
    })
})

describe('the Bias section of the advanced tab', () => {
    function installBias(): void {
        install('', { bias: [['token', 5]] })
        CharConfigSubMenu.set(2)
    }

    function biasHeader(root: HTMLElement): string {
        return root.querySelector('table.tabler th')?.textContent?.trim() ?? ''
    }

    function biasTokenPlaceholder(root: HTMLElement): string | null {
        return root.querySelector('table.tabler input[type="text"], table.tabler input:not([type])')?.getAttribute('placeholder') ?? null
    }

    function biasLabel(root: HTMLElement): string {
        return root.querySelector('span.text-textcolor.mt-2')?.textContent?.trim() ?? ''
    }

    test('compatibility guard: English shows Bias for the label and the header and string for the placeholder', async () => {
        changeLanguage('en')
        installBias()

        const root = await mountConfig()

        expect(biasLabel(root)).toBe('Bias')
        expect(biasHeader(root)).toBe('Bias')
        expect(biasTokenPlaceholder(root)).toBe('string')
    })

    test('regression reproducer: Korean shows the translated Bias label, header and token placeholder', async () => {
        changeLanguage('ko')
        installBias()

        const root = await mountConfig()

        expect(biasLabel(root)).toBe(enValue('sidebarUi.bias', 'Bias'))
        expect(biasHeader(root)).toBe(koValue('sidebarUi.bias'))
        expect(biasTokenPlaceholder(root)).toBe(enValue('sidebarUi.biasTokenPlaceholder', 'string'))
    })

    function emptyRowText(root: HTMLElement): string {
        return root.querySelector('table.tabler td[colspan="3"]')?.textContent?.trim() ?? ''
    }

    test('compatibility guard: English shows "No Bias" in the empty table row', async () => {
        changeLanguage('en')
        install('', { bias: [] })
        CharConfigSubMenu.set(2)

        expect(emptyRowText(await mountConfig())).toBe('No Bias')
    })

    test('regression reproducer: Korean words the empty table row with the Korean Bias word', async () => {
        changeLanguage('ko')
        install('', { bias: [] })
        CharConfigSubMenu.set(2)

        const text = emptyRowText(await mountConfig())

        expect(text).toBe(koValue('noBias'))
        expect(text).toContain(koValue('sidebarUi.bias'))
    })
})

describe('the VOICEVOX Style label', () => {
    test('regression reproducer: the label uses the theme text colour class', async () => {
        changeLanguage('en')
        install('VOICEVOX')

        const root = await mountConfig()

        const label = [...root.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'Style')
        expect(label, 'the Style label').toBeDefined()
        expect(label!.classList.contains('text-textcolor')).toBe(true)
        expect(label!.getAttribute('class')).not.toContain('=')
    })
})
