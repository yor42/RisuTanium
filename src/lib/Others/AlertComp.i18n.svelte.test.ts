// @vitest-environment happy-dom

/**
 * The confirm dialog of `AlertComp.svelte` labels its two buttons in the UI language, read when
 * the component initialises. The language is set before the dialog opens and restored to
 * English afterwards. Whatever the label says, a click answers the caller of the confirm and
 * writes the same `'yes'` or `'no'` message to the alert store.
 *
 * Drives the REAL `AlertComp.svelte`, the real alert functions and a real `writable`
 * standing in for `alertStore`. The module mocks copy `AlertComp.keyAnswers.svelte.test.ts`.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while a button label is a hard-coded English literal.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
            isPlainHttpFileSrc: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        loadoutModalStore: { open: false },
        openPersonaList: writable(false),
        openPresetList: writable(false),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('../../ts/process/index.svelte'))

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertConfirm, type alertData } from '../../ts/alert'
import { changeLanguage } from '../../lang'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'
import AlertComp from './AlertComp.svelte'

/** One millisecond past the pause during which a prompt ignores Enter. */
const PAUSE_MS = 401

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
const stopRecording: Array<() => void> = []

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
    await Promise.resolve()
}

async function openConfirm(): Promise<{ target: HTMLElement, answers: boolean[], written: alertData[] }> {
    vi.useFakeTimers()
    DBState.db = { characters: [] } as unknown as Database
    const answers: boolean[] = []
    void alertConfirm('Proceed?').then((answer) => { answers.push(answer) })
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    await settle()
    await vi.advanceTimersByTimeAsync(PAUSE_MS)
    await settle()
    const written: alertData[] = []
    stopRecording.push(alertStore.subscribe((value) => { written.push(value as alertData) }))
    written.length = 0
    return { target, answers, written }
}

const buttonTexts = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())

/** The button showing the translated label, else the English literal. */
function buttonNamed(target: HTMLElement, name: string, english: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => [name, english].includes(button.textContent?.trim() ?? ''))
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

afterEach(async () => {
    while (stopRecording.length > 0) {
        stopRecording.pop()!()
    }
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    changeLanguage('en')
    vi.clearAllMocks()
})

afterAll(() => {
    alertStore.set({ type: 'none', msg: '' } as never)
})

describe('AlertComp confirm buttons', () => {
    test('regression reproducer: Korean labels the confirm buttons in Korean', async () => {
        changeLanguage('ko')
        expect(languageKorean.alertComp.yes).not.toBe('YES')
        expect(languageKorean.alertComp.no).not.toBe('NO')
        const { target } = await openConfirm()

        expect(buttonTexts(target)).toContain(languageKorean.alertComp.yes)
        expect(buttonTexts(target)).toContain(languageKorean.alertComp.no)
        expect(buttonTexts(target)).not.toContain('YES')
        expect(buttonTexts(target)).not.toContain('NO')
    })

    test('guard: clicking the Korean-labelled yes button answers yes and writes the yes message', async () => {
        changeLanguage('ko')
        const { target, answers, written } = await openConfirm()

        buttonNamed(target, languageKorean.alertComp.yes, 'YES').click()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        expect(answers).toEqual([true])
        expect(written.filter((w) => w.type === 'none' && w.msg === 'yes')).toHaveLength(1)
    })

    test('guard: clicking the Korean-labelled no button answers no and writes the no message', async () => {
        changeLanguage('ko')
        const { target, answers, written } = await openConfirm()

        buttonNamed(target, languageKorean.alertComp.no, 'NO').click()
        await vi.advanceTimersByTimeAsync(0)
        await settle()

        expect(answers).toEqual([false])
        expect(written.filter((w) => w.type === 'none' && w.msg === 'no')).toHaveLength(1)
        expect(written.filter((w) => w.type === 'none' && w.msg === 'yes')).toHaveLength(0)
    })

    test('guard: English labels the confirm buttons YES and NO', async () => {
        expect(languageEnglish.alertComp.yes).toBe('YES')
        expect(languageEnglish.alertComp.no).toBe('NO')
        const { target } = await openConfirm()

        expect(buttonTexts(target)).toContain('YES')
        expect(buttonTexts(target)).toContain('NO')
    })
})