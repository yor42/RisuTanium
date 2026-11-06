// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

const mobile = writable(false)
const sidebar = writable(0)
const closeChat = vi.fn()
vi.mock('../../ts/stores.svelte', () => ({ MobileGUI: mobile, MobileSideBar: sidebar }))
vi.mock('../Mobile/mobileBack', () => ({ closeShellChat: closeChat }))
vi.mock('../../lang', () => ({ language: { chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona' } }))

describe('ShellHeader hide rules', () => {
    test('hidden state yields to keyboard use and focus, and MobileGUI arrow closes chat', async () => {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const state = $state({ hidden: true, hardwareKeyboardSeen: false })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { name: 'Seraphina', get hidden() { return state.hidden }, get hardwareKeyboardSeen() { return state.hardwareKeyboardSeen }, onpersona: vi.fn() } })
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
        mobile.set(true)
        button?.click()
        expect(closeChat).toHaveBeenCalledTimes(1)
        await unmount(app)
        target.remove()
    })

    test('onconcealed reports every change of the concealed expression', async () => {
        const { default: ShellHeader } = await import('./ShellHeader.svelte')
        const state = $state({ hidden: false, hardwareKeyboardSeen: false })
        const seen: boolean[] = []
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ShellHeader, { target, props: { name: 'Seraphina', get hidden() { return state.hidden }, get hardwareKeyboardSeen() { return state.hardwareKeyboardSeen }, onpersona: vi.fn(), onconcealed: (concealed: boolean) => { seen.push(concealed) } } })
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
