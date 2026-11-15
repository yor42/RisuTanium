// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state({ db: { newMessageButtonStyle: 'bottom-center' } })
    const additionalFloatingActionButtons = $state([{ id: 'plugin', name: 'Plugin action', icon: '', iconType: 'none' as const, callback: vi.fn() }])
    const chatPanelStore = $state([{ id: 'panel', pluginName: 'Plugin', html: '<b>Panel</b>' }])
    return { DBState, additionalFloatingActionButtons, chatPanelStore }
})
vi.mock('../../lang', () => ({ language: { chatShellJumpLatest: 'Jump to latest', chatShellNewCount: (count: number) => `${count} new` } }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))

async function render(props: { visible: boolean, count: number, onclick: () => void }) {
    const { default: ShellFloatingButtons } = await import('./ShellFloatingButtons.svelte')
    const target = document.createElement('div')
    const app = mount(ShellFloatingButtons, { target, props })
    flushSync()
    return { target, app, button: () => target.querySelector<HTMLButtonElement>('[data-part="chat-new-message"]') }
}

describe('ShellFloatingButtons', () => {
    // MC-1761: the shell ignores newMessageButtonStyle, so the attribute that placed the old pill is gone for every style.
    test.each(['bottom-center', 'bottom-right', 'bottom-left', 'floating-circle', 'right-center', 'top-bar'])('A1-18: the shell button ignores the %s style', async (style) => {
        const { DBState } = await import('../../ts/stores.svelte')
        Object.assign(DBState.db, { newMessageButtonStyle: style })
        const { target, app, button } = await render({ visible: true, count: 0, onclick: vi.fn() })
        expect(target.querySelectorAll('[data-part="chat-new-message"]')).toHaveLength(1)
        expect(button()?.dataset.style).toBeUndefined()
        await unmount(app)
    })
    test('A1-18: the button is named by the jump label and calls onclick', async () => {
        const onclick = vi.fn()
        const { app, button } = await render({ visible: true, count: 0, onclick })
        expect(button()?.getAttribute('aria-label')).toBe('Jump to latest')
        expect(button()?.querySelector('.badge')).toBeNull()
        button()?.click()
        expect(onclick).toHaveBeenCalledOnce()
        await unmount(app)
    })
    test('A1-18: a count is in the accessible name and shown as a badge, capped at 99+', async () => {
        const three = await render({ visible: true, count: 3, onclick: vi.fn() })
        expect(three.button()?.getAttribute('aria-label')).toBe('Jump to latest, 3 new')
        expect(three.button()?.querySelector('.badge')?.textContent).toBe('3')
        await unmount(three.app)
        const many = await render({ visible: true, count: 150, onclick: vi.fn() })
        expect(many.button()?.querySelector('.badge')?.textContent).toBe('99+')
        await unmount(many.app)
    })
    test('A1-18: nothing renders for the button while not visible, and plugin panels and actions still do', async () => {
        const { target, app, button } = await render({ visible: false, count: 4, onclick: vi.fn() })
        expect(button()).toBeNull()
        expect(target.querySelector('[data-plugin-chat-panel]')?.textContent).toBe('Panel')
        expect(target.querySelector('[aria-label="Plugin action"]')).not.toBeNull()
        await unmount(app)
    })
})
