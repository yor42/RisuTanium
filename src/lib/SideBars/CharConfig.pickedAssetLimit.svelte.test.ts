// @vitest-environment happy-dom

/**
 * The two asset pickers of the REAL `CharConfig.svelte`: the Additional Assets add button and the GPT-SoVITS
 * reference-audio button. A picked file above the store's asset limit is never saved or read (its `slice` throws);
 * the files within the limit of a multi-pick are saved in order and one notice then names the refused ones.
 * Every module `CharConfig.svelte` imports and every child component other than the form inputs is a fake, the
 * same set as `CharConfig.ttsLabels.svelte.test.ts`; the limit is 1 MiB so the fixtures stay small.
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
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import CharConfig from './CharConfig.svelte'

const LIMIT = 1024 * 1024

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

type CharacterFixture = {
    additionalAssets: unknown[]
    gptSoVitsConfig: { ref_audio_data: { fileName: string, assetId: string } }
}

function install(): CharacterFixture {
    const character = {
        chaId: 'char-a',
        name: 'Alpha',
        type: 'character',
        ttsMode: 'gptsovits',
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
    }
    DBState.db = { characters: [character], personas: [], modules: [] } as never
    return DBState.db.characters[0] as unknown as CharacterFixture
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

/** A file that reports `size` bytes without holding them; any slice of it throws. */
function fileReportingSize(name: string, size: number): File {
    const file = new File([new Uint8Array([1])], name)
    Object.defineProperty(file, 'size', { value: size })
    Object.defineProperty(file, 'slice', { value: () => { throw new Error('a file above the limit must not be sliced') } })
    return file
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

beforeEach(() => {
    resetBusyActionsForTest()
    h.alertError.mockClear()
    h.saveAssetFromBlob.mockClear()
    h.selectMultipleFileObjects.mockReset()
    h.selectSingleFileObject.mockReset()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
})

describe('the Additional Assets add button', () => {
    function addButton(root: HTMLElement): HTMLButtonElement {
        // The assets table is the third view of the Display tab.
        const views = root.querySelectorAll('button.flex-1')
        if (views.length < 3) throw new Error('the Display tab views are not shown')
        ;(views[2] as HTMLButtonElement).click()
        flushSync()
        const button = root.querySelector('th.cursor-pointer button') as HTMLButtonElement | null
        if (!button) throw new Error('the add button is not shown')
        return button
    }

    test('regression reproducer: a mixed pick saves the files within the limit in order, then shows one notice naming the refused ones', async () => {
        CharConfigSubMenu.set(1)
        const character = install()
        h.selectMultipleFileObjects.mockResolvedValue([
            new File([new Uint8Array([1])], 'ok1.png'),
            fileReportingSize('big1.mp4', LIMIT + 1),
            new File([new Uint8Array([2])], 'ok2.png'),
            fileReportingSize('big2.mp4', LIMIT * 2),
        ])
        const root = await mountConfig()

        addButton(root).click()
        await settle()

        expect(h.saveAssetFromBlob.mock.calls.map((call) => (call[0] as File).name)).toEqual(['ok1.png', 'ok2.png'])
        expect(character.additionalAssets).toEqual([
            ['ok1.png', 'assets/saved', 'png'],
            ['ok2.png', 'assets/saved', 'png'],
        ])
        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledWith('"big1.mp4" and "big2.mp4" are larger than the 1 MB limit, so they were not added.')
        expect(h.alertError.mock.invocationCallOrder[0]).toBeGreaterThan(h.saveAssetFromBlob.mock.invocationCallOrder[1])
        expect(isBusy()).toBe(false)
    })

    test('regression reproducer: when every file is above the limit nothing is saved, no busy entry starts and one notice is shown', async () => {
        CharConfigSubMenu.set(1)
        const character = install()
        h.selectMultipleFileObjects.mockResolvedValue([fileReportingSize('big1.mp4', LIMIT + 1), fileReportingSize('big2.mp4', LIMIT + 2)])
        const root = await mountConfig()

        addButton(root).click()
        await settle()

        expect(h.saveAssetFromBlob).not.toHaveBeenCalled()
        expect(character.additionalAssets).toEqual([])
        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(isBusy()).toBe(false)
    })
})

describe('the GPT-SoVITS reference-audio button', () => {
    function refAudioButton(root: HTMLElement): HTMLButtonElement {
        const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'ref.wav')
        if (!button) throw new Error('the reference-audio button is not shown')
        return button
    }

    test('regression reproducer: an audio file above the limit is not saved, the stored reference is unchanged and one notice is shown', async () => {
        CharConfigSubMenu.set(5)
        const character = install()
        h.selectSingleFileObject.mockResolvedValue(fileReportingSize('long.wav', LIMIT + 1))
        const root = await mountConfig()

        refAudioButton(root).click()
        await settle()

        expect(h.saveAssetFromBlob).not.toHaveBeenCalled()
        expect(character.gptSoVitsConfig.ref_audio_data).toEqual({ fileName: 'ref.wav', assetId: 'asset-1' })
        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledWith('"long.wav" is larger than the 1 MB limit, so it was not added.')
    })

    test('guard: an audio file within the limit is saved and becomes the reference', async () => {
        CharConfigSubMenu.set(5)
        const character = install()
        h.selectSingleFileObject.mockResolvedValue(new File([new Uint8Array([1])], 'short.wav'))
        const root = await mountConfig()

        refAudioButton(root).click()
        await settle()

        expect(character.gptSoVitsConfig.ref_audio_data).toEqual({ fileName: 'short.wav', assetId: 'assets/saved' })
        expect(h.alertError).not.toHaveBeenCalled()
    })
})
