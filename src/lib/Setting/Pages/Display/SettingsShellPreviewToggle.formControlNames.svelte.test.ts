// @vitest-environment jsdom
/**
 * The Settings-screen preview checkbox is named through aria-label equal to its visible text.
 * REAL: SettingsShellPreviewToggle. MOCKED: the language table and the switch store.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { unnamedControls } from '../../../a11yNames.test-helpers'

vi.mock('src/lang', () => ({ language: { settingsShellPreviewLabel: 'New Settings screen (preview)', chatShellOnThisDevice: 'On this device', settingsShellNextOpenHelp: 'Applies on the next open.' } }))
vi.mock('src/ts/settingsShell/settingsShellSwitch.svelte', () => ({ settingsShellSwitch: { enabled: false }, setSettingsShellEnabled: vi.fn() }))

import SettingsShellPreviewToggle from './SettingsShellPreviewToggle.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

describe('SettingsShellPreviewToggle form control names', () => {
    test('the checkbox carries aria-label equal to its visible text and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(SettingsShellPreviewToggle, { target })
        flushSync()
        const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(box.getAttribute('aria-label')).toBe('New Settings screen (preview)')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
