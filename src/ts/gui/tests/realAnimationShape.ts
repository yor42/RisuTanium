import { vi } from 'vitest'

/**
 * Stubs for the entries Chrome's `getAnimations` returns, copied from a measurement on a Note 9 (WebView 156):
 * a CSSAnimation reports its animation name; a CSSTransition has none and lists first; a pseudo-element animation
 * reports the HOST element as `effect.target` and the pseudo string as `effect.pseudoElement`; a finite
 * fill-forwards animation stays listed once finished. Iterations are Infinity both specified and computed for a loop.
 */
export interface AnimationShape {
    kind: 'CSSAnimation' | 'CSSTransition'
    animationName: string | null
    transitionProperty: string | null
    pseudoElement: string | null
    specifiedIterations: number
    computedIterations: number
    specifiedDuration: number
    specifiedFill: string
    playState: AnimationPlayState
}

export const SHAPES = {
    beforeLoopInfinite: {
        kind: 'CSSAnimation', animationName: 'd1spin', transitionProperty: null, pseudoElement: '::before',
        specifiedIterations: Infinity, computedIterations: Infinity, specifiedDuration: 1000, specifiedFill: 'none', playState: 'running',
    },
    afterLoopInfinite: {
        kind: 'CSSAnimation', animationName: 'd1spin', transitionProperty: null, pseudoElement: '::after',
        specifiedIterations: Infinity, computedIterations: Infinity, specifiedDuration: 1000, specifiedFill: 'none', playState: 'running',
    },
    selfLoopInfinite: {
        kind: 'CSSAnimation', animationName: 'rcpulse', transitionProperty: null, pseudoElement: null,
        specifiedIterations: Infinity, computedIterations: Infinity, specifiedDuration: 1000, specifiedFill: 'none', playState: 'running',
    },
    finiteFillForwardsRunning: {
        kind: 'CSSAnimation', animationName: 'd1rev', transitionProperty: null, pseudoElement: null,
        specifiedIterations: 1, computedIterations: 1, specifiedDuration: 1000, specifiedFill: 'forwards', playState: 'running',
    },
    finiteFillForwardsFinished: {
        kind: 'CSSAnimation', animationName: 'd1rev', transitionProperty: null, pseudoElement: null,
        specifiedIterations: 1, computedIterations: 1, specifiedDuration: 1000, specifiedFill: 'forwards', playState: 'finished',
    },
    cssTransitionOpacity: {
        kind: 'CSSTransition', animationName: null, transitionProperty: 'opacity', pseudoElement: null,
        specifiedIterations: 1, computedIterations: 1, specifiedDuration: 5000, specifiedFill: 'backwards', playState: 'running',
    },
    markerLoopInfinite: {
        kind: 'CSSAnimation', animationName: 'd1col', transitionProperty: null, pseudoElement: '::marker',
        specifiedIterations: Infinity, computedIterations: Infinity, specifiedDuration: 1000, specifiedFill: 'none', playState: 'running',
    },
} satisfies Record<string, AnimationShape>

export type ShapeName = keyof typeof SHAPES

/** An entry of getAnimations with the real shape; `pause`, `play` and `finish` are spies so a test can prove they are never used. */
export interface StubAnimation {
    animationName?: string | null
    transitionProperty: string | null
    playState: AnimationPlayState
    effect: {
        target: Element
        pseudoElement: string | null
        getTiming: () => { iterations: number }
        getComputedTiming: () => { iterations: number }
    }
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    finish: ReturnType<typeof vi.fn>
}

export function stubAnimation(shape: ShapeName, target: Element): StubAnimation {
    const spec: AnimationShape = SHAPES[shape]
    const entry: StubAnimation = {
        animationName: spec.animationName,
        transitionProperty: spec.transitionProperty,
        playState: spec.playState,
        effect: {
            target,
            pseudoElement: spec.pseudoElement,
            getTiming: () => ({ iterations: spec.specifiedIterations }),
            getComputedTiming: () => ({ iterations: spec.computedIterations }),
        },
        pause: vi.fn(),
        play: vi.fn(),
        finish: vi.fn(),
    }
    // A real CSSTransition has no animationName property at all; the measurement records null.
    if (spec.kind === 'CSSTransition') {
        delete entry.animationName
    }
    return entry
}

export interface AnimationWorld {
    /**
     * Declares that every connected element matching `selector` has an animation of this shape, listed in
     * declaration order. Elements rendered later are covered at once, as a browser's style recalculation would.
     */
    rule: (selector: string, shape: ShapeName) => void
    /** Every entry handed out so far, for asserting that none was paused, played or finished. */
    handedOut: () => StubAnimation[]
    restore: () => void
}

/**
 * Gives `Element.prototype.getAnimations` and `document.getAnimations` a browser-shaped answer: only entries whose
 * target is connected, and for an element only entries whose target is the element or below it. An entry keeps its
 * identity (and its spies) for as long as its element lives.
 */
export function installAnimationWorld(): AnimationWorld {
    const rules: Array<{ selector: string, shape: ShapeName }> = []
    const cache = new WeakMap<Element, Map<number, StubAnimation>>()
    const issued: StubAnimation[] = []
    const answer = (within: Element | null): StubAnimation[] => {
        const result: StubAnimation[] = []
        rules.forEach((rule, index) => {
            for (const target of document.querySelectorAll(rule.selector)) {
                if (within && !within.contains(target)) {
                    continue
                }
                let perElement = cache.get(target)
                if (!perElement) {
                    perElement = new Map()
                    cache.set(target, perElement)
                }
                let entry = perElement.get(index)
                if (!entry) {
                    entry = stubAnimation(rule.shape, target)
                    perElement.set(index, entry)
                    issued.push(entry)
                }
                result.push(entry)
            }
        })
        return result
    }
    const elementProto = Element.prototype as { getAnimations?: unknown }
    const documentObject = document as { getAnimations?: unknown }
    const hadElement = Object.getOwnPropertyDescriptor(elementProto, 'getAnimations')
    const hadDocument = Object.getOwnPropertyDescriptor(documentObject, 'getAnimations')
    Object.defineProperty(elementProto, 'getAnimations', {
        configurable: true,
        writable: true,
        value(this: Element) {
            return answer(this)
        },
    })
    Object.defineProperty(documentObject, 'getAnimations', {
        configurable: true,
        writable: true,
        value: () => answer(null),
    })
    return {
        rule(selector, shape) {
            rules.push({ selector, shape })
        },
        handedOut: () => issued,
        restore() {
            rules.length = 0
            if (hadElement) {
                Object.defineProperty(elementProto, 'getAnimations', hadElement)
            } else {
                delete elementProto.getAnimations
            }
            if (hadDocument) {
                Object.defineProperty(documentObject, 'getAnimations', hadDocument)
            } else {
                delete documentObject.getAnimations
            }
        },
    }
}

/** An IntersectionObserver whose reports a test sends by hand, keyed by the `rootMargin` it was created with. */
export class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = []
    readonly rootMargin: string
    readonly targets = new Set<Element>()
    readonly disconnect = vi.fn(() => { this.targets.clear() })
    private readonly callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback
        this.rootMargin = options?.rootMargin ?? '0px'
        FakeIntersectionObserver.instances.push(this)
    }

    observe(target: Element): void {
        this.targets.add(target)
    }

    unobserve(target: Element): void {
        this.targets.delete(target)
    }

    report(target: Element, isIntersecting: boolean): void {
        this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }

    /** Reports to every live observer of this margin that watches `target`. */
    static send(rootMargin: string, target: Element, isIntersecting: boolean): void {
        for (const observer of FakeIntersectionObserver.instances) {
            if (observer.rootMargin === rootMargin && observer.targets.has(target)) {
                observer.report(target, isIntersecting)
            }
        }
    }
}