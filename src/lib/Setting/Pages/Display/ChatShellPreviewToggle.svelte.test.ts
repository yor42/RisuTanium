// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const state = $state({ enabled: false, refused: true })
const alerts = vi.fn<(message: string) => void>()
const writes = vi.fn<(value: boolean) => void>((value) => { state.enabled = value })

vi.mock('src/lang', () => ({ language: {
    chatShellPreviewLabel: 'New chat screen (preview)',
    chatShellOnThisDevice: 'On this device',
    chatShellOnThisDeviceHelp: 'Other devices keep their own setting.',
    chatShellFlipRefusedEditing: 'Save or discard the message you are editing before switching the chat screen.',
    chatShellHaptics: 'Vibrate on swipe actions',
    chatShellHapticsUnavailable: 'This device cannot vibrate.',
    chatShellCustomizeButtons: 'Customize buttons',
} }))
vi.mock('src/ts/alert', () => ({ alertNormal: alerts }))
const sheetProps = vi.hoisted(() => ({ latest: null as { open: boolean } | null }))
vi.mock('src/lib/ChatShell/CustomizeButtonsSheet.svelte', () => ({ default: (_anchor: unknown, props: { open: boolean }) => { sheetProps.latest = props } }))
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({
    shellSwitch: state,
    setShellEnabled: writes,
}))
vi.mock('src/ts/chatShell/flipBlocker', () => ({
    shellFlipBlocker: () => state.refused ? { kind: 'editing', reasonKey: 'chatShellFlipRefusedEditing' } : null,
}))

let target: HTMLElement
let app: ReturnType<typeof mount>

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    state.enabled = false
    state.refused = true
    alerts.mockClear()
    writes.mockClear()
})

async function show(): Promise<HTMLInputElement> {
    const { default: ChatShellPreviewToggle } = await import('./ChatShellPreviewToggle.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShellPreviewToggle, { target })
    flushSync()
    return target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

describe('S0 preview toggle', () => {
    test('a refusal leaves the controlled checkbox unchanged and shows the reason', async () => {
        const checkbox = await show()
        expect(checkbox.checked).toBe(false)
        checkbox.click()
        flushSync()
        expect(checkbox.checked).toBe(false)
        expect(writes).not.toHaveBeenCalled()
        expect(alerts).toHaveBeenCalledWith('Save or discard the message you are editing before switching the chat screen.')
    })

    test('an idle click writes the new value', async () => {
        state.refused = false
        const checkbox = await show()
        checkbox.click()
        flushSync()
        expect(checkbox.checked).toBe(true)
        expect(writes).toHaveBeenCalledExactlyOnceWith(true)
        expect(target.textContent).toContain('On this device')
    })

    test('only a refused click is cancelled; an accepted click keeps the native toggle', async () => {
        const checkbox = await show()
        const refused = new MouseEvent('click', { bubbles: true, cancelable: true })
        checkbox.dispatchEvent(refused)
        flushSync()
        expect(refused.defaultPrevented).toBe(true)
        state.refused = false
        const accepted = new MouseEvent('click', { bubbles: true, cancelable: true })
        checkbox.dispatchEvent(accepted)
        flushSync()
        expect(accepted.defaultPrevented).toBe(false)
        expect(writes).toHaveBeenCalledExactlyOnceWith(true)
    })
})
describe('device-local chat settings', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
    afterEach(() => {
        sheetProps.latest = null
        localStorage.removeItem('risuChatShell.haptics')
        if (original) Object.defineProperty(navigator, 'vibrate', original)
        else Reflect.deleteProperty(navigator, 'vibrate')
    })
    function hapticsBox(): HTMLInputElement { return target.querySelector<HTMLInputElement>('[data-setting="haptics"]')! }
    test('the haptics switch is on by default where the device can vibrate, labelled for this device, and writes the device key', async () => {
        Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true })
        await show()
        expect(hapticsBox().checked).toBe(true)
        expect(hapticsBox().disabled).toBe(false)
        expect(target.querySelector('[data-part="chat-shell-device-settings"]')!.textContent).toContain('On this device')
        hapticsBox().click()
        flushSync()
        expect(localStorage.getItem('risuChatShell.haptics')).toBe('0')
        expect(hapticsBox().checked).toBe(false)
        hapticsBox().click()
        flushSync()
        expect(localStorage.getItem('risuChatShell.haptics')).toBe('1')
    })
    test('a stored off value is shown off when the page opens again', async () => {
        Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true })
        localStorage.setItem('risuChatShell.haptics', '0')
        await show()
        expect(hapticsBox().checked).toBe(false)
    })
    test('without vibration support the switch is disabled and says so', async () => {
        Reflect.deleteProperty(navigator, 'vibrate')
        await show()
        expect(hapticsBox().disabled).toBe(true)
        expect(target.textContent).toContain('This device cannot vibrate.')
    })
    test('the Customize buttons line opens the sheet', async () => {
        await show()
        expect(sheetProps.latest).toBeNull()
        target.querySelector<HTMLButtonElement>('[data-setting="customize-buttons"]')!.click()
        await vi.waitFor(() => expect(sheetProps.latest?.open).toBe(true))
        expect(target.textContent).toContain('Customize buttons')
    })
})