// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CARD_BACKGROUND_ATTR, cardAnimationHold, installCardAnimationVisibilityHold } from './cardAnimationHold'
import { FakeIntersectionObserver, installAnimationWorld, type AnimationWorld } from './tests/realAnimationShape'

/**
 * The hold decides per target from `getAnimations` entries shaped like the browser's: a target is held only on the
 * tokens (own, `::before`, `::after`) whose animations are all infinite, transitions are not animations of a target,
 * and an unsupported pseudo-element is skipped. The hold is the attribute alone; no animation is paused, played or
 * finished by script.
 */

const NEAR = '50% 0px'
const FAR = '100% 0px'
const HOLD = 'data-risu-anim-hold'

let world: AnimationWorld

function markup(html: string) {
    const row = document.createElement('div')
    row.className = 'chattext'
    row.innerHTML = html
    document.body.append(row)
    return row
}

function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    world = installAnimationWorld()
})

afterEach(() => {
    document.body.replaceChildren()
    world.restore()
    vi.unstubAllGlobals()
    delete (document as { visibilityState?: unknown }).visibilityState
})

describe('the hold sheet', () => {
    test('G T2.8 (module absent on the base): importing the module adopts the rules that pause a held host and its pseudo-elements', () => {
        const sheet = document.head.querySelector('style[data-risu-sheet="card-animation-hold"]')
        expect(sheet).not.toBeNull()
        const css = sheet!.textContent ?? ''
        expect(css).toContain('[data-risu-anim-hold~="self"]')
        expect(css).toContain('[data-risu-anim-hold~="before"]::before')
        expect(css).toContain('[data-risu-anim-hold~="after"]::after')
        expect(css.match(/animation-play-state:\s*paused\s*!important/g)).toHaveLength(3)
    })

    test('G: the background mark is the one the sheet-adjacent scope reads', () => {
        expect(CARD_BACKGROUND_ATTR).toBe('data-risu-card-background')
    })
})

describe('the row bands', () => {
    test('G T2.4b: the action observes the 50% near band and the 100% far band, not the shared defaults', () => {
        const row = markup('<div>row</div>')
        const action = cardAnimationHold(row)
        expect(FakeIntersectionObserver.instances.map((observer) => observer.rootMargin).sort()).toEqual([FAR, NEAR])
        for (const observer of FakeIntersectionObserver.instances) {
            expect(observer.targets.has(row)).toBe(true)
        }
        action.destroy()
        for (const observer of FakeIntersectionObserver.instances) {
            expect(observer.targets.size).toBe(0)
        }
    })
})

describe('what a far-exit holds', () => {
    test('G T2.3: a target with a finite animation beside an infinite one is not held, on every token', () => {
        const row = markup('<div class="mixed">m</div><div class="mixedbefore">b</div><div class="plain">p</div>')
        world.rule('.mixed', 'selfLoopInfinite')
        world.rule('.mixed', 'finiteFillForwardsRunning')
        world.rule('.mixedbefore', 'beforeLoopInfinite')
        world.rule('.mixedbefore', 'beforeLoopInfinite')
        world.rule('.plain', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.plain')!.getAttribute(HOLD)).toBe('self')
        expect(row.querySelector('.mixed')!.hasAttribute(HOLD)).toBe(false)
        // Two infinite ::before animations on one host are still all infinite.
        expect(row.querySelector('.mixedbefore')!.getAttribute(HOLD)).toBe('before')
        action.destroy()
    })

    test('G T2.3: a finite own animation does not stop an infinite ::before from being held, and the ::after token is its own', () => {
        const row = markup('<div class="both">b</div>')
        world.rule('.both', 'finiteFillForwardsRunning')
        world.rule('.both', 'beforeLoopInfinite')
        world.rule('.both', 'afterLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.both')!.getAttribute(HOLD)).toBe('before after')
        action.destroy()
    })

    test('G T2.3: a transition neither holds a target nor makes an infinite one mixed', () => {
        const row = markup('<div class="onlytransition">t</div><div class="looptransition">l</div>')
        world.rule('.onlytransition', 'cssTransitionOpacity')
        world.rule('.looptransition', 'cssTransitionOpacity')
        world.rule('.looptransition', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.onlytransition')!.hasAttribute(HOLD)).toBe(false)
        expect(row.querySelector('.looptransition')!.getAttribute(HOLD)).toBe('self')
        action.destroy()
    })

    test('G T2.3: an unsupported pseudo-element is skipped and its host is not held by it', () => {
        const row = markup('<div class="marker">m</div><div class="markerplus">mp</div>')
        world.rule('.marker', 'markerLoopInfinite')
        world.rule('.markerplus', 'markerLoopInfinite')
        world.rule('.markerplus', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.marker')!.hasAttribute(HOLD)).toBe(false)
        // Its own infinite animation is held; the marker loop is left running and never named in the mark.
        expect(row.querySelector('.markerplus')!.getAttribute(HOLD)).toBe('self')
        action.destroy()
    })

    test('G T2.3: the row itself and nodes outside the row are never held', () => {
        const row = markup('<div class="inside">i</div>')
        const outside = document.createElement('div')
        outside.className = 'inside'
        document.body.append(outside)
        row.classList.add('inside')
        world.rule('.inside', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.inside')!.getAttribute(HOLD)).toBe('self')
        expect(row.hasAttribute(HOLD)).toBe(false)
        expect(outside.hasAttribute(HOLD)).toBe(false)
        action.destroy()
    })

    test('G: a row that was never far-exited holds nothing and release before any hold is harmless', () => {
        const row = markup('<div class="plain">p</div>')
        world.rule('.plain', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(NEAR, row, true)
        expect(row.querySelector('.plain')!.hasAttribute(HOLD)).toBe(false)
        action.destroy()
    })

    test('G T2.3: a held row follows the next change of its content, and a released row does not', async () => {
        const row = markup('<div class="plain">p</div>')
        world.rule('.plain', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        const added = document.createElement('div')
        added.className = 'plain'
        row.append(added)
        await Promise.resolve()
        await Promise.resolve()
        expect(added.getAttribute(HOLD)).toBe('self')

        FakeIntersectionObserver.send(NEAR, row, true)
        const late = document.createElement('div')
        late.className = 'plain'
        row.append(late)
        await Promise.resolve()
        await Promise.resolve()
        expect(late.hasAttribute(HOLD)).toBe(false)
        expect(added.hasAttribute(HOLD)).toBe(false)
        action.destroy()
    })

    test('G T2.3: after destroy the row is released and later changes are not held', async () => {
        const row = markup('<div class="plain">p</div>')
        world.rule('.plain', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        const plain = row.querySelector('.plain')!
        expect(plain.getAttribute(HOLD)).toBe('self')
        action.destroy()
        expect(plain.hasAttribute(HOLD)).toBe(false)
        const late = document.createElement('div')
        late.className = 'plain'
        row.append(late)
        await Promise.resolve()
        await Promise.resolve()
        expect(late.hasAttribute(HOLD)).toBe(false)
    })

    test('G: no animation is ever paused, played or finished through script', () => {
        const row = markup('<div class="plain">p</div><div class="both">b</div>')
        world.rule('.plain', 'selfLoopInfinite')
        world.rule('.both', 'beforeLoopInfinite')
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(row.querySelector('.plain')!.getAttribute(HOLD)).toBe('self')
        FakeIntersectionObserver.send(NEAR, row, true)
        FakeIntersectionObserver.send(FAR, row, false)
        action.destroy()
        const issued = world.handedOut()
        expect(issued.length).toBeGreaterThan(0)
        for (const animation of issued) {
            expect(animation.pause).not.toHaveBeenCalled()
            expect(animation.play).not.toHaveBeenCalled()
            expect(animation.finish).not.toHaveBeenCalled()
        }
    })
})

describe('fail-open', () => {
    test('G I6: without getAnimations nothing is held and nothing throws', () => {
        world.restore()
        const row = markup('<div class="plain">p</div>')
        const action = cardAnimationHold(row)
        expect(() => FakeIntersectionObserver.send(FAR, row, false)).not.toThrow()
        expect(row.querySelector('.plain')!.hasAttribute(HOLD)).toBe(false)
        expect(() => action.destroy()).not.toThrow()
    })

    test('G I6: without IntersectionObserver the row is always visible and nothing is held', () => {
        vi.unstubAllGlobals()
        vi.stubGlobal('IntersectionObserver', undefined)
        const row = markup('<div class="plain">p</div>')
        world.rule('.plain', 'selfLoopInfinite')
        const action = cardAnimationHold(row)
        expect(row.querySelector('.plain')!.hasAttribute(HOLD)).toBe(false)
        expect(() => action.destroy()).not.toThrow()
        expect(row.querySelector('.plain')!.hasAttribute(HOLD)).toBe(false)
    })
})

describe('the hidden hold', () => {
    test('G T2.3: only descendants of cards and card backgrounds are held; foreign nodes are untouched', () => {
        const row = markup('<div class="loop">in</div>')
        const foreign = document.createElement('div')
        foreign.className = 'loop'
        document.body.append(foreign)
        const background = document.createElement('div')
        background.setAttribute(CARD_BACKGROUND_ATTR, '')
        background.innerHTML = '<div class="loop">bg</div>'
        document.body.append(background)
        world.rule('.loop', 'selfLoopInfinite')
        const uninstall = installCardAnimationVisibilityHold()
        setVisibility('hidden')
        expect(row.querySelector('.loop')!.getAttribute(HOLD)).toBe('self')
        expect(background.querySelector('.loop')!.getAttribute(HOLD)).toBe('self')
        expect(foreign.hasAttribute(HOLD)).toBe(false)
        expect(row.hasAttribute(HOLD)).toBe(false)
        setVisibility('visible')
        expect(row.querySelector('.loop')!.hasAttribute(HOLD)).toBe(false)
        uninstall()
    })

    test('G: installing twice adds one listener, and the uninstaller releases what is held', () => {
        const row = markup('<div class="loop">in</div>')
        world.rule('.loop', 'selfLoopInfinite')
        const add = vi.spyOn(document, 'addEventListener')
        const uninstall = installCardAnimationVisibilityHold()
        installCardAnimationVisibilityHold()
        expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1)
        setVisibility('hidden')
        expect(row.querySelector('.loop')!.getAttribute(HOLD)).toBe('self')
        uninstall()
        expect(row.querySelector('.loop')!.hasAttribute(HOLD)).toBe(false)
        setVisibility('visible')
        add.mockRestore()
    })

    test('G: a page that is already hidden when the hold is installed is held at once', () => {
        const row = markup('<div class="loop">in</div>')
        world.rule('.loop', 'selfLoopInfinite')
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        const uninstall = installCardAnimationVisibilityHold()
        expect(row.querySelector('.loop')!.getAttribute(HOLD)).toBe('self')
        uninstall()
    })
})
