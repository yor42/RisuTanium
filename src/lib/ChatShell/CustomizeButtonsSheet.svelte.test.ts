// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: {
    chatShellCustomizeButtons: 'Customize buttons', chatShellOnThisDevice: 'On this device',
    chatShellMoveUp: 'Move up', chatShellMoveDown: 'Move down', chatShellRestoreDefaults: 'Restore defaults',
} }))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))
import CustomizeButtonsSheet from './CustomizeButtonsSheet.svelte'

let target: HTMLElement
let app: ReturnType<typeof CustomizeButtonsSheet> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove(); localStorage.removeItem('risuChatShell.actionSlots') })

describe('device-local pinned buttons', () => {
    test('pinning an action writes the ordered slots and defaults restore them', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(CustomizeButtonsSheet, { target, props: { open: true, onclose: vi.fn() } })
        flushSync()
        const copy = [...target.querySelectorAll('[data-part="chat-customize-action"]')].find((row) => row.textContent?.includes('copy'))!
        const checkbox = copy.querySelector<HTMLInputElement>('input')!
        checkbox.click()
        flushSync()
        expect(JSON.parse(localStorage.getItem('risuChatShell.actionSlots')!).pinned).toContain('copy')
        ;[...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Restore defaults')?.click()
        flushSync()
        expect(JSON.parse(localStorage.getItem('risuChatShell.actionSlots')!).pinned).toEqual(['edit', 'delete'])
    })
    test('without a background list the rest of the page is inert while the sheet is open', () => {
        const page = document.createElement('main')
        const settings = document.createElement('div')
        target = document.createElement('div')
        const host = document.createElement('div')
        target.append(page, host)
        document.body.appendChild(target)
        document.body.appendChild(settings)
        const state = $state({ open: true })
        app = mount(CustomizeButtonsSheet, { target: host, props: { get open() { return state.open }, onclose: vi.fn() } })
        flushSync()
        expect(page.hasAttribute('inert')).toBe(true)
        expect(settings.hasAttribute('inert')).toBe(true)
        expect(host.querySelector('[data-part="chat-sheet"]')?.closest('[inert]')).toBeNull()
        state.open = false
        flushSync()
        expect(page.hasAttribute('inert')).toBe(false)
        expect(settings.hasAttribute('inert')).toBe(false)
        settings.remove()
    })
    test('the background it is given is inert while the sheet is open', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const background = document.createElement('main')
        target.appendChild(background)
        const state = $state({ open: true })
        app = mount(CustomizeButtonsSheet, { target, props: { get open() { return state.open }, background: [background], onclose: vi.fn() } })
        flushSync()
        expect(background.hasAttribute('inert')).toBe(true)
        state.open = false
        flushSync()
        expect(background.hasAttribute('inert')).toBe(false)
    })
})
