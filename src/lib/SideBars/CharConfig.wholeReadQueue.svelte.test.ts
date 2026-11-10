// @vitest-environment jsdom

/**
 * The character configuration on Android: the member icons of a group, the group icon, the character icon and the
 * additional icon rows of `CharConfig.svelte` read their images through a hold, so a file of 8 MiB or more waits in the
 * app-wide whole-read queue instead of being put on the page together with the other large images.
 *
 * The real component and the real `BarIcon.svelte` are mounted; every other module the page imports is a fake, the same set as
 * `CharConfig.pickedAssetLimit.svelte.test.ts`. `getCharImage` is the kit's mirror (`wholeReadQueue.testKit.ts`; the util
 * test checks it against the real function) behind a spy; the queue, the size verdict and the detached `Image` are the real ones.
 *
 * "Held grant": the test takes 60 MiB of the 64 MiB queue itself, as a chat image would, so any larger read must wait.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix component), `(G)` a compatibility guard, `(U)` a rule test.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    getCharImageSpy: vi.fn(),
}))

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        CharConfigSubMenu: writable(0),
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
    getCharImage: h.getCharImageSpy,
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

vi.mock(import('src/ts/util'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        findCharacterbyId: vi.fn((id: string) => {
            const found = (DBState.db.characters as Array<{ chaId: string }>).find((character) => character.chaId === id)
            return found ?? { chaId: id, image: '' }
        }),
        getAuthorNoteDefaultText: vi.fn(() => ''),
        selectMultipleFile: vi.fn(),
        selectSingleFile: vi.fn(),
        selectMultipleFileObjects: vi.fn(),
        selectSingleFileObject: vi.fn(),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

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
    saveAssetFromBlob: vi.fn(async () => 'assets/saved'),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
    readImage: vi.fn(),
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

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

vi.mock('./LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../UI/GUI/MultiLangInput.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState } from 'src/ts/stores.svelte'
import CharConfig from './CharConfig.svelte'
import { androidWholeReadQueue, resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidTransport, createMirroredGetCharImage, exposedBytes, resetAndroidTransport,
    seedSizes, urlOf,
} from 'src/ts/media/wholeReadQueue.testKit'

const READ_MIN = 8 * MIB

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

async function showConfig(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(CharConfig, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    await settleReads()
    return target
}

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        flushSync()
    }
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
}

/** Takes 60 MiB of the app-wide queue, as a chat image in flight would. */
async function holdBudget(): Promise<{ release: () => void }> {
    return androidWholeReadQueue().acquire(60 * MIB)
}

const exposed = (): number => exposedBytes(document.body, { minBytes: READ_MIN })

/** Fires `load` on the oldest unsettled fake image until none is left, checking the cap after every step. */
async function drainReads(): Promise<void> {
    for (let guard = 0; guard < 40; guard++) {
        const next = FakeImage.all.find((image) => !image.settled)
        if (!next) {
            return
        }
        next.fire('load')
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
    }
    throw new Error('reads never drained')
}

// The number of `getCharImage` calls the page makes off Android; they are the counts of the component before the hold.
const MEMBER_CALLS_OFF_ANDROID = 4
const ICON_CALLS_OFF_ANDROID = 5

const MEMBER_IMAGES = ['assets/m0.webp', 'assets/m1.webp', 'assets/m2.webp', 'assets/m3.webp']
const GROUP_IMAGE = 'assets/group.webp'
const CHARACTER_IMAGE = 'assets/character.webp'
const ASSET_IMAGES = ['assets/a0.webp', 'assets/a1.webp', 'assets/a2.webp', 'assets/a3.webp']

function chatsOf() {
    return [{ id: 'chat-a', message: [], scriptstate: {}, note: '' }]
}

function installGroupDb(subMenu: number): void {
    const members = MEMBER_IMAGES.map((image, index) => ({ type: 'character', chaId: `member-${index}`, name: `member-${index}`, image, chats: chatsOf() }))
    const group = {
        type: 'group', chaId: 'group-1', name: 'Group', image: GROUP_IMAGE, chatPage: 0, chats: chatsOf(),
        characters: members.map((member) => member.chaId),
        characterTalks: members.map(() => 0.5),
        characterActive: members.map(() => true),
        emotionImages: [], viewScreen: 'none',
    }
    DBState.db = { characters: [group, ...members], personas: [], modules: [], hideAllImages: false } as never
    CharConfigSubMenu.set(subMenu)
}

function installCharacterDb(): void {
    const character = {
        type: 'character', chaId: 'char-a', name: 'Alpha', image: CHARACTER_IMAGE, chatPage: 0, chats: chatsOf(),
        ccAssets: ASSET_IMAGES.map((uri) => ({ type: 'image', uri })),
        largePortrait: false, ttsMode: 'none', ttsSpeech: '', vits: null, oaiVoice: 'alloy', bias: [], personality: '', scenario: '',
        additionalData: {}, depth_prompt: { depth: 0, prompt: '' }, alternateGreetings: [], additionalAssets: [], emotionImages: [],
        viewScreen: 'none', desc: '', firstMessage: '', license: '',
    }
    DBState.db = { characters: [character], personas: [], modules: [], hideAllImages: false } as never
    CharConfigSubMenu.set(1)
}

const barIcons = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('button.ico'))
const iconBoxes = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('div.h-24.w-24.bg-textcolor2'))

beforeEach(() => {
    resetAndroidTransport(true)
    h.getCharImageSpy.mockReset()
    h.getCharImageSpy.mockImplementation(createMirroredGetCharImage(() => false))
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetAndroidWholeReadQueueForTest()
    resetQueuedWholeReadsForTest()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    await unmountAll()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('CharConfig group members and icons on Android', () => {
    test('(R) T16 four 20 MiB member icons stay within 64 MiB in flight, and each member paints its own image', async () => {
        installGroupDb(0)
        seedSizes(MEMBER_IMAGES, 20)
        const target = await showConfig()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        MEMBER_IMAGES.forEach((image, index) => {
            expect(barIcons(target)[index].getAttribute('style') ?? '').toContain(urlOf(image))
        })

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T16 leaving the page gives every waiting member entry back without an Image', async () => {
        installGroupDb(0)
        seedSizes(MEMBER_IMAGES, 20)
        const grant = await holdBudget()
        const target = await showConfig()
        expect(barIcons(target).every((icon) => !(icon.getAttribute('style') ?? '').includes('url('))).toBe(true)

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T16 the 20 MiB group icon waits while a chat image holds the queue, and paints after its read settles', async () => {
        installGroupDb(1)
        seedSizes([GROUP_IMAGE], 20)
        const grant = await holdBudget()
        const target = await showConfig()
        expect(iconBoxes(target)).toHaveLength(1)
        expect(iconBoxes(target)[0].getAttribute('style') ?? '').not.toContain('url(')

        grant.release()
        await settleReads()
        await drainReads()
        expect(iconBoxes(target)[0].getAttribute('style') ?? '').toContain(urlOf(GROUP_IMAGE))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the member icons paint at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        installGroupDb(0)
        seedSizes(MEMBER_IMAGES, 20)
        const target = await showConfig()

        expect(FakeImage.all).toHaveLength(0)
        MEMBER_IMAGES.forEach((image, index) => {
            expect(barIcons(target)[index].getAttribute('style') ?? '').toContain(urlOf(image))
        })
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(MEMBER_CALLS_OFF_ANDROID)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
        expect(new Set(calls.map((call) => call[0]))).toEqual(new Set(MEMBER_IMAGES))
    })
})

describe('CharConfig character icon and additional icons on Android', () => {
    test('(R) T16 the character icon and four 20 MiB additional icons stay within 64 MiB in flight, and each paints its own image', async () => {
        installCharacterDb()
        seedSizes([CHARACTER_IMAGE, ...ASSET_IMAGES], 20)
        const target = await showConfig()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        const boxes = iconBoxes(target)
        expect(boxes).toHaveLength(5)
        expect(boxes[0].getAttribute('style') ?? '').toContain(urlOf(CHARACTER_IMAGE))
        ASSET_IMAGES.forEach((image, index) => {
            expect(boxes[index + 1].getAttribute('style') ?? '').toContain(urlOf(image))
        })

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T16 leaving the page gives every waiting icon entry back without an Image', async () => {
        installCharacterDb()
        seedSizes([CHARACTER_IMAGE, ...ASSET_IMAGES], 20)
        const grant = await holdBudget()
        await showConfig()

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the icons paint at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        installCharacterDb()
        seedSizes([CHARACTER_IMAGE, ...ASSET_IMAGES], 20)
        const target = await showConfig()

        expect(FakeImage.all).toHaveLength(0)
        expect(iconBoxes(target)).toHaveLength(5)
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(ICON_CALLS_OFF_ANDROID)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
        expect(new Set(calls.map((call) => call[0]))).toEqual(new Set([CHARACTER_IMAGE, ...ASSET_IMAGES]))
    })
})
