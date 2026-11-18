// @vitest-environment happy-dom

/**
 * The wrapper on Tauri with the real `SourceDisclosure` and real Svelte event delegation, against a transcription of
 * the Tauri shell plugin's injected body click listener (the "stand-in"). The component's own `activate` prevents the
 * default and calls `openURL`; the router must leave such a click to the component (one open) and the stand-in must
 * never act. The component is mounted both under a wrapper div under body and directly on body, because delegated
 * handlers live on each mount target and on `document`.
 *
 * `window.open` is stubbed and navigation is switched off, because happy-dom runs anchor activation inside
 * `dispatchEvent` and reads the shield as an empty target. Clicks are dispatched on the anchor element itself.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'

vi.mock(import('src/ts/platform'), async (importOriginal) => ({
    ...(await importOriginal()),
    isTauri: true,
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import SourceDisclosure, { type Destination } from './SourceDisclosure.svelte'
import { openURL } from 'src/ts/globalApi.svelte'
import { installTauriLinkRouter } from 'src/ts/tauriLinkRouter'

const SHELL_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:']
const REPO_URL = 'https://github.com/yor42/RisuTanium'

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

let shellInvoke: Mock<(cmd: string, args: { path: string }) => void>
let reached = 0
let acted = 0
const mountedInstances: unknown[] = []

function shellListener(event: Event): void {
    reached++
    let node = event.target as Element | null
    while (node) {
        if (node.matches('a')) {
            const anchor = node as HTMLAnchorElement
            if (anchor.href !== '' && SHELL_PREFIXES.some((prefix) => anchor.href.startsWith(prefix)) && anchor.target === '_blank') {
                shellInvoke('plugin:shell|open', { path: anchor.href })
                event.preventDefault()
                acted++
            }
            break
        }
        node = node.parentElement
    }
}

function mountDisclosure(target: HTMLElement, destinations?: Destination[]): void {
    mountedInstances.push(mount(SourceDisclosure, {
        target,
        props: {
            title: 'Source & Issues',
            description: 'Browse the source code or file an issue on GitHub.',
            cardClass: 'card',
            triggerClass: 'trigger',
            iconClass: 'icon',
            ...(destinations ? { destinations } : {}),
        },
    }))
    flushSync()
    ;(target.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    // Opening the list is not a link click; only the link click below is counted.
    reached = 0
}

function clickAnchor(anchor: Element): void {
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    flushSync()
}

beforeAll(() => {
    installTauriLinkRouter()
})

beforeEach(() => {
    shellInvoke = vi.fn()
    reached = 0
    acted = 0
    vi.spyOn(window, 'open').mockReturnValue(null)
    setNavigationDisabled(true)
    // After the router and after the mount: the real ordering of the shell's boot-time listener is not relied on.
    document.body.addEventListener('click', shellListener)
})

afterEach(async () => {
    document.body.removeEventListener('click', shellListener)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    document.body.replaceChildren()
    setNavigationDisabled(false)
    vi.restoreAllMocks()
    vi.mocked(openURL).mockClear()
})

describe('installTauriLinkRouter on Tauri', () => {
    test('the wrapper routes a plain _blank link through openURL', () => {
        const anchor = document.createElement('a')
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
        anchor.setAttribute('href', 'https://x.invalid/a')
        document.body.appendChild(anchor)
        clickAnchor(anchor)
        expect(openURL).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledWith('https://x.invalid/a')
        expect(acted).toBe(0)
        expect(shellInvoke).not.toHaveBeenCalled()
    })
})

describe('the real Source & Issues link on Tauri', () => {
    test('a disclosure under a wrapper div opens the link once and the stand-in never acts', () => {
        const wrapper = document.createElement('div')
        document.body.appendChild(wrapper)
        mountDisclosure(wrapper)
        const anchor = wrapper.querySelector(`a[href="${REPO_URL}"]`) as HTMLAnchorElement
        clickAnchor(anchor)
        expect(openURL).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledWith(REPO_URL)
        expect(acted).toBe(0)
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(reached).toBe(1)
    })

    test('a disclosure mounted on document.body opens the link once and the stand-in never acts', () => {
        mountDisclosure(document.body)
        const anchor = document.body.querySelector(`a[href="${REPO_URL}"]`) as HTMLAnchorElement
        clickAnchor(anchor)
        expect(openURL).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledWith(REPO_URL)
        expect(acted).toBe(0)
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(reached).toBe(1)
    })

    test('the Email link opens once through the component and the shell stand-in has no target to act on', () => {
        const wrapper = document.createElement('div')
        document.body.appendChild(wrapper)
        mountDisclosure(wrapper, [
            { label: 'Contact the maintainer', href: 'mailto:someone@x.invalid', upstream: false },
        ])
        const anchor = wrapper.querySelector('a[href^="mailto:"]') as HTMLAnchorElement
        clickAnchor(anchor)
        expect(openURL).toHaveBeenCalledTimes(1)
        expect(openURL).toHaveBeenCalledWith('mailto:someone@x.invalid')
        expect(acted).toBe(0)
        expect(reached).toBe(1)
    })
})
