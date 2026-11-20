// @vitest-environment jsdom
/**
 * The pin checkbox of every customizable action is named through aria-label, equal to the label text beside it
 * (TalkBack speaks neither a wrapping label nor aria-labelledby on a checkbox). REAL: CustomizeButtonsSheet and the
 * sheet frame. MOCKED: the language table and the parser modules, as the sibling test does.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'

vi.mock('../../lang', () => ({ language: {
    chatShellCustomizeButtons: 'Customize buttons', chatShellOnThisDevice: 'On this device',
    chatShellMoveUp: 'Move up', chatShellMoveDown: 'Move down', chatShellRestoreDefaults: 'Restore defaults', cancel: 'Cancel',
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

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('CustomizeButtonsSheet form control names', () => {
    test('every pin checkbox carries aria-label equal to its visible label, and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(CustomizeButtonsSheet, { target, props: { open: true, onclose: vi.fn() } })
        flushSync()
        const boxes = [...target.querySelectorAll<HTMLInputElement>('[data-part="chat-customize-action"] input[type="checkbox"]')]
        expect(boxes.length).toBeGreaterThan(1)
        for (const box of boxes) {
            const visible = text(box.closest('label'))
            expect(visible).not.toBe('')
            expect(box.getAttribute('aria-label')).toBe(visible)
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(controlName(boxes[0])).toBe(text(boxes[0].closest('label')))
    })
})
