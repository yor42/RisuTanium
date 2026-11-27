// @vitest-environment jsdom

/**
 * `RealmPopUp.svelte` carries the overlay vocabulary on its real elements (#438 W3-3). The REAL component is mounted; each element is found
 * by tag, id, role, aria-label, text or structure, never by its part, and the part is asserted on it together with its direct parent. The
 * outline tests pin the whole nesting for the full card, the minimal card and the hidden-image branch, so a part that is dropped, renamed,
 * swapped with a sibling or its parent, moved into a comment or moved inward or outward fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `src/ts/characterCards` (hub URL and download), `src/ts/alert` and `src/ts/stores.svelte` (a plain database). Synthetic data only;
 * nothing contacts a host.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import type { hubType } from 'src/ts/characterCards'

const downloadRisuHubSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    downloadRisuHub: downloadRisuHubSpy,
    getRealmInfo: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false, blockedRealmCreators: [] } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { DBState } from 'src/ts/stores.svelte'
import RealmPopUp from './RealmPopUp.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const showToast = vi.fn()

function fullCard(): hubType {
    return {
        name: 'Parts card',
        desc: 'A long description',
        download: '12',
        id: 'layout-card',
        img: 'cover.png',
        tags: ['tag-one', 'tag-two'],
        viewScreen: 'none',
        hasLore: true,
        hasEmotion: true,
        hasAsset: true,
        hot: 0,
        license: 'CC BY 4.0',
        type: 'character',
        creator: 'creator-1',
        authorname: 'Author',
        original: 'orig-1',
    }
}

function minimalCard(): hubType {
    return {
        ...fullCard(),
        tags: [],
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        authorname: undefined,
        original: undefined,
        creator: undefined,
    }
}

function mountPopUp(card: hubType = fullCard()) {
    const main = document.createElement('main')
    document.body.appendChild(main)
    const target = document.createElement('div')
    main.appendChild(target)
    const props = $state({ openedData: card as hubType | null })
    mounted.push(mount(RealmPopUp, { target, props }))
    flushSync()
    return { target, props }
}

beforeEach(() => {
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    showToast.mockReset()
    downloadRisuHubSpy.mockReset()
    DBState.db.hideAllImages = false
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element matching the selector whose trimmed text is exactly `text` (the test fails when there is none or more than one). */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() === text)
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const FULL_OUTLINE = 'modal-realm-popup(modal-frame('
    + 'modal-header(modal-title modal-text modal-action modal-close) '
    + 'modal-body(modal-text modal-list(modal-text modal-text) modal-text modal-text modal-text modal-text) '
    + 'modal-footer(modal-controls(modal-action modal-action) modal-action modal-controls(modal-action modal-action))))'

describe('RealmPopUp overlay parts', () => {
    test('acceptance: the backdrop layer and the dialog frame', () => {
        const { target } = mountPopUp()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-realm-popup')
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        expect(partOf(dialog)).toBe('modal-frame')
        expect(dialog.parentElement).toBe(layer)
    })

    test('acceptance: the title, author, forked and close sit in the header', () => {
        const { target } = mountPopUp()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const title = target.querySelector('#realm-popup-title') as HTMLElement
        expect(partOf(title)).toBe('modal-title')
        const column = title.parentElement as HTMLElement
        expect(partOf(column)).toBeNull()
        const header = column.parentElement as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header).toBe(dialog.firstElementChild)
        const author = byText(target, 'span', fillLang(language.uiCommon.madeBy, { name: 'Author' }))
        expect(partOf(author)).toBe('modal-text')
        expect(author.parentElement).toBe(column)
        const forked = byText(target, 'button', language.uiCommon.forked)
        expect(partOf(forked)).toBe('modal-action')
        expect(forked.parentElement).toBe(column)
        const close = target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
    })

    test('acceptance: the body holds the cover, description, tags, popularity and badges', () => {
        const { target } = mountPopUp()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const header = dialog.firstElementChild as HTMLElement
        const img = target.querySelector('img') as HTMLElement
        const body = img.parentElement as HTMLElement
        expect(partOf(body)).toBe('modal-body')
        expect(body).toBe(header.nextElementSibling)
        const heading = byText(target, 'h2', language.realmDescriptionHeading)
        expect(partOf(heading)).toBe('modal-text')
        const detailsColumn = heading.parentElement!.parentElement as HTMLElement
        expect(partOf(detailsColumn)).toBeNull()
        expect(detailsColumn.parentElement).toBe(body)
        for (const tag of ['tag-one', 'tag-two']) {
            const chip = byText(target, 'div', tag)
            expect(partOf(chip), tag).toBe('modal-text')
            expect(partOf(chip.parentElement), tag).toBe('modal-list')
            expect(chip.parentElement!.parentElement, tag).toBe(detailsColumn)
        }
        const popularity = byText(target, 'span', language.popularityLevel.replace('{}', '12'))
        expect(partOf(popularity)).toBe('modal-text')
        const badgeRow = popularity.parentElement as HTMLElement
        expect(partOf(badgeRow)).toBeNull()
        expect(badgeRow.parentElement).toBe(detailsColumn)
        for (const label of [language.realmBadgeEmotion, language.realmBadgeAssets, language.realmBadgeLore]) {
            const badge = byText(target, 'span', label)
            expect(partOf(badge), label).toBe('modal-text')
            expect(badge.parentElement, label).toBe(badgeRow)
        }
    })

    test('acceptance: the footer holds the two main actions and the More disclosure', () => {
        const { target } = mountPopUp()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const footer = dialog.lastElementChild as HTMLElement
        expect(partOf(footer)).toBe('modal-footer')
        const importButton = byText(target, 'button', language.realmImportAndChat)
        const copyButton = byText(target, 'button', language.realmCopyLink)
        for (const button of [importButton, copyButton]) {
            expect(partOf(button)).toBe('modal-action')
            expect(partOf(button.parentElement)).toBe('modal-controls')
            expect(button.parentElement!.parentElement).toBe(footer)
        }
        expect(copyButton.parentElement).toBe(importButton.parentElement)
        const summary = byText(target, 'summary', language.realmDetailMore)
        expect(partOf(summary)).toBe('modal-action')
        const details = summary.parentElement as HTMLElement
        expect(details.tagName).toBe('DETAILS')
        expect(partOf(details)).toBeNull()
        expect(details.parentElement).toBe(footer)
        for (const name of [language.realmReport, language.blockRealmCreator]) {
            const button = byText(target, 'button', name)
            expect(partOf(button), name).toBe('modal-action')
            expect(partOf(button.parentElement), name).toBe('modal-controls')
            expect(button.parentElement, name).not.toBe(importButton.parentElement)
            expect(button.parentElement!.parentElement, name).toBe(details)
        }
    })

    test('acceptance: the whole nesting of the full card', () => {
        const { target } = mountPopUp()
        expect(outline(target)).toBe(FULL_OUTLINE)
    })

    test('acceptance: the whole nesting of the minimal card', () => {
        const { target } = mountPopUp(minimalCard())
        expect(outline(target)).toBe('modal-realm-popup(modal-frame('
            + 'modal-header(modal-title modal-close) '
            + 'modal-body(modal-text modal-text) '
            + 'modal-footer(modal-controls(modal-action modal-action) modal-action modal-controls(modal-action))))')
    })

    test('acceptance: with hidden images the placeholder carries no part and sits in the body', () => {
        DBState.db.hideAllImages = true
        const { target } = mountPopUp()
        expect(target.querySelector('img')).toBeNull()
        const placeholder = byText(target, 'div', '?')
        expect(partOf(placeholder)).toBeNull()
        expect(partOf(placeholder.parentElement)).toBe('modal-body')
        expect(partOf(placeholder.firstElementChild)).toBeNull()
        expect(outline(target)).toBe(FULL_OUTLINE)
    })

    test('guard: the h1 column, the cover, the details column, the description, the badge row and details carry no part', () => {
        const { target } = mountPopUp()
        const title = target.querySelector('#realm-popup-title') as HTMLElement
        expect(partOf(title.parentElement)).toBeNull()
        expect(partOf(target.querySelector('img'))).toBeNull()
        const description = target.querySelector('[data-testid="realm-popup-description"]') as HTMLElement
        expect(partOf(description)).toBeNull()
        expect(partOf(description.parentElement)).toBeNull()
        expect(partOf(description.parentElement!.parentElement)).toBeNull()
        expect(partOf(byText(target, 'span', language.popularityLevel.replace('{}', '12')).parentElement)).toBeNull()
        expect(partOf(target.querySelector('details'))).toBeNull()
    })

    test('guard: close empties the popup and Import calls the download once', () => {
        const { target, props } = mountPopUp()
        byText(target, 'button', language.realmImportAndChat).click()
        flushSync()
        expect(downloadRisuHubSpy).toHaveBeenCalledTimes(1)
        expect(downloadRisuHubSpy).toHaveBeenCalledWith('layout-card', { creator: 'creator-1' })
        expect(props.openedData).toBeNull()
        const second = mountPopUp()
        ;(second.target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement).click()
        flushSync()
        expect(second.props.openedData).toBeNull()
    })
})
