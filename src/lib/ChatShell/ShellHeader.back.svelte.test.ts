// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'

// The sidebar stores are real svelte writables; the full stores module drags in the parser graph, which is not under test.
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DynamicGUI: writable(false), MobileGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(false) }
})
vi.mock('../../lang', () => ({ language: { chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat' } }))

import { DynamicGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import ShellHeader from './ShellHeader.svelte'

let target: HTMLElement
let app: Record<string, unknown> | undefined
function mountBack(): HTMLButtonElement {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellHeader, { target, props: { name: 'Seraphina', hidden: false, hardwareKeyboardSeen: false, onthischat: vi.fn() } })
    flushSync()
    return target.querySelector('[data-part="chat-header-back"]') as HTMLButtonElement
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    DynamicGUI.set(false)
    sideBarStore.set(false)
    sideBarClosing.set(false)
})

describe('header Back in the classic layout', () => {
    test('a closed sidebar is opened with the same pair as the classic toggle', () => {
        sideBarStore.set(false)
        sideBarClosing.set(true)
        mountBack().click()
        expect(get(sideBarStore)).toBe(true)
        expect(get(sideBarClosing)).toBe(false)
    })
    test('an open sidebar is closed like the toggle first branch', () => {
        sideBarStore.set(true)
        mountBack().click()
        expect(get(sideBarClosing)).toBe(true)
    })
    test('with DynamicGUI the toggle only opens, so Back opens', () => {
        DynamicGUI.set(true)
        sideBarStore.set(true)
        sideBarClosing.set(true)
        mountBack().click()
        expect(get(sideBarClosing)).toBe(false)
        expect(get(sideBarStore)).toBe(true)
    })
})
