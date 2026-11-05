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

function mountSheet(): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(CustomizeButtonsSheet, { target, props: { open: true, onclose: vi.fn() } })
    flushSync()
}

describe('customize rows are 44 dp tap targets', () => {
    test('the label wraps the checkbox and a tap on the label text toggles it', () => {
        mountSheet()
        const label = target.querySelector<HTMLLabelElement>('[data-part="chat-customize-action"] label')!
        const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(label.contains(checkbox)).toBe(true)
        const before = checkbox.checked
        label.click()
        flushSync()
        expect(checkbox.checked).toBe(!before)
    })
    test('the label row carries the touch height token and the checkbox keeps its small visual size', () => {
        mountSheet()
        const label = target.querySelector<HTMLLabelElement>('[data-part="chat-customize-action"] label')!
        const checkbox = label.querySelector<HTMLInputElement>('input')!
        expect(label.style.minHeight).toBe('var(--size-touch)')
        expect(checkbox.style.width).toBe('var(--space-12)')
        expect(checkbox.style.height).toBe('var(--space-12)')
    })
})
