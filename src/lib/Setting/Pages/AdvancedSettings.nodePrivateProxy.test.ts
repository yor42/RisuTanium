// @vitest-environment happy-dom

/**
 * The Advanced settings page warns, on a Node server only, that the server's
 * proxy can reach the local network. Mounts the REAL page; the warning follows
 * the answer of `nodeServerPrivateProxyEnabled`, and a web or desktop build
 * never asks.
 *
 * MOCKED: `platform` (the build kind), `nodeStorage` (the capability read),
 * `SettingRenderer.svelte` and the settings item list (the page's other content).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    isNodeServer: true,
    enabled: vi.fn(async () => true),
}))

vi.mock(import('src/ts/platform'), () => ({
    get isNodeServer() {
        return h.isNodeServer
    },
    isTauri: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeStorage'), () => ({
    nodeServerPrivateProxyEnabled: h.enabled,
}) as unknown as typeof import('src/ts/storage/nodeStorage'))

vi.mock(import('../SettingRenderer.svelte'), () => ({
    default: () => undefined,
}) as unknown as typeof import('../SettingRenderer.svelte'))

vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({
    advancedSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/advancedSettingsData'))

import AdvancedSettings from './AdvancedSettings.svelte'

let mounted: ReturnType<typeof mount> | undefined

async function render(): Promise<string> {
    mounted = mount(AdvancedSettings, { target: document.body })
    for (let turn = 0; turn < 5; turn++) {
        await Promise.resolve()
        flushSync()
    }
    return document.body.textContent ?? ''
}

beforeEach(() => {
    h.isNodeServer = true
    h.enabled.mockReset()
    h.enabled.mockResolvedValue(true)
})

afterEach(() => {
    if (mounted !== undefined) {
        unmount(mounted)
        mounted = undefined
    }
    document.body.innerHTML = ''
})

describe('the private-network proxy warning', () => {
    test('S4b-T8 is shown on a Node server whose proxy reaches the local network', async () => {
        const text = await render()
        expect(language.nodePrivateProxyWarning).toContain('RISU_PROXY_ALLOW_PRIVATE')
        expect(text).toContain(language.nodePrivateProxyWarning)
    })

    test('S4b-T8 is absent when the server says the proxy does not', async () => {
        h.enabled.mockResolvedValue(false)
        const text = await render()
        expect(h.enabled).toHaveBeenCalledTimes(1)
        expect(text).not.toContain(language.nodePrivateProxyWarning)
    })

    test('S4b-T8 is absent, and never asked for, outside a Node server', async () => {
        h.isNodeServer = false
        const text = await render()
        expect(h.enabled).not.toHaveBeenCalled()
        expect(text).not.toContain(language.nodePrivateProxyWarning)
    })
})
