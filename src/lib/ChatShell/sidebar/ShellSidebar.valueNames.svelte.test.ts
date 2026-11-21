// @vitest-environment jsdom

/**
 * `ShellSidebar.svelte`: the chat sort select is named by an sr-only span holding the sort label, and its description is
 * that name first and the "on this device" help second. Mounts the REAL sidebar; mocks are those of
 * `ShellSidebar.search.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable(true),
        settingsOpen: writable(false),
        PlaygroundStore: writable(0),
        OpenRealmStore: writable(false),
        bookmarkListOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    changeChatTo: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
    changeChar: vi.fn(),
    supersedeChangeChar: vi.fn(),
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { fieldNameProblems, unnamedControls } from '../../a11yNames.test-helpers'
import ShellSidebar from './ShellSidebar.svelte'

// jsdom has no ResizeObserver; the chat list only observes its own size.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(sort: 'manual' | 'recent'): HTMLElement {
    DBState.db = {
        characters: [{ type: 'character', chaId: 'a', name: 'Name a', image: '', chats: [{ id: 'id-a1', name: 'a1', message: [{ role: 'char', data: 'a1', time: 5 }], note: '', localLore: [], fmIndex: -1 }], chatPage: 0, chatFolders: [], lastInteraction: 0 }],
        enableDevTools: false,
    } as unknown as Database
    selectedCharID.set(0)
    localStorage.setItem('risuChatShell.chatSort', sort)
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

// The chat search text field: not a value control, so outside #334.
const KNOWN_UNNAMED: string[] = ['<input type=text class="w-full rounded-md border border-darkborderc bg-darkbutton ps-8 pe-2 py-2 text-textcolor">']

describe('ShellSidebar value-control names', () => {
    test.each(['manual', 'recent'] as const)('regression reproducer: the sort select (%s) is named by the sort label, then helped by the device note', (sort) => {
        const target = render(sort)
        expect(fieldNameProblems(target, [
            { name: language.chatShellSortLabel, help: language.chatShellOnThisDevice },
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
