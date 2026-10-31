// @vitest-environment happy-dom

/**
 * The await-spanning writers of the REAL `CharConfig.svelte`: the Additional Assets add button, the GPT-SoVITS
 * reference-audio button, the ONNX model button and the regex import button. Each result belongs to the character
 * that was selected when the user clicked, found again by its `chaId` after the await: a selection change or an
 * array element replacement during the await must not redirect it, a landed write marks that character for save,
 * and a character removed during the await drops the write with a console warning.
 * Every module `CharConfig.svelte` imports and every child component other than the form inputs is a fake, the
 * same set as `CharConfig.pickedAssetLimit.svelte.test.ts`; `src/ts/liveCharacterWrite` is real and only
 * `markCharacterForSave` is replaced so the marks can be read.
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
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return target
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

/** The next `saveAssetFromBlob` call stays pending until the returned function resolves it. */
function deferredSave(): (assetId: string) => void {
    let release: (assetId: string) => void = () => {}
    h.saveAssetFromBlob.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
    return (assetId) => release(assetId)
}

async function clickAssetAdd(): Promise<void> {
    const root = await mountConfig()
    // The assets table is the third view of the Display tab.
    const views = root.querySelectorAll('button.flex-1')
    ;(views[2] as HTMLButtonElement).click()
    flushSync()
    ;(root.querySelector('th.cursor-pointer button') as HTMLButtonElement).click()
    await settle()
}

/** A one-step element replacement keeping the same `chaId`, as a plugin or archive swap does. */
function replaceFirstCharacter(source: CharacterFixture): void {
    DBState.db.characters[0] = structuredClone($state.snapshot(source)) as never
}

const liveFirst = () => DBState.db.characters[0] as unknown as CharacterFixture

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    resetBusyActionsForTest()
    h.alertError.mockClear()
    h.saveAssetFromBlob.mockReset()
    h.saveAssetFromBlob.mockImplementation(async () => 'assets/saved')
    h.selectMultipleFileObjects.mockReset()
    h.selectSingleFileObject.mockReset()
    h.mark.mockReset()
    h.registerOnnxModel.mockReset()
    h.importRegex.mockReset()
    selectedCharID.set(0)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    warn.mockRestore()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
})

describe('an await-spanning CharConfig writer follows the clicked character by id', () => {
    test('regression reproducer: an asset saved after the selection moved lands on the clicked character, which is marked', async () => {
        CharConfigSubMenu.set(1)
        const { a, b } = installTwo()
        const release = deferredSave()
        h.selectMultipleFileObjects.mockResolvedValue([new File([new Uint8Array([1])], 'ok1.png')])
        await clickAssetAdd()

        selectedCharID.set(1)
        flushSync()
        release('assets/saved')
        await settle()

        expect(a.additionalAssets).toEqual([['ok1.png', 'assets/saved', 'png']])
        expect(b.additionalAssets).toEqual([])
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('regression reproducer: a GPT-SoVITS reference saved after the selection moved lands on the clicked character, which is marked', async () => {
        CharConfigSubMenu.set(5)
        const { a, b } = installTwo()
        const release = deferredSave()
        h.selectSingleFileObject.mockResolvedValue(new File([new Uint8Array([1])], 'short.wav'))
        const root = await mountConfig()
        const button = Array.from(root.querySelectorAll('button')).find((x) => x.textContent?.trim() === 'ref.wav') as HTMLButtonElement
        button.click()
        await settle()

        selectedCharID.set(1)
        flushSync()
        release('assets/new')
        await settle()

        expect(a.gptSoVitsConfig.ref_audio_data).toEqual({ fileName: 'short.wav', assetId: 'assets/new' })
        expect(b.gptSoVitsConfig.ref_audio_data.assetId).toBe('asset-1')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('regression reproducer: an ONNX model registered after the selection moved lands on the clicked character, which is marked', async () => {
        CharConfigSubMenu.set(5)
        const { a, b } = installTwo('vits')
        let release: (model: unknown) => void = () => {}
        h.registerOnnxModel.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
        const root = await mountConfig()
        const button = Array.from(root.querySelectorAll('button')).find((x) => x.textContent?.trim() === 'Select Model') as HTMLButtonElement
        expect(button).toBeTruthy()
        button.click()
        await settle()

        selectedCharID.set(1)
        flushSync()
        release({ name: 'm', files: {}, id: 'm1' })
        await settle()

        expect((a.vits as { id: string } | null)?.id).toBe('m1')
        expect(b.vits).toBeNull()
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('regression reproducer for the missing mark: scripts imported after the selection moved are appended to the clicked character, which is marked', async () => {
        CharConfigSubMenu.set(4)
        const { a, b } = installTwo()
        const imported = { comment: 'S', in: 'x', out: 'y', type: 'editinput' }
        let release: () => void = () => {}
        h.importRegex.mockImplementationOnce((existing?: unknown[]) => new Promise((resolve) => {
            release = () => resolve([...(existing ?? []), imported])
        }))
        const root = await mountConfig()
        const buttons = root.querySelectorAll('div.text-textcolor2.mt-2.flex.gap-2 button')
        ;(buttons[2] as HTMLButtonElement).click()
        await settle()

        selectedCharID.set(1)
        flushSync()
        release()
        await settle()

        expect(a.customscript.map((s) => s.comment)).toEqual(['old', 'S'])
        expect(b.customscript.map((s) => s.comment)).toEqual(['old'])
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('regression reproducer: an asset saved after the clicked element was replaced and the selection moved lands on the live element with that id', async () => {
        CharConfigSubMenu.set(1)
        const { a, b } = installTwo()
        const release = deferredSave()
        h.selectMultipleFileObjects.mockResolvedValue([new File([new Uint8Array([1])], 'ok1.png')])
        await clickAssetAdd()

        replaceFirstCharacter(a)
        selectedCharID.set(1)
        flushSync()
        release('assets/saved')
        await settle()

        expect(liveFirst().additionalAssets).toHaveLength(1)
        expect(b.additionalAssets).toEqual([])
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('guard: an asset saved after the clicked element was replaced, with the selection unchanged, lands on the live element (passes before and after)', async () => {
        CharConfigSubMenu.set(1)
        const { a } = installTwo()
        const release = deferredSave()
        h.selectMultipleFileObjects.mockResolvedValue([new File([new Uint8Array([1])], 'ok1.png')])
        await clickAssetAdd()

        replaceFirstCharacter(a)
        flushSync()
        release('assets/saved')
        await settle()

        expect(liveFirst().additionalAssets).toHaveLength(1)
    })

    test('regression reproducer: an asset saved after the clicked character was removed is dropped with one warning, and no other character is written or marked', async () => {
        CharConfigSubMenu.set(1)
        const { b } = installTwo()
        const release = deferredSave()
        h.selectMultipleFileObjects.mockResolvedValue([new File([new Uint8Array([1])], 'ok1.png')])
        await clickAssetAdd()

        DBState.db.characters.splice(0, 1)
        flushSync()
        release('assets/saved')
        await settle()

        expect(b.additionalAssets).toEqual([])
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })
})
