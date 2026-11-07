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

describe('header Back clears the classic sidebar toggle', () => {
    test('the header reserves the toggle column so Back is not covered', async () => {
        const header = await mountHeader()
        expect(header.hasAttribute('data-toggle-inset')).toBe(true)
        // The reserved column (touch-lg toggle plus one gap) must be the rule the attribute selects.
        expect(header.style.paddingLeft).toBe('calc(var(--size-touch-lg) + var(--space-7))')
    })
})
