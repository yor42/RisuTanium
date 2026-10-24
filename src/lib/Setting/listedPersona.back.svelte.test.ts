// @vitest-environment jsdom

/**
 * Android Back on the persona list does what the header X does (the `close` prop). (R) = regression
 * reproducer: fails on a base without the Back handler (the list stays and the quit warning shows);
 * (G) = guard that may pass before and after. The reproducers import only modules that exist on the
 * pre-fix base.
 *
 * MOCKED: `stores.svelte` (a `$state` database and plain writable stores), `persona` and
 * `alertBack`. The quit warning is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        openPersonaList: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/persona', () => ({ changeUserPersona: vi.fn() }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import { DBState, openPersonaList } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import ListedPersona from './listedPersona.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

function mountList(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ListedPersona, { target, props: { close: () => openPersonaList.set(false) } })
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
    openPersonaList.set(true)
    DBState.db = { personas: [{ name: 'One', note: '' }], selectedPersona: 0 } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('persona list Back', () => {
    test('(R) Back closes the list, then the root warns', () => {
        mountList()
        expect(pressBack()).toBe(true)
        expect(get(openPersonaList)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the store as the header X does', () => {
        const first = mountList()
        ;(first.target.querySelector('div.grow.flex.justify-end > button') as HTMLButtonElement).click()
        flushSync()
        expect(get(openPersonaList)).toBe(false)
        first.destroy()
        openPersonaList.set(true)
        mountList()
        pressBack()
        expect(get(openPersonaList)).toBe(false)
    })

    test('(G) an unmounted list stops answering Back', () => {
        const { destroy } = mountList()
        destroy()
        expect(pressBack()).toBe(true)
        expect(get(openPersonaList)).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })
})
