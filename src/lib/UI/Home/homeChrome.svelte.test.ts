// @vitest-environment node

/**
 * `holdHomeChrome`: each `homeChrome` flag is true while at least one holder holds it, a release
 * never lowers another holder's hold, a second call of the same release does nothing, and the two
 * flags count independently.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { holdHomeChrome, homeChrome } from './homeChrome.svelte'

const releases: Array<() => void> = []

function hold(flag: 'landing' | 'phoneDrawer'): () => void {
    const release = holdHomeChrome(flag)
    releases.push(release)
    return release
}

afterEach(() => {
    for (const release of releases.splice(0)) release()
})

describe('holdHomeChrome', () => {
    test('S5-U2: overlapping holds keep the flag until the last release, and a release is idempotent', () => {
        expect(homeChrome.landing).toBe(false)
        const first = hold('landing')
        const second = hold('landing')
        expect(homeChrome.landing).toBe(true)
        first()
        expect(homeChrome.landing).toBe(true)
        first()
        expect(homeChrome.landing).toBe(true)
        second()
        expect(homeChrome.landing).toBe(false)

        const again = hold('landing')
        expect(homeChrome.landing).toBe(true)
        again()
        expect(homeChrome.landing).toBe(false)
    })

    test('S5-U2: the two flags count independently', () => {
        const landing = hold('landing')
        expect(homeChrome.phoneDrawer).toBe(false)
        const drawer = hold('phoneDrawer')
        expect(homeChrome.phoneDrawer).toBe(true)
        drawer()
        expect(homeChrome.phoneDrawer).toBe(false)
        expect(homeChrome.landing).toBe(true)
        landing()
        expect(homeChrome.landing).toBe(false)
        expect(homeChrome.phoneDrawer).toBe(false)
    })
})
