// @vitest-environment jsdom

/**
 * With an App-level overlay open over the Beta Mobile GUI shell, Android Back closes the overlay
 * first and leaves the shell page where it is; the next Back is the shell's. The overlays render
 * outside the shell branch, so the shell handler is registered beneath them. (R) = regression
 * reproducer: fails on a base where the overlay registers no Back handler (the shell page pops
 * invisibly beneath the overlay); (G) = guard that may pass before and after.
 *
 * Mounts the REAL header and the REAL loadout modal. MOCKED: `stores.svelte`, `loadout`, the
 * database module and `alertBack`. The quit warning is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const loadout = $state({ open: false })
    return {
        DBState: state,
        loadoutModalStore: loadout,
        selectedCharID: writable(-1),
        MobileGUIStack: writable(1),
        MobileSideBar: writable(0),
        MobileSearch: writable(''),
        SettingsMenuIndex: writable(-1),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/loadout', () => ({ applyLoadout: vi.fn(), saveCurrentLoadout: vi.fn() }))
vi.mock('src/ts/storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(() => undefined) }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import {
    DBState,
    MobileGUIStack,
    MobileSideBar,
    loadoutModalStore,
    selectedCharID,
} from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import MobileHeader from './Mobile/MobileHeader.svelte'
import LoadoutModal from './Others/LoadoutModal.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

function mountInto(component: Parameters<typeof mount>[0]): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target, props: {} }))
    flushSync()
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    DBState.db = {
        characters: [{ name: 'Char' }],
        loadouts: [],
        loadoutApplyOptions: {},
    } as unknown as Database
    selectedCharID.set(0)
    MobileSideBar.set(1)
    MobileGUIStack.set(1)
    loadoutModalStore.open = false
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    loadoutModalStore.open = false
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('overlay before shell', () => {
    test('(R) Back closes the open overlay and the shell page stays; the next Back is the shell\'s', () => {
        mountInto(MobileHeader as Parameters<typeof mount>[0])
        loadoutModalStore.open = true
        mountInto(LoadoutModal as Parameters<typeof mount>[0])
        expect(pressBack()).toBe(true)
        expect(loadoutModalStore.open).toBe(false)
        expect(get(MobileSideBar)).toBe(1)
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(0)
        expect(get(selectedCharID)).toBe(0)
    })

    test('(G) navigating the shell while the overlay is open does not put the shell above it', () => {
        mountInto(MobileHeader as Parameters<typeof mount>[0])
        loadoutModalStore.open = true
        mountInto(LoadoutModal as Parameters<typeof mount>[0])
        MobileSideBar.set(2)
        flushSync()
        expect(pressBack()).toBe(true)
        expect(loadoutModalStore.open).toBe(false)
        expect(get(MobileSideBar)).toBe(2)
    })

    test('(G) without an overlay the shell answers Back as before', () => {
        mountInto(MobileHeader as Parameters<typeof mount>[0])
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
    })
})
