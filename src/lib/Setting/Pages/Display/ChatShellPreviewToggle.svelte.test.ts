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
} }))
vi.mock('src/ts/alert', () => ({ alertNormal: alerts }))
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
})
