// @vitest-environment happy-dom

/**
 * What `MobileCharacters.svelte` lists for a search: the shared character
 * search decides the matches (name, description, tags and creator, every word
 * of the query, normalised), the list keeps its own order, and the trash stays
 * shown or hidden by `hideTrash` alone. A typed query reaches the list only
 * after the debounce; a query given at mount applies at once.
 *
 * MOCKED: the module set of `MobileCharacters.hiddenCharacters.svelte.test.ts`
 * (same directory), with `changeChar` a bare spy and the clock faked for
 * `setTimeout`/`clearTimeout` only. Nothing here writes to storage.
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

const { changeCharSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
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

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

import { DBState, MobileSearch } from '../../ts/stores.svelte'
import { language } from '../../lang'
import MobileCharacters from './MobileCharacters.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
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

async function withMounted(props: { hideTrash?: boolean; search?: string }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileCharacters, { target, props }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

/** One entry per list row, in display order: the row's name and the index it hands to `changeChar` when clicked. */
function rows(root: HTMLElement): { name: string; index: number }[] {
    const result: { name: string; index: number }[] = []
    const names = Array.from(root.querySelectorAll('div.flex-1 > span:first-child'))
    for (const nameSpan of names) {
        const row = nameSpan.closest('button') as HTMLButtonElement
        changeCharSpy.mockClear()
        row.click()
        result.push({
            name: nameSpan.textContent?.trim() ?? '',
            index: changeCharSpy.mock.calls[0]?.[0] as number,
        })
    }
    return result
}

function rowNames(root: HTMLElement): string[] {
    return rows(root).map((r) => r.name)
}

/** Lets the debounce window pass and applies the resulting update. */
async function pastDebounce(): Promise<void> {
    vi.advanceTimersByTime(150)
    await settle()
}

beforeEach(() => {
    changeCharSpy.mockClear()
    MobileSearch.set('')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
    vi.useRealTimers()
})

//#endregion

describe('MobileCharacters search: what a query matches', { timeout: 60_000 }, () => {
    test('a word only the description has lists the character', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', { creatorNotes: 'keeper of a tall dragon' }),
            makeCharacter('b', 'Bob'),
        ])

        await withMounted({ search: 'dragon' }, (target) => {
            expect(rows(target)).toEqual([{ name: 'Ann', index: 0 }])
        })
    })

    test('every word of the query must match, in any order, each in any field', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'John Smith', { creatorNotes: 'a baker' }),
            makeCharacter('b', 'John Doe', { creatorNotes: 'a baker' }),
        ])

        await withMounted({ search: 'smith john' }, (target) => {
            expect(rowNames(target)).toEqual(['John Smith'])
        })
        await withMounted({ search: 'doe baker' }, (target) => {
            expect(rowNames(target)).toEqual(['John Doe'])
        })
    })

    // Intended change, not a guard: the old mobile search matched the
    // placeholder shown for a nameless character, so the query "unnamed" found
    // it. The search now looks at the stored name only.
    test('intended change: the placeholder shown for a nameless character is not searchable', async () => {
        DBState.db = buildDb([makeCharacter('a', ''), makeCharacter('b', 'Bob')])

        await withMounted({ search: language.settingsPage.unnamed }, (target) => {
            expect(rowNames(target)).toEqual([])
        })
    })

    // Guard: passes before and after.
    test('guard: a nameless character is listed under the placeholder when nothing is searched', async () => {
        DBState.db = buildDb([makeCharacter('a', ''), makeCharacter('b', 'Bob')])

        await withMounted({}, (target) => {
            expect(rowNames(target).sort()).toEqual([language.settingsPage.unnamed, 'Bob'].sort())
        })
    })

    test('the search box of the mobile header (the MobileSearch store) is the query when no search prop is given', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', { creatorNotes: 'keeper of a tall dragon' }),
            makeCharacter('b', 'Bob'),
        ])
        MobileSearch.set('dragon')

        await withMounted({}, (target) => {
            expect(rowNames(target)).toEqual(['Ann'])
        })
    })
})

describe('MobileCharacters search: debounce', { timeout: 60_000 }, () => {
    test('a query typed into the header reaches the list only after the debounce window', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({}, async (target) => {
            expect(rowNames(target)).toEqual(['Ann', 'Bob'].sort())
            MobileSearch.set('bo')
            await settle()
            expect(rowNames(target).sort()).toEqual(['Ann', 'Bob'])
            await pastDebounce()
            expect(rowNames(target)).toEqual(['Bob'])
        })
    })

    test('a burst of keystrokes lands once, as the last query', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])

        await withMounted({}, async (target) => {
            for (const key of ['a', 'an', 'ann']) {
                MobileSearch.set(key)
                await settle()
                vi.advanceTimersByTime(100)
                await settle()
                expect(rowNames(target).sort(), `after "${key}", inside the window`).toEqual(['Ann', 'Bob', 'Cat'])
            }
            await pastDebounce()
            expect(rowNames(target)).toEqual(['Ann'])
        })
    })

    test('clearing the box applies at once and a pending earlier query never lands afterwards', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({}, async (target) => {
            MobileSearch.set('bo')
            await settle()
            await pastDebounce()
            expect(rowNames(target)).toEqual(['Bob'])

            MobileSearch.set('ann')
            await settle()
            MobileSearch.set('')
            await settle()
            expect(rowNames(target).sort()).toEqual(['Ann', 'Bob'])
            vi.advanceTimersByTime(1000)
            await settle()
            expect(rowNames(target).sort()).toEqual(['Ann', 'Bob'])
        })
    })

    test('no timer is left pending after the list is destroyed mid-window', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({}, async () => {
            MobileSearch.set('bo')
            await settle()
            expect(vi.getTimerCount()).toBeGreaterThan(0)
        })
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('MobileCharacters search: trash and order', { timeout: 60_000 }, () => {
    // Guard: passes before and after; with the trash shown, a query narrows the
    // trashed rows too.
    test('guard: with the trash shown, the query narrows live and trashed rows alike', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', { trashTime: Date.now() - 1000 }),
            makeCharacter('b', 'Anna'),
            makeCharacter('c', 'Bob'),
        ])

        await withMounted({ hideTrash: false, search: 'ann' }, (target) => {
            expect(rowNames(target).sort()).toEqual(['Ann', 'Anna'])
        })
    })

    // Guard: passes before and after.
    test('guard: with the trash shown and no query, trashed rows are listed', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', { trashTime: Date.now() - 1000 }), makeCharacter('b', 'Bob')])

        await withMounted({ hideTrash: false }, (target) => {
            expect(rowNames(target).sort()).toEqual(['Ann', 'Bob'])
        })
    })

    test('with the trash hidden, a trashed character is not listed even when its description matches', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', { trashTime: Date.now() - 1000, creatorNotes: 'dragon' }),
            makeCharacter('b', 'Bob', { creatorNotes: 'dragon' }),
        ])

        await withMounted({ hideTrash: true, search: 'dragon' }, (target) => {
            expect(rowNames(target)).toEqual(['Bob'])
        })
    })

    // Guard: passes before and after.
    test('guard: matching rows keep the most-recent-first order and select their own db index', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann one', { lastInteraction: 10 }),
            makeCharacter('b', 'Bob', { lastInteraction: 30 }),
            makeCharacter('c', 'Ann two', { lastInteraction: 20 }),
        ])

        await withMounted({ search: 'ann' }, (target) => {
            expect(rows(target)).toEqual([
                { name: 'Ann two', index: 2 },
                { name: 'Ann one', index: 0 },
            ])
        })
    })
})

describe('MobileCharacters search: the list follows the database', { timeout: 60_000 }, () => {
    // Guard: passes before and after.
    test('guard: renaming a listed character updates its row and its searchability', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({ search: 'zed' }, async (target) => {
            expect(rowNames(target)).toEqual([])
            DBState.db.characters[1].name = 'Zed'
            await settle()
            expect(rows(target)).toEqual([{ name: 'Zed', index: 1 }])
            DBState.db.characters[1].name = 'Bob'
            await settle()
            expect(rowNames(target)).toEqual([])
        })
    })

    test('a character trashed and then restored moves out of and back into the list while a query is typed', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Anna')])

        await withMounted({ hideTrash: true }, async (target) => {
            MobileSearch.set('ann')
            await settle()
            await pastDebounce()
            expect(rowNames(target).sort()).toEqual(['Ann', 'Anna'])
            DBState.db.characters[0].trashTime = Date.now() - 1000
            await settle()
            expect(rowNames(target)).toEqual(['Anna'])
            DBState.db.characters[0].trashTime = undefined
            await settle()
            expect(rowNames(target).sort()).toEqual(['Ann', 'Anna'])
        })
    })

    test('deleting a character below a listed one re-indexes the remaining rows', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])

        await withMounted({ search: 'cat' }, async (target) => {
            expect(rows(target)).toEqual([{ name: 'Cat', index: 2 }])
            DBState.db.characters.splice(0, 1)
            await settle()
            expect(rows(target)).toEqual([{ name: 'Cat', index: 1 }])
        })
    })

    test('deleting the last listed character does not throw and drops its row', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({}, async (target) => {
            DBState.db.characters.pop()
            await settle()
            expect(rowNames(target)).toEqual(['Ann'])
        })
    })

    test('a character pushed while a query is active appears when it matches', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted({ search: 'dragon' }, async (target) => {
            expect(rowNames(target)).toEqual([])
            DBState.db.characters.push(makeCharacter('b', 'Bob', { creatorNotes: 'dragon' }))
            await settle()
            expect(rows(target)).toEqual([{ name: 'Bob', index: 1 }])
        })
    })
})
