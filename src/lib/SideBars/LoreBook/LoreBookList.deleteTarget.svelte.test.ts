// @vitest-environment happy-dom

/**
 * A lorebook entry's delete button removes the entry the user aimed at, and only
 * that entry, however the list changes while its confirmation is open.
 *
 * Mounts the REAL `LoreBookList.svelte` and `LoreBookData.svelte` over a real
 * `$state` database. The alert confirm is a mock the test holds open and answers.
 * Titles beginning "guard:" pin behaviour that must be preserved before and after
 * the change; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database, loreBook } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'
import { language } from 'src/lang'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        changeChatTo: vi.fn(), downloadFile: vi.fn(), openURL: vi.fn(), loadAsset: vi.fn(), saveAsset: vi.fn(),
        readImage: vi.fn(), globalFetch: vi.fn(), fetchNative: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '', usingSw: false, getFetchLogs: vi.fn(() => []), getFetchData: vi.fn(() => ({})),
        isPlainHttpFileSrc: vi.fn(() => false),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('src/ts/stores.svelte')
    return { ...actual, getDatabase: vi.fn((_o?: { snapshot?: boolean }) => DBState.db) }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(),
    remove: vi.fn(), readDir: vi.fn(async () => []), BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))

// The detail editor's text area pulls in the highlighter and the hotkey table, which an
// entry's delete button never touches.
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({
    default: () => {},
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]), CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }), MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 }, SettingsMenuIndex: writable(0), ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false), botMakerMode: writable(false), DynamicGUI: writable(false),
        sideBarClosing: writable(false), sideBarStore: writable({ tab: 0 }), PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]), additionalHamburgerMenu: writable([]), CharConfigSubMenu: writable(0),
        MobileGUI: writable(false), hypaV3ModalOpen: writable(false), ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false), alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import LoreBookList from './LoreBookList.svelte'

//#region fixtures and helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Lets the click handler's awaits and the resulting re-render finish. */
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function entry(comment: string, extra: Partial<loreBook> = {}): loreBook {
    return {
        key: 'k' + comment, comment, content: '', mode: 'normal', insertorder: 100,
        alwaysActive: false, secondkey: '', selective: false, ...extra,
    } as loreBook
}

function folder(name: string, uuid: string): loreBook {
    return entry(name, { mode: 'folder', key: 'folder:' + uuid })
}

function child(id: string): loreBook {
    return entry('', { mode: 'child', key: '', alwaysActive: true, id })
}

function character(chaId: string, globalLore: loreBook[], localLore: loreBook[] = []) {
    return {
        chaId, name: chaId, type: 'character', image: '', creatorNotes: '', chatPage: 0, lastInteraction: 0,
        globalLore,
        chats: [{ id: chaId + '-chat-0', message: [], note: '', name: '', localLore }],
    }
}

function installDb(characters: ReturnType<typeof character>[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => c.chaId), hideAllImages: false,
        loreBook: [{ data: [] }], loreBookPage: 0, characters, ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

const globalNames = (c = 0) => DBState.db.characters[c].globalLore.map((l) => l.comment)
const localNames = (c = 0) => DBState.db.characters[c].chats[0].localLore.map((l) => l.comment || `<child:${l.id}>`)

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountList(props: { submenu?: number, externalLoreBooks?: loreBook[] }): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoreBookList, { target, props: { ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

/** The delete (X) button of the row whose title is `title`. Child-link rows have one fewer button. */
function deleteButton(target: HTMLElement, title: string): HTMLButtonElement {
    const span = Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    const row = span.closest('[data-risu-idx]') as HTMLElement
    const buttons = Array.from(row.querySelectorAll('button')) as HTMLButtonElement[]
    return buttons[buttons.length - 1]
}

async function clickDelete(target: HTMLElement, title: string): Promise<void> {
    deleteButton(target, title).click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    confirms.pending.length = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const base = () => [entry('e0'), entry('e1'), entry('e2'), entry('e3')]

//#endregion

describe('a character lorebook entry (submenu 0)', () => {
    test('guard: with nothing else changing, the confirmed entry is removed and no other', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e1')
        await answer(true)
        expect(globalNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('guard: refusing the confirmation removes nothing', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e1')
        await answer(false)
        expect(globalNames()).toEqual(['e0', 'e1', 'e2', 'e3'])
    })

    test('an entry inserted above it while the confirmation is open does not change which entry is removed', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e2')
        DBState.db.characters[0].globalLore.unshift(entry('new'))
        flushSync()
        await answer(true)
        expect(globalNames()).toEqual(['new', 'e0', 'e1', 'e3'])
    })

    test('an entry removed above it while the confirmation is open does not change which entry is removed', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e2')
        DBState.db.characters[0].globalLore.splice(0, 1)
        flushSync()
        await answer(true)
        expect(globalNames()).toEqual(['e1', 'e3'])
    })

    test('two pending deletes of the same entry remove it once', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e1')
        await clickDelete(target, 'e1')
        expect(confirms.pending.length).toBe(2)
        await answer(true)
        await answer(true)
        expect(globalNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('an entry removed by something else while its confirmation is open leaves every other entry in place', async () => {
        installDb([character('c0', base())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e1')
        DBState.db.characters[0].globalLore.splice(1, 1)
        flushSync()
        await answer(true)
        expect(globalNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('a selection that moves to another character during the confirmation leaves that character\'s list untouched', async () => {
        installDb([
            character('c0', base()),
            character('c1', [entry('f0'), entry('f1'), entry('f2'), entry('f3')]),
        ])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'e1')
        selectedCharID.set(1)
        flushSync()
        await answer(true)
        expect(globalNames(1)).toEqual(['f0', 'f1', 'f2', 'f3'])
        expect(globalNames(0)).toEqual(['e0', 'e1', 'e2', 'e3'])
    })

    test('guard: with entries that share an id, the confirmed entry is the one removed', async () => {
        installDb([character('c0', [entry('a'), entry('b', { id: 'X' }), entry('c', { id: 'X' }), entry('d')])])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'c')
        await answer(true)
        expect(globalNames()).toEqual(['a', 'b', 'd'])
    })
})

describe('a chat-local lorebook entry (submenu 1)', () => {
    test('one confirmed delete of a local entry that carries an id removes that entry and no neighbour', async () => {
        installDb([character('c0', [], [entry('e0'), entry('e1', { id: 'X' }), entry('e2'), entry('e3')])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'e1')
        await answer(true)
        expect(localNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('guard: with nothing else changing, a local entry without an id is removed alone', async () => {
        installDb([character('c0', [], [entry('e0'), entry('e1'), entry('e2'), entry('e3')])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'e1')
        await answer(true)
        expect(localNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('an entry inserted above it while the confirmation is open does not change which local entry is removed', async () => {
        installDb([character('c0', [], [entry('e0'), entry('e1'), entry('e2'), entry('e3')])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'e2')
        DBState.db.characters[0].chats[0].localLore.unshift(entry('new'))
        flushSync()
        await answer(true)
        expect(localNames()).toEqual(['new', 'e0', 'e1', 'e3'])
    })

    test('two pending deletes of the same local entry remove it once', async () => {
        installDb([character('c0', [], [entry('e0'), entry('e1'), entry('e2'), entry('e3')])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'e1')
        await clickDelete(target, 'e1')
        await answer(true)
        await answer(true)
        expect(localNames()).toEqual(['e0', 'e2', 'e3'])
    })

    test('a selection that moves to another character during the confirmation leaves that character\'s chat lorebook untouched', async () => {
        installDb([
            character('c0', [], [entry('e0'), entry('e1'), entry('e2')]),
            character('c1', [], [entry('f0'), entry('f1'), entry('f2')]),
        ])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'e1')
        selectedCharID.set(1)
        flushSync()
        await answer(true)
        expect(localNames(1)).toEqual(['f0', 'f1', 'f2'])
        expect(localNames(0)).toEqual(['e0', 'e1', 'e2'])
    })

    test('an inserted entry above a child link does not change which child link is removed', async () => {
        installDb([character('c0', [entry('g0', { id: 'G' })], [entry('e0'), child('G'), entry('e2')])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'g0')
        DBState.db.characters[0].chats[0].localLore.unshift(entry('new'))
        flushSync()
        await answer(true)
        expect(localNames()).toEqual(['new', 'e0', 'e2'])
    })
})

describe('deleting a character lorebook entry that has local links', () => {
    test('removes the chat\'s child links to it and keeps a local entry that only shares its id', async () => {
        installDb([character('c0', [entry('g0', { id: 'X' }), entry('g1')], [entry('l0', { id: 'X' }), child('X'), entry('l2')])])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'g0')
        await answer(true)
        expect(globalNames()).toEqual(['g1'])
        expect(localNames()).toEqual(['l0', 'l2'])
    })

    test('guard: removes the child links to the deleted entry and leaves the links to other entries', async () => {
        installDb([character('c0', [entry('g0', { id: 'X' }), entry('g1', { id: 'Y' })], [child('X'), child('Y')])])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'g0')
        await answer(true)
        expect(localNames()).toEqual(['<child:Y>'])
    })

    test('an entry removed by something else during the confirmation leaves every entry and every chat link in place', async () => {
        installDb([character('c0', [entry('g0', { id: 'X' }), entry('g1', { id: 'Y' })], [child('X'), child('Y')])])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'g0')
        DBState.db.characters[0].globalLore.splice(0, 1)
        flushSync()
        await answer(true)
        expect(globalNames()).toEqual(['g1'])
        expect(localNames()).toEqual(['<child:X>', '<child:Y>'])
    })

    test('deleting a chat-local entry that shares an id with a character entry keeps the links to the character entry', async () => {
        installDb([character('c0', [entry('g0', { id: 'X' })], [child('X'), entry('l1', { id: 'X' })])])
        const target = mountList({ submenu: 1 })
        await clickDelete(target, 'l1')
        await answer(true)
        expect(localNames()).toEqual(['<child:X>'])
    })

    test('unticking "always active in this chat" removes only the child link, not a local entry that shares the id', async () => {
        installDb(
            [character('c0', [entry('g0', { id: 'X' })], [child('X'), entry('l1', { id: 'X' })])],
            { localActivationInGlobalLorebook: true },
        )
        const target = mountList({ submenu: 0 })
        // open the entry's detail to reach its "always active in this chat" checkbox
        const nameButton = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'g0') as HTMLButtonElement
        nameButton.click()
        await settle()
        const boxes = Array.from(target.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[]
        const localBox = boxes.find((b) => b.checked)
        expect(localBox, 'the "always active in this chat" checkbox is ticked and present').toBeDefined()
        localBox!.checked = false
        localBox!.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(localNames()).toEqual(['l1'])
    })
})

describe('a character lorebook folder', () => {
    function folderFixture(): loreBook[] {
        return [
            entry('top0'),
            folder('F1', 'aaa'), entry('a0', { folder: 'folder:aaa' }), entry('a1', { folder: 'folder:aaa' }),
            entry('top1'),
            folder('F2', 'bbb'), entry('b0', { folder: 'folder:bbb' }),
        ]
    }

    test('guard: deleting a folder removes it and its own entries, and keeps top-level entries and other folders\' entries', async () => {
        installDb([character('c0', folderFixture())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'F1')
        await answer(true) // the folder holds entries: first confirmation
        await answer(true) // then the removal confirmation
        expect(globalNames()).toEqual(['top0', 'top1', 'F2', 'b0'])
    })

    test('an entry inserted above the folder while its confirmations are open does not change what is removed', async () => {
        installDb([character('c0', folderFixture())])
        const target = mountList({ submenu: 0 })
        await clickDelete(target, 'F1')
        await answer(true)
        DBState.db.characters[0].globalLore.unshift(entry('new'))
        flushSync()
        await answer(true)
        expect(globalNames()).toEqual(['new', 'top0', 'top1', 'F2', 'b0'])
    })
})

describe('an external lorebook list (a module\'s lorebook)', () => {
    test('guard: with nothing else changing, the confirmed entry is removed and no other', async () => {
        const list = $state(base())
        const target = mountList({ externalLoreBooks: list })
        await clickDelete(target, 'e1')
        await answer(true)
        expect(list.map((l) => l.comment)).toEqual(['e0', 'e2', 'e3'])
    })

    test('an entry inserted above it while the confirmation is open does not change which entry is removed', async () => {
        const list = $state(base())
        const target = mountList({ externalLoreBooks: list })
        await clickDelete(target, 'e2')
        list.unshift(entry('new'))
        flushSync()
        await answer(true)
        expect(list.map((l) => l.comment)).toEqual(['new', 'e0', 'e1', 'e3'])
    })

    test('two pending deletes of the same entry remove it once', async () => {
        const list = $state(base())
        const target = mountList({ externalLoreBooks: list })
        await clickDelete(target, 'e1')
        await clickDelete(target, 'e1')
        await answer(true)
        await answer(true)
        expect(list.map((l) => l.comment)).toEqual(['e0', 'e2', 'e3'])
    })
})

describe('a lorebook folder whose key is missing or empty', () => {
    type Branch = 'character' | 'chat' | 'external'
    const cases: Array<[Branch, 'undefined' | 'empty']> = [
        ['character', 'undefined'], ['character', 'empty'],
        ['chat', 'undefined'], ['chat', 'empty'],
        ['external', 'undefined'], ['external', 'empty'],
    ]

    /** A folder without a usable key, between top-level entries; for the empty key one top-level entry carries `folder: ''`. */
    function fixture(keyKind: 'undefined' | 'empty'): loreBook[] {
        const keyless = entry('F', { mode: 'folder' })
        if (keyKind === 'undefined') delete (keyless as { key?: string }).key
        else keyless.key = ''
        return [
            entry('top0', keyKind === 'empty' ? { folder: '' } : {}),
            keyless,
            entry('top1'),
        ]
    }

    async function answerAll(): Promise<void> {
        while (confirms.pending.length > 0) await answer(true)
    }

    function mountBranch(branch: Branch, keyKind: 'undefined' | 'empty'): HTMLElement {
        if (branch === 'external') {
            const list = $state(fixture(keyKind))
            return mountList({ externalLoreBooks: list })
        }
        if (branch === 'character') {
            installDb([character('c0', fixture(keyKind))])
            return mountList({ submenu: 0 })
        }
        installDb([character('c0', [], fixture(keyKind))])
        return mountList({ submenu: 1 })
    }

    test.each(cases)('deleting it on the %s lorebook list (%s key) asks only the removal confirmation, not the "folder holds entries" one', async (branch, keyKind) => {
        const target = mountBranch(branch, keyKind)
        await clickDelete(target, 'F')
        expect(confirms.pending.map((p) => p.message)).toEqual([language.removeConfirm + 'F'])
    })
    test.each(cases)('deleting it on the %s lorebook list (%s key) removes the folder and no top-level entry', async (branch, keyKind) => {
        let names: () => string[]
        let target: HTMLElement
        if (branch === 'external') {
            const list = $state(fixture(keyKind))
            const mountedTarget = mountList({ externalLoreBooks: list })
            target = mountedTarget
            // The external list is shown from the component's own copy once a folder is deleted, so read the rows.
            names = () => Array.from(mountedTarget.querySelectorAll('[data-risu-idx] button.endflex span')).map((s) => s.textContent!.trim())
        } else if (branch === 'character') {
            installDb([character('c0', fixture(keyKind))])
            target = mountList({ submenu: 0 })
            names = () => globalNames()
        } else {
            installDb([character('c0', [], fixture(keyKind))])
            target = mountList({ submenu: 1 })
            names = () => localNames()
        }
        await clickDelete(target, 'F')
        await answerAll()
        expect(names()).toEqual(['top0', 'top1'])
    })
})