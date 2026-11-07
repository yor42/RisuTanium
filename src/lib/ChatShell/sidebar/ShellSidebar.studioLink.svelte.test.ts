// @vitest-environment happy-dom

/**
 * `ShellSidebar.svelte` as the consumer of a Studio link-out on the new shell's route.
 *
 * Invariants exercised here:
 * - A pending request opens More on Character settings and is cleared by that consumption, so it cannot
 *   open More a second time (single shot).
 * - A request that arrives while More is already open on its menu still lands on Character settings.
 * - With no request the sidebar is unchanged: More stays closed, and a normal open starts at the menu.
 *
 * MOCKED: the stores module, the alert module, the reply flag and the heavy sidebar children.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'

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

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { classicLinks } from '../../../ts/studio/classicLinks.svelte'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string): Chat {
    return { id: `id-${name}`, name, message: [], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats: [chat('c1')], chatPage: 0, lastInteraction: 0 } as unknown as Entry
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
const reseter = vi.fn()
const openGrid = vi.fn()

function render(): void {
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid, reseter } }) as Record<string, unknown>)
    flushSync()
}

const part = (name: string) => target.querySelector<HTMLElement>(`[data-part="${name}"]`)

function requestCharacterSettings(): void {
    classicLinks.request = { view: 'characterSettings' }
    flushSync()
}

beforeEach(() => {
    reseter.mockReset()
    openGrid.mockReset()
    localStorage.clear()
    classicLinks.request = null
    DBState.db = { characters: [character('a')], enableDevTools: false } as unknown as Database
    selectedCharID.set(0)
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    target?.remove()
    classicLinks.request = null
})

describe('4g link-out request', () => {
    test('with no request More stays closed and opens on its menu', () => {
        render()
        expect(part('sidebar-more-panel')).toBeNull()
        part('sidebar-more')?.click()
        flushSync()
        expect(part('more-list')).not.toBeNull()
        expect(part('more-subview')).toBeNull()
    })

    test('a request opens More on Character settings and is cleared', () => {
        render()
        requestCharacterSettings()
        expect(part('sidebar-more-panel')).not.toBeNull()
        expect(part('more-subview')).not.toBeNull()
        expect(part('more-list')).toBeNull()
        expect(classicLinks.request).toBeNull()
    })

    test('the request is single shot: closing More does not open it again', () => {
        render()
        requestCharacterSettings()
        const back = part('sidebar-more-panel')?.querySelector('button')
        back?.click()
        flushSync()
        expect(part('more-list')).not.toBeNull()
        part('sidebar-more-panel')?.querySelector('button')?.click()
        flushSync()
        expect(part('sidebar-more-panel')).toBeNull()
    })

    test('a normal open after a link-out starts at the menu again', () => {
        render()
        requestCharacterSettings()
        part('sidebar-more')?.click()
        flushSync()
        expect(part('sidebar-more-panel')).toBeNull()
        part('sidebar-more')?.click()
        flushSync()
        expect(part('more-list')).not.toBeNull()
    })

    test('a request while More is open on its menu lands on Character settings', async () => {
        render()
        part('sidebar-more')?.click()
        flushSync()
        expect(part('more-list')).not.toBeNull()
        requestCharacterSettings()
        await tick()
        flushSync()
        expect(part('more-subview')).not.toBeNull()
        expect(classicLinks.request).toBeNull()
    })
})
