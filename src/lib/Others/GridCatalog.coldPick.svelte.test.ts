// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` picks with the new shell off. A pick that must restore an archived character
 * (a placeholder slot, or a group with an archived member) keeps the grid open with that tile marked
 * as loading, and closes the grid only when `changeChar` returns `selected`. A warm pick stays the
 * plain synchronous call and close.
 *
 * Invariants exercised here:
 * - C1-C3: a cold pick in the Grid, List and Simple tabs keeps the grid open with the tile marked, and
 *   closes it once on `selected`.
 * - C4-C7: a failed restore, a reply that started meanwhile, a vanished character and a thrown error
 *   each leave the grid open with the marker gone; only the reply and the thrown error add a notice.
 * - C8-C9: the last pick wins; an earlier landing changes nothing.
 * - C10: a repeat tap on the loading tile does nothing.
 * - C11: `selected` closes the host even when the grid was unmounted by the selection itself.
 * - C12-C13: leaving the grid or entering edit mode while a load is pending supersedes it.
 * - C14-C15: an archived group member keeps the group pick waiting; the marker survives the install
 *   replacing the slot object.
 * - W1, E1 (guards): a warm pick closes synchronously with no marker; edit mode only toggles the pick.
 * - G1: a warm pick whose `changeChar` rejects closes the grid at once, shows the could-not-load
 *   notice once, records `grid.pick` and leaves no unhandled rejection. It is reported
 *   unconditionally: a warm `changeChar` throws before any await, so nothing newer can start first.
 * - G2: a warm pick ends a pending cold pick first; the overtaken cold pick's later throw is
 *   recorded but shows no notice.
 * - G3: when both throw there is exactly one notice, with the real generation counter moving.
 *
 * MOCKED: the module set of `GridCatalog.shellPick.svelte.test.ts` (same directory); `changeChar` is a
 * deferred promise the test settles, `supersedeChangeChar`, the two alerts and the caught-error record
 * are spies, and the shell switch is a flag held off. A `selected` settlement writes the selection
 * before it resolves, like the real one. There are no timing values: only ordering and counts. G3
 * wires the real generation counter through the spies.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
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

const { changeCharSpy, supersedeSpy, alertNormalSpy, alertErrorSpy, recordErrorSpy, realSupersede } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    supersedeSpy: vi.fn(),
    alertNormalSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
    recordErrorSpy: vi.fn(),
    // The real `supersedeChangeChar`, for the tests that move the real generation counter.
    realSupersede: { fn: null as null | (() => void) },
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
    realSupersede.fn = actual.supersedeChangeChar
    return {
        ...actual,
        changeChar: changeCharSpy,
        supersedeChangeChar: supersedeSpy,
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

vi.mock(import('../../ts/caughtErrors'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        recordCaughtError: recordErrorSpy,
    }
})

vi.mock('../../ts/chatShell/shellSwitch.svelte', () => {
    const flag = $state({ eligible: false })
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

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { changeCharGeneration } from '../../ts/characters'
import { doingChat } from '../../ts/process/index.svelte'
import { isWriting, registerWork } from '../../ts/process/chatOrigin'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

//#region fixtures and helpers

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

/** An archived character in the shape the upstream application writes. */
function upstreamStub(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        type: 'character',
        chaId,
        name,
        image: '',
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: `unit-${chaId}`,
        coldStoragedChats: [],
        ...extra,
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, name: string, members: string[]): CharacterFixture {
    return makeCharacter(chaId, name, { type: 'group', characters: members })
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

/** A `changeChar` call the test has not settled yet. */
interface PendingCall {
    index: number
    /** Settles the call; `selected` writes the selection first, like the real one. */
    land: (outcome: ChangeCharOutcome) => void
    fail: (error: Error) => void
}

let calls: PendingCall[] = []

/**
 * A slot that must be restored (placeholder, or a group) waits for the test; any other slot selects
 * at once, as the real call does, because it has no await before the selection write.
 */
function installDeferredChangeChar(): void {
    calls = []
    changeCharSpy.mockImplementation((index: number) => {
        const slot = DBState.db.characters[index]
        if (!slot.coldstorage && slot.type !== 'group') {
            selectedCharID.set(index)
            return Promise.resolve('selected')
        }
        return new Promise<ChangeCharOutcome>((resolve, reject) => {
            calls.push({
                index,
                land: (outcome) => {
                    if (outcome === 'selected') {
                        selectedCharID.set(index)
                    }
                    resolve(outcome)
                },
                fail: reject,
            })
        })
    })
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

const tiles = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.ico'))
const nameButton = (root: HTMLElement, name: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('h4 button')).find((b) => b.textContent?.trim() === name)!
const simpleRow = (root: HTMLElement, name: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(name))!
const markCount = (root: HTMLElement): number => root.querySelectorAll('[data-charlist-opening]').length
const busyCount = (root: HTMLElement): number => root.querySelectorAll('[aria-busy="true"]').length

beforeEach(() => {
    changeCharSpy.mockReset()
    supersedeSpy.mockReset()
    alertNormalSpy.mockReset()
    alertErrorSpy.mockReset()
    recordErrorSpy.mockReset()
    shellFlag.eligible = false
    doingChat.set(false)
    selectedCharID.set(-1)
    installDeferredChangeChar()
})

afterEach(() => {
    doingChat.set(false)
    vi.restoreAllMocks()
})

//#endregion

describe('GridCatalog: a cold pick keeps the grid open until the character has opened', { timeout: 60_000 }, () => {
    test('C1: a Grid tab pick marks the tile and closes the grid once, on selected', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(tiles(target)[1].getAttribute('aria-busy')).toBe('true')
            expect(tiles(target)[0].getAttribute('aria-busy')).toBeNull()
            expect(markCount(target)).toBe(1)
            expect(calls).toHaveLength(1)

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
            expect(markCount(target)).toBe(0)
            expect(get(selectedCharID)).toBe(1)
        })
    })

    test('C2: a List tab pick marks the row and closes the grid once, on selected', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 1)
            nameButton(target, 'Bob').click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(nameButton(target, 'Bob').getAttribute('aria-busy')).toBe('true')
            expect(nameButton(target, 'Ann').getAttribute('aria-busy')).toBeNull()
            expect(markCount(target)).toBe(1)

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
        })
    })

    test('C3: a Simple tab pick marks the row and closes the grid once, on selected', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 3)
            simpleRow(target, 'Bob').click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(simpleRow(target, 'Bob').getAttribute('aria-busy')).toBe('true')
            expect(simpleRow(target, 'Ann').getAttribute('aria-busy')).toBeNull()
            expect(markCount(target)).toBe(1)

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
        })
    })

    test('C4: a failed restore leaves the grid open and clears the marker, with no notice of its own', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(1)

            calls[0].land({ failed: 'missing' })
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(0)
            expect(busyCount(target)).toBe(0)
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(alertErrorSpy).not.toHaveBeenCalled()
        })
    })

    test('C5 (T6): a reply being written does not stop a cold pick: the tile is marked and the grid closes when it lands selected', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        doingChat.set(true)
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(1)

            calls[0].land('selected')
            await settle()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(markCount(target)).toBe(0)
        })
    })

    test('C6: a character that is gone leaves the grid open, silently', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()

            calls[0].land('gone')
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(alertErrorSpy).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(0)
        })
    })

    test('C7: a thrown error is recorded, shows the could-not-load notice and leaves the grid open', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()
        const error = new Error('read failed')

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()

            calls[0].fail(error)
            await settle()
            expect(recordErrorSpy).toHaveBeenCalledWith('grid.pick', error)
            expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
            expect(endGrid).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(0)
        })
    })

    test('C8: a second cold pick moves the marker; the first landing as superseded changes nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob'), upstreamStub('c', 'Cy')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(tiles(target)[1].getAttribute('aria-busy')).toBe('true')

            tiles(target)[2].click()
            await settle()
            expect(tiles(target)[1].getAttribute('aria-busy')).toBeNull()
            expect(tiles(target)[2].getAttribute('aria-busy')).toBe('true')
            expect(calls.map((call) => call.index)).toEqual([1, 2])

            calls[0].land('superseded')
            await settle()
            expect(tiles(target)[2].getAttribute('aria-busy')).toBe('true')
            expect(endGrid).not.toHaveBeenCalled()
            expect(alertNormalSpy).not.toHaveBeenCalled()

            calls[1].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
        })
    })

    test('C9: a warm pick after a cold one closes at once; the earlier landing as superseded changes nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()

            tiles(target)[0].click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1], [0]])

            calls[0].land('superseded')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(0)
        })
    })

    test('C10: a repeat tap on the loading tile does nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            tiles(target)[1].click()
            await settle()
            expect(changeCharSpy).toHaveBeenCalledTimes(1)
            expect(markCount(target)).toBe(1)

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('C11: selected closes the host even when the selection already unmounted the grid', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
        try {
            await settle()
            clickLayoutButton(target, 3)
            simpleRow(target, 'Bob').click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()

            // The host removes the grid as soon as the selection is written.
            const stop = selectedCharID.subscribe((value) => {
                if (value >= 0) {
                    void unmount(app as never)
                }
            })
            calls[0].land('selected')
            stop()
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
        } finally {
            target.remove()
        }
    })

    test('C12: leaving the grid while a load is pending supersedes it; the landing changes nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
        try {
            await settle()
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(supersedeSpy).not.toHaveBeenCalled()

            await unmount(app as never)
            expect(supersedeSpy).toHaveBeenCalledTimes(1)

            calls[0].land('superseded')
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(alertNormalSpy).not.toHaveBeenCalled()
            expect(alertErrorSpy).not.toHaveBeenCalled()
        } finally {
            target.remove()
        }
    })

    test('guard: T23 dropping a pending pick during a reply supersedes the pick only and leaves the reply registered and running', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        doingChat.set(true)
        const stopReply = vi.fn()
        const reply = registerWork({ chaId: 'a', chatId: 'a-chat' }, stopReply, 'reply')
        const endGrid = vi.fn()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
        try {
            await settle()
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(markCount(target)).toBe(1)

            await unmount(app)

            expect(supersedeSpy).toHaveBeenCalledTimes(1)
            expect(stopReply).not.toHaveBeenCalled()
            expect(isWriting({ chaId: 'a', chatId: 'a-chat' })).toBe(true)
        } finally {
            reply.end()
            target.remove()
        }
    })

    test('guard: C12 leaving the grid with nothing pending supersedes nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        await withMounted(vi.fn(), async (target) => {
            clickLayoutButton(target, 0)
            await settle()
        })
        expect(supersedeSpy).not.toHaveBeenCalled()
    })

    test('C13: entering edit mode while a load is pending drops it and clears the marker', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(markCount(target)).toBe(1)

            const edit = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.othersUi.editMode)!
            edit.click()
            await settle()
            expect(supersedeSpy).toHaveBeenCalledTimes(1)
            expect(markCount(target)).toBe(0)
            expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.othersUi.editDone)).toBe(true)

            calls[0].land('superseded')
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(alertNormalSpy).not.toHaveBeenCalled()
        })
    })

    test('C14: a group with an archived member waits for the load like an archived character', async () => {
        DBState.db = buildDb([makeGroup('g', 'Team', ['m']), upstreamStub('m', 'Member')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[0].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(tiles(target)[0].getAttribute('aria-busy')).toBe('true')

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
        })
    })

    test('C15: an archived stub that restores to a group keeps its marker and repeat-tap guard until selected', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob'), upstreamStub('m', 'Member')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
            expect(tiles(target)[1].getAttribute('aria-busy')).toBe('true')

            // The install replaces the slot object; the group's archived member is still loading.
            DBState.db.characters[1] = makeGroup('b', 'Bob', ['m'])
            await settle()
            expect(tiles(target)[1].getAttribute('aria-busy')).toBe('true')
            expect(markCount(target)).toBe(1)

            tiles(target)[1].click()
            await settle()
            expect(changeCharSpy).toHaveBeenCalledTimes(1)
            expect(endGrid).not.toHaveBeenCalled()

            calls[0].land('selected')
            await settle()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(busyCount(target)).toBe(0)
        })
    })
})

describe('GridCatalog: picks that never wait', { timeout: 60_000 }, () => {
    test('guard: W1 a warm pick closes the grid synchronously and marks nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            flushSync()
            expect(busyCount(target)).toBe(0)
            expect(markCount(target)).toBe(0)
        })
    })

    test('guard: E1 in edit mode a tap on an archived tile toggles the pick and loads nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            const edit = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.othersUi.editMode)!
            edit.click()
            await settle()
            tiles(target)[1].click()
            await settle()
            expect(tiles(target)[1].getAttribute('aria-pressed')).toBe('true')
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
            expect(busyCount(target)).toBe(0)
        })
    })
})

describe('GridCatalog: a warm pick whose changeChar throws', { timeout: 60_000 }, () => {
    // Node reports an unhandled rejection after the microtask queue drains, so a check needs a macrotask first.
    const nextMacrotask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))
    let unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

    beforeEach(() => {
        unhandled = []
        process.on('unhandledRejection', onUnhandled)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        process.off('unhandledRejection', onUnhandled)
    })

    test('G1: the grid closes at once, the notice shows once, grid.pick is recorded and nothing is left unhandled', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const endGrid = vi.fn()
        const error = new Error('format failed')
        changeCharSpy.mockImplementationOnce(() => Promise.reject(error))

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            expect(endGrid).toHaveBeenCalledTimes(1)
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(supersedeSpy).not.toHaveBeenCalled()

            await settle()
            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
            expect(recordErrorSpy).toHaveBeenCalledWith('grid.pick', error)
            await nextMacrotask()
            expect(unhandled).toEqual([])
            expect(markCount(target)).toBe(0)
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('G2: a warm pick ends a pending cold pick; the cold pick throwing later is recorded and shows no notice', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()
        const error = new Error('read failed')

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(markCount(target)).toBe(1)

            tiles(target)[0].click()
            flushSync()
            expect(markCount(target)).toBe(0)
            expect(supersedeSpy).toHaveBeenCalledTimes(1)
            expect(endGrid).toHaveBeenCalledTimes(1)

            calls[0].fail(error)
            await settle()
            expect(recordErrorSpy).toHaveBeenCalledWith('grid.pick', error)
            expect(alertErrorSpy).not.toHaveBeenCalled()
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('G3: when the warm pick and the pending cold pick both throw there is exactly one notice, with the real generation counter moving', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), upstreamStub('b', 'Bob')])
        const endGrid = vi.fn()
        const warmError = new Error('format failed')
        const coldError = new Error('read failed')
        // Like the real producer: every call bumps the counter first, and a supersede bumps it too.
        supersedeSpy.mockImplementation(() => realSupersede.fn!())
        const deferred = changeCharSpy.getMockImplementation()!
        changeCharSpy.mockImplementation((index: number) => {
            realSupersede.fn!()
            return deferred(index)
        })

        await withMounted(endGrid, async (target) => {
            clickLayoutButton(target, 0)
            tiles(target)[1].click()
            await settle()
            expect(markCount(target)).toBe(1)

            // The cold click's own bump is already counted here, so the difference below is only this pick's.
            const g0 = changeCharGeneration()
            changeCharSpy.mockImplementationOnce(() => {
                realSupersede.fn!()
                return Promise.reject(warmError)
            })
            tiles(target)[0].click()
            await settle()
            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
            expect(recordErrorSpy).toHaveBeenCalledWith('grid.pick', warmError)
            // Fixture self-check: the drop's supersede and the call's own bump both ran, so the counter really moved.
            expect(changeCharGeneration() - g0).toBe(2)

            calls[0].fail(coldError)
            await settle()
            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(recordErrorSpy).toHaveBeenCalledWith('grid.pick', coldError)
            await nextMacrotask()
            expect(unhandled).toEqual([])
        })
    })
})
