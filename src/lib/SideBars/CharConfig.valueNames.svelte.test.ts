// @vitest-environment jsdom

/**
 * Accessible names of the value controls (selects, number inputs, sliders) of the REAL `CharConfigPanel.svelte`
 * in every branch that renders one: the display page's screen select, the asset style select, every TTS provider
 * form, and the advanced page's bias and depth number inputs. Each control is named by its visible label text
 * through `aria-labelledby` (that label first in `aria-describedby`), and no naming element is shared between two
 * controls. The screen select and the bias and depth number inputs have no visible text of their own and take a
 * screen-reader-only name.
 *
 * The mock set is that of `CharConfig.names.svelte.test.ts`. The lorebook, regex, trigger and toggle child panels
 * are stubs (their value controls belong to their own files); the shared inputs and Help are real.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
        ReloadGUIPointer: writable(0),
        alertStore: writable({ type: 'none', msg: '' }),
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
    alertError: vi.fn(),
    alertMd: vi.fn(),
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn((id: string) => ({ name: 'Member ' + id, image: '' })),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    selectMultipleFileObjects: vi.fn(),
    selectSingleFileObject: vi.fn(),
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
    getNovelAIVoices: vi.fn(async () => []),
    fetchFishSpeechModels: vi.fn(async () => []),
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(async (path: string) => 'src:' + path),
    saveAssetFromBlob: vi.fn(async () => 'assets/saved'),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/group'), () => ({
    addGroupChar: vi.fn(),
    rmCharFromGroup: vi.fn(),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((c: unknown) => c),
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
vi.mock('src/ts/platform', () => ({ isMobile: false, isNodeServer: false, isTauri: false, isIOS: () => false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))

vi.mock('./LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../UI/GUI/MultiLangInput.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../Studio/StudioToggleLink.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import CharConfigPanel from './CharConfigPanel.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const subMenu = CharConfigSubMenu as ReturnType<typeof writable<number>>

type Fixture = { character?: Record<string, unknown>, db?: Record<string, unknown> }

function characterBase(): Record<string, unknown> {
    return {
        chaId: 'char-a',
        name: 'Alpha',
        type: 'character',
        license: '',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [], scriptstate: {}, note: '', fmIndex: -1 }],
        image: '',
        emotionImages: [],
        additionalAssets: [],
        ccAssets: [],
        alternateGreetings: [],
        desc: '',
        firstMessage: '',
        customModuleToggle: '',
        bias: [],
        personality: '',
        scenario: '',
        exampleMessage: '',
        systemPrompt: '',
        replaceGlobalNote: '',
        additionalText: '',
        defaultVariables: '',
        translatorNote: '',
        backgroundHTML: '',
        customscript: [],
        triggerscript: [],
        virtualscript: '',
        creatorNotes: '',
        additionalData: { creator: '', character_version: '' },
        nickname: '',
        depth_prompt: { depth: 0, prompt: '' },
        viewScreen: 'none',
        newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' },
        voicevoxConfig: { speaker: '', SPEED_SCALE: 1, PITCH_SCALE: 0, VOLUME_SCALE: 1, INTONATION_SCALE: 1 },
        hfTTS: { model: '', language: 'en' },
        ttsMode: '',
        ttsSpeech: '',
        oaiVoice: '',
        utilityBot: false,
    }
}

function groupBase(): Record<string, unknown> {
    return {
        ...characterBase(),
        type: 'group',
        characters: ['m1', 'm2'],
        characterTalks: [0.5, 1],
        characterActive: [true, false],
    }
}

function install(fixture: Fixture, type: 'character' | 'group'): void {
    const character = { ...(type === 'group' ? groupBase() : characterBase()), ...(fixture.character ?? {}) }
    DBState.db = {
        characters: [character],
        personas: [],
        modules: [],
        hotkeys: [],
        longPressToPopupEditor: false,
        useAdditionalAssetsPreview: false,
        showUnrecommended: true,
        hideApiKey: false,
        supaModelType: 'none',
        ...(fixture.db ?? {}),
    } as never
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    flushSync()
}

async function show(page: number, fixture: Fixture = {}, type: 'character' | 'group' = 'character'): Promise<HTMLElement> {
    install(fixture, type)
    subMenu.set(page)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfigPanel, { target, props: { studioEntry: false } }))
    await settle()
    return target
}

async function pickView(target: HTMLElement, index: number): Promise<void> {
    target.querySelectorAll<HTMLButtonElement>('div.flex.w-full.rounded-md button')[index].click()
    await settle()
}

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** Out-of-scope unnamed controls on these pages: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

beforeEach(() => {
    subMenu.set(0)
    vi.stubGlobal('speechSynthesis', {})
})

afterEach(async () => {
    vi.unstubAllGlobals()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
    subMenu.set(0)
})

const GSV_CONFIG = {
    url: '', use_auto_path: false, ref_audio_path: '', use_long_audio: false, ref_audio_data: { fileName: '', assetId: '' },
    volume: 1, text_lang: 'auto', text: 'en', use_prompt: true, prompt: '', prompt_lang: 'en', top_p: 1, temperature: 0.7,
    speed: 1, top_k: 5, text_split_method: 'cut0',
}

describe('CharConfigPanel value control names', () => {
    test('display page: the additional screen select takes a screen-reader-only name in every view mode', async () => {
        for (const viewScreen of ['none', 'emotion', 'imggen']) {
            const target = await show(1, { character: { viewScreen, inlayViewScreen: true, emotionImages: [['happy', 'happy.png']] } })
            await pickView(target, 1)
            check(target, names(language.viewScreen))
        }
    })

    test('display page of a group: the screen select is named', async () => {
        const target = await show(1, {}, 'group')
        await pickView(target, 1)
        check(target, names(language.viewScreen))
    })

    test('additional assets page: the asset style select is named by its visible label', async () => {
        const target = await show(1, { db: { newImageHandlingBeta: true } })
        await pickView(target, 2)
        // The insert-asset-prompt checkbox shares the select's parent, so the helper's toggle pairing (F7) reports
        // it as the select's toggle; every naming rule (F1-F6) must still hold.
        const problems = fieldNameProblems(target, names(language.assetStyle))
        expect(problems.filter((line) => !line.includes(' F7 '))).toEqual([])
        expect(problems.filter((line) => line.includes(' F7 ')).map((line) => line.replace(/^.*> /, ''))).toEqual(['F7 found an unexpected toggle checkbox'])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('advanced page: every bias row number input and the depth number input have their own names', async () => {
        const target = await show(2, { character: { bias: [['a', 1], ['b', 2], ['c', 3]] } })
        check(target, names(language.value, language.value, language.value, language.depth))
    })

    test('advanced page without bias rows and of a group', async () => {
        check(await show(2), names(language.depth))
        check(await show(2, {}, 'group'), [])
    })

    test('tts page: the provider select of a disabled and a huggingface provider', async () => {
        check(await show(5), names(language.provider))
        check(await show(5, { character: { ttsMode: 'huggingface' } }), names(language.provider))
        check(await show(5, { character: { ttsMode: 'vits' } }), names(language.provider))
    })

    test('tts page: webspeech and elevenlabs speech selects', async () => {
        check(await show(5, { character: { ttsMode: 'webspeech' } }), names(language.provider, language.Speech))
        check(await show(5, { character: { ttsMode: 'elevenlab' } }), names(language.provider, language.Speech))
    })

    test('tts page: voicevox without and with a speaker', async () => {
        check(await show(5, { character: { ttsMode: 'VOICEVOX' } }), names(
            language.provider, language.sidebarUi.ttsSpeaker, 'Speed scale', 'Pitch scale', 'Volume scale', 'Intonation scale',
        ))
        const speaker = JSON.stringify([{ id: '1', name: 'Normal' }])
        check(await show(5, { character: { ttsMode: 'VOICEVOX', voicevoxConfig: { speaker, SPEED_SCALE: 1, PITCH_SCALE: 0, VOLUME_SCALE: 1, INTONATION_SCALE: 1 } } }), names(
            language.provider, language.sidebarUi.ttsSpeaker, language.sidebarUi.ttsStyle, 'Speed scale', 'Pitch scale', 'Volume scale', 'Intonation scale',
        ))
    })

    test('tts page: novelai with a voice list and with a custom voice seed', async () => {
        check(await show(5, { character: { ttsMode: 'novelai', naittsConfig: { customvoice: false, voice: 'a', version: 'v2' } } }), names(
            language.provider, language.sidebarUi.ttsVoice, language.sidebarUi.ttsVersion,
        ))
        check(await show(5, { character: { ttsMode: 'novelai', naittsConfig: { customvoice: true, voice: 'a', version: 'v2' } } }), names(
            language.provider, language.sidebarUi.ttsVersion,
        ))
    })

    test('tts page: openai with the voice list and with the advanced endpoint', async () => {
        check(await show(5, { character: { ttsMode: 'openai', oaiTTSConfig: { enabled: false, format: 'mp3' } } }), names(
            language.provider, language.sidebarUi.ttsVoice,
        ))
        check(await show(5, { character: { ttsMode: 'openai', oaiTTSConfig: { enabled: true, format: 'mp3', voice: '', baseURL: '', apiKey: '', model: '' } } }), names(
            language.provider, 'Response Format',
        ))
    })

    test('tts page: gpt-sovits with and without the reference script', async () => {
        const all = names(
            language.provider, language.sidebarUi.ttsVolume, language.sidebarUi.ttsTextLanguage, language.sidebarUi.ttsRefAudioLanguage,
            'Top P', language.temperature, language.sidebarUi.ttsSpeed, 'Top K', language.sidebarUi.ttsTextSplitMethod,
        )
        check(await show(5, { character: { ttsMode: 'gptsovits', gptSoVitsConfig: GSV_CONFIG } }), all)
        check(await show(5, { character: { ttsMode: 'gptsovits', gptSoVitsConfig: { ...GSV_CONFIG, use_prompt: false, use_auto_path: true } } }), all)
    })

    test('tts page: fish speech model select and chunk length', async () => {
        check(await show(5, { character: { ttsMode: 'fishspeech', fishSpeechConfig: { model: { _id: '' }, chunk_length: 200, normalize: true } } }), names(
            language.provider, language.model, 'Chunk Length',
        ))
    })
})
