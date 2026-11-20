// @vitest-environment happy-dom

/**
 * The REAL `CharConfig.svelte` while the selected index names no character: the character was removed from
 * `DBState.db.characters` and the selection still points past it, or the selection was cleared while the
 * component is still mounted. Every tab must render nothing for the missing character instead of throwing
 * from its script effects or its markup, and the settings come back when the selection names a character again.
 * Every module `CharConfig.svelte` imports and every child component other than the form inputs is a fake, the
 * same set as `CharConfig.selectionDuringAwait.svelte.test.ts`.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    alertError: vi.fn(),
    saveAssetFromBlob: vi.fn(async (..._args: unknown[]) => 'assets/saved'),
    selectMultipleFileObjects: vi.fn(),
    selectSingleFileObject: vi.fn(),
    mark: vi.fn(),
    registerOnnxModel: vi.fn(),
    importRegex: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        CharConfigSubMenu: writable(1),
        MobileGUI: writable(false),
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/characterSaveMarks'), async (importOriginal) => ({
    ...(await importOriginal()),
    markCharacterForSave: h.mark,
}))

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
    alertError: h.alertError,
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(() => null),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    selectMultipleFileObjects: h.selectMultipleFileObjects,
    selectSingleFileObject: h.selectSingleFileObject,
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
    fetchFishSpeechModels: vi.fn(async () => []),
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(async () => ''),
    saveAssetFromBlob: h.saveAssetFromBlob,
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/group'), () => ({
    addGroupChar: vi.fn(),
    rmCharFromGroup: vi.fn(),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/transformers'), () => ({
    registerOnnxModel: h.registerOnnxModel,
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
    importRegex: h.importRegex,
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('src/lib/SideBars/LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/BarIcon.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/UI/GUI/MultiLangInput.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import CharConfig from 'src/lib/SideBars/CharConfig.svelte'

type CharacterFixture = {
    chaId: string
    additionalAssets: unknown[]
    vits: unknown
    customscript: Array<{ comment: string }>
    gptSoVitsConfig: { ref_audio_data: { fileName: string, assetId: string } }
}

function baseCharacter(ttsMode: string) {
    return {
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
        customscript: [{ comment: 'old', in: '', out: '', type: 'editinput' }],
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
    }
}

/** Two characters, `char-a` selected at index 0 and `char-b` at index 1. */
function installTwo(ttsMode = 'gptsovits'): { a: CharacterFixture, b: CharacterFixture } {
    const a = baseCharacter(ttsMode)
    const b = structuredClone(a)
    b.chaId = 'char-b'
    b.name = 'Beta'
    DBState.db = { characters: [a, b], personas: [], modules: [] } as never
    return {
        a: DBState.db.characters[0] as unknown as CharacterFixture,
        b: DBState.db.characters[1] as unknown as CharacterFixture,
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountConfig(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: {} }))
    flushSync()
    await tick()
    flushSync()
    return target
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

/** Clicks the Display tab's view button `index` (0 image, 1 view screen, 2 assets). */
function openView(root: HTMLElement, index: number): void {
    const views = root.querySelectorAll('button.flex-1')
    ;(views[index] as HTMLButtonElement).click()
    flushSync()
}

/** Every tab and Display view, with the TTS mode that renders the most of the Speech tab. */
const cases: Array<{ name: string, menu: number, view?: number, ttsMode?: string, viewScreen?: string }> = [
    { name: 'basic info', menu: 0 },
    { name: 'display: image', menu: 1, view: 0 },
    { name: 'display: emotion view screen', menu: 1, view: 1, viewScreen: 'emotion' },
    { name: 'display: image-generation view screen', menu: 1, view: 1, viewScreen: 'imggen' },
    { name: 'display: additional assets', menu: 1, view: 2 },
    { name: 'advanced settings', menu: 2 },
    { name: 'lorebook', menu: 3 },
    { name: 'scripts', menu: 4 },
    { name: 'speech: GPT-SoVITS', menu: 5, ttsMode: 'gptsovits' },
    { name: 'speech: OpenAI', menu: 5, ttsMode: 'openai' },
    { name: 'share and export', menu: 6 },
]

async function mountSecondSelected(c: typeof cases[number]): Promise<HTMLElement> {
    CharConfigSubMenu.set(c.menu)
    installTwo(c.ttsMode ?? 'gptsovits')
    if (c.viewScreen) {
        for (const chara of DBState.db.characters as unknown as Array<Record<string, unknown>>) {
            chara.viewScreen = c.viewScreen
            chara.emotionImages = [['happy', 'assets/happy.png']]
            chara.newGenData = { prompt: '', negative: '', instructions: '', emotionInstructions: '' }
        }
    }
    selectedCharID.set(1)
    const root = await mountConfig()
    if (c.view !== undefined) {
        openView(root, c.view)
    }
    await settle()
    flushSync()
    return root
}

let errors: unknown[] = []
const onError = (event: ErrorEvent) => { errors.push(event.error ?? event.message) }
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    errors = []
    window.addEventListener('error', onError)
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    selectedCharID.set(0)
})

afterEach(async () => {
    window.removeEventListener('error', onError)
    consoleError.mockRestore()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
})

describe('CharConfig renders nothing while the selection names no character', () => {
    for (const c of cases) {
        test(`regression reproducer (${c.name}): the selected character is removed from the list and the selection still points at its index`, async () => {
            const root = await mountSecondSelected(c)
            expect(root.textContent?.trim(), 'the tab rendered before the removal').not.toBe('')

            expect(() => {
                DBState.db.characters.splice(1, 1)
                flushSync()
            }).not.toThrow()
            await settle()
            flushSync()

            expect(errors).toEqual([])
            expect(root.textContent?.trim()).toBe('')
        })

        test(`regression reproducer (${c.name}): the selection is cleared while the settings are still mounted`, async () => {
            const root = await mountSecondSelected(c)

            expect(() => {
                selectedCharID.set(-1)
                flushSync()
            }).not.toThrow()
            await settle()
            flushSync()

            expect(errors).toEqual([])
            expect(root.textContent?.trim()).toBe('')
        })
    }

    test('guard: the settings come back for the character the selection names again (passes only after the fix mounts it)', async () => {
        const root = await mountSecondSelected(cases[0])
        DBState.db.characters.splice(1, 1)
        flushSync()
        await settle()

        selectedCharID.set(0)
        flushSync()
        await settle()
        flushSync()

        expect(errors).toEqual([])
        expect((root.querySelector('input') as HTMLInputElement | null)?.value).toBe('Alpha')
    })
})
