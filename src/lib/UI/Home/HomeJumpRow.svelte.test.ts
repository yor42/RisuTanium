// @vitest-environment jsdom

/**
 * `HomeJumpRow` alone: which entries and which bands show the row, the Characters entry raising the
 * library request, the RisuRealm entry calling the host's callback, and the 44 px targets.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { HomeBand } from './homeLayout'
import { homeView } from './homeView.svelte'
import HomeJumpRow from './HomeJumpRow.svelte'

type Props = { band: HomeBand, realmShown: boolean, libraryShown: boolean, liveCount: number, onjumprealm: () => void }

const instances: unknown[] = []
const targets: HTMLElement[] = []

function render(over: Partial<Props>): { target: HTMLElement, onjumprealm: ReturnType<typeof vi.fn> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const onjumprealm = vi.fn()
    instances.push(mount(HomeJumpRow, { target, props: { band: 'phone', realmShown: true, libraryShown: true, liveCount: 2, onjumprealm, ...over } }))
    flushSync()
    return { target, onjumprealm }
}

const links = (target: ParentNode) => Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="home-jump"] [data-part="home-jump-link"]'))

afterEach(async () => {
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
})

describe('the entries and where the row shows', () => {
    const cases: [string, Partial<Props>, string[]][] = [
        ['phone, both entries', {}, [language.homeJumpCharacters(2), language.hub]],
        ['phone, Realm hidden: one entry, no row', { realmShown: false }, []],
        ['phone, no library: one entry, no row', { libraryShown: false }, []],
        ['phone, neither: no row', { realmShown: false, libraryShown: false }, []],
        ['mid, both entries: no row', { band: 'mid' }, []],
        ['wide, both entries: no row', { band: 'wide' }, []],
    ]

    test.each(cases)('%s', (_name, over, expected) => {
        const { target } = render(over)
        expect(links(target).map((b) => b.textContent?.trim())).toEqual(expected)
        expect(target.querySelector('[data-part="home-jump"]') !== null).toBe(expected.length > 0)
    })

    test('the nav carries the accessible name and a zero count is shown', () => {
        const { target } = render({ liveCount: 0 })
        expect(target.querySelector('nav[data-part="home-jump"]')!.getAttribute('aria-label')).toBe(language.homeJumpLabel)
        expect(links(target)[0].textContent?.trim()).toBe(language.homeJumpCharacters(0))
    })

    test('every entry is a 44 px target', () => {
        const { target } = render({})
        for (const button of links(target)) {
            expect(button.className.split(/\s+/)).toContain('min-h-11')
        }
    })
})

describe('activating an entry', () => {
    test('Characters raises one library request and leaves the Realm callback alone', () => {
        const { target, onjumprealm } = render({})
        const before = homeView.libraryRequest
        links(target)[0].click()
        expect(homeView.libraryRequest).toBe(before + 1)
        expect(onjumprealm).not.toHaveBeenCalled()
    })

    test('RisuRealm calls the host once and raises no library request', () => {
        const { target, onjumprealm } = render({})
        const before = homeView.libraryRequest
        links(target)[1].click()
        expect(onjumprealm).toHaveBeenCalledTimes(1)
        expect(homeView.libraryRequest).toBe(before)
    })
})