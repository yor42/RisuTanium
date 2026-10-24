// @vitest-environment jsdom

/**
 * Android Back in the Beta Mobile GUI shell: the header's arrows are the shell's close controls,
 * and Back does what the visible arrow does. (R) = regression reproducer (fails on a base without
 * the Back handler: the store does not change and the quit warning shows); (G) = guard that may
 * pass before and after. The reproducers import only modules that exist on the pre-fix base.
 *
 * MOCKED: `stores.svelte` (plain writable stores for what the header reads) and `alertBack` (the
 * dialog close only clears the alert store). The quit warning is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable(1),
        MobileSideBar: writable(0),
        MobileSearch: writable(''),
        SettingsMenuIndex: writable(-1),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', async () => {
    const { alertStore } = await import('../../ts/stores.svelte')
    return { closeDialogForBack: vi.fn(() => alertStore.set({ type: 'none', msg: '' })) }
})

import {
    DBState,
    MobileGUIStack,
    MobileSideBar,
    selectedCharID,
    SettingsMenuIndex,
    alertStore,
} from '../../ts/stores.svelte'
import { installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import MobileHeader from './MobileHeader.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []

function mountHeader(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(MobileHeader, { target })
    mounted.push(component)
    flushSync()
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

function setShell(char: number, side: number, stack: number, settings: number): void {
    selectedCharID.set(char)
    MobileSideBar.set(side)
    MobileGUIStack.set(stack)
    SettingsMenuIndex.set(settings)
}

function tuple(): string {
    return [get(selectedCharID), get(MobileSideBar), get(MobileGUIStack), get(SettingsMenuIndex)].join('|')
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
    DBState.db = { characters: [{ name: 'Char' }] } as unknown as Database
    alertStore.set({ type: 'none', msg: '' })
    setShell(-1, 0, 1, -1)
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('shell Back', () => {
    test('(R) a sidebar page goes back to the chat, then the chat to the character list, then the root warns', () => {
        setShell(0, 1, 1, -1)
        mountHeader()
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(0)
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(selectedCharID)).toBe(-1)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(500)
        expect(pressBack()).toBe(false)
    })

    test('(R) a Settings page goes back to the Settings list, then the root warns', () => {
        setShell(-1, 0, 2, 3)
        mountHeader()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(R) a handled Back resets the quit arm: after a root warning, a handled press and a root press warn again', () => {
        mountHeader()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        setShell(0, 0, 1, -1)
        vi.advanceTimersByTime(500)
        expect(pressBack()).toBe(true)
        expect(get(selectedCharID)).toBe(-1)
        vi.advanceTimersByTime(500)
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test.each([
        ['sidebar page', [0, 1, 1, -1]],
        ['chat', [0, 0, 1, -1]],
        ['Settings page', [-1, 0, 2, 3]],
    ])('(G) Back from the %s leaves the stores as the header arrow does', (_row, start) => {
        const [char, side, stack, settings] = start
        setShell(char, side, stack, settings)
        const first = mountHeader()
        first.target.querySelector('button')?.click()
        flushSync()
        const afterArrow = tuple()
        first.destroy()
        setShell(char, side, stack, settings)
        mountHeader()
        pressBack()
        expect(tuple()).toBe(afterArrow)
        expect(afterArrow).not.toBe(start.join('|'))
    })

    test.each([0, 1, 2])('(G) the tab root %i is not handled: the guard warns and nothing moves', (stack) => {
        setShell(-1, 0, stack, -1)
        mountHeader()
        const before = tuple()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(tuple()).toBe(before)
    })

    test('(G) a root press keeps the focused field and a handled press blurs it', () => {
        setShell(-1, 0, 1, -1)
        const { target } = mountHeader()
        const search = target.querySelector('input') as HTMLInputElement
        search.focus()
        expect(pressBack()).toBe(true)
        expect(document.activeElement).toBe(search)
        const outside = document.createElement('input')
        document.body.appendChild(outside)
        outside.focus()
        setShell(0, 1, 1, -1)
        expect(pressBack()).toBe(true)
        expect(document.activeElement).toBe(document.body)
    })

    test('(G) after the header unmounts Back no longer runs the shell step, and a remount registers it again', () => {
        setShell(0, 1, 1, -1)
        const first = mountHeader()
        first.destroy()
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(1)
        expect(showToast).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(3000)
        mountHeader()
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(0)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) a covering alert takes the press and the shell does not move', () => {
        setShell(0, 1, 1, -1)
        mountHeader()
        alertStore.set({ type: 'ask', msg: 'sure?' })
        expect(pressBack()).toBe(true)
        expect(get(alertStore).type).toBe('none')
        expect(get(MobileSideBar)).toBe(1)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) navigating the shell does not move its handler above an overlay opened after it', () => {
        setShell(-1, 0, 1, -1)
        mountHeader()
        const overlay = { open: true }
        cleanups.push(
            registerBackHandler(() => {
                if (!overlay.open) {
                    return false
                }
                overlay.open = false
                return true
            }),
        )
        MobileSideBar.set(1)
        selectedCharID.set(0)
        flushSync()
        expect(pressBack()).toBe(true)
        expect(overlay.open).toBe(false)
        expect(get(MobileSideBar)).toBe(1)
        expect(pressBack()).toBe(true)
        expect(get(MobileSideBar)).toBe(0)
    })

    test('(G) a change-on-blur write reaches the effects before the chat closes', () => {
        setShell(0, 0, 1, -1)
        mountHeader()
        const seen: string[] = []
        let committed = $state(0)
        const stopEffects = $effect.root(() => {
            $effect(() => {
                if (committed > 0) {
                    seen.push(`${committed}@${get(selectedCharID)}`)
                }
            })
        })
        cleanups.push(stopEffects)
        flushSync()
        const field = document.createElement('input')
        document.body.appendChild(field)
        field.focus()
        field.addEventListener('blur', () => {
            committed = 1
        })
        expect(pressBack()).toBe(true)
        expect(get(selectedCharID)).toBe(-1)
        expect(seen).toEqual(['1@0'])
    })
})
