// @vitest-environment jsdom

/**
 * `SideBarArrow.svelte`: the sidebar toggle at the top-left of the chat area. It renders nothing
 * while the Home phone drawer owns navigation (`homeChrome.phoneDrawer`) and is otherwise the
 * open arrow or the close arrow, as before.
 *
 * MOCKED: `stores.svelte` with the three stores the arrow reads.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DynamicGUI: writable(false),
    sideBarClosing: writable(false),
    sideBarStore: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

import SideBarArrow from './SideBarArrow.svelte'
import { homeChrome } from 'src/lib/UI/Home/homeChrome.svelte'
import { DynamicGUI, sideBarStore } from 'src/ts/stores.svelte'

const mounted: { instance: unknown, target: HTMLElement }[] = []

function mountArrow(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ instance: mount(SideBarArrow, { target }), target })
    flushSync()
    return target
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    homeChrome.phoneDrawer = false
    sideBarStore.set(false)
    DynamicGUI.set(false)
})

describe('SideBarArrow', () => {
    test('T-B13: with the phone drawer flag set the arrow renders no button, in the open and the closed state', () => {
        homeChrome.phoneDrawer = true
        expect(mountArrow().querySelector('button')).toBeNull()

        sideBarStore.set(true)
        expect(mountArrow().querySelector('button')).toBeNull()
    })

    test('T-B13b: without the flag it renders the open arrow, and the close arrow while the sidebar is open', () => {
        homeChrome.phoneDrawer = false
        const closedState = mountArrow()
        expect(closedState.querySelectorAll('button').length).toBe(1)
        expect(closedState.querySelector('button')!.hasAttribute('data-panel-handle')).toBe(true)

        sideBarStore.set(true)
        const openState = mountArrow()
        expect(openState.querySelectorAll('button').length).toBe(1)
        expect(openState.querySelector('button')!.hasAttribute('data-panel-handle')).toBe(false)
    })

    test('T-B13d: the flag is false by default, before any HomeShell mount, so the arrow shows in a chat opened first', async () => {
        vi.resetModules()
        const fresh = await import('src/lib/UI/Home/homeChrome.svelte')
        expect(fresh.homeChrome.phoneDrawer).toBe(false)
    })

    test('T-B13c: the arrow follows the flag live', () => {
        const target = mountArrow()
        expect(target.querySelector('button')).not.toBeNull()
        homeChrome.phoneDrawer = true
        flushSync()
        expect(target.querySelector('button')).toBeNull()
        homeChrome.phoneDrawer = false
        flushSync()
        expect(target.querySelector('button')).not.toBeNull()
    })
})
