// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state({ db: { newMessageButtonStyle: 'bottom-center' } })
    const additionalFloatingActionButtons = $state([{ id: 'plugin', name: 'Plugin action', icon: '', iconType: 'none' as const, callback: vi.fn() }])
    const chatPanelStore = $state([{ id: 'panel', pluginName: 'Plugin', html: '<b>Panel</b>' }])
    return { DBState, additionalFloatingActionButtons, chatPanelStore }
})
vi.mock('../../lang', () => ({ language: { newMessage: 'New message' } }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))

describe('ShellFloatingButtons', () => {
    test.each(['bottom-center', 'bottom-right', 'bottom-left', 'floating-circle', 'right-center', 'top-bar'])('places the latest button at %s', async (style) => {
        const { DBState } = await import('../../ts/stores.svelte')
        Object.assign(DBState.db, { newMessageButtonStyle: style })
        const { default: ShellFloatingButtons } = await import('./ShellFloatingButtons.svelte')
        const target = document.createElement('div')
        const onclick = vi.fn()
        const app = mount(ShellFloatingButtons, { target, props: { visible: true, onclick } })
        flushSync()
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-new-message"]')
        expect(button?.dataset.style).toBe(style)
        button?.click()
        expect(onclick).toHaveBeenCalledOnce()
        expect(target.querySelector('[data-plugin-chat-panel]')?.textContent).toBe('Panel')
        expect(target.querySelector('[aria-label="Plugin action"]')).not.toBeNull()
        await unmount(app)
    })
})
