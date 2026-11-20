// @vitest-environment jsdom
/**
 * The Studio switch checkbox is named through aria-label equal to its visible text.
 * REAL: StudioSwitchToggle. MOCKED: the language table, the switch store and the flip blocker.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { unnamedControls } from '../../../a11yNames.test-helpers'

vi.mock('src/lang', () => ({ language: { studioSwitchLabel: 'label-text', studioSwitchHelp: 'help-text', chatShellOnThisDevice: 'device-tag' } }))
vi.mock('src/ts/alert', () => ({ alertNormal: vi.fn() }))
vi.mock('src/ts/studio/studioSwitch.svelte', () => ({ studioSwitch: { enabled: false }, setStudioEnabled: vi.fn() }))
vi.mock('src/ts/studio/studioFlip', () => ({ studioFlipBlocker: () => null }))

import StudioSwitchToggle from './StudioSwitchToggle.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

describe('StudioSwitchToggle form control names', () => {
    test('the checkbox carries aria-label equal to its visible text and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(StudioSwitchToggle, { target })
        flushSync()
        const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(box.getAttribute('aria-label')).toBe('label-text')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
