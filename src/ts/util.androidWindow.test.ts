// @vitest-environment node

/**
 * The native window commands (maximize, fullscreen) do not exist in the Tauri
 * mobile runtime and reject there, so under Tauri on a mobile OS no window
 * command may be issued from `changeFullscreen` and the Fullscreen setting is
 * hidden. Under Tauri on desktop the window is still driven.
 *
 * `appWindow` is computed when `./util` loads, so each case loads fresh modules.
 *
 * Tests whose title starts with `guard:` pass with or without the change: they
 * pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { SettingContext } from './setting/types'

const env = vi.hoisted(() => ({
    isTauri: true,
    db: { fullScreen: true } as { fullScreen: boolean },
    appWindow: {
        isFullscreen: vi.fn(async () => false),
        setFullscreen: vi.fn(async (_full: boolean) => {}),
    },
    getCurrentWebviewWindow: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: (...args: unknown[]) => env.getCurrentWebviewWindow(...args),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))

vi.mock(import('./platform'), () => ({
    get isTauri() { return env.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('./platform'))

vi.mock(import('./characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('./characters'))

vi.mock(import('./stores.svelte'), () => ({
    DBState: { db: env.db },
    selectedCharID: writable(-1),
    CustomGUISettingMenuStore: writable(null),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => env.db),
}) as unknown as typeof import('./storage/database.svelte'))

vi.mock('./gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('./gui/guisize', () => ({ guiSizeText: vi.fn(), updateGuisize: vi.fn() }))
vi.mock('./gui/colorscheme', () => ({ updateTextThemeAndCSS: vi.fn() }))

const ctx = { db: env.db } as unknown as SettingContext

async function load(mobile: boolean) {
    vi.stubGlobal('navigator', { userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 15; Pixel 6a)' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    vi.resetModules()
    const util = await import('./util')
    const data = await import('./setting/displaySettingsData.svelte')
    const { checkCondition } = await import('./setting/utils')
    const item = data.displayOtherSettingsItems.find(i => i.id === 'display.fullScreen')
    if (!item) throw new Error('display.fullScreen item is missing')
    return { util, visible: () => checkCondition(item, ctx) }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

beforeEach(() => {
    env.db.fullScreen = true
    env.appWindow.isFullscreen.mockReset().mockResolvedValue(false)
    env.appWindow.setFullscreen.mockReset().mockResolvedValue(undefined)
    env.getCurrentWebviewWindow.mockReset().mockImplementation(() => env.appWindow)
})

describe('Tauri on a mobile OS has no window to drive', () => {
    test('changeFullscreen issues no window command', async () => {
        const { util } = await load(true)
        await expect(util.changeFullscreen()).resolves.toBeUndefined()
        expect(env.appWindow.isFullscreen).not.toHaveBeenCalled()
        expect(env.appWindow.setFullscreen).not.toHaveBeenCalled()
    })

    test('the Fullscreen setting is hidden', async () => {
        const { visible } = await load(true)
        expect(visible()).toBe(false)
    })
})

describe('guard: Tauri on desktop drives the window', () => {
    test('guard: changeFullscreen enters fullscreen and the setting is shown', async () => {
        const { util, visible } = await load(false)
        await util.changeFullscreen()
        expect(env.appWindow.setFullscreen).toHaveBeenCalledExactlyOnceWith(true)
        expect(visible()).toBe(true)
    })
})
