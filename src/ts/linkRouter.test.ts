// @vitest-environment happy-dom

/**
 * Behaviour of the pure link-router core against a transcription of the Tauri shell plugin's injected body click
 * listener (the "stand-in"). The stand-in is the producer of the defect: it invokes `plugin:shell|open` and prevents the
 * default for every `_blank` anchor whose resolved href starts with a routed prefix, whatever any other listener did.
 *
 * Every dispatched click is cancelable and `window.open` is stubbed, because happy-dom runs anchor activation inside
 * `dispatchEvent`. The probe is a window bubble listener registered after the router; it records what the router left
 * behind and then prevents the default itself, so no assertion depends on native activation.
 *
 * Declared gaps: the rule that the shield is never released from a microtask needs a native dispatch with a microtask
 * checkpoint between listeners, and the guarded `defineProperty` of the shield cannot be reached without fault
 * injection. Both are held by code review and by the device checks.
 */

import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { installLinkRouter } from './linkRouter'

const SHELL_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:']
const PAGE_URL = 'http://localhost:3000/'

interface Probe {
    ran: boolean
    prevented: boolean
    ownTarget: boolean
}

interface NavigationSettings {
    disableMainFrameNavigation: boolean
    disableChildFrameNavigation: boolean
    disableChildPageNavigation: boolean
    disableFallbackToSetURL: boolean
}

interface HappyDomWindow {
    happyDOM: { setURL(url: string): void; settings: { navigation: NavigationSettings } }
}

/**
 * happy-dom activates an anchor inside `dispatchEvent` with `anchor.target || '_self'`, which reads the shield as an
 * empty target and would navigate the page itself before the router's bubble listener runs. A real browser activates
 * after the dispatch, so navigation is switched off for the harness.
 */
function setNavigationDisabled(disabled: boolean): void {
    const navigation = (window as unknown as HappyDomWindow).happyDOM.settings.navigation
    navigation.disableMainFrameNavigation = disabled
    navigation.disableChildFrameNavigation = disabled
    navigation.disableChildPageNavigation = disabled
    navigation.disableFallbackToSetURL = disabled
}

let shellInvoke: Mock<(cmd: string, args: { path: string }) => void>
let reached = 0
let acted = 0
let probe: Probe
let errorCount = 0
let warn: ReturnType<typeof vi.spyOn>
let cleanups: Array<() => void> = []

function hasOwnTarget(anchor: Element): boolean {
    return Object.prototype.hasOwnProperty.call(anchor, 'target')
}

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

function attachShell(): void {
    document.body.addEventListener('click', shellListener)
    cleanups.push(() => document.body.removeEventListener('click', shellListener))
}

function probeListener(event: Event): void {
    const anchor = (event.target as Element).closest('a')
    probe = {
        ran: true,
        prevented: event.defaultPrevented,
        ownTarget: anchor ? hasOwnTarget(anchor) : false,
    }
    event.preventDefault()
}

function onError(): void {
    errorCount++
}

/** Installs the router and the stand-in in the requested order; the probe always comes after the router. */
function setup(shell: 'before' | 'after' = 'after', open = vi.fn<(url: string) => void>()) {
    if (shell === 'before') {
        attachShell()
    }
    const uninstall = installLinkRouter(open)
    cleanups.push(uninstall)
    if (shell === 'after') {
        attachShell()
    }
    window.addEventListener('click', probeListener)
    cleanups.push(() => window.removeEventListener('click', probeListener))
    return open
}

function host(): HTMLElement {
    const div = document.createElement('div')
    document.body.appendChild(div)
    return div
}

const PARSER_ATTRS = { target: '_blank', rel: 'noopener noreferrer' }

function makeAnchor(href: string, attributes: Record<string, string> = PARSER_ATTRS, parent: HTMLElement = host()): HTMLAnchorElement {
    const anchor = document.createElement('a')
    for (const [name, value] of Object.entries(attributes)) {
        anchor.setAttribute(name, value)
    }
    anchor.setAttribute('href', href)
    parent.appendChild(anchor)
    return anchor
}

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
    probe = { ran: false, prevented: false, ownTarget: false }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    element.dispatchEvent(event)
    return event
}

beforeEach(() => {
    shellInvoke = vi.fn()
    reached = 0
    acted = 0
    errorCount = 0
    probe = { ran: false, prevented: false, ownTarget: false }
    cleanups = []
    vi.spyOn(window, 'open').mockReturnValue(null)
    setNavigationDisabled(true)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.addEventListener('error', onError)
})

afterEach(() => {
    for (const cleanup of cleanups.reverse()) {
        cleanup()
    }
    window.removeEventListener('error', onError)
    document.body.innerHTML = ''
    setNavigationDisabled(false)
    ;(window as unknown as HappyDomWindow).happyDOM.setURL(PAGE_URL)
    vi.restoreAllMocks()
})

describe('routed clicks', () => {
    test.each(['before', 'after'] as const)('a plain click on a _blank https link opens once through the router and the shell stand-in never acts (stand-in installed %s the router)', (order) => {
        const open = setup(order)
        const a = makeAnchor('https://x.invalid/a')
        click(a)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('https://x.invalid/a')
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(reached).toBe(1)
        expect(probe.prevented).toBe(true)
    })

    test('an app handler that prevents and opens is not opened again', () => {
        const open = setup()
        const appOpen = vi.fn<(url: string) => void>()
        const container = host()
        container.addEventListener('click', (event) => {
            event.preventDefault()
            appOpen('https://x.invalid/a')
        })
        const a = makeAnchor('https://x.invalid/a', PARSER_ATTRS, container)
        click(a)
        expect(appOpen).toHaveBeenCalledTimes(1)
        expect(open).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(hasOwnTarget(a)).toBe(false)
    })

    test.each([
        ['ctrlKey'],
        ['metaKey'],
        ['shiftKey'],
        ['altKey'],
    ] as const)('modified clicks are routed like plain clicks (%s)', (modifier) => {
        const open = setup()
        const a = makeAnchor('https://x.invalid/a')
        click(a, { [modifier]: true })
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('https://x.invalid/a')
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(reached).toBe(1)
        expect(probe.prevented).toBe(true)
    })

    test('a keyboard-style click (detail 0) is routed', () => {
        const open = setup()
        const a = makeAnchor('https://x.invalid/a')
        click(a, { detail: 0 })
        expect(open).toHaveBeenCalledTimes(1)
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(reached).toBe(1)
        expect(probe.prevented).toBe(true)
    })

    test('a click on an element nested in the anchor routes the anchor', () => {
        const open = setup()
        const container = host()
        container.innerHTML = '<a target="_blank" rel="nofollow noopener noreferrer" href="https://x.invalid/p"><span class="label">x</span><svg><path d="M0 0"/></svg></a>'
        const span = container.querySelector('span') as Element
        const path = container.querySelector('path') as Element
        click(path)
        click(span)
        expect(open).toHaveBeenCalledTimes(2)
        expect(open).toHaveBeenNthCalledWith(1, 'https://x.invalid/p')
        expect(open).toHaveBeenNthCalledWith(2, 'https://x.invalid/p')
        expect(acted).toBe(0)
    })

    test('an uppercase-scheme href is routed with the resolved URL', () => {
        const open = setup()
        const a = makeAnchor('HTTPS://x.invalid/a')
        click(a)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('https://x.invalid/a')
        expect(acted).toBe(0)
    })

    test('a mailto link on an opaque-origin page (tauri://localhost) is routed, not swallowed as same-origin', () => {
        const open = setup()
        ;(window as unknown as HappyDomWindow).happyDOM.setURL('tauri://localhost/')
        const a = makeAnchor('mailto:someone@x.invalid')
        click(a)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('mailto:someone@x.invalid')
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(probe.prevented).toBe(true)
    })
})

describe('clicks the router leaves alone', () => {
    test.each([
        ['no target', {}],
        ['_self', { target: '_self' }],
        ['_BLANK', { target: '_BLANK' }],
    ] as const)('non-_blank anchors are untouched (%s)', (_name, attributes) => {
        const open = setup()
        const a = makeAnchor('https://x.invalid/a', attributes)
        click(a)
        expect(probe.ran).toBe(true)
        expect(probe.prevented).toBe(false)
        expect(probe.ownTarget).toBe(false)
        expect(open).not.toHaveBeenCalled()
        expect(acted).toBe(0)
    })

    test.each([
        ['javascript:void 0'],
        ['file:///x'],
        ['ftp://x.invalid/'],
        ['data:text/plain,x'],
        ['intent://x#Intent;end'],
    ])('_blank anchors with another scheme are untouched (%s)', (href) => {
        const open = setup()
        const a = makeAnchor(href)
        click(a)
        expect(probe.ran).toBe(true)
        expect(probe.prevented).toBe(false)
        expect(probe.ownTarget).toBe(false)
        expect(open).not.toHaveBeenCalled()
        expect(acted).toBe(0)
    })

    test('document-level listeners still receive routed clicks', () => {
        const open = setup()
        const seen = vi.fn()
        document.addEventListener('click', seen)
        cleanups.push(() => document.removeEventListener('click', seen))
        const a = makeAnchor('https://x.invalid/a')
        click(a)
        expect(open).toHaveBeenCalledTimes(1)
        expect(seen).toHaveBeenCalledTimes(1)
    })
})

describe('swallowed and failed-closed links', () => {
    test.each([
        [''],
        ['/x'],
        [`${PAGE_URL}y`],
    ])('same-origin and empty-href _blank links are swallowed (%j)', (href) => {
        const open = setup()
        const a = makeAnchor(href, { target: '_blank', rel: 'noreferrer' })
        click(a)
        expect(open).not.toHaveBeenCalled()
        expect(probe.prevented).toBe(true)
        expect(acted).toBe(0)
        expect(warn).not.toHaveBeenCalled()
        expect(hasOwnTarget(a)).toBe(false)
    })

    test.each([
        ['https://a b/'],
        ['http://x.invalid:99999/'],
        ['http://['],
    ])('a routed-prefix href that does not parse fails closed without throwing (%j)', (href) => {
        const open = setup()
        const a = makeAnchor(href, { target: '_blank', rel: 'noreferrer' })
        expect(a.href).toBe(href)
        click(a)
        expect(errorCount).toBe(0)
        expect(probe.prevented).toBe(true)
        expect(open).not.toHaveBeenCalled()
        expect(acted).toBe(0)
        expect(reached).toBe(1)
        expect(warn).not.toHaveBeenCalled()
        expect(hasOwnTarget(a)).toBe(false)
    })
})

describe('the target shield', () => {
    test('the shield is present during the dispatch and removed by the end of it', () => {
        const open = setup()
        const seen: Array<{ target: string; attribute: string | null }> = []
        const a = makeAnchor('https://x.invalid/a')
        const during = () => seen.push({ target: a.target, attribute: a.getAttribute('target') })
        document.body.addEventListener('click', during)
        cleanups.push(() => document.body.removeEventListener('click', during))
        click(a)
        expect(seen).toEqual([{ target: '', attribute: '_blank' }])
        expect(hasOwnTarget(a)).toBe(false)
        expect(a.target).toBe('_blank')
        expect(open).toHaveBeenCalledTimes(1)
    })

    test('a stopped click leaves no shield after a tick and is not opened', async () => {
        const open = setup()
        const a = makeAnchor('https://x.invalid/a')
        a.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
        })
        click(a)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(hasOwnTarget(a)).toBe(false)
        expect(open).not.toHaveBeenCalled()
    })

    test('writing target during the dispatch reaches the attribute', () => {
        const a = makeAnchor('https://x.invalid/a')
        let thrown: unknown = null
        const writer = () => {
            try {
                a.target = '_self'
            } catch (error) {
                thrown = error
            }
        }
        document.body.addEventListener('click', writer)
        cleanups.push(() => document.body.removeEventListener('click', writer))
        setup('after')
        click(a)
        expect(thrown).toBeNull()
        expect(a.getAttribute('target')).toBe('_self')
    })

    test('a nested click on the same anchor during dispatch keeps the outer shield', () => {
        const a = makeAnchor('https://x.invalid/a')
        let nested = false
        // Registered before the stand-in on purpose: the nested click must run before the shell sees the outer one.
        const reclick = () => {
            if (!nested) {
                nested = true
                a.click()
            }
        }
        document.body.addEventListener('click', reclick)
        cleanups.push(() => document.body.removeEventListener('click', reclick))
        const open = setup('after')
        click(a)
        expect(acted).toBe(0)
        expect(shellInvoke).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledTimes(2)
        expect(hasOwnTarget(a)).toBe(false)
    })
})

describe('failures and installation', () => {
    test('a throwing opener is contained', () => {
        const open = setup('after', vi.fn<(url: string) => void>(() => {
            throw new Error('boom https://secret.invalid/?state=SECRETSTATE')
        }))
        const a = makeAnchor('https://secret.invalid/?state=SECRETSTATE')
        expect(() => click(a)).not.toThrow()
        expect(open).toHaveBeenCalledTimes(1)
        expect(errorCount).toBe(0)
        expect(warn).toHaveBeenCalledTimes(1)
        const text = String(warn.mock.calls[0].join(' '))
        expect(text).not.toContain('SECRETSTATE')
        expect(text).not.toContain('secret.invalid')
    })

    test('installing twice routes once and the repeated install returns the live uninstaller', () => {
        const first = vi.fn<(url: string) => void>()
        const second = vi.fn<(url: string) => void>()
        const uninstallFirst = installLinkRouter(first)
        const uninstallSecond = installLinkRouter(second)
        cleanups.push(uninstallFirst)
        attachShell()
        window.addEventListener('click', probeListener)
        cleanups.push(() => window.removeEventListener('click', probeListener))
        const a = makeAnchor('https://x.invalid/a')
        click(a)
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).not.toHaveBeenCalled()
        uninstallSecond()
        click(a)
        expect(first).toHaveBeenCalledTimes(1)
        expect(hasOwnTarget(a)).toBe(false)
    })
})
