// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const state = $state({ enabled: false, refused: true })
const alerts = vi.fn<(message: string) => void>()
const writes = vi.fn<(value: boolean) => void>((value) => { state.enabled = value })

vi.mock('src/lang', () => ({ language: {
    studioSwitchLabel: 'label-text',
    studioSwitchHelp: 'help-text',
    chatShellOnThisDevice: 'device-tag',
    chatShellFlipRefusedEditing: 'refusal-text',
} }))
vi.mock('src/ts/alert', () => ({ alertNormal: alerts }))
// The registry imports every custom setting component; only the toggle under test is real, so the
// registry loads without the rest of the application.
const otherCustomComponent = vi.hoisted(() => () => ({ default: () => { } }))
vi.mock('src/lib/Setting/Pages/SeparateParametersSection.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Advanced/CustomSidebarConfigButton.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/ColorSchemeSelect.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/CustomTextThemeEditor.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/NullableTextColorToggle.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/NotificationToggle.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/ChatShellPreviewToggle.svelte', otherCustomComponent)
vi.mock('src/lib/Setting/Pages/Display/SettingsShellPreviewToggle.svelte', otherCustomComponent)
vi.mock('src/ts/studio/studioSwitch.svelte', () => ({
    studioSwitch: state,
    setStudioEnabled: writes,
}))
vi.mock('src/ts/studio/studioFlip', () => ({
    studioFlipBlocker: () => state.refused ? { kind: 'draft', reasonKey: 'chatShellFlipRefusedEditing' } : null,
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
    const { default: StudioSwitchToggle } = await import('./StudioSwitchToggle.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(StudioSwitchToggle, { target })
    flushSync()
    return target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

describe('S0c studio switch registration', () => {
    test('the acc.studio row follows the Settings screen preview row and names the toggle and its label', async () => {
        const { accessibilitySettingsItems } = await import('src/ts/setting/accessibilitySettingsData')
        const ids = accessibilitySettingsItems.map((item) => item.id)
        const at = ids.indexOf('acc.studio')
        expect(at).toBeGreaterThan(-1)
        expect(at).toBe(ids.indexOf('acc.settingsShellPreview') + 1)
        const row = accessibilitySettingsItems[at]
        expect(row).toMatchObject({ type: 'custom', componentId: 'StudioSwitchToggle', labelKey: 'studioSwitchLabel' })
    })

    test('the custom component registry holds the real toggle under that id', async () => {
        const { customComponents } = await import('src/ts/setting/customComponents')
        const { default: StudioSwitchToggle } = await import('./StudioSwitchToggle.svelte')
        expect(customComponents['StudioSwitchToggle']).toBe(StudioSwitchToggle)
    })
})

describe('S0c studio switch row', () => {
    test('0e: a click on the off switch writes true and a click on the on switch writes false', async () => {
        state.refused = false
        const checkbox = await show()
        expect(checkbox.checked).toBe(false)
        checkbox.click()
        flushSync()
        expect(writes).toHaveBeenLastCalledWith(true)
        expect(checkbox.checked).toBe(true)
        checkbox.click()
        flushSync()
        expect(writes).toHaveBeenLastCalledWith(false)
        expect(checkbox.checked).toBe(false)
        expect(writes).toHaveBeenCalledTimes(2)
    })

    test('0e: the row shows the label, the on-this-device tag and the help', async () => {
        await show()
        expect(target.textContent).toContain('label-text')
        expect(target.textContent).toContain('device-tag')
        expect(target.textContent).toContain('help-text')
    })

    test('0f: an injected block prevents the flip, cancels the click and alerts its reason', async () => {
        const checkbox = await show()
        const refused = new MouseEvent('click', { bubbles: true, cancelable: true })
        checkbox.dispatchEvent(refused)
        flushSync()
        expect(refused.defaultPrevented).toBe(true)
        expect(checkbox.checked).toBe(false)
        expect(writes).not.toHaveBeenCalled()
        expect(alerts).toHaveBeenCalledExactlyOnceWith('refusal-text')
    })

    test('0f: with no block the click is not cancelled and nothing alerts', async () => {
        state.refused = false
        const checkbox = await show()
        const accepted = new MouseEvent('click', { bubbles: true, cancelable: true })
        checkbox.dispatchEvent(accepted)
        flushSync()
        expect(accepted.defaultPrevented).toBe(false)
        expect(alerts).not.toHaveBeenCalled()
    })
})
