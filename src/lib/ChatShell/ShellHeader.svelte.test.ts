// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

const mobile = writable(false)
const sidebar = writable(0)
vi.mock('../../ts/stores.svelte', () => ({ MobileGUI: mobile, MobileSideBar: sidebar }))
vi.mock('../../lang', () => ({ language: { chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat' } }))

describe('ShellHeader menu button', () => {
    async function mountHeader(onthischat: (opener: HTMLElement) => void) {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { name: 'Seraphina', hidden: false, hardwareKeyboardSeen: false, onthischat } })
        flushSync()
        return { target, app }
    }

    // Regression reproducer: the button announced "Choose persona" with a persona glyph, and opened the persona sheet.
    test('the button is named after the sheet it opens, announces a dialog popup and shows the ⋮ glyph', async () => {
        const { target, app } = await mountHeader(vi.fn())
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!
        expect(button.getAttribute('aria-label')).toBe('This chat')
        expect(button.getAttribute('title')).toBe('This chat')
        expect(button.getAttribute('aria-label')).not.toBe('Choose persona')
        expect(button.getAttribute('aria-haspopup')).toBe('dialog')
        expect(button.textContent?.trim()).toBe('⋮')
        await unmount(app)
        target.remove()
    })

    test('a click passes the button itself to onthischat, so focus can return to it', async () => {
        const onthischat = vi.fn()
        const { target, app } = await mountHeader(onthischat)
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!
        button.click()
        expect(onthischat).toHaveBeenCalledTimes(1)
        expect(onthischat).toHaveBeenCalledWith(button)
        await unmount(app)
        target.remove()
    })
})

describe('ShellHeader hide rules', () => {
    test('hidden state yields to keyboard use and focus', async () => {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const state = $state({ hidden: true, hardwareKeyboardSeen: false })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { name: 'Seraphina', get hidden() { return state.hidden }, get hardwareKeyboardSeen() { return state.hardwareKeyboardSeen }, onthischat: vi.fn() } })
        flushSync()
        const header = target.querySelector('header')
        expect(header?.hasAttribute('data-hidden')).toBe(true)
        state.hardwareKeyboardSeen = true
        flushSync()
        expect(header?.hasAttribute('data-hidden')).toBe(false)
        state.hardwareKeyboardSeen = false
        const button = target.querySelector('button')
        button?.focus()
        flushSync()
        expect(header?.hasAttribute('data-hidden')).toBe(false)
        await unmount(app)
        target.remove()
    })

    test('onconcealed reports every change of the concealed expression', async () => {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const state = $state({ hidden: false, hardwareKeyboardSeen: false })
        const seen: boolean[] = []
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { name: 'Seraphina', get hidden() { return state.hidden }, get hardwareKeyboardSeen() { return state.hardwareKeyboardSeen }, onthischat: vi.fn(), onconcealed: (concealed: boolean) => { seen.push(concealed) } } })
        flushSync()
        expect(seen).toEqual([false])
        state.hidden = true
        flushSync()
        expect(seen).toEqual([false, true])
        state.hardwareKeyboardSeen = true
        flushSync()
        expect(seen).toEqual([false, true, false])
        state.hardwareKeyboardSeen = false
        flushSync()
        target.querySelector('button')?.focus()
        flushSync()
        expect(seen).toEqual([false, true, false, true, false])
        await unmount(app)
        target.remove()
    })
})
