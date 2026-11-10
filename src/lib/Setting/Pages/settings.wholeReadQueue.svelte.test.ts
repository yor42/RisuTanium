// @vitest-environment jsdom

/**
 * The settings surfaces on Android: the persona list and user icon of `PersonaSettings.svelte`, the picture of
 * `WelcomePersonaStep.svelte` and the three reference images of `OtherBotSettings.svelte` read their images through a
 * hold, so a file of 8 MiB or more waits in the app-wide whole-read queue instead of being put on the page together
 * with the other large images.
 *
 * The real components are mounted over a real `$state` database. `getCharImage` is the kit's mirror
 * (`wholeReadQueue.testKit.ts`; the util test checks it against the real function) behind a spy; the queue, the size
 * verdict and the detached `Image` are the real ones.
 *
 * "Held grant": the test takes 60 MiB of the 64 MiB queue itself, as a chat image would, so any larger read must wait.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix components), `(G)` a compatibility guard, `(U)` a rule test.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    getCharImageSpy: vi.fn(),
}))

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertSelect: vi.fn(async () => '0'),
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
    sleep: vi.fn(async () => {}),
    sortableOptions: {},
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: h.getCharImageSpy,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/persona'), () => ({
    changeUserPersona: vi.fn(),
    exportUserPersona: vi.fn(),
    importUserPersona: vi.fn(),
    saveUserPersona: vi.fn(),
    selectUserImg: vi.fn(),
}) as unknown as typeof import('src/ts/persona'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string) => ({ name })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

vi.mock(import('src/ts/process/wavespeedModels'), () => ({
    requestWavespeedModels: vi.fn(async () => ({
        ok: true,
        data: { code: 200, data: [{ model_id: 'wave-model', name: 'Wave', base_price: 1, type: 'image-to-image' }] },
    })),
}) as unknown as typeof import('src/ts/process/wavespeedModels'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: { create: vi.fn(() => ({ destroy: () => {} })) },
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import PersonaSettings from './PersonaSettings.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'
import WelcomePersonaStep from 'src/lib/Others/Welcome/WelcomePersonaStep.svelte'
import { androidWholeReadQueue, resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidTransport, createMirroredGetCharImage, domUrls, exposedBytes, resetAndroidTransport,
    seedSizes, urlOf,
} from 'src/ts/media/wholeReadQueue.testKit'

const READ_MIN = 8 * MIB

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

function show(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(component, { target, props })
    mounted.push({ instance, target })
    flushSync()
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

const loadedSources = (): string[] => FakeImage.all.map((image) => image.src)

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

//#region PersonaSettings

const PERSONA_ICONS = ['assets/persona0.webp', 'assets/persona1.webp', 'assets/persona2.webp', 'assets/persona3.webp']
const USER_ICON = 'assets/userIcon.webp'

function installPersonaDb(): void {
    DBState.db = {
        username: 'me',
        userNote: '',
        personaPrompt: '',
        userIcon: USER_ICON,
        selectedPersona: 0,
        hideAllImages: false,
        personas: PERSONA_ICONS.map((icon, index) => ({ name: `persona${index}`, icon, personaPrompt: '', note: '' })),
    } as unknown as Database
}

const personaBoxes = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('button[data-risu-idx] .bg-textcolor2'))
const userBox = (target: HTMLElement): HTMLElement | null => target.querySelector<HTMLElement>('.h-28.w-28.bg-textcolor2')

describe('PersonaSettings icons on Android', () => {
    test('(R) T15 four 20 MiB persona icons and a 20 MiB user icon stay within 64 MiB in flight, and all paint in the end', async () => {
        installPersonaDb()
        seedSizes([...PERSONA_ICONS, USER_ICON], 20)
        const target = show(PersonaSettings)
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        PERSONA_ICONS.forEach((icon, index) => {
            expect(personaBoxes(target)[index].getAttribute('style')).toContain(urlOf(icon))
        })
        expect(userBox(target)!.getAttribute('style')).toContain(urlOf(USER_ICON))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T15 leaving the page gives every waiting icon entry back without an Image', async () => {
        installPersonaDb()
        seedSizes([...PERSONA_ICONS, USER_ICON], 20)
        const grant = await holdBudget()
        const target = show(PersonaSettings)
        await settleReads()
        expect(domUrls(target)).toEqual([])

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(U) a persona icon that changes while its read waits shows the newer image and never loads the older one', async () => {
        installPersonaDb()
        seedSizes([...PERSONA_ICONS, USER_ICON, 'assets/persona1b.webp'], 20)
        const grant = await holdBudget()
        const target = show(PersonaSettings)
        await settleReads()

        DBState.db.personas[1].icon = 'assets/persona1b.webp'
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()

        expect(personaBoxes(target)[1].getAttribute('style')).toContain(urlOf('assets/persona1b.webp'))
        expect(personaBoxes(target)[0].getAttribute('style')).toContain(urlOf(PERSONA_ICONS[0]))
        expect(loadedSources()).not.toContain(urlOf(PERSONA_ICONS[1]))
    })

    test('(G) T17 off Android the icons paint at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        installPersonaDb()
        seedSizes([...PERSONA_ICONS, USER_ICON], 20)
        const target = show(PersonaSettings)
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        PERSONA_ICONS.forEach((icon, index) => {
            expect(personaBoxes(target)[index].getAttribute('style')).toContain(urlOf(icon))
        })
        expect(userBox(target)!.getAttribute('style')).toContain(urlOf(USER_ICON))
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(5)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
        expect(calls.map((call) => call[0]).sort()).toEqual([...PERSONA_ICONS, USER_ICON].sort())
    })
})

//#endregion

//#region WelcomePersonaStep

function pictureFlow() {
    return {
        keepPicture: true, name: '', description: '', finishing: false,
        next: () => {}, removePicture: () => {}, skipPersona: () => {}, pictureChosen: () => {},
    }
}

const WELCOME_PICTURE = 'assets/welcome.webp'

describe('WelcomePersonaStep picture on Android', () => {
    test('(R) the 20 MiB picture waits while a chat image holds the queue, and paints after its read settles', async () => {
        DBState.db = { userIcon: WELCOME_PICTURE, hideAllImages: false } as unknown as Database
        seedSizes([WELCOME_PICTURE], 20)
        const grant = await holdBudget()
        const target = show(WelcomePersonaStep, { flow: pictureFlow(), mode: 'persona' })
        await settleReads()
        expect(target.querySelector('[data-persona-picture]')).toBeNull()

        grant.release()
        await settleReads()
        await drainReads()
        expect(target.querySelector('[data-persona-picture]')!.getAttribute('style')).toContain(urlOf(WELCOME_PICTURE))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) leaving the step gives the waiting picture entry back without an Image', async () => {
        DBState.db = { userIcon: WELCOME_PICTURE, hideAllImages: false } as unknown as Database
        seedSizes([WELCOME_PICTURE], 20)
        const grant = await holdBudget()
        show(WelcomePersonaStep, { flow: pictureFlow(), mode: 'persona' })
        await settleReads()

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the picture paints at once with a two-argument call', async () => {
        resetAndroidTransport(false)
        DBState.db = { userIcon: WELCOME_PICTURE, hideAllImages: false } as unknown as Database
        seedSizes([WELCOME_PICTURE], 20)
        const target = show(WelcomePersonaStep, { flow: pictureFlow(), mode: 'persona' })
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(target.querySelector('[data-persona-picture]')!.getAttribute('style')).toContain(urlOf(WELCOME_PICTURE))
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls).toEqual([[WELCOME_PICTURE, 'css']])
    })
})

//#endregion

//#region OtherBotSettings

const NAI_CHARACTER = 'assets/naiCharacter.webp'
const NAI_BASE = 'assets/naiBase.webp'
const WAVESPEED_REFERENCE = 'assets/wavespeedReference.webp'

function installOtherBotDb(provider: 'novelai' | 'wavespeed'): void {
    DBState.db = {
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        hideAllImages: false,
        sdProvider: provider,
        sdConfig: {},
        NAIImgModel: 'nai-diffusion-4-5-full',
        NAII2I: true,
        NAIImgConfig: { reference_mode: 'character', character_image: NAI_CHARACTER, image: NAI_BASE },
        wavespeedImage: { key: 'throwaway', model: 'wave-model', reference_mode: 'image', reference_image: WAVESPEED_REFERENCE, loras: [] },
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
}

const imageSources = (target: HTMLElement): string[] => Array.from(target.querySelectorAll('img')).map((image) => image.getAttribute('src') ?? '')

/** The page opens on the memory tab; the reference images are in the image generation tab. */
function showImageTab(): HTMLElement {
    const target = show(OtherBotSettings)
    const tab = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === language.imageGeneration)
    tab!.click()
    flushSync()
    return target
}

/** The wavespeed reference image shows only for a model that takes image input, which the page learns from its model list. */
async function loadWavespeedModels(target: HTMLElement): Promise<void> {
    const refresh = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === language.settingsPage.refreshModels)
    refresh!.click()
    await settleReads()
}

describe('OtherBotSettings reference images on Android', () => {
    test('(R) the two Novel AI images of 20 MiB wait while a chat image holds the queue, and paint after their reads settle', async () => {
        installOtherBotDb('novelai')
        seedSizes([NAI_CHARACTER, NAI_BASE], 20)
        const grant = await holdBudget()
        const target = showImageTab()
        await settleReads()
        expect(imageSources(target)).toEqual([])

        grant.release()
        await settleReads()
        await drainReads()
        expect(imageSources(target).sort()).toEqual([urlOf(NAI_CHARACTER), urlOf(NAI_BASE)].sort())

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) the wavespeed reference image of 20 MiB waits while a chat image holds the queue', async () => {
        installOtherBotDb('wavespeed')
        seedSizes([WAVESPEED_REFERENCE], 20)
        const grant = await holdBudget()
        const target = showImageTab()
        await loadWavespeedModels(target)
        expect(imageSources(target)).toEqual([])

        grant.release()
        await settleReads()
        await drainReads()
        expect(imageSources(target)).toEqual([urlOf(WAVESPEED_REFERENCE)])

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) leaving the page gives every waiting image entry back without an Image', async () => {
        installOtherBotDb('novelai')
        seedSizes([NAI_CHARACTER, NAI_BASE], 20)
        const grant = await holdBudget()
        showImageTab()
        await settleReads()

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T17 off Android the images show at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        installOtherBotDb('novelai')
        seedSizes([NAI_CHARACTER, NAI_BASE], 20)
        const target = showImageTab()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(imageSources(target).sort()).toEqual([urlOf(NAI_CHARACTER), urlOf(NAI_BASE)].sort())
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(2)
        expect(calls.every((call) => call.length === 2 && call[1] === 'plain')).toBe(true)
    })
})

//#endregion
