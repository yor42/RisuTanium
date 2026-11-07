// @vitest-environment jsdom

/**
 * Which Settings screen the surface mounts (T11): the shell only when the device switch is on and the build is
 * neither the Beta Mobile GUI nor Lite, latched for the whole open. A guard for new behaviour (G-new).
 *
 * MOCKED: `stores.svelte` and `lite` (plain writable stores), and both screens, which are counting stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mounts = vi.hoisted(() => ({ shell: 0, legacy: 0 }))

vi.mock(import('../../ts/stores.svelte'), () => ({
    MobileGUI: writable(false),
    SettingsMenuIndex: writable(-1),
    settingsOpen: writable(true),
}) as unknown as typeof import('../../ts/stores.svelte'))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('./SettingsShell.svelte', () => ({ default: () => { mounts.shell++ } }))
vi.mock('../Setting/Settings.svelte', () => ({ default: () => { mounts.legacy++ } }))

import { isLite } from '../../ts/lite'
import { MobileGUI, settingsOpen } from '../../ts/stores.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import SettingsSurface from './SettingsSurface.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(): ReturnType<typeof mount> {
    const target = document.createElement('div')
    document.body.append(target)
    const component = mount(SettingsSurface, { target })
    mounted.push(component)
    flushSync()
    return component
}

beforeEach(() => {
    localStorage.clear()
    mounts.shell = 0
    mounts.legacy = 0
    MobileGUI.set(false)
    isLite.set(false)
    settingsOpen.set(true)
    setSettingsShellEnabled(false)
    flushSync()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    setSettingsShellEnabled(false)
})

describe('T11 surface latch', () => {
    test('the switch off shows the legacy screen', () => {
        show()
        expect(mounts).toEqual({ shell: 0, legacy: 1 })
    })

    test('the switch on shows the shell; flipping it off while open changes nothing; the next open is legacy', () => {
        setSettingsShellEnabled(true)
        flushSync()
        const first = show()
        expect(mounts).toEqual({ shell: 1, legacy: 0 })
        setSettingsShellEnabled(false)
        flushSync()
        expect(mounts).toEqual({ shell: 1, legacy: 0 })
        unmount(first)
        mounted.splice(mounted.indexOf(first), 1)
        show()
        expect(mounts).toEqual({ shell: 1, legacy: 1 })
    })

    test('the Beta Mobile GUI and Lite keep the legacy screen with the switch on', () => {
        setSettingsShellEnabled(true)
        flushSync()
        MobileGUI.set(true)
        show()
        expect(mounts).toEqual({ shell: 0, legacy: 1 })
        MobileGUI.set(false)
        isLite.set(true)
        show()
        expect(mounts).toEqual({ shell: 0, legacy: 2 })
    })
})
