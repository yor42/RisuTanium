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
import type { RisuHubResult } from 'src/ts/characterCards'
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
import { DBState } from 'src/ts/stores.svelte'
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
        // Discord, Website, and the two upstream destinations of the open disclosure.
        expect(tags.length).toBe(4)
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
