// @vitest-environment jsdom
// The time of a message row follows the app language, live, and every row of one language shares one formatter.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { changeLanguage } from '../../lang'
import MessageMeta from './MessageMeta.svelte'

const NativeDateTimeFormat = Intl.DateTimeFormat
const OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
const TIME = 1_700_000_000_000

/** The expected row text for a language tag. */
const textFor = (tag: string | undefined): string => new NativeDateTimeFormat(tag, OPTIONS).format(TIME)

/** Two app languages whose text differs from the host's and from each other, so a host-locale base cannot pass. */
function pickLanguages(): [string, string] {
    const host = textFor(undefined)
    const fit = ['en', 'ko', 'de'].filter((tag) => textFor(tag) !== host)
    const first = fit[0]
    const second = fit.find((tag) => textFor(tag) !== textFor(first))
    if (!first || !second) throw new Error('no distinguishable locales on this host')
    return [first, second]
}

let targets: HTMLElement[] = []
let apps: ReturnType<typeof MessageMeta>[] = []
function mountRow(time = TIME): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    apps.push(mount(MessageMeta, { target, props: { name: 'Ari', time, available: ['edit'], onaction: vi.fn(), onmore: vi.fn() } }))
    flushSync()
    return target
}

afterEach(async () => {
    Intl.DateTimeFormat = NativeDateTimeFormat
    for (const app of apps) await unmount(app)
    for (const target of targets) target.remove()
    apps = []; targets = []
    changeLanguage('en')
    document.documentElement.removeAttribute('lang')
    localStorage.removeItem('risuChatShell.actionSlots')
})

describe('the time of a message row follows the app language', () => {
    test('a row mounted under the app language shows that language, not the host locale', () => {
        const [first] = pickLanguages()
        expect(textFor(first)).not.toBe(textFor(undefined))
        changeLanguage(first)
        const target = mountRow()
        expect(target.querySelector('time')!.textContent).toBe(textFor(first))
    })

    test('switching the app language changes a mounted row without a remount', () => {
        const [first, second] = pickLanguages()
        changeLanguage(first)
        const target = mountRow()
        expect(target.querySelector('time')!.textContent).toBe(textFor(first))
        changeLanguage(second)
        flushSync()
        expect(textFor(second)).not.toBe(textFor(first))
        expect(target.querySelector('time')!.textContent).toBe(textFor(second))
    })

    test('five rows across three language switches build at most one formatter per language', async () => {
        vi.resetModules()
        const freshSvelte = await import('svelte')
        const freshLang = await import('../../lang')
        const FreshMeta = (await import('./MessageMeta.svelte')).default
        const [first, second] = pickLanguages()
        let constructions = 0
        Intl.DateTimeFormat = new Proxy(NativeDateTimeFormat, {
            construct(target, args, newTarget) {
                constructions += 1
                return Reflect.construct(target, args, newTarget)
            },
        })
        const mine: ReturnType<typeof FreshMeta>[] = []
        const hosts: HTMLElement[] = []
        const row = (): void => {
            const target = document.createElement('div')
            document.body.appendChild(target)
            hosts.push(target)
            mine.push(freshSvelte.mount(FreshMeta, { target, props: { name: 'Ari', time: TIME, available: ['edit'], onaction: vi.fn(), onmore: vi.fn() } }))
        }
        try {
            freshLang.changeLanguage(first); row(); row()
            freshSvelte.flushSync()
            freshLang.changeLanguage(second); row(); freshSvelte.flushSync()
            freshLang.changeLanguage(first); row(); row(); freshSvelte.flushSync()
            expect(constructions).toBe(2)
            expect(hosts[4].querySelector('time')!.textContent).toBe(textFor(first))
        } finally {
            for (const app of mine) await freshSvelte.unmount(app)
            for (const host of hosts) host.remove()
        }
    })
})
