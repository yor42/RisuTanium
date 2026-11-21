// @vitest-environment jsdom

/**
 * The landing's side block (MC-2821/2822/2831/2832): the Utility row, the RisuRealm card, the Community and
 * source list with its version foot, and the announcement, in one column. (R) = regression reproducer for the
 * behaviour it names; (G) = structure or compatibility guard. jsdom has no layout, so the class-contract guards
 * pin the hooks and classes; the visual proof of those is the PC rows of the plan.
 *
 * REAL: `MainMenu.svelte`, `CommunityList.svelte`, `SourceDisclosure.svelte`, `RealmPreviewRow.svelte` and the
 * page-mode store. MOCKED: the hub fetch, `globalApi` (inert `openURL`, fixed version), `DBState`, the realm view
 * and the desktop-transport probe (so the Utility row can be shown).
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult, hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { accessibleText, controlName, exposedIcons, paletteClasses } from 'src/lib/a11yNames.test-helpers'

const h = vi.hoisted(() => ({
    desktop: false,
    getRisuHub: vi.fn(async (_arg: unknown): Promise<unknown> => ({ ok: true, cards: [], additionalHTML: '' })),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: h.getRisuHub,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isDesktopTransport: () => h.desktop,
}))

vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

import MainMenu from './MainMenu.svelte'
import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountMainMenu() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(MainMenu, { target, props: {} }))
    flushSync()
    return target
}

async function flushHub() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

beforeEach(() => {
    h.desktop = false
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetPageStorageModeForTests()
    h.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult))
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    DBState.db.hideRealm = false
    OpenRealmStore.set(false)
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    resetPageStorageModeForTests()
    vi.clearAllMocks()
})

function titleSpan(root: ParentNode, text: string): HTMLElement {
    const match = Array.from(root.querySelectorAll<HTMLElement>('[data-part="home-community-title"]')).find(
        (el) => el.textContent?.trim() === text,
    )
    if (!match) throw new Error(`no community title "${text}"`)
    return match
}

function realmTitleButton(root: ParentNode): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => b.getAttribute('aria-label') === language.hubBrowseMore) ?? null
}

function follows(a: Node, b: Node): boolean {
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function openDisclosure(root: ParentNode, text: string): HTMLButtonElement {
    const trigger = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find(
        (b) => b.querySelector('[data-part="home-community-title"]')?.textContent?.trim() === text,
    )
    if (!trigger) throw new Error(`no disclosure "${text}"`)
    trigger.click()
    flushSync()
    return trigger
}

function showUtility() {
    h.desktop = true
    setPageStorageMode({ kind: 'store2' })
}

describe('the Community and source list rows', () => {
    test('(R) S2b1-R1: Discord and Website show the title and no description', () => {
        const text = mountMainMenu().textContent ?? ''
        expect(text).not.toContain(language.homeLinkDiscordDescription)
        expect(text).not.toContain(language.homeLinkWebsiteDescription)
        expect(text).toContain(language.homeLinkDiscordTitle)
        expect(text).toContain(language.homeLinkWebsiteTitle)
    })

    test('(R) S2b1-R2: Source & Issues and Email hold their description inside the disclosure, only while open', () => {
        const target = mountMainMenu()
        expect(target.textContent).not.toContain(language.homeLinkGithubDescription)
        expect(target.textContent).not.toContain(language.homeLinkEmailDescription)

        const trigger = openDisclosure(target, language.homeLinkGithubTitle)
        const card = trigger.parentElement!
        const description = Array.from(card.querySelectorAll('p')).find((p) => p.textContent?.trim() === language.homeLinkGithubDescription)
        expect(description).toBeTruthy()
        expect(trigger.contains(description!)).toBe(false)
        expect(follows(trigger, description!)).toBe(true)
        expect(card.contains(description!)).toBe(true)
    })

    test('(G) S2b1-G2: the aside is labelled, the list has its heading and exactly four rows', () => {
        const target = mountMainMenu()
        const aside = target.querySelector('aside[data-part="home-side"]')
        expect(aside?.getAttribute('aria-label')).toBe(language.homeSideLabel)
        const section = aside!.querySelector('section[data-part="home-community"]')!
        expect(section.querySelector(':scope > h3')?.textContent?.trim()).toBe(language.homeCommunityHeading)
        expect(section.querySelectorAll(':scope > ul > li').length).toBe(4)
    })

    test('(R) S2b1-R5: the version is a p that is the last child of the list, right after the Email row; the announcement follows the list', async () => {
        h.getRisuHub.mockImplementation(async () => ({ ok: true, cards: [], additionalHTML: '<p>banner</p>' } satisfies RisuHubResult))
        const target = mountMainMenu()
        await flushHub()
        const holder = Array.from(target.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent?.includes('test-version'))!
        expect(holder.tagName).toBe('P')
        const section = holder.parentElement!
        expect(section.lastElementChild).toBe(holder)
        const list = holder.previousElementSibling!
        expect(list.tagName).toBe('UL')
        expect(list.lastElementChild!.textContent).toContain(language.homeLinkEmailTitle)
        const banner = Array.from(target.querySelectorAll('div')).find((d) => d.innerHTML.trim() === '<p>banner</p>')!
        expect(follows(section, banner)).toBe(true)
        expect(section.contains(banner)).toBe(false)
    })

    test('(G) S2b1-G1: no exposed icon, no default-palette class, every control named and 44 px tall', async () => {
        const target = mountMainMenu()
        await flushHub()
        openDisclosure(target, language.homeLinkGithubTitle)
        const aside = target.querySelector('aside[data-part="home-side"]')!
        expect(exposedIcons(aside)).toEqual([])
        expect(paletteClasses(aside)).toEqual([])
        const rows = Array.from(aside.querySelectorAll<HTMLElement>('section[data-part="home-community"] button, section[data-part="home-community"] a'))
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            expect(accessibleText(row).length, row.outerHTML).toBeGreaterThan(0)
            expect(row.classList.contains('min-h-11'), row.outerHTML).toBe(true)
        }
        for (const control of Array.from(aside.querySelectorAll('button, a'))) {
            expect(controlName(control).length, control.outerHTML).toBeGreaterThan(0)
        }
    })

    test('(G) S2b1-G7: titles beside a tag or icon keep whole words (class contract)', () => {
        showUtility()
        const target = mountMainMenu()
        openDisclosure(target, language.homeLinkGithubTitle)
        const aside = target.querySelector('aside[data-part="home-side"]')!
        const titles = [
            ...Array.from(aside.querySelectorAll<HTMLElement>('[data-part="home-community-title"]')),
            aside.querySelector<HTMLElement>('[data-part="home-utility-text"]')!,
        ]
        expect(titles.length).toBe(5)
        for (const title of titles) {
            const classes = title.className
            expect(title.classList.contains('flex-1'), classes).toBe(true)
            expect(title.classList.contains('max-w-full'), classes).toBe(true)
            expect(title.classList.contains('[overflow-wrap:break-word]'), classes).toBe(true)
            expect(title.classList.contains('min-w-0'), classes).toBe(false)
        }
        const tags = Array.from(aside.querySelectorAll<HTMLElement>('[data-part="home-upstream-tag"]'))
        // Discord, Website, the two upstream destinations of the open disclosure, and the RisuRealm heading.
        expect(tags.length).toBe(5)
        for (const tag of tags) expect(tag.classList.contains('shrink-0'), tag.outerHTML).toBe(true)
        for (const title of titles) {
            const row = title.parentElement!
            expect(row.classList.contains('flex-wrap'), row.className).toBe(true)
            const icon = row.querySelector(':scope > [data-part="home-row-icon"]')
            expect(icon?.classList.contains('shrink-0'), row.className).toBe(true)
        }
    })
})

describe('the side block order (MC-2831)', () => {
    test('(R) S2b1-R3: with Utility shown, the Utility row precedes RisuRealm, which precedes the Community list', () => {
        showUtility()
        const target = mountMainMenu()
        const utility = target.querySelector('[data-testid="utility-card"]')!
        const realm = realmTitleButton(target)!
        expect(utility).toBeTruthy()
        expect(realm).toBeTruthy()
        expect(follows(utility, realm)).toBe(true)
        expect(follows(realm, titleSpan(target, language.homeLinkDiscordTitle))).toBe(true)
        expect(follows(utility, titleSpan(target, language.homeLinkDiscordTitle))).toBe(true)
    })

    test('(R) S2b1-R4: with hideRealm the Utility row still precedes the list and nothing is fetched', () => {
        showUtility()
        DBState.db.hideRealm = true
        const target = mountMainMenu()
        const utility = target.querySelector('[data-testid="utility-card"]')!
        expect(utility).toBeTruthy()
        expect(follows(utility, titleSpan(target, language.homeLinkDiscordTitle))).toBe(true)
        expect(realmTitleButton(target)).toBeNull()
        expect(h.getRisuHub).not.toHaveBeenCalled()
    })
})

function makeChara(name: string): hubType {
    return {
        name,
        desc: '',
        download: '',
        id: name,
        img: '',
        tags: [],
        viewScreen: 'none',
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: '',
        type: 'character',
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

const populated = (html = ''): RisuHubResult => ({ ok: true, cards: [makeChara('one'), makeChara('two')], additionalHTML: html })

const RESERVED_BODY = 'h-[calc(var(--home-realm-list-max)+2*var(--home-space-3))]'

function has(el: Element | null, ...classes: string[]): boolean {
    return !!el && classes.every((c) => el.classList.contains(c))
}

/** The first ancestor of `from` (starting at `from`) carrying the `@container` class. */
function nearestContainer(from: Element | null): Element | null {
    let el = from
    while (el) {
        if (el.classList.contains('@container')) return el
        el = el.parentElement
    }
    return null
}

const partOf = (root: ParentNode, part: string) => root.querySelector<HTMLElement>(`[data-part="${part}"]`)

describe('the page grid, the Realm panel and the list container (S2b-2)', () => {
    test('(R) S2b2-R1: the Realm pair is keyed to the Home tokens, not to Tailwind lg literals', async () => {
        h.getRisuHub.mockImplementation(async () => populated())
        const target = mountMainMenu()
        await flushHub()
        const html = target.innerHTML
        for (const literal of ['min-h-[296px]', 'lg:min-h-[380px]', 'max-h-[150px]', 'lg:max-h-[200px]']) {
            expect(html, literal).not.toContain(literal)
        }
        const panel = partOf(target, 'home-realm')!
        expect(has(panel, 'min-h-[var(--home-realm-min-height)]')).toBe(true)
        const scroller = target.querySelector('[data-realm-preview-list]')!.firstElementChild!
        expect(has(scroller, 'max-h-[var(--home-realm-list-max)]', 'min-h-0', 'overflow-y-auto')).toBe(true)
    })

    test('(R) S2b2-R2: the landing body is capped and padded by the page tokens; no max-w-4xl ancestor of the side block', async () => {
        const target = mountMainMenu()
        const aside = target.querySelector('aside[data-part="home-side"]')!
        for (let el: Element | null = aside; el; el = el.parentElement) {
            expect(el.classList.contains('max-w-4xl'), el.className).toBe(false)
        }
        const body = partOf(target, 'home-body')!
        expect(has(body, '@container', 'w-full', 'max-w-[var(--home-page-max)]', 'px-[var(--home-main-pad-x)]', 'pt-[var(--home-main-pad-top)]', 'pb-[var(--home-main-pad-bottom)]')).toBe(true)
        expect(body.contains(aside)).toBe(true)
    })

    test('(G) S2b2-G1: the reserved body is the same fixed-height node in every Realm state and across pending to populated', async () => {
        const check = (target: HTMLElement) => {
            const body = partOf(target, 'home-realm-body')
            expect(body, 'reserved body').not.toBeNull()
            expect(has(body, RESERVED_BODY), body!.className).toBe(true)
            return body!
        }

        // consent
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        const consent = mountMainMenu()
        expect(consent.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
        check(consent)
        consent.remove()
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()

        const results: Array<[string, RisuHubResult]> = [
            ['offline', { ok: false, reason: 'offline' }],
            ['failed', { ok: false, reason: 'http', status: 500 }],
            ['empty', { ok: true, cards: [], additionalHTML: '' }],
            ['populated', populated()],
        ]
        for (const [name, result] of results) {
            h.getRisuHub.mockImplementation(async () => result)
            const target = mountMainMenu()
            await flushHub()
            check(target)
            expect(!!target.querySelector('[data-realm-preview-list]'), name).toBe(name === 'populated')
            target.remove()
        }

        // pending, then populated: identity
        const pending = deferred<RisuHubResult>()
        h.getRisuHub.mockImplementation(() => pending.promise)
        const target = mountMainMenu()
        await flushHub()
        expect(target.querySelector('[role="status"]')).not.toBeNull()
        const before = check(target)
        pending.resolve(populated())
        await flushHub()
        expect(target.querySelector('[data-realm-preview-list]')).not.toBeNull()
        expect(check(target)).toBe(before)
    })

    test('(G) S2b2-G2: the two-up classes are on the grid and the aside only with Realm shown', () => {
        showUtility()
        const shown = mountMainMenu()
        const columns = partOf(shown, 'home-columns')!
        expect(has(columns, '@min-[1000px]:grid-cols-[minmax(0,1fr)_var(--home-side-width)]')).toBe(true)
        const aside = shown.querySelector('aside[data-part="home-side"]')!
        expect(has(aside, '@min-[1000px]:col-start-2')).toBe(true)
        expect(has(aside, '@min-[768px]:@max-[1000px]:grid', '@min-[768px]:@max-[1000px]:grid-cols-2', '@min-[768px]:@max-[1000px]:items-start')).toBe(true)
        expect(has(shown.querySelector('[data-testid="utility-card"]'), 'col-span-full')).toBe(true)
        expect(columns.lastElementChild).toBe(aside)
        shown.remove()

        DBState.db.hideRealm = true
        const hidden = mountMainMenu()
        const hiddenColumns = partOf(hidden, 'home-columns')!
        const hiddenAside = hidden.querySelector('aside[data-part="home-side"]')!
        const forbidden = /grid-cols-\[minmax|col-start-2|@max-\[|:grid-cols-2|:grid\b/
        expect(hiddenColumns.className).not.toMatch(forbidden)
        expect(hiddenAside.className).not.toMatch(forbidden)
        expect(hiddenColumns.lastElementChild).toBe(hiddenAside)
        const utility = hidden.querySelector('[data-testid="utility-card"]')!
        expect(follows(utility, titleSpan(hidden, language.homeLinkDiscordTitle))).toBe(true)
    })

    test('(G) S2b2-G3: opening and closing the Realm view leaves the preview as it was, with no new request', async () => {
        h.getRisuHub.mockImplementation(async () => populated())
        const target = mountMainMenu()
        await flushHub()
        expect(h.getRisuHub).toHaveBeenCalledTimes(1)
        OpenRealmStore.set(true)
        flushSync()
        expect(partOf(target, 'home-body')).toBeNull()
        OpenRealmStore.set(false)
        flushSync()
        expect(h.getRisuHub).toHaveBeenCalledTimes(1)
        expect(target.querySelector('[data-realm-preview-list]')).not.toBeNull()
        expect(target.querySelector('[data-testid="upstream-consent-placeholder"]')).toBeNull()
    })

    test('(G) S2b2-G8: the Community section is the list container, with Realm shown and hidden', async () => {
        const check = (target: HTMLElement) => {
            const section = partOf(target, 'home-community')!
            const ul = section.querySelector(':scope > ul')!
            expect(nearestContainer(ul.parentElement)).toBe(section)
            expect(has(section, '@container', 'w-full')).toBe(true)
            expect(has(ul, '@min-[36rem]:grid-cols-2')).toBe(true)
            const aside = target.querySelector('aside[data-part="home-side"]')!
            expect(aside.classList.contains('@container')).toBe(false)
        }
        h.getRisuHub.mockImplementation(async () => populated())
        const shown = mountMainMenu()
        await flushHub()
        check(shown)
        shown.remove()
        DBState.db.hideRealm = true
        check(mountMainMenu())
    })

    test('(G) S2b2-G9: the announcement is the last block, after the list, full width, and hidden with hideRealm', async () => {
        h.getRisuHub.mockImplementation(async () => populated('<p>banner</p>'))
        const target = mountMainMenu()
        await flushHub()
        const aside = target.querySelector('aside[data-part="home-side"]')!
        const announcement = partOf(target, 'home-realm-announcement')!
        expect(announcement).not.toBeNull()
        expect(aside.lastElementChild).toBe(announcement)
        expect(follows(partOf(target, 'home-community')!, announcement)).toBe(true)
        expect(has(announcement, 'col-span-full')).toBe(true)
        expect(announcement.innerHTML).toContain('<p>banner</p>')

        DBState.db.hideRealm = true
        flushSync()
        await flushHub()
        expect(partOf(target, 'home-realm-announcement')).toBeNull()
        DBState.db = { hideRealm: true, realmDirectOpen: false, hideAllImages: false } as never
        flushSync()
        expect(partOf(target, 'home-realm-announcement')).toBeNull()
    })

    test('(G) S2b2-G10 and (R) S2b2-R3: the Realm heading carries the upstream tag outside the title button', async () => {
        h.getRisuHub.mockImplementation(async () => populated())
        const target = mountMainMenu()
        await flushHub()
        const button = realmTitleButton(target)!
        const head = button.parentElement!
        expect(accessibleText(head)).toBe(`${language.hubBrowseMore} (${language.homeSourceUpstreamLabel})`)
        expect(head.tagName).toBe('H3')
        const tag = head.querySelector('[data-part="home-upstream-tag"]')!
        expect(tag.getAttribute('aria-hidden')).toBe('true')
        expect(tag.textContent?.trim()).toBe(language.homeSourceUpstreamLabel)
        expect(button.contains(tag)).toBe(false)
        const marker = Array.from(head.children).find((c) => c.classList.contains('sr-only'))!
        expect(marker.textContent?.trim()).toBe(`(${language.homeSourceUpstreamLabel})`)
        expect(button.contains(marker)).toBe(false)
        expect(follows(button, marker)).toBe(true)
        expect(controlName(button)).toBe(language.hubBrowseMore)
        expect(button.textContent?.trim()).toBe(language.hub)

        expect(has(head, 'flex', 'flex-wrap', 'items-center', 'justify-between')).toBe(true)
        expect(has(button, 'w-fit', 'max-w-full', '[overflow-wrap:break-word]')).toBe(true)
        expect(button.classList.contains('min-w-0')).toBe(false)
        expect(button.classList.contains('flex-1')).toBe(false)
        expect(has(tag, 'shrink-0')).toBe(true)
        expect(head.nextElementSibling?.textContent).toContain(language.hubDescription)
    })
})
