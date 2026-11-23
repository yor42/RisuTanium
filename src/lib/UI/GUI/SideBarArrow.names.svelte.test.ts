// @vitest-environment jsdom

/**
 * Accessible names of `SideBarArrow.svelte`'s two icon-only buttons. The close arrow is named
 * "Close sidebar"; the open handle is named "Sidebar" with `aria-expanded` reporting the sidebar
 * state, and the arrow glyphs are hidden from the accessibility tree so they add no name.
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
import { DynamicGUI, sideBarStore } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

const mounted: { instance: unknown, target: HTMLElement }[] = []

function onlyButton(): HTMLButtonElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ instance: mount(SideBarArrow, { target }), target })
    flushSync()
    const buttons = target.querySelectorAll('button')
    expect(buttons.length).toBe(1)
    return buttons[0]
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    sideBarStore.set(false)
    DynamicGUI.set(false)
})

describe('SideBarArrow names', () => {
    test('the open handle is named Sidebar and reports collapsed', () => {
        const button = onlyButton()
        expect(button.hasAttribute('data-panel-handle')).toBe(true)
        expect(button.getAttribute('aria-label')).toBe(language.chatShellSidebar)
        expect(button.getAttribute('aria-expanded')).toBe('false')
        expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    test('the close arrow is named Close sidebar', () => {
        sideBarStore.set(true)
        const button = onlyButton()
        expect(button.hasAttribute('data-panel-handle')).toBe(false)
        expect(button.getAttribute('aria-label')).toBe(language.closeSidebar)
        expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    test('under the dynamic GUI the open overlay owns its own arrow, so the handle renders nothing', () => {
        DynamicGUI.set(true)
        sideBarStore.set(true)
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ instance: mount(SideBarArrow, { target }), target })
        flushSync()
        expect(target.querySelector('button')).toBeNull()
    })

    test('under the dynamic GUI the closed handle is named Sidebar and reports collapsed', () => {
        DynamicGUI.set(true)
        const button = onlyButton()
        expect(button.hasAttribute('data-panel-handle')).toBe(true)
        expect(button.getAttribute('aria-expanded')).toBe('false')
    })
})
