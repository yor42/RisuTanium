// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => ({ MobileGUI: writable(false), DynamicGUI: writable(false), sideBarStore: writable(false), sideBarClosing: writable(false) }))
vi.mock('../../lang', () => ({ language: { chatShellBack: 'Back', chatShellThisChat: 'This chat' } }))

/**
 * TE1: the header names the character and, on a second line, the chat shown. Regression reproducer: the base header
 * carries the character's name only.
 */
describe('ShellHeader chat name line', () => {
    async function mountHeader(props: { name: string, chatName?: string }) {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { ...props, hidden: false, hardwareKeyboardSeen: false, onthischat: vi.fn() } })
        flushSync()
        return { target, app }
    }

    test('the chat name is a second line below the character name', async () => {
        const { target, app } = await mountHeader({ name: 'Seraphina', chatName: 'Night walk' })
        const title = target.querySelector('[data-part="chat-header-title"]')
        const chat = target.querySelector('[data-part="chat-header-chat"]')
        expect(title?.textContent).toBe('Seraphina')
        expect(chat).not.toBeNull()
        expect(chat?.textContent).toBe('Night walk')
        expect(title?.nextElementSibling).toBe(chat)
        await unmount(app)
        target.remove()
    })

    test('an empty or absent chat name leaves no second line', async () => {
        const first = await mountHeader({ name: 'Seraphina' })
        expect(first.target.querySelector('[data-part="chat-header-chat"]')).toBeNull()
        expect(first.target.querySelector('[data-part="chat-header-title"]')?.textContent).toBe('Seraphina')
        await unmount(first.app)
        first.target.remove()
        const second = await mountHeader({ name: 'Seraphina', chatName: '' })
        expect(second.target.querySelector('[data-part="chat-header-chat"]')).toBeNull()
        await unmount(second.app)
        second.target.remove()
    })
})
