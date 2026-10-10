// @vitest-environment happy-dom

/**
 * The search of `GridCatalog.svelte`: what a query matches (name, description,
 * tags and creator; every word, in any order; normalised), that the header
 * count follows the open tab, that a typed query lands once after the debounce
 * with header and rows always agreeing, and that the list follows later
 * database changes (trash, restore, delete, add) while a query is active. The
 * scan counts pin that a keystroke or a chat in progress does not re-walk
 * `db.characters`.
 *
 * MOCKED: the module set of `GridCatalog.hiddenCharacters.svelte.test.ts`
 * (same directory), with `changeChar` a bare spy, `isHiddenSystemCharacter`
 * wrapped over the real module to count calls (every pass over
 * `db.characters` makes one call per slot) and `restoreColdCharacter` a spy.
 * The clock is faked for `setTimeout`/`clearTimeout` only. Nothing here writes
 * to storage.
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

const { changeCharSpy, restoreColdSpy, hiddenCalls } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    restoreColdSpy: vi.fn(),
    hiddenCalls: { n: 0 },
}))

vi.mock(import('src/ts/hiddenCharacters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        isHiddenSystemCharacter: (char: { chaId?: string } | null | undefined) => {
            hiddenCalls.n++
            return actual.isHiddenSystemCharacter(char)
        },
    }
})

vi.mock(import('../../ts/process/coldCharacterRestore'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        restoreColdCharacter: restoreColdSpy,
    }
})

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

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type Layout = 0 | 1 | 2 | 3

const GRID: Layout = 0
const LIST: Layout = 1
const TRASH: Layout = 2
const SIMPLE: Layout = 3

const LAYOUTS = [
    ['grid', GRID],
    ['list', LIST],
    ['simple', SIMPLE],
] as const

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

/** An archived character as the list sees it: a stub whose `creatorNotes` is its description. */
function makeStub(chaId: string, name: string, description: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return makeCharacter(chaId, name, {
        creatorNotes: description,
        coldstorage: `unit-${chaId}`,
        coldStoragedChats: [],
        coldVersion: 2,
        coldChatCount: 1,
        ...extra,
    })
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

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickLayoutButton(root: HTMLElement, layout: Layout): void {
    const label =
        (layout === GRID ? language.grid : layout === LIST ? language.list : layout === TRASH ? language.trash : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

function setSearchValue(root: HTMLElement, value: string): void {
    const input = root.querySelector('input[type="text"]') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

/** Types `value` and lets the debounce window pass, so the query has landed. */
async function search(root: HTMLElement, value: string): Promise<void> {
    setSearchValue(root, value)
    vi.advanceTimersByTime(150)
    await settle()
}

/** The `db.characters` index each avatar button of the current layout hands to `changeChar`, in display order. */
function reachableIndices(root: HTMLElement): number[] {
    changeCharSpy.mockClear()
    for (const icon of Array.from(root.querySelectorAll<HTMLElement>('.ico'))) {
        icon.click()
    }
    return changeCharSpy.mock.calls.map((args) => args[0] as number)
}

/** The number the header shows next to the "characters" label. */
function headerCount(root: HTMLElement): number {
    const span = Array.from(root.querySelectorAll('span')).find((s) => s.textContent?.includes(language.character))
    if (!span) {
        throw new Error('header count not found')
    }
    return Number.parseInt(span.textContent!.trim(), 10)
}

function trashRowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
}

/** Mounts, switches to `layout`, types `query` and returns the db indices the layout offers. */
async function offered(characters: CharacterFixture[], layout: Layout, query: string): Promise<number[]> {
    DBState.db = buildDb(characters)
    let result: number[] = []
    await withMounted(async (target) => {
        if (layout !== SIMPLE) {
            clickLayoutButton(target, layout)
        }
        await search(target, query)
        result = reachableIndices(target).sort((x, y) => x - y)
    })
    return result
}

beforeEach(() => {
    changeCharSpy.mockClear()
    restoreColdSpy.mockClear()
    hiddenCalls.n = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
    vi.useRealTimers()
})

//#endregion

describe.each(LAYOUTS)('GridCatalog search in the %s layout: what a query matches', (_label, layout) => {
    test('a word only the description has lists a loaded character', async () => {
        const found = await offered(
            [makeCharacter('a', 'Ann', { creatorNotes: 'keeper of a tall dragon' }), makeCharacter('b', 'Bob')],
            layout,
            'dragon',
        )
        expect(found).toEqual([0])
    })

    test('a word only the description of an archived character has lists it, without opening the archive', async () => {
        const found = await offered(
            [makeStub('a', 'Ann', 'keeper of a tall dragon'), makeCharacter('b', 'Bob')],
            layout,
            'dragon',
        )
        expect(found).toEqual([0])
        expect(restoreColdSpy).not.toHaveBeenCalled()
        expect(changeCharSpy.mock.calls.map((args) => args[0])).toEqual([0])
    })

    test('only the english section of a multilingual description is searched', async () => {
        const notes = '# `en`\nenglishword here\n# `ko`\nkoreanword here'
        expect(await offered([makeCharacter('a', 'Ann', { creatorNotes: notes })], layout, 'englishword')).toEqual([0])
        expect(await offered([makeCharacter('a', 'Ann', { creatorNotes: notes })], layout, 'koreanword')).toEqual([])
    })

    test('tags and creator of a loaded character are searched', async () => {
        const characters = [
            makeCharacter('a', 'Ann', { tags: ['fantasy', 'elf'], creator: 'Somebody Else' }),
            makeCharacter('b', 'Bob'),
        ]
        expect(await offered(characters, layout, 'fantasy')).toEqual([0])
        expect(await offered(characters, layout, 'somebody')).toEqual([0])
    })

    // Guards: green on a name-only base as well, because nothing is found there.
    test('guard: tags and creator of an archived character and of a group are not searched', async () => {
        const characters = [
            makeStub('a', 'Ann', 'plain', { tags: ['fantasy'], creator: 'Somebody' }),
            makeCharacter('g', 'Group', { type: 'group', tags: ['fantasy'], creator: 'Somebody' }),
        ]
        expect(await offered(characters, layout, 'fantasy')).toEqual([])
        expect(await offered(characters, layout, 'somebody')).toEqual([])
    })

    test('every word must match, in any order, each in any field', async () => {
        const characters = [
            makeCharacter('a', 'John Smith', { creatorNotes: 'a baker' }),
            makeCharacter('b', 'John Doe', { creatorNotes: 'a baker' }),
        ]
        expect(await offered(characters, layout, 'smith john')).toEqual([0])
        expect(await offered(characters, layout, 'doe baker')).toEqual([1])
        expect(await offered(characters, layout, 'john baker')).toEqual([0, 1])
    })

    test('a decomposed Hangul query finds the composed name and a full-width query finds the plain one', async () => {
        const characters = [makeCharacter('a', '한글 캐릭터'.normalize('NFC')), makeCharacter('b', 'abc def')]
        expect(await offered(characters, layout, '한글'.normalize('NFD'))).toEqual([0])
        expect(await offered(characters, layout, 'ＡＢＣ')).toEqual([1])
    })

    test('a zero-width character inside a description does not hide the word', async () => {
        const found = await offered([makeCharacter('a', 'Ann', { creatorNotes: 'dra\u200Bgon' })], layout, 'dragon')
        expect(found).toEqual([0])
    })

    // Documents the cap: the description is the first 500 characters of the
    // shown text, the same text the list renders.
    test('a word past the 500th character of the notes is not searchable', async () => {
        const notes = `${'x '.repeat(260)}lateword`
        expect(await offered([makeCharacter('a', 'Ann', { creatorNotes: notes })], layout, 'lateword')).toEqual([])
    })

    // Guards: pass before and after.
    test('guard: the name match ignores case and spaces in either direction', async () => {
        const characters = [makeCharacter('a', 'Ab'), makeCharacter('b', 'C d')]
        expect(await offered(characters, layout, 'a b')).toEqual([0])
        expect(await offered(characters, layout, 'cd')).toEqual([1])
        expect(await offered(characters, layout, 'AB')).toEqual([0])
    })

    test('guard: a query of only spaces lists everything', async () => {
        const characters = [makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')]
        expect(await offered(characters, layout, '   ')).toEqual([0, 1])
    })

    test('guard: the system characters are never offered', async () => {
        const characters = [makeCharacter('§playground', 'assistant'), makeCharacter('a', 'assistant')]
        expect(await offered(characters, layout, 'assistant')).toEqual([1])
    })

    test('a damaged slot with a name that is not text does not break the list', async () => {
        const characters = [makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob', { name: undefined })]
        const found = await offered(characters, layout, 'ann')
        expect(found).toEqual([0])
    })
})

describe('GridCatalog search: the header count follows the open tab', { timeout: 60_000 }, () => {
    function fixture(): CharacterFixture[] {
        const gone = Date.now() - 1000
        return [
            makeCharacter('a', 'Ann'),
            makeCharacter('b', 'Anna'),
            makeCharacter('c', 'Bob'),
            makeCharacter('d', 'Ann Trashed', { trashTime: gone }),
            makeCharacter('e', 'Cat Trashed', { trashTime: gone }),
        ]
    }

    test.each([
        ['simple', SIMPLE],
        ['grid', GRID],
        ['list', LIST],
    ] as const)('on the %s tab it counts the matching live characters', async (_label, layout) => {
        DBState.db = buildDb(fixture())
        await withMounted(async (target) => {
            clickLayoutButton(target, layout)
            expect(headerCount(target)).toBe(3)
            await search(target, 'ann')
            expect(headerCount(target)).toBe(2)
        })
    })

    test('on the trash tab it counts the matching trashed characters', async () => {
        DBState.db = buildDb(fixture())
        await withMounted(async (target) => {
            clickLayoutButton(target, TRASH)
            expect(headerCount(target)).toBe(2)
            await search(target, 'ann')
            expect(headerCount(target)).toBe(1)
            expect(trashRowNames(target)).toEqual(['Ann Trashed'])
            await search(target, 'zzz')
            expect(headerCount(target)).toBe(0)
        })
    })
})

describe('GridCatalog search: debounce', { timeout: 60_000 }, () => {
    test('a burst lands once after the window; header and rows agree at every step', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            for (const key of ['a', 'an', 'ann']) {
                setSearchValue(target, key)
                await settle()
                vi.advanceTimersByTime(100)
                await settle()
                expect(reachableIndices(target), `rows after "${key}", inside the window`).toEqual([0, 1, 2])
                expect(headerCount(target), `header after "${key}", inside the window`).toBe(3)
            }
            vi.advanceTimersByTime(150)
            await settle()
            expect(reachableIndices(target)).toEqual([0])
            expect(headerCount(target)).toBe(1)
        })
    })

    test('clearing the box applies at once and a pending earlier query never lands afterwards', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'bob')
            expect(reachableIndices(target)).toEqual([1])

            setSearchValue(target, 'ann')
            await settle()
            setSearchValue(target, '')
            await settle()
            expect(reachableIndices(target)).toEqual([0, 1])
            vi.advanceTimersByTime(1000)
            await settle()
            expect(reachableIndices(target)).toEqual([0, 1])
        })
    })

    test('the embedded simple list follows a later query change, not only the one at mount', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(async (target) => {
            expect(reachableIndices(target)).toEqual([0, 1])
            await search(target, 'bob')
            expect(reachableIndices(target)).toEqual([1])
            await search(target, '')
            expect(reachableIndices(target)).toEqual([0, 1])
        })
    })

    test('no timer is left pending after the catalog is destroyed mid-window', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted(async (target) => {
            setSearchValue(target, 'an')
            await settle()
            expect(vi.getTimerCount()).toBeGreaterThan(0)
        })
        expect(vi.getTimerCount()).toBe(0)
    })

    test('the Empty trash label follows the landed query, not the text in the box', async () => {
        const gone = Date.now() - 1000
        DBState.db = buildDb([makeCharacter('a', 'Ann', { trashTime: gone }), makeCharacter('b', 'Bob', { trashTime: gone })])

        await withMounted(async (target) => {
            clickLayoutButton(target, TRASH)
            setSearchValue(target, 'ann')
            await settle()
            expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.emptyTrash)).toBe(true)
            vi.advanceTimersByTime(150)
            await settle()
            expect(
                Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.emptyTrashMatching(1)),
            ).toBe(true)
        })
    })
})

describe('GridCatalog search: scans of db.characters', { timeout: 60_000 }, () => {
    const N = 300

    function many(): CharacterFixture[] {
        return Array.from({ length: N }, (_, i) => makeCharacter(`c${i}`, `Character ${i}`))
    }

    test('a landed keystroke makes no pass over db.characters', async () => {
        DBState.db = buildDb(many())

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            hiddenCalls.n = 0
            await search(target, 'character 1')
            expect(hiddenCalls.n).toBe(0)
        })
    })

    test('a rename rebuilds the search index once and nothing walks the list again', async () => {
        DBState.db = buildDb(many())

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'character')
            hiddenCalls.n = 0
            DBState.db.characters[5].name = 'Renamed'
            await settle()
            expect(hiddenCalls.n).toBeGreaterThan(0)
            expect(hiddenCalls.n).toBeLessThanOrEqual(N)
        })
    })

    // Guards: pass before and after; neither write is read by the list.
    test('guard: a message pushed into a chat and a lastInteraction write walk nothing', async () => {
        DBState.db = buildDb(many())

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'character')
            hiddenCalls.n = 0
            ;(DBState.db.characters[3].chats[0].message as unknown[]).push({ time: 1, data: 'hi', role: 'user' })
            DBState.db.characters[3].lastInteraction = Date.now()
            await settle()
            expect(hiddenCalls.n).toBe(0)
        })
    })
})

describe('GridCatalog search: the list follows the database while a query is active', { timeout: 60_000 }, () => {
    test('trashing and restoring a match moves it between the grid and the trash tab in the same flush', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Anna'), makeCharacter('c', 'Bob')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'ann')
            expect(reachableIndices(target)).toEqual([0, 1])

            DBState.db.characters[0].trashTime = Date.now() - 1000
            await settle()
            expect(reachableIndices(target)).toEqual([1])
            expect(headerCount(target)).toBe(1)

            clickLayoutButton(target, TRASH)
            expect(trashRowNames(target)).toEqual(['Ann'])
            expect(headerCount(target)).toBe(1)

            DBState.db.characters[0].trashTime = undefined
            await settle()
            expect(trashRowNames(target)).toEqual([])
            clickLayoutButton(target, GRID)
            expect(reachableIndices(target)).toEqual([0, 1])
        })
    })

    test('deleting a lower character re-indexes the rows: a click selects the new index', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'cat')
            expect(reachableIndices(target)).toEqual([2])
            DBState.db.characters.splice(0, 1)
            await settle()
            expect(reachableIndices(target)).toEqual([1])
        })
    })

    test('deleting the last listed character does not throw and drops its tile', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(async (target) => {
            clickLayoutButton(target, LIST)
            expect(reachableIndices(target)).toEqual([0, 1])
            DBState.db.characters.pop()
            await settle()
            expect(reachableIndices(target)).toEqual([0])
            expect(headerCount(target)).toBe(1)
        })
    })

    test('a character added while a query is active appears when it matches', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'dragon')
            expect(reachableIndices(target)).toEqual([])
            DBState.db.characters.push(makeCharacter('b', 'Bob', { creatorNotes: 'dragon' }))
            await settle()
            expect(reachableIndices(target)).toEqual([1])
            expect(headerCount(target)).toBe(1)
        })
    })

    test('renaming a character makes it searchable under the new name and not the old one', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'zed')
            expect(reachableIndices(target)).toEqual([])
            DBState.db.characters[1].name = 'Zed'
            await settle()
            expect(reachableIndices(target)).toEqual([1])
            DBState.db.characters[1].name = 'Bob'
            await settle()
            expect(reachableIndices(target)).toEqual([])
        })
    })

    test('archiving a loaded character keeps it findable by the same description', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', { creatorNotes: 'keeper of a tall dragon' })])

        await withMounted(async (target) => {
            clickLayoutButton(target, GRID)
            await search(target, 'dragon')
            expect(reachableIndices(target)).toEqual([0])
            const slot = DBState.db.characters[0]
            slot.coldstorage = 'unit-a'
            await settle()
            expect(reachableIndices(target)).toEqual([0])
        })
    })
})
