// @vitest-environment jsdom
/**
 * The preview and haptics checkboxes are named through aria-label equal to the visible text beside them.
 * REAL: ChatShellPreviewToggle. MOCKED: the language table, the switch store, the flip blocker, the haptics module
 * (supported, so the haptics row renders) and the customize sheet.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { controlName, unnamedControls } from '../../../a11yNames.test-helpers'

vi.mock('src/lang', () => ({ language: {
    chatShellPreviewLabel: 'New chat screen (preview)',
    chatShellOnThisDevice: 'On this device',
    chatShellOnThisDeviceHelp: 'Other devices keep their own setting.',
    chatShellHaptics: 'Vibrate on swipe actions',
    chatShellCustomizeButtons: 'Customize buttons',
} }))
vi.mock('src/ts/alert', () => ({ alertNormal: vi.fn() }))
vi.mock('src/lib/ChatShell/CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellSwitch: { enabled: false }, setShellEnabled: vi.fn() }))
vi.mock('src/ts/chatShell/flipBlocker', () => ({ shellFlipBlocker: () => null }))
vi.mock('src/ts/chatShell/haptics', () => ({ hapticsSupported: () => true, readHaptics: () => false, writeHaptics: vi.fn() }))

import ChatShellPreviewToggle from './ChatShellPreviewToggle.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

describe('ChatShellPreviewToggle form control names', () => {
    test('both checkboxes carry aria-label equal to their visible text and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ChatShellPreviewToggle, { target })
        flushSync()
        const boxes = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(['New chat screen (preview)', 'Vibrate on swipe actions'])
        expect(boxes.every((box) => !box.hasAttribute('aria-labelledby'))).toBe(true)
        expect(controlName(boxes[1])).toBe('Vibrate on swipe actions')
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
