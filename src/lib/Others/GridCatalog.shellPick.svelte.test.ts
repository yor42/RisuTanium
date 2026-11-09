// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` picks while the new shell is the active surface go through
 * `switchCharacter`: quiet, with a reply being written or not, and a refused restore ends in the
 * chat frame, never in an alert. With the shell not eligible a pick is `changeChar(index)` and
 * `endGrid()`, with a reply being written or not.
 *
 * Invariants exercised here:
 * - TB9: during a reply a pick closes the grid and switches quietly, with no notice.
 * - TB11: a pick of an archived character is a quiet switch; a missing unit ends as `failed`, no alert.
 * - TB10 (guard): idle with the shell not eligible a pick is today's call, in the Grid tab and the Simple list.
 * - TB12: during a reply a pick with the shell not eligible is the same plain call, in the Grid, List and
 *   Simple tabs.
 * - TB13 (guard): in edit mode a tile tap only toggles the pick, with no notice, during a reply too.
 *
 * MOCKED: the module set of `GridCatalog.pick.svelte.test.ts` (same directory); `changeChar` is a
 * spy, the shell switch is a reactive flag, the alert module keeps its real prompts and spies the
 * two notices. `switchTarget` and the reply flag are real.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

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

const { changeCharSpy, alertNormalSpy, alertErrorSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    alertNormalSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
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
        alertNormal: alertNormalSpy,
        alertError: alertErrorSpy,
    }
})

vi.mock('../../ts/chatShell/shellSwitch.svelte', () => {
    const flag = $state({ eligible: true })
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState } from '../../ts/stores.svelte'
import { doingChat } from '../../ts/process/index.svelte'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { clearPending, switchTarget } from '../../ts/chatShell/switchTarget.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: `${name} description`,
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
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
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(endGrid: () => void, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 3): void {
    const label = (layout === 0 ? language.grid : layout === 1 ? language.list : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

beforeEach(() => {
    changeCharSpy.mockReset()
    alertNormalSpy.mockReset()
    alertErrorSpy.mockReset()
    shellFlag.eligible = true
    doingChat.set(false)
    clearPending()
})

afterEach(() => {
    doingChat.set(false)
    clearPending()
})

describe('GridCatalog picks while the new shell is the active surface', { timeout: 60_000 }, () => {
    test('TB9 (T6): during a reply a Grid tab pick closes the grid and switches quietly, with no notice', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        changeCharSpy.mockResolvedValue('selected')
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            target.querySelectorAll<HTMLElement>('.ico')[1].click()
            await settle()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(changeCharSpy).toHaveBeenCalledWith(1, { quiet: true })
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('TB9 (T6): the Simple list switches the same way', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        changeCharSpy.mockResolvedValue('selected')
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 3)
            const row = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Bob'))!
            row.click()
            await settle()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(changeCharSpy).toHaveBeenCalledWith(1, { quiet: true })
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('a warm pick closes the grid and switches quietly', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        changeCharSpy.mockResolvedValue('selected')
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            target.querySelectorAll<HTMLElement>('.ico')[1].click()
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy).toHaveBeenCalledTimes(1)
            expect(changeCharSpy).toHaveBeenCalledWith(1, { quiet: true })
        })
    })

    test('TB11: an archived pick whose unit is missing ends as failed in the frame, with no alert', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob', { coldstorage: 'unit-b' })])
        changeCharSpy.mockResolvedValue({ failed: 'missing' })
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            target.querySelectorAll<HTMLElement>('.ico')[1].click()
            await settle()
            expect(changeCharSpy).toHaveBeenCalledWith(1, { quiet: true })
            expect(alertErrorSpy).not.toHaveBeenCalled()
            expect(switchTarget.phase).toBe('failed')
            expect(switchTarget.reason).toBe('missing')
        })
    })

    test('guard: TB10 idle with the shell not eligible a pick is the plain call and closes the grid', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 0)
            target.querySelectorAll<HTMLElement>('.ico')[1].click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(alertNormalSpy).not.toHaveBeenCalled()
        })
    })

    test('guard: TB10 with the shell not eligible the Simple list is the plain call', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 3)
            const row = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Bob'))!
            row.click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('TB12 (T6): during a reply with the shell not eligible a Grid tab pick is the plain call and closes the grid', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 0)
            target.querySelectorAll<HTMLElement>('.ico')[1].click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(alertNormalSpy).not.toHaveBeenCalled()
        })
    })

    test('TB12 (T6): during a reply with the shell not eligible a List tab pick switches the same way', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const heading = Array.from(target.querySelectorAll('h4')).find((h) => h.textContent?.trim() === 'Bob')!
            heading.click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(alertNormalSpy).not.toHaveBeenCalled()
        })
    })

    test('TB12 (T6): during a reply with the shell not eligible a Simple tab pick switches the same way', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 3)
            const row = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Bob'))!
            row.click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(alertNormalSpy).not.toHaveBeenCalled()
        })
    })

    test('guard: TB13 in edit mode a tile tap toggles the pick, with no notice, during a reply', async () => {
        shellFlag.eligible = false
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            const edit = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.othersUi.editMode)!
            edit.click()
            await settle()
            const tile = target.querySelectorAll<HTMLElement>('.ico')[1]
            tile.click()
            await settle()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
            expect(target.querySelectorAll<HTMLElement>('.ico')[1].getAttribute('aria-pressed')).toBe('true')
        })
    })
})
