// @vitest-environment happy-dom

/**
 * What the character lists show for an archived character (the "stub": the
 * placeholder whose full data lives in a cold-storage unit).
 *
 * A stub built by this fork (`buildColdStub` in `src/ts/process/
 * coldCharacter.ts`) carries the fields the lists read, so:
 * - `GridCatalog.svelte` (list and trash layouts) shows its description, and
 *   its grid layout shows the group icon for an archived group;
 * - `MobileCharacters.svelte` shows the chat count of the full character (not
 *   the dummy chat's 1), sorts it by the character's `lastInteraction`, and
 *   hides or lists it by its `trashTime`;
 * - the select-character dialog in `AlertComp.svelte` leaves an archived
 *   group out.
 * A full character and an upstream-made stub (no marker, `type` always
 * `'character'`, no description or `lastInteraction`) show exactly what they
 * show without any of this; those cases are labelled guards.
 *
 * MOCKED: `localforage`, `src/ts/globalApi.svelte` (a lightweight stand-in),
 * `src/ts/storage/database.svelte`'s `getDatabase` (reads live `DBState.db`),
 * `src/ts/platform`, `@tauri-apps/plugin-fs`, a reactive `stores.svelte`
 * stand-in, `src/ts/characters`'s `changeChar` alone (a bare spy; everything
 * else stays real, `getCharImage` included), `src/ts/media/avatarThumb`'s
 * `getAvatarThumbSrc` alone (resolves null: no thumbnail), and a fake
 * `IntersectionObserver` that reports every target visible. The mount and
 * mock pattern follows `charlistAvatarLookups.svelte.test.ts` (same
 * directory), which documents the reasons in full.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database, character, groupChat } from '../../ts/storage/database.svelte'
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

import { DBState, alertStore } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { buildColdStub } from '../../ts/process/coldCharacter'
import GridCatalog from './GridCatalog.svelte'
import MobileCharacters from '../Mobile/MobileCharacters.svelte'
import AlertComp from './AlertComp.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const HOUR = 3_600_000
const DAY = 24 * HOUR

function makeChats(count: number): character['chats'] {
    const chats: character['chats'] = []
    for (let i = 0; i < count; i++) {
        chats.push({ id: `chat-${i}`, message: [], note: '', name: `Chat ${i}`, localLore: [] } as unknown as character['chats'][number])
    }
    return chats
}

function fullCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        chaId,
        name,
        image: '',
        creatorNotes: '',
        chatPage: 0,
        firstMsgIndex: 0,
        lastInteraction: 0,
        chats: makeChats(1),
        ...extra,
    } as unknown as character
}

function fullGroup(chaId: string, name: string, extra: Record<string, unknown> = {}): groupChat {
    return {
        type: 'group',
        chaId,
        name,
        image: '',
        chatPage: 0,
        firstMsgIndex: -1,
        lastInteraction: 0,
        characters: [],
        chats: makeChats(1),
        ...extra,
    } as unknown as groupChat
}

/** An archived character built by this fork's stub builder. */
function forkStub(source: character | groupChat, key = `unit-${source.chaId}`): CharacterFixture {
    return buildColdStub(source, key, []) as unknown as CharacterFixture
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

function full(character: character | groupChat): CharacterFixture {
    return character as unknown as CharacterFixture
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted<T>(component: typeof GridCatalog | typeof MobileCharacters | typeof AlertComp, props: Record<string, unknown>, body: (target: HTMLElement) => T | Promise<T>): Promise<T> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props }) as Record<string, unknown>
    try {
        await settle()
        return await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 2 | 3): void {
    const label =
        (layout === 0 ? language.grid : layout === 1 ? language.list : layout === 2 ? language.trash : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

/** Row names of the simple/mobile list, in display order. */
function mobileRowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')
}

function mobileRow(root: HTMLElement, name: string): HTMLElement {
    const span = Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).find((s) => s.textContent?.trim() === name)
    const row = span?.closest('button') as HTMLElement | null
    if (!row) {
        throw new Error(`mobile row not found for "${name}"`)
    }
    return row
}

function mobileChatCount(root: HTMLElement, name: string): string {
    return mobileRow(root, name).querySelector('span.mr-1')?.textContent?.trim() ?? ''
}

/** The description line of the list/trash layout row for `name`. */
function listDescription(root: HTMLElement, name: string): string {
    const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    const row = heading?.closest('.flex-1') as HTMLElement | null
    const text = row?.querySelector('[data-description]')?.textContent
    if (text === undefined || text === null) {
        throw new Error(`list row not found for "${name}"`)
    }
    return text.trim()
}

function listHeadings(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
}

//#endregion

describe('MobileCharacters -- archived characters', { timeout: 60_000 }, () => {
    test('shows the chat count of the full character for a stub built here', async () => {
        DBState.db = buildDb([forkStub(fullCharacter('a', 'Stubby', { chats: makeChats(7) }))])

        await withMounted(MobileCharacters, {}, (target) => {
            expect(mobileChatCount(target, 'Stubby')).toBe('7')
        })
    })

    test('guard: shows chats.length for a full character', async () => {
        DBState.db = buildDb([full(fullCharacter('a', 'Warm', { chats: makeChats(3) }))])

        await withMounted(MobileCharacters, {}, (target) => {
            expect(mobileChatCount(target, 'Warm')).toBe('3')
        })
    })

    test('guard: shows 1 for an upstream-made stub', async () => {
        DBState.db = buildDb([upstreamStub('a', 'Old Stub')])

        await withMounted(MobileCharacters, {}, (target) => {
            expect(mobileChatCount(target, 'Old Stub')).toBe('1')
        })
    })

    test('sorts a stub built here by the character\'s lastInteraction, most recent first', async () => {
        const now = Date.now()
        DBState.db = buildDb([
            full(fullCharacter('warm', 'Warm Older', { lastInteraction: now - 5 * DAY })),
            forkStub(fullCharacter('cold', 'Cold Newer', { lastInteraction: now - 2 * HOUR })),
        ])

        await withMounted(MobileCharacters, {}, (target) => {
            expect(mobileRowNames(target)).toEqual(['Cold Newer', 'Warm Older'])
            expect(mobileRow(target, 'Cold Newer').textContent).not.toContain('Unknown')
        })
    })

    test('guard: an upstream-made stub has no lastInteraction, shows Unknown and sorts after a character with one', async () => {
        const now = Date.now()
        DBState.db = buildDb([
            upstreamStub('old', 'Old Stub'),
            full(fullCharacter('warm', 'Warm', { lastInteraction: now - 5 * DAY })),
        ])

        await withMounted(MobileCharacters, {}, (target) => {
            expect(mobileRowNames(target)).toEqual(['Warm', 'Old Stub'])
            expect(mobileRow(target, 'Old Stub').textContent).toContain('Unknown')
        })
    })

    test('hides a stub built from a trashed character when trash is hidden, and lists it otherwise', async () => {
        DBState.db = buildDb([
            forkStub(fullCharacter('gone', 'Trashed Stub', { trashTime: Date.now() - HOUR })),
            full(fullCharacter('kept', 'Kept')),
        ])

        await withMounted(MobileCharacters, { hideTrash: true }, (target) => {
            expect(mobileRowNames(target)).toEqual(['Kept'])
        })
        await withMounted(MobileCharacters, { hideTrash: false }, (target) => {
            expect(mobileRowNames(target).sort()).toEqual(['Kept', 'Trashed Stub'])
        })
    })

    test('guard: an upstream-made stub with a trashTime is hidden when trash is hidden', async () => {
        DBState.db = buildDb([
            upstreamStub('gone', 'Trashed Old Stub', { trashTime: Date.now() - HOUR }),
            full(fullCharacter('kept', 'Kept')),
        ])

        await withMounted(MobileCharacters, { hideTrash: true }, (target) => {
            expect(mobileRowNames(target)).toEqual(['Kept'])
        })
    })
})

describe('GridCatalog -- archived characters', { timeout: 60_000 }, () => {
    test('the list layout shows the description of a stub built here', async () => {
        DBState.db = buildDb([forkStub(fullCharacter('a', 'Stubby', { creatorNotes: 'A stub description' }))])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listDescription(target, 'Stubby')).toBe('A stub description')
        })
    })

    test('the list layout shows the en section of a multilingual description, as it does for the full character', async () => {
        const notes = '# `ko`\n한국어 설명\n# `en`\nEnglish description'
        DBState.db = buildDb([
            forkStub(fullCharacter('a', 'Stubby', { creatorNotes: notes })),
            full(fullCharacter('b', 'Warm', { creatorNotes: notes })),
        ])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listDescription(target, 'Warm')).toBe('English description')
            expect(listDescription(target, 'Stubby')).toBe('English description')
        })
    })

    test('the list layout still shows the en section when a long text precedes it in the description', async () => {
        const notes = `${'k'.repeat(5_000)}\n# \`en\`\nEnglish description`
        DBState.db = buildDb([forkStub(fullCharacter('a', 'Stubby', { creatorNotes: notes }))])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listDescription(target, 'Stubby')).toBe('English description')
        })
    })

    test('the list layout shows a bounded prefix of a very long description', async () => {
        const long = 'abcdefghij'.repeat(2_000)
        DBState.db = buildDb([forkStub(fullCharacter('a', 'Stubby', { creatorNotes: long }))])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            const shown = listDescription(target, 'Stubby')
            expect(shown).not.toBe('No description')
            expect(shown.length).toBeLessThan(1_000)
            expect(long.startsWith(shown)).toBe(true)
        })
    })

    test('guard: the list layout shows No description for an upstream-made stub', async () => {
        DBState.db = buildDb([upstreamStub('a', 'Old Stub')])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listDescription(target, 'Old Stub')).toBe('No description')
        })
    })

    test('the grid layout shows the group icon for a group stub built here and the person icon for a character stub', async () => {
        DBState.db = buildDb([
            forkStub(fullGroup('g', 'Group Stub')),
            forkStub(fullCharacter('c', 'Character Stub')),
        ])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 0)
            expect(target.querySelectorAll('svg.lucide-users')).toHaveLength(1)
            expect(target.querySelectorAll('svg.lucide-user')).toHaveLength(1)
        })
    })

    test('guard: the grid layout shows the group icon for a full group and the person icon for an upstream-made stub', async () => {
        DBState.db = buildDb([
            full(fullGroup('g', 'Warm Group')),
            upstreamStub('c', 'Old Stub'),
        ])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 0)
            expect(target.querySelectorAll('svg.lucide-users')).toHaveLength(1)
            expect(target.querySelectorAll('svg.lucide-user')).toHaveLength(1)
        })
    })

    test('a stub built from a trashed character is listed in the trash layout and left out of the list layout', async () => {
        DBState.db = buildDb([
            forkStub(fullCharacter('gone', 'Trashed Stub', { trashTime: Date.now() - HOUR })),
            full(fullCharacter('kept', 'Kept')),
        ])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listHeadings(target)).toEqual(['Kept'])
            clickLayoutButton(target, 2)
            expect(listHeadings(target)).toEqual(['Trashed Stub'])
        })
    })

    test('guard: an upstream-made stub with a trashTime is listed in the trash layout only', async () => {
        DBState.db = buildDb([
            upstreamStub('gone', 'Trashed Old Stub', { trashTime: Date.now() - HOUR }),
            full(fullCharacter('kept', 'Kept')),
        ])

        await withMounted(GridCatalog, {}, (target) => {
            clickLayoutButton(target, 1)
            expect(listHeadings(target)).toEqual(['Kept'])
            clickLayoutButton(target, 2)
            expect(listHeadings(target)).toEqual(['Trashed Old Stub'])
        })
    })
})

describe('AlertComp select-character dialog -- archived characters', { timeout: 60_000 }, () => {
    test('leaves an archived group out and lists an archived character', async () => {
        DBState.db = buildDb([
            forkStub(fullGroup('g', 'Group Stub')),
            forkStub(fullCharacter('c', 'Character Stub')),
            full(fullCharacter('w', 'Warm')),
        ])
        alertStore.set({ type: 'selectChar', msg: '' } as never)

        try {
            await withMounted(AlertComp, {}, (target) => {
                expect(target.querySelectorAll('.ico')).toHaveLength(2)
            })
        } finally {
            alertStore.set({ type: 'none', msg: '' } as never)
        }
    })

    test('guard: an upstream-made stub is listed in the dialog like a full character', async () => {
        DBState.db = buildDb([
            upstreamStub('old', 'Old Stub'),
            full(fullCharacter('w', 'Warm')),
        ])
        alertStore.set({ type: 'selectChar', msg: '' } as never)

        try {
            await withMounted(AlertComp, {}, (target) => {
                expect(target.querySelectorAll('.ico')).toHaveLength(2)
            })
        } finally {
            alertStore.set({ type: 'none', msg: '' } as never)
        }
    })
})
