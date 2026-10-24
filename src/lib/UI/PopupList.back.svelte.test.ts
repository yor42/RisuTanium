// @vitest-environment jsdom

/**
 * Android Back on the context popup does what a document click does: it clears the popup. Back
 * does not depend on the delayed click listener. (R) = regression reproducer: fails on a base
 * without the Back handler (the popup stays and the quit warning shows); (G) = guard that may pass
 * before and after. The reproducers import only modules that exist on the pre-fix base.
 *
 * MOCKED: `stores.svelte` (the real shape of `popupStore`), `util` (sleep resolves at once) and
 * `alertBack`. The quit warning is a spy.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../ts/stores.svelte'), () => {
    const popupStore = $state({ children: null as null | import('svelte').Snippet, mouseX: 0, mouseY: 0 })
    return {
        popupStore,
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import { popupStore } from '../../ts/stores.svelte'
import { installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import PopupList from './PopupList.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []

function openPopup(): void {
    popupStore.children = createRawSnippet(() => ({ render: () => '<span class="popup-body">item</span>' }))
}

function mountPopup(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(PopupList, { target })
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
    popupStore.children = null
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    popupStore.children = null
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('popup list Back', () => {
    test('(R) Back closes the popup right after it opens, then the root warns', () => {
        openPopup()
        const { target } = mountPopup()
        expect(target.querySelector('.popup-body')).not.toBeNull()
        expect(pressBack()).toBe(true)
        expect(popupStore.children).toBeNull()
        expect(target.querySelector('.popup-body')).toBeNull()
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the store as a document click does', async () => {
        openPopup()
        const first = mountPopup()
        await vi.advanceTimersByTimeAsync(0)
        document.body.click()
        flushSync()
        expect(popupStore.children).toBeNull()
        first.destroy()
        openPopup()
        mountPopup()
        pressBack()
        expect(popupStore.children).toBeNull()
    })

    test('(G) an unmounted popup stops answering Back', () => {
        openPopup()
        const { destroy } = mountPopup()
        destroy()
        expect(pressBack()).toBe(true)
        expect(popupStore.children).not.toBeNull()
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) a popup opened over an older surface answers first, then the older surface', () => {
        const older = { open: true }
        cleanups.push(registerBackHandler(() => {
            if (!older.open) {
                return false
            }
            older.open = false
            return true
        }))
        openPopup()
        mountPopup()
        expect(pressBack()).toBe(true)
        expect(popupStore.children).toBeNull()
        expect(older.open).toBe(true)
        expect(pressBack()).toBe(true)
        expect(older.open).toBe(false)
    })
})
