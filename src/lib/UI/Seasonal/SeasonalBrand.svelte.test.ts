// @vitest-environment jsdom

/**
 * SeasonalBrand: the top-bar wordmark that mounts the seasonal host only when the device toggle is on and today has an
 * occasion. Each test names the defect it guards.
 *
 * MOCKED: `mountSeasonal` (a spy returning a controller stub), the DB language, `openURL`. The calendar, the prefs, the
 * app's motion and colour-scheme helpers are real. The scene host itself is covered by host.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const hostMock = vi.hoisted(() => ({ mountSeasonal: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { language: 'en' } as unknown as Record<string, unknown> })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock('src/ts/seasonal/host', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/seasonal/host')>()),
    mountSeasonal: hostMock.mountSeasonal,
}))

import { openURL } from 'src/ts/globalApi.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { ColorSchemeTypeStore } from 'src/ts/gui/surfaceTone'
import { PLAIN_WORDMARK_HTML, type HostOptions } from 'src/ts/seasonal/host'
import { reloadSeasonalPrefs, setSeasonalLogoEnabled } from 'src/ts/seasonal/seasonalPrefs.svelte'
import SeasonalBrand from './SeasonalBrand.svelte'

const CHRISTMAS = new Date(2026, 11, 22, 12, 0, 0)
const ORDINARY_DAY = new Date(2026, 10, 21, 12, 0, 0)

interface Stub { destroy: ReturnType<typeof vi.fn>, refresh: ReturnType<typeof vi.fn> }
let stubs: Stub[] = []
let instances: unknown[] = []

function render(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const inst = mount(SeasonalBrand, { target, props: { class: 'extra' } })
    instances.push(inst)
    flushSync()
    return target
}

const optionsOf = (call: number): HostOptions => hostMock.mountSeasonal.mock.calls[call][1] as HostOptions

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(CHRISTMAS)
    localStorage.clear()
    reloadSeasonalPrefs()
    DBState.db.language = 'en'
    ColorSchemeTypeStore.set('dark')
    stubs = []
    hostMock.mountSeasonal.mockReset()
    hostMock.mountSeasonal.mockImplementation(() => {
        const stub: Stub = { destroy: vi.fn(), refresh: vi.fn() }
        stubs.push(stub)
        return stub
    })
    vi.mocked(openURL).mockClear()
})

afterEach(async () => {
    for (const inst of instances.splice(0)) await unmount(inst as never).catch(() => {})
    document.body.innerHTML = ''
    document.documentElement.className = ''
    vi.useRealTimers()
})

describe('SeasonalBrand', () => {
    // Guards: the toggle being ignored (the host, its listeners and the scene chunk would load with the logo switched off).
    test('with the toggle off the host is not mounted even on an occasion day', () => {
        setSeasonalLogoEnabled(false)
        const root = render()
        expect(hostMock.mountSeasonal).not.toHaveBeenCalled()
        expect(root.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
    })

    // Guards: an ordinary day mounting the host (observers and timers for a day with nothing to show).
    test('a day without an occasion does not mount the host', () => {
        vi.setSystemTime(ORDINARY_DAY)
        const root = render()
        expect(hostMock.mountSeasonal).not.toHaveBeenCalled()
        expect(root.innerHTML).toContain('rt-sw-sr')
    })

    // Guards: the everyday wordmark markup drifting from the host's (a layout jump when the host takes over), and the
    // wordmark losing its single accessible name.
    test('renders the shared everyday wordmark with one accessible name node', () => {
        vi.setSystemTime(ORDINARY_DAY)
        const root = render()
        const host = root.querySelector('[data-seasonal-host]') as HTMLElement
        expect(host.innerHTML).toBe(PLAIN_WORDMARK_HTML)
        expect(host.classList.contains('extra')).toBe(true)
        expect(root.querySelectorAll('.rt-sw-sr').length).toBe(1)
        expect(root.querySelector('.rt-sw-text')!.getAttribute('aria-hidden')).toBe('true')
    })

    // Guards: wrong inputs reaching the host (language, anniversary link, storage-backed once-a-day hooks).
    test('on an occasion day the host gets the language, the anniversary link and the device record', () => {
        DBState.db.language = 'de'
        const root = render()
        expect(hostMock.mountSeasonal).toHaveBeenCalledTimes(1)
        const [hostEl, opts] = hostMock.mountSeasonal.mock.calls[0] as [HTMLElement, HostOptions]
        expect(hostEl).toBe(root.querySelector('[data-seasonal-host]'))
        expect(opts.language).toBe('de')
        expect(opts.anniversaryUrl).toBe('https://github.com/yor42/RisuTanium')
        expect(opts.playedToday('2026-12-22')).toBe(false)
        opts.markPlayed('2026-12-22')
        expect(opts.playedToday('2026-12-22')).toBe(true)
        expect(opts.autoplay).toBe(true)
    })

    // Guards: the anniversary link bypassing the app's opener, or opening for a null url.
    test('links open through the app openURL helper and a null url opens nothing', () => {
        render()
        const opts = optionsOf(0)
        opts.onLink!('https://github.com/yor42/RisuTanium')
        expect(openURL).toHaveBeenCalledWith('https://github.com/yor42/RisuTanium')
        vi.mocked(openURL).mockClear()
        opts.onLink!(null)
        expect(openURL).not.toHaveBeenCalled()
    })

    // Guards: reduced motion, low power and the colour scheme read from somewhere other than the app's own state.
    test('reduced motion, low power and theme come from the app state at call time', () => {
        render()
        const opts = optionsOf(0)
        expect(opts.reducedMotion!()).toBe(false)
        expect(opts.lowPower!()).toBe(false)
        expect(opts.theme!()).toBe('dark')
        document.documentElement.classList.add('rm')
        document.documentElement.classList.add('nexus-low-power')
        ColorSchemeTypeStore.set('light')
        expect(opts.reducedMotion!()).toBe(true)
        expect(opts.lowPower!()).toBe(true)
        expect(opts.theme!()).toBe('light')
    })

    // Guards: a colour scheme change leaving the stage tones stale until the next remount.
    test('a colour scheme change refreshes the mounted host without remounting it', () => {
        render()
        expect(stubs[0].refresh).toHaveBeenCalledTimes(1)
        ColorSchemeTypeStore.set('light')
        flushSync()
        expect(stubs[0].refresh.mock.calls.length).toBeGreaterThan(1)
        expect(hostMock.mountSeasonal).toHaveBeenCalledTimes(1)
    })

    // Guards: switching the toggle off in Settings leaving the scene on screen.
    test('switching the toggle off destroys the host and on mounts it again', () => {
        render()
        expect(stubs.length).toBe(1)
        setSeasonalLogoEnabled(false)
        flushSync()
        expect(stubs[0].destroy).toHaveBeenCalledTimes(1)
        setSeasonalLogoEnabled(true)
        flushSync()
        expect(hostMock.mountSeasonal).toHaveBeenCalledTimes(2)
    })

    // Guards: a language change keeping the old language's occasion rules and strings.
    test('a language change remounts the host with the new language', () => {
        render()
        DBState.db.language = 'es'
        flushSync()
        expect(stubs[0].destroy).toHaveBeenCalledTimes(1)
        expect(optionsOf(1).language).toBe('es')
    })

    // Guards: an unmounted component leaving the host (and its observers) behind.
    test('unmounting destroys the host', async () => {
        render()
        await unmount(instances.pop() as never)
        expect(stubs[0].destroy).toHaveBeenCalledTimes(1)
    })

    // Guards: the app open across midnight into an occasion playing the animation under the user's eyes, or never noticing
    // the new day; also that an ordinary day arms no timer.
    test('returning on a later day with an occasion mounts the host without autoplay and arms no timer before', () => {
        vi.setSystemTime(new Date(2026, 11, 18, 23, 59, 30))
        render()
        expect(hostMock.mountSeasonal).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
        vi.setSystemTime(new Date(2026, 11, 19, 8, 0, 0))
        document.dispatchEvent(new Event('visibilitychange'))
        flushSync()
        expect(hostMock.mountSeasonal).toHaveBeenCalledTimes(1)
        expect(optionsOf(0).autoplay).toBe(false)
    })
})
