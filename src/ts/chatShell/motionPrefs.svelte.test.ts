// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    animationDimReason,
    applyMotionClasses,
    installMotionPrefs,
    motionPrefs,
    readLowPower,
    readReducedMotion,
    reducedMotionActive,
    resolveReducedMotion,
    setLowPower,
    setReducedMotion,
    type ReducedMotionMode,
} from './motionPrefs.svelte'
import { lowPowerMarked } from './lowPower'

const root = document.documentElement

function clearRoot(): void {
    root.classList.remove('nexus-low-power', 'rm', 'rm-off')
    root.removeAttribute('data-low-power')
}

/** A media query list whose `matches` the test flips, with the listener bookkeeping a real one has. */
function fakeMedia(initial: boolean) {
    const listeners = new Set<(event: { matches: boolean }) => void>()
    const list = {
        matches: initial,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn((_type: string, fn: (event: { matches: boolean }) => void) => { listeners.add(fn) }),
        removeEventListener: vi.fn((_type: string, fn: (event: { matches: boolean }) => void) => { listeners.delete(fn) }),
    }
    return {
        list,
        listeners,
        set(matches: boolean) {
            list.matches = matches
            for (const fn of [...listeners]) fn({ matches })
        },
        win: { matchMedia: vi.fn(() => list) as unknown as Window['matchMedia'], document },
    }
}

let dispose: (() => void) | undefined

beforeEach(() => {
    localStorage.clear()
    clearRoot()
})
afterEach(() => {
    dispose?.()
    dispose = undefined
    vi.restoreAllMocks()
    clearRoot()
})

describe('device storage (MC-1529)', () => {
    it('defaults to low power off and following the system', () => {
        expect(readLowPower()).toBe(false)
        expect(readReducedMotion()).toBe('system')
    })
    it('round-trips each value through localStorage only', () => {
        setLowPower(true)
        expect(localStorage.getItem('risuChatShell.lowPower')).toBe('1')
        expect(readLowPower()).toBe(true)
        setLowPower(false)
        expect(localStorage.getItem('risuChatShell.lowPower')).toBe('0')
        expect(readLowPower()).toBe(false)
        for (const mode of ['on', 'off', 'system'] as const) {
            setReducedMotion(mode)
            expect(localStorage.getItem('risuChatShell.reducedMotion')).toBe(mode)
            expect(readReducedMotion()).toBe(mode)
        }
    })
    it('reads an unknown stored value as the default and leaves it in place', () => {
        localStorage.setItem('risuChatShell.lowPower', 'yes')
        localStorage.setItem('risuChatShell.reducedMotion', 'sometimes')
        expect(readLowPower()).toBe(false)
        expect(readReducedMotion()).toBe('system')
        expect(localStorage.getItem('risuChatShell.reducedMotion')).toBe('sometimes')
    })
    it('falls back to the defaults and keeps working when storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        expect(readLowPower()).toBe(false)
        expect(readReducedMotion()).toBe('system')
        expect(() => setLowPower(true)).not.toThrow()
        expect(() => setReducedMotion('on')).not.toThrow()
        // The session still applies what was chosen even though it could not be stored.
        expect(motionPrefs.lowPower).toBe(true)
        expect(lowPowerMarked(root)).toBe(true)
        expect(root.classList.contains('rm')).toBe(true)
    })
})

describe('resolving and applying', () => {
    it('resolves on, off and system as the mockup does', () => {
        expect(resolveReducedMotion('on', false)).toBe(true)
        expect(resolveReducedMotion('on', true)).toBe(true)
        expect(resolveReducedMotion('off', true)).toBe(false)
        expect(resolveReducedMotion('off', false)).toBe(false)
        expect(resolveReducedMotion('system', true)).toBe(true)
        expect(resolveReducedMotion('system', false)).toBe(false)
    })
    it('marks the root for every combination and clears what no longer applies', () => {
        const modes: ReducedMotionMode[] = ['system', 'on', 'off']
        for (const lowPower of [true, false]) {
            for (const reducedMotion of modes) {
                for (const systemReduced of [true, false]) {
                    applyMotionClasses(root, { lowPower: !lowPower, reducedMotion: reducedMotion === 'off' ? 'on' : 'off', systemReduced: !systemReduced })
                    applyMotionClasses(root, { lowPower, reducedMotion, systemReduced })
                    const label = `${lowPower}/${reducedMotion}/${systemReduced}`
                    expect(root.classList.contains('nexus-low-power'), label).toBe(lowPower)
                    expect(root.hasAttribute('data-low-power'), label).toBe(lowPower)
                    expect(lowPowerMarked(root), label).toBe(lowPower)
                    expect(root.classList.contains('rm'), label).toBe(resolveReducedMotion(reducedMotion, systemReduced))
                    expect(root.classList.contains('rm-off'), label).toBe(reducedMotion === 'off')
                }
            }
        }
    })
    it('names why the animation speed has no effect: low power first, then the system, then the setting', () => {
        expect(animationDimReason({ lowPower: true, reducedMotion: 'on', systemReduced: true })).toBe('lowPower')
        expect(animationDimReason({ lowPower: false, reducedMotion: 'system', systemReduced: true })).toBe('system')
        expect(animationDimReason({ lowPower: false, reducedMotion: 'on', systemReduced: false })).toBe('reduced')
        expect(animationDimReason({ lowPower: false, reducedMotion: 'off', systemReduced: true })).toBeNull()
        expect(animationDimReason({ lowPower: false, reducedMotion: 'system', systemReduced: false })).toBeNull()
    })
})

describe('reducedMotionActive', () => {
    const reducing = (matches: boolean) => ((query: string) => ({ matches: matches && query.includes('prefers-reduced-motion') })) as unknown as Window['matchMedia']
    it('is on with the rm class whatever the system says', () => {
        root.classList.add('rm')
        expect(reducedMotionActive(root, reducing(false))).toBe(true)
    })
    it('is off with rm-off even when the system asks for reduced motion', () => {
        root.classList.add('rm-off')
        expect(reducedMotionActive(root, reducing(true))).toBe(false)
    })
    it('follows the system when the root carries neither class', () => {
        expect(reducedMotionActive(root, reducing(true))).toBe(true)
        expect(reducedMotionActive(root, reducing(false))).toBe(false)
        expect(reducedMotionActive(root, undefined)).toBe(false)
    })
})

describe('installMotionPrefs', () => {
    it('applies the stored choice at once and follows the system while set to follow it', () => {
        localStorage.setItem('risuChatShell.lowPower', '1')
        const media = fakeMedia(false)
        dispose = installMotionPrefs(media.win)
        expect(lowPowerMarked(root)).toBe(true)
        expect(root.classList.contains('rm')).toBe(false)
        media.set(true)
        expect(motionPrefs.systemReduced).toBe(true)
        expect(root.classList.contains('rm')).toBe(true)
        media.set(false)
        expect(root.classList.contains('rm')).toBe(false)
    })
    it('ignores system changes under on and off', () => {
        const media = fakeMedia(false)
        dispose = installMotionPrefs(media.win)
        setReducedMotion('off')
        media.set(true)
        expect(root.classList.contains('rm')).toBe(false)
        expect(root.classList.contains('rm-off')).toBe(true)
        setReducedMotion('on')
        media.set(false)
        expect(root.classList.contains('rm')).toBe(true)
        expect(root.classList.contains('rm-off')).toBe(false)
    })
    it('installs once and stops listening after the disposer runs', () => {
        const media = fakeMedia(false)
        dispose = installMotionPrefs(media.win)
        const again = installMotionPrefs(media.win)
        expect(media.listeners.size).toBe(1)
        again()
        dispose()
        dispose = undefined
        expect(media.listeners.size).toBe(0)
        media.set(true)
        expect(root.classList.contains('rm')).toBe(false)
    })
})
