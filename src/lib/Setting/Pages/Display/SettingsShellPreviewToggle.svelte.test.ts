// @vitest-environment jsdom

/**
 * The device switch row for the new Settings screen (T16), rendered the way the Accessibility page renders it:
 * through the setting renderer from `accessibilitySettingsItems`. A guard for new behaviour (G-new).
 *
 * MOCKED: `stores.svelte` and `lite` (plain stores) and the model catalogue lookup. The renderer, the item
 * registry, the toggle and the switch module are real. Only the two chat-screen and Settings-screen preview
 * rows are passed to the renderer, so the other Accessibility rows need no database fixture.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/lite', () => ({ isLite: writable(false) }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({}) }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { accessibilitySettingsItems } from 'src/ts/setting/accessibilitySettingsData'
import { setSettingsShellEnabled, settingsShellSwitch } from 'src/ts/settingsShell/settingsShellSwitch.svelte'
import SettingRenderer from '../../SettingRenderer.svelte'

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

function show(): HTMLInputElement {
    const rows = accessibilitySettingsItems.filter((item) => item.id === 'acc.settingsShellPreview')
    target = document.createElement('div')
    document.body.append(target)
    app = mount(SettingRenderer, { target, props: { items: rows } })
    flushSync()
    return target.querySelector<HTMLInputElement>('[data-setting="settings-shell-preview"]')!
}

beforeEach(() => {
    localStorage.clear()
    DBState.db = {} as unknown as Database
    setSettingsShellEnabled(false)
    flushSync()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = null
    target?.remove()
    setSettingsShellEnabled(false)
})

describe('T16 the Settings screen preview row', () => {
    test('the row sits after the chat screen preview row in the Accessibility items', () => {
        const ids = accessibilitySettingsItems.map((item) => item.id)
        expect(ids.indexOf('acc.settingsShellPreview')).toBe(ids.indexOf('acc.chatShellPreview') + 1)
    })

    test('it is off by default, says it is for this device and takes effect next time, and a click stores 1 only for this switch', () => {
        const checkbox = show()
        expect(checkbox.checked).toBe(false)
        expect(target.textContent).toContain(language.settingsShellPreviewLabel)
        expect(target.textContent).toContain(language.chatShellOnThisDevice)
        expect(target.textContent).toContain(language.settingsShellNextOpenHelp)
        checkbox.click()
        flushSync()
        expect(localStorage.getItem('risuSettings.enabled')).toBe('1')
        expect(localStorage.getItem('risuChatShell.enabled')).toBeNull()
        expect(settingsShellSwitch.enabled).toBe(true)
        expect(checkbox.checked).toBe(true)
        checkbox.click()
        flushSync()
        expect(localStorage.getItem('risuSettings.enabled')).toBe('0')
    })

    test('a stored 1 shows the row on', () => {
        setSettingsShellEnabled(true)
        flushSync()
        expect(show().checked).toBe(true)
    })
})
