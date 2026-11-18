/**
 * The app's own router for external links on Tauri.
 *
 * The Tauri shell plugin injects a body click listener that cannot be switched off. For a `_blank` anchor whose
 * resolved href starts with a routed prefix it invokes `plugin:shell|open` and prevents the default, without looking at
 * `defaultPrevented`, modifier keys or the rejection of its call. The app grants no shell open capability, so that call
 * rejects and the error dialog appears. This router makes the shell's listener a no-op and opens the link itself.
 *
 * Mechanism: a window capture listener puts a one-dispatch own-property `target` shield on the matched anchor, so the
 * shell's `anchor.target === '_blank'` test fails. A window bubble listener then decides: an already-prevented click
 * belongs to the app and is left alone; any other matched click is prevented and either opened, swallowed or failed
 * closed. Nothing is ever stopped, so every app listener at every depth still sees every click, and the result does not
 * depend on listener registration order.
 *
 * Invariants:
 * - The opener capability, not this router, is the security boundary. The router adds no scheme, command or grant.
 * - A routed-prefix href on the page's own http(s) origin (including the empty href, which resolves to the page) is
 *   swallowed, and a routed-prefix href that cannot be parsed fails closed: prevented, nothing opened, no warning.
 *   `mailto:` and `tel:` always route, even when the page origin is opaque.
 * - The shield lasts at most one dispatch. It is released synchronously at window bubble on every path, with a
 *   macrotask fallback for stopped or non-bubbling dispatches. It is never released from a microtask: a native dispatch
 *   runs microtasks between listener callbacks, which would release it before the shell's listener runs.
 * - No exception leaves either listener and no promise is created. The only warning is fixed text without the URL.
 */

const ROUTED_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:']

interface ClickRecord {
    anchor: HTMLAnchorElement
    href: string
    /** Whether this dispatch defined the shield; a nested dispatch on a shielded anchor leaves it to the outer one. */
    owned: boolean
}

type AnchorGetter = (this: HTMLAnchorElement) => string
type AnchorSetter = (this: HTMLAnchorElement, value: string) => void

const records = new WeakMap<Event, ClickRecord>()

let uninstallCurrent: (() => void) | null = null
let openLink: (url: string) => void = () => {}
let hrefGetter: AnchorGetter | null = null
let targetGetter: AnchorGetter | null = null
let targetSetter: AnchorSetter | null = null

/** Mirrors the shell: the first `a` element from the target upwards decides, and only an HTML anchor can match. */
function findAnchor(event: Event): HTMLAnchorElement | null {
    let node: Element | null = event.target instanceof Element ? event.target : null
    while (node) {
        if (node.matches('a')) {
            return node instanceof HTMLAnchorElement ? node : null
        }
        node = node.parentElement
    }
    return null
}

function parseUrlOrNull(href: string): URL | null {
    try {
        return new URL(href)
    } catch {
        return null
    }
}

function release(event: Event): void {
    const record = records.get(event)
    if (!record) {
        return
    }
    records.delete(event)
    if (record.owned) {
        Reflect.deleteProperty(record.anchor, 'target')
    }
}

function onCapture(event: Event): void {
    if (!hrefGetter || !targetGetter || !targetSetter) {
        return
    }
    const anchor = findAnchor(event)
    if (!anchor) {
        return
    }
    const href = hrefGetter.call(anchor)
    if (href === '' || !ROUTED_PREFIXES.some((prefix) => href.startsWith(prefix))) {
        return
    }
    // The prototype getter, so a shield an outer dispatch left on this anchor does not hide the real target.
    if (targetGetter.call(anchor) !== '_blank') {
        return
    }
    let owned = false
    if (!Object.prototype.hasOwnProperty.call(anchor, 'target')) {
        const setTarget = targetSetter
        try {
            Object.defineProperty(anchor, 'target', {
                configurable: true,
                get: () => '',
                set: (value: string) => setTarget.call(anchor, value),
            })
        } catch {
            // Without a shield the shell acts as on the base, and the missing capability still refuses its call.
            return
        }
        owned = true
    }
    records.set(event, { anchor, href, owned })
    setTimeout(() => release(event), 0)
}

function onBubble(event: Event): void {
    const record = records.get(event)
    if (!record) {
        return
    }
    try {
        if (event.defaultPrevented) {
            return
        }
        event.preventDefault()
        const url = parseUrlOrNull(record.href)
        if (url === null) {
            return
        }
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === location.origin) {
            return
        }
        try {
            openLink(record.href)
        } catch {
            console.warn('link router: the link could not be opened')
        }
    } finally {
        release(event)
    }
}

/**
 * Installs the router once and returns its uninstaller. A repeated install changes nothing and returns the live
 * uninstaller of the first one.
 */
export function installLinkRouter(open: (url: string) => void): () => void {
    if (uninstallCurrent) {
        return uninstallCurrent
    }
    hrefGetter = (Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href')?.get as AnchorGetter | undefined) ?? null
    targetGetter = (Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'target')?.get as AnchorGetter | undefined) ?? null
    targetSetter = (Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'target')?.set as AnchorSetter | undefined) ?? null
    openLink = open
    window.addEventListener('click', onCapture, { capture: true })
    window.addEventListener('click', onBubble, { capture: false })
    const uninstall = () => {
        window.removeEventListener('click', onCapture, { capture: true })
        window.removeEventListener('click', onBubble, { capture: false })
        if (uninstallCurrent === uninstall) {
            uninstallCurrent = null
        }
    }
    uninstallCurrent = uninstall
    return uninstall
}
