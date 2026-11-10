// @vitest-environment happy-dom

/**
 * `CharacterSimpleList.svelte`: a row tap without an `onpick` host opens the character through
 * `changeChar`. A `changeChar` that throws or rejects shows the translated could-not-load alert
 * once and records the error under `list.pick`; the tap never raises an unhandled rejection and the
 * grid still closes. Every resolved outcome stays as it was: no alert, no record.
 *
 * Invariants exercised here:
 * - T1: a rejection shows one alert, writes a `list.pick` record, leaves no unhandled rejection and
 *   closes the grid.
 * - T4 (guard): `selected`, `superseded`, `gone`, a refused restore and a spy that returns nothing
 *   add neither an alert nor a record.
 * - T5: a tap that was overtaken by a later `changeChar` or a supersede before it rejected is
 *   recorded but not alerted.
 * - T6: two joined taps that both reject show exactly one alert.
 * - T7 (guard): `changeChar` is called synchronously from the click with the index only.
 *
 * MOCKED: the module set of `CharacterSimpleList.window.svelte.test.ts` (same directory), with
 * `changeChar` a spy, the alert and the caught-error record spies. The generation counter and
 * `supersedeChangeChar` are the real ones. The container's height is faked on `HTMLElement.prototype`.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { ChangeCharOutcome } from '../../ts/characters'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { changeCharSpy, alertErrorSpy, recordErrorSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
    recordErrorSpy: vi.fn(),
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
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
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
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
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
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

// The real characters module imports characterCards, which imports characterPick, which imports
// characters again. Loading the original inside the characters factory below would close that
// cycle on the unmocked module and bind characterPick to the real changeChar instead of the spy,
// so the cycle is cut here; this component never reaches characterCards.
vi.mock(import('../../ts/characterCards'), () => ({
    importCharacter: vi.fn(async () => []),
}) as unknown as typeof import('../../ts/characterCards'))

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: changeCharSpy,
    }
})

vi.mock(import('../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertError: alertErrorSpy,
    }
})

vi.mock(import('../../ts/caughtErrors'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        recordCaughtError: recordErrorSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { supersedeChangeChar } from '../../ts/characters'
import { language } from '../../lang'
import CharacterSimpleList from './CharacterSimpleList.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacters(): CharacterFixture[] {
    return ['Ann', 'Bob', 'Cy'].map((name, i) => ({
        chaId: `id-${i}`,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: i + 1,
        chats: [{ id: `id-${i}-chat`, message: [], note: '', name: '', localLore: [] }],
    })) as unknown as CharacterFixture[]
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(endGrid: () => void, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterSimpleList, { target, props: { endGrid } as never }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

const rowOf = (root: ParentNode, name: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(name))!

/** Rows are listed most recent first, so `Cy` (index 2) is the first row and `Ann` (index 0) the last. */
const INDEX_OF = { Ann: 0, Bob: 1, Cy: 2 } as const

// Node reports an unhandled rejection after the microtask queue drains, so a check needs a macrotask first.
const nextMacrotask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

beforeEach(() => {
    changeCharSpy.mockReset()
    alertErrorSpy.mockReset()
    recordErrorSpy.mockReset()
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('ResizeObserver', undefined)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
})

//#endregion

describe('CharacterSimpleList: a row tap whose changeChar throws', { timeout: 60_000 }, () => {
    test('T1: a rejection shows one alert, writes a list.pick record, closes the grid and leaves no unhandled rejection', async () => {
        DBState.db = buildDb(makeCharacters())
        const endGrid = vi.fn()
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        await withMounted(endGrid, async (target) => {
            rowOf(target, 'Bob').click()
            await settle()

            expect(changeCharSpy.mock.calls).toEqual([[INDEX_OF.Bob]])
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
            expect(recordErrorSpy).toHaveBeenCalledWith('list.pick', error)
            await nextMacrotask()
            expect(unhandled).toEqual([])
        })
    })

    test('T1b: a synchronous throw is handled the same way', async () => {
        DBState.db = buildDb(makeCharacters())
        const error = new Error('sync boom')
        changeCharSpy.mockImplementationOnce(() => { throw error })

        await withMounted(vi.fn(), async (target) => {
            rowOf(target, 'Bob').click()
            await settle()

            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(recordErrorSpy).toHaveBeenCalledWith('list.pick', error)
            await nextMacrotask()
            expect(unhandled).toEqual([])
        })
    })

    test.each<[string, ChangeCharOutcome | undefined]>([
        ['selected', 'selected'],
        ['superseded', 'superseded'],
        ['gone', 'gone'],
        ['a refused restore', { failed: 'unreadable' }],
        ['nothing', undefined],
    ])('guard: T4 a tap that resolves %s adds no alert and no record', async (_label, outcome) => {
        DBState.db = buildDb(makeCharacters())
        changeCharSpy.mockResolvedValueOnce(outcome)

        await withMounted(vi.fn(), async (target) => {
            rowOf(target, 'Bob').click()
            await settle()

            expect(changeCharSpy).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).not.toHaveBeenCalled()
            expect(recordErrorSpy).not.toHaveBeenCalled()
        })
    })

    test('T5: a tap overtaken by a supersede before it rejects is recorded and shows no alert', async () => {
        DBState.db = buildDb(makeCharacters())
        const error = new Error('late')
        let rejectTap: (reason: Error) => void = () => {}
        // The spy stands in for changeChar's own count bump at the start of a call.
        changeCharSpy.mockImplementationOnce(() => {
            supersedeChangeChar()
            return new Promise<ChangeCharOutcome>((_resolve, reject) => { rejectTap = reject })
        })

        await withMounted(vi.fn(), async (target) => {
            rowOf(target, 'Bob').click()
            await settle()
            supersedeChangeChar()
            rejectTap(error)
            await settle()

            expect(recordErrorSpy).toHaveBeenCalledWith('list.pick', error)
            expect(alertErrorSpy).not.toHaveBeenCalled()
            await nextMacrotask()
            expect(unhandled).toEqual([])
        })
    })

    test('T6: two joined taps that both reject show exactly one alert', async () => {
        DBState.db = buildDb(makeCharacters())
        const first = new Error('first')
        const second = new Error('second')
        const rejects: Array<(reason: Error) => void> = []
        changeCharSpy.mockImplementation(() => {
            supersedeChangeChar()
            return new Promise<ChangeCharOutcome>((_resolve, reject) => { rejects.push(reject) })
        })

        await withMounted(vi.fn(), async (target) => {
            rowOf(target, 'Bob').click()
            rowOf(target, 'Bob').click()
            expect(rejects).toHaveLength(2)

            rejects[0](first)
            await settle()
            expect(alertErrorSpy).not.toHaveBeenCalled()
            rejects[1](second)
            await settle()

            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(recordErrorSpy).toHaveBeenCalledWith('list.pick', first)
            expect(recordErrorSpy).toHaveBeenCalledWith('list.pick', second)
            await nextMacrotask()
            expect(unhandled).toEqual([])
        })
    })

    test('guard: T7 changeChar runs synchronously from the click with the index only', async () => {
        DBState.db = buildDb(makeCharacters())
        const endGrid = vi.fn()
        changeCharSpy.mockResolvedValue('selected')

        await withMounted(endGrid, (target) => {
            rowOf(target, 'Cy').click()

            expect(changeCharSpy.mock.calls).toEqual([[INDEX_OF.Cy]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })
})
