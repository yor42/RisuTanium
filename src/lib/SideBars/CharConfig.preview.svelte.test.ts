// @vitest-environment happy-dom

/**
 * The Additional Assets previews of the REAL `CharConfig.svelte`: one classifier
 * decides both the element a row renders and the `use` of the URL it asks for.
 * `getFileSrc` is replaced by a stand-in of the Android gate: a `'whole'` use of
 * a path containing `huge` gets `''` (over the limit), a `'media'` use gets the
 * URL, and a call that names no use gets the URL, so a row that forgets to say
 * what its URL is for shows as a leaked image. The mock set is that of
 * `CharConfig.pickedAssetLimit.svelte.test.ts`.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => {
    const pending = new Map<string, (value: string) => void>()
    return {
        pending,
        // A path starting with `assets/pending` settles only when the test resolves it.
        getFileSrc: vi.fn(async (path: string, use?: string) => {
            if (path.startsWith('assets/pending')) {
                return await new Promise<string>((resolve) => { pending.set(path, resolve) })
            }
            return use === 'whole' && path.includes('huge') ? '' : 'src:' + path
        }),
    }
})

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
    alertError: vi.fn(),
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(() => null),
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
    getNovelAIVoices: vi.fn(() => []),
    fetchFishSpeechModels: vi.fn(async () => []),
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: h.getFileSrc,
    saveAssetFromBlob: vi.fn(async () => 'assets/saved'),
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
import CharConfig from './CharConfig.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function install(additionalAssets: string[][]): void {
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
        additionalAssets,
        emotionImages: [],
    }
    DBState.db = { characters: [character], personas: [], modules: [], useAdditionalAssetsPreview: true } as never
}

/** Mounts the config on the assets view with `assets`, and returns the name cells of the rows. */
async function openRows(assets: string[][]): Promise<HTMLElement[]> {
    CharConfigSubMenu.set(1)
    install(assets)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: {} }))
    flushSync()
    await tick()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    const views = target.querySelectorAll('button.flex-1')
    if (views.length < 3) throw new Error('the Display tab views are not shown')
    ;(views[2] as HTMLButtonElement).click()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return Array.from(target.querySelectorAll('table td.font-medium')) as HTMLElement[]
}

beforeEach(() => {
    h.pending.clear()
    h.getFileSrc.mockClear()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
})

describe('which element a row renders', () => {
    test('guard: a small mp4 is a video, an mp3 an audio element, a png an image, each with its URL', async () => {
        const cells = await openRows([['v', 'assets/clip', 'mp4'], ['a', 'assets/tune', 'mp3'], ['p', 'assets/pic', 'png']])

        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/clip')
        expect(cells[1].querySelector('audio source')?.getAttribute('src')).toBe('src:assets/tune')
        expect(cells[2].querySelector('img')?.getAttribute('src')).toBe('src:assets/pic')
    })

    test('contract: video and audio ask for a media use, so an upper-case MP4 over the limit still plays; an image asks a whole use', async () => {
        const cells = await openRows([['v', 'assets/huge-clip', 'MP4'], ['p', 'assets/pic', 'PNG']])

        expect(h.getFileSrc).toHaveBeenCalledWith('assets/huge-clip', 'media')
        expect(h.getFileSrc).toHaveBeenCalledWith('assets/pic', 'whole')
        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')
        expect(cells[1].querySelector('img')?.getAttribute('src')).toBe('src:assets/pic')
    })

    test.each(['mov', 'wav', 'avif'])('guard: a .%s row has no image (CharConfig previews only its known image extensions)', async (ext) => {
        const cells = await openRows([['clip name', 'assets/media-file', ext]])

        expect(cells[0].querySelector('img')).toBeNull()
    })

    test.each(['mov', 'wav', 'avif'])('reproducer: a .%s row asks for no URL', async (ext) => {
        await openRows([['clip name', 'assets/media-file', ext]])

        expect(h.getFileSrc).not.toHaveBeenCalled()
    })

    test('reproducer: an image over the limit shows the name box instead of an image', async () => {
        const cells = await openRows([['big picture', 'assets/huge-pic', 'png']])

        expect(cells[0].querySelector('img')).toBeNull()
        expect(cells[0].textContent).toContain('big picture')
    })
})

describe('a row whose asset changes', () => {
    async function settleRows(): Promise<HTMLElement[]> {
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()
        return Array.from(document.querySelectorAll('table td.font-medium')) as HTMLElement[]
    }

    function setAssets(assets: string[][]): void {
        const character = DBState.db.characters[0]
        if (character.type !== 'character') throw new Error('the installed character is a full character')
        character.additionalAssets = assets as typeof character.additionalAssets
    }

    test('reproducer: a row that was an over-limit video never shows its media URL in an image while the new URL is pending', async () => {
        const cells = await openRows([['v', 'assets/huge-clip', 'mp4']])
        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')

        setAssets([['p', 'assets/pending-pic', 'png']])
        const pendingCells = await settleRows()

        expect(pendingCells[0].querySelectorAll('img').length).toBe(0)
        expect(pendingCells[0].querySelectorAll('source').length).toBe(0)

        h.pending.get('assets/pending-pic')?.('src:assets/pending-pic')
        const settledCells = await settleRows()

        expect(settledCells[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-pic')
    })

    test('reproducer: a URL that settles after the row names another asset is ignored', async () => {
        await openRows([['a', 'assets/pending-a', 'png']])

        setAssets([['b', 'assets/pending-b', 'png']])
        await settleRows()
        h.pending.get('assets/pending-b')?.('src:assets/pending-b')
        await settleRows()
        h.pending.get('assets/pending-a')?.('src:assets/pending-a')
        const cells = await settleRows()

        expect(cells[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-b')
    })
})
