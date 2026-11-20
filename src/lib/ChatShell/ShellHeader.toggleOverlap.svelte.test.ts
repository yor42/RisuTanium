// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

const mobile = writable(false)
vi.mock('../../ts/stores.svelte', () => ({ MobileGUI: mobile, MobileSideBar: writable(0) }))
vi.mock('../../lang', () => ({ language: { chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat' } }))

let target: HTMLElement
let app: Record<string, unknown> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

async function mountHeader(): Promise<HTMLElement> {
    const { default: ShellHeader } = await import('./ShellHeader.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellHeader, { target, props: { name: 'Seraphina', hidden: false, hardwareKeyboardSeen: false, onthischat: vi.fn() } })
    flushSync()
    return target.querySelector('header')!
}

describe('header Back is the only back control', () => {
    test('the header reserves no column for the classic sidebar arrow', async () => {
        const header = await mountHeader()
        // The classic arrow no longer mounts over the shell, so the header pads only with its own gap.
        expect(header.hasAttribute('data-toggle-inset')).toBe(false)
        expect(header.style.paddingLeft).toBe('')
    })
})
