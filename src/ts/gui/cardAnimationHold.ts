import holdSheet from './cardAnimationHold.css?raw'
import { adoptSheet } from './adoptSheet'
import { nearViewport } from './nearViewport.svelte'

// The hold rules reach the document with the first module that uses them, before any row paints.
adoptSheet('card-animation-hold', holdSheet)

/** Marks the wrapper that holds a character's background markup, so the hidden hold reaches it like a chat row. */
export const CARD_BACKGROUND_ATTR = 'data-risu-card-background'

const HOLD_ATTR = 'data-risu-anim-hold'
const CARD_SCOPE = `.chattext, [${CARD_BACKGROUND_ATTR}]`
const ROW_MARGINS = { near: '50% 0px', far: '100% 0px' }

/** Which animations of an element a hold covers: its own, its `::before` or its `::after`. */
type Token = 'self' | 'before' | 'after'
type Reason = 'offscreen' | 'hidden'

const TOKEN_ORDER: readonly Token[] = ['self', 'before', 'after']

/**
 * What each reason holds on an element. The attribute is the union over reasons, so a release removes only its own
 * reason's tokens and an element another reason still holds stays paused. The hold is the attribute alone: no
 * animation is ever paused, played or finished through script, because a script's play state outranks the
 * attribute for the rest of that animation's life.
 */
const holds = new WeakMap<Element, Map<Reason, ReadonlySet<Token>>>()

function pseudoToken(pseudoElement: string | null): Token | null {
    if (pseudoElement === null) {
        return 'self'
    }
    if (pseudoElement === '::before') {
        return 'before'
    }
    if (pseudoElement === '::after') {
        return 'after'
    }
    // Any other pseudo-element has no hold rule; it is left running and never marked.
    return null
}

function writeAttribute(element: Element, reasons: Map<Reason, ReadonlySet<Token>>): void {
    const union = new Set<Token>()
    for (const tokens of reasons.values()) {
        for (const token of tokens) {
            union.add(token)
        }
    }
    const value = TOKEN_ORDER.filter((token) => union.has(token)).join(' ')
    if (value === '') {
        element.removeAttribute(HOLD_ATTR)
    } else if (element.getAttribute(HOLD_ATTR) !== value) {
        element.setAttribute(HOLD_ATTR, value)
    }
}

function mark(element: Element, reason: Reason, tokens: ReadonlySet<Token>): void {
    let reasons = holds.get(element)
    if (!reasons) {
        reasons = new Map()
        holds.set(element, reasons)
    }
    reasons.set(reason, tokens)
    writeAttribute(element, reasons)
}

function unmark(element: Element, reason: Reason): void {
    const reasons = holds.get(element)
    if (!reasons || !reasons.delete(reason)) {
        return
    }
    if (reasons.size === 0) {
        holds.delete(element)
    }
    writeAttribute(element, reasons)
}

/** Replaces what `reason` holds: elements no longer wanted are released, the wanted ones are marked. */
function sync(held: Set<Element>, reason: Reason, next: Map<Element, ReadonlySet<Token>>): void {
    for (const element of held) {
        if (!next.has(element)) {
            unmark(element, reason)
            held.delete(element)
        }
    }
    for (const [element, tokens] of next) {
        mark(element, reason, tokens)
        held.add(element)
    }
}

/**
 * Groups the running CSS animations by element and token and keeps the tokens whose animations are all infinite.
 * Transitions are not animations of a target here: they carry no animation name, so they neither hold a target
 * nor make it mixed. A pseudo-element without a hold rule is skipped, never attributed to its host.
 */
function collectTargets(animations: Animation[], accept: (target: Element) => boolean): Map<Element, ReadonlySet<Token>> {
    const seen = new Map<Element, Map<Token, boolean>>()
    for (const animation of animations) {
        if (typeof (animation as Partial<CSSAnimation>).animationName !== 'string') {
            continue
        }
        const effect = animation.effect as KeyframeEffect | null
        const target = effect?.target
        if (!effect || !target || !accept(target)) {
            continue
        }
        const token = pseudoToken(effect.pseudoElement)
        if (token === null) {
            continue
        }
        const infinite = effect.getComputedTiming().iterations === Infinity
        const tokens = seen.get(target) ?? new Map<Token, boolean>()
        tokens.set(token, (tokens.get(token) ?? true) && infinite)
        seen.set(target, tokens)
    }
    const result = new Map<Element, ReadonlySet<Token>>()
    for (const [target, tokens] of seen) {
        const allInfinite = new Set<Token>()
        for (const [token, infinite] of tokens) {
            if (infinite) {
                allInfinite.add(token)
            }
        }
        if (allInfinite.size > 0) {
            result.set(target, allInfinite)
        }
    }
    return result
}

/**
 * Holds the infinite animations inside a chat row while the row is outside the far band, and releases them when it
 * comes back inside the near band or is destroyed. Finite animations, the row element itself and unsupported
 * pseudo-elements are never held. While held, a rescan follows each change of the row's content, so a re-rendered
 * body is held again. Without IntersectionObserver or getAnimations nothing is held.
 */
export function cardAnimationHold(node: HTMLElement) {
    const held = new Set<Element>()
    let destroyed = false
    let observer: MutationObserver | null = null

    const scan = () => {
        if (typeof node.getAnimations !== 'function') {
            return
        }
        sync(held, 'offscreen', collectTargets(node.getAnimations({ subtree: true }), (target) => target !== node))
    }
    const hold = () => {
        scan()
        if (!observer && typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(scan)
            observer.observe(node, { childList: true, subtree: true })
        }
    }
    const release = () => {
        observer?.disconnect()
        observer = null
        sync(held, 'offscreen', new Map())
    }

    const watcher = nearViewport(node, {
        // The trailing change nearViewport reports from its own destroy is ignored: destroy releases everything itself.
        onChange: (visible) => {
            if (destroyed) {
                return
            }
            if (visible) {
                release()
            } else {
                hold()
            }
        },
        margins: ROW_MARGINS,
    })

    return {
        destroy() {
            destroyed = true
            watcher.destroy()
            release()
        },
    }
}

const hiddenHeld = new Set<Element>()
let hiddenObserver: MutationObserver | null = null
let visibilityInstalled = false

/** Card content and card backgrounds, below their own root: the root element is never held. */
function inCardScope(target: Element): boolean {
    return target.parentElement?.closest(CARD_SCOPE) != null
}

function scanHidden(): void {
    if (typeof document.getAnimations !== 'function') {
        return
    }
    sync(hiddenHeld, 'hidden', collectTargets(document.getAnimations(), inCardScope))
}

function onHidden(): void {
    scanHidden()
    if (!hiddenObserver && typeof MutationObserver !== 'undefined' && document.body) {
        hiddenObserver = new MutationObserver(scanHidden)
        hiddenObserver.observe(document.body, { childList: true, subtree: true })
    }
}

function onVisible(): void {
    hiddenObserver?.disconnect()
    hiddenObserver = null
    sync(hiddenHeld, 'hidden', new Map())
}

function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
        onHidden()
    } else {
        onVisible()
    }
}

/**
 * While the page is hidden, holds the infinite animations of every card and card background, including nodes added
 * while hidden, and releases them when the page is shown. Safe to call twice; returns the uninstaller.
 */
export function installCardAnimationVisibilityHold(): () => void {
    if (typeof document === 'undefined') {
        return () => {}
    }
    if (!visibilityInstalled) {
        visibilityInstalled = true
        document.addEventListener('visibilitychange', onVisibilityChange)
        if (document.visibilityState === 'hidden') {
            onHidden()
        }
    }
    return () => {
        if (!visibilityInstalled) {
            return
        }
        visibilityInstalled = false
        document.removeEventListener('visibilitychange', onVisibilityChange)
        onVisible()
    }
}
