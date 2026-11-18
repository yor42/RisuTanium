// @vitest-environment happy-dom

/**
 * The wrapper installs nothing off Tauri: no click listener and no shield, so a `_blank` link behaves exactly as it did
 * before the router existed. `window.open` is stubbed and the probe prevents the default itself, because happy-dom runs
 * anchor activation inside `dispatchEvent`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { installTauriLinkRouter } from './tauriLinkRouter'
import { openURL } from 'src/ts/globalApi.svelte'

interface NavigationSettings {
    disableMainFrameNavigation: boolean
    disableChildFrameNavigation: boolean
    disableChildPageNavigation: boolean
    disableFallbackToSetURL: boolean
}

function setNavigationDisabled(disabled: boolean): void {
    const navigation = (window as unknown as { happyDOM: { settings: { navigation: NavigationSettings } } }).happyDOM.settings.navigation
    navigation.disableMainFrameNavigation = disabled
    navigation.disableChildFrameNavigation = disabled
    navigation.disableChildPageNavigation = disabled
    navigation.disableFallbackToSetURL = disabled
}

afterEach(() => {
    setNavigationDisabled(false)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('installTauriLinkRouter off Tauri', () => {
    test('on the web nothing is installed', () => {
        vi.spyOn(window, 'open').mockReturnValue(null)
        setNavigationDisabled(true)
        const addListener = vi.spyOn(window, 'addEventListener')
        installTauriLinkRouter()
        const clickRegistrations = addListener.mock.calls.filter(([type]) => type === 'click')

        const anchor = document.createElement('a')
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('href', 'https://x.invalid/a')
        document.body.appendChild(anchor)
        const seen = { prevented: true, ownTarget: true }
        const probe = (event: Event) => {
            seen.prevented = event.defaultPrevented
            seen.ownTarget = Object.prototype.hasOwnProperty.call(anchor, 'target')
            event.preventDefault()
        }
        window.addEventListener('click', probe)
        anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        window.removeEventListener('click', probe)

        expect(openURL).not.toHaveBeenCalled()
        expect(seen.prevented).toBe(false)
        expect(seen.ownTarget).toBe(false)
        expect(clickRegistrations).toHaveLength(0)
    })
})
