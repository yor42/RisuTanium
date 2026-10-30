// @vitest-environment happy-dom

/**
 * The Advanced settings page offers the device-local "Allow private network for plugins, cards and
 * MCP" toggle on Tauri builds only: enabling it needs the warning accepted, disabling never asks, and a
 * declined warning leaves it off and stores nothing.
 *
 * Mounts the REAL page. MOCKED: `platform` (the build kind), `nodeStorage`, `alert`, the toggle store,
 * `SettingRenderer.svelte` and the settings item list (the page's other content).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    isTauri: true,
    stored: false,
    confirm: vi.fn(async (_msg: string) => true),
    error: vi.fn((_msg: string) => undefined),
    get: vi.fn(async () => false),
    set: vi.fn(async (_value: boolean) => ({ persisted: true })),
}))

vi.mock(import('src/ts/platform'), () => ({
    isNodeServer: false,
    get isTauri() {
        return h.isTauri
    },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeStorage'), () => ({
    nodeServerPrivateProxyEnabled: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/storage/nodeStorage'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: h.confirm,
    alertError: h.error,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/network/privateNetworkConsent'), () => ({
    getAllowPrivate: h.get,
    setAllowPrivate: h.set,
}) as unknown as typeof import('src/ts/network/privateNetworkConsent'))

vi.mock(import('../SettingRenderer.svelte'), () => ({
    default: () => undefined,
}) as unknown as typeof import('../SettingRenderer.svelte'))

vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({
    advancedSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/advancedSettingsData'))

import AdvancedSettings from './AdvancedSettings.svelte'

let mounted: ReturnType<typeof mount> | undefined

async function turns() {
    // The page loads its alert and store modules on demand, so a macrotask turn is needed per hop.
    for (let turn = 0; turn < 5; turn++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        flushSync()
    }
}

async function render(): Promise<string> {
    mounted = mount(AdvancedSettings, { target: document.body })
    await turns()
    return document.body.textContent ?? ''
}

function checkbox(): HTMLInputElement {
    return document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
}

async function toggle(checked: boolean) {
    const box = checkbox()
    box.checked = checked
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await turns()
}

beforeEach(() => {
    h.isTauri = true
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
    h.get.mockReset()
    h.get.mockResolvedValue(false)
    h.set.mockReset()
    h.set.mockResolvedValue({ persisted: true })
    h.error.mockReset()
})

afterEach(() => {
    if (mounted !== undefined) {
        unmount(mounted)
        mounted = undefined
    }
    document.body.innerHTML = ''
})

describe('the private-network toggle for plugins, cards and MCP', () => {
    test('is offered on Tauri with its label and help, off by default', async () => {
        const text = await render()
        expect(text).toContain('Allow private network for plugins, cards and MCP')
        expect(text).toContain(language.allowPrivateNetworkNativeHelp)
        expect(checkbox().checked).toBe(false)
    })

    test('is absent, and its store never read, outside Tauri', async () => {
        h.isTauri = false
        const text = await render()
        expect(text).not.toContain(language.allowPrivateNetworkNative)
        expect(checkbox()).toBeNull()
        expect(h.get).not.toHaveBeenCalled()
    })

    test('shows the stored choice', async () => {
        h.get.mockResolvedValue(true)
        await render()
        expect(checkbox().checked).toBe(true)
    })

    test('enabling asks with the warning and stores true when accepted', async () => {
        await render()
        await toggle(true)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(h.confirm).toHaveBeenCalledWith(language.allowPrivateNetworkNativeWarning)
        expect(h.set).toHaveBeenCalledWith(true)
        expect(checkbox().checked).toBe(true)
    })

    test('a declined warning leaves it off and stores nothing', async () => {
        h.confirm.mockResolvedValue(false)
        await render()
        await toggle(true)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(h.set).not.toHaveBeenCalled()
        expect(checkbox().checked).toBe(false)
    })

    test('disabling never asks and stores false', async () => {
        h.get.mockResolvedValue(true)
        await render()
        await toggle(false)
        expect(h.confirm).not.toHaveBeenCalled()
        expect(h.set).toHaveBeenCalledWith(false)
    })

    test('a failed write shows the notice and the checkbox returns to the stored off state', async () => {
        await render()
        // The write failed: the stored value re-reads as off.
        h.set.mockResolvedValue({ persisted: false })
        h.get.mockResolvedValue(false)
        await toggle(true)
        expect(h.error).toHaveBeenCalledWith(language.allowPrivateNetworkNativeNotSaved)
        expect(checkbox().checked).toBe(false)
    })

    test('an unreadable store shows the notice and keeps the session choice on', async () => {
        await render()
        // The store is unreadable: the choice is held in memory, so the effective value re-reads as on.
        h.set.mockResolvedValue({ persisted: false })
        h.get.mockResolvedValue(true)
        await toggle(true)
        expect(h.error).toHaveBeenCalledWith(language.allowPrivateNetworkNativeNotSaved)
        expect(checkbox().checked).toBe(true)
    })

    test('a persisted choice shows no notice', async () => {
        await render()
        await toggle(true)
        expect(h.error).not.toHaveBeenCalled()
    })

    test('guard: the warning names who gains access and what they reach', () => {
        const warning = language.allowPrivateNetworkNativeWarning.toLowerCase()
        expect(warning).toContain('local network')
        expect(warning).toContain('plugins')
        expect(warning).toContain('cards')
        expect(warning).toContain('mcp')
    })
})
