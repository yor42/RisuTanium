// @vitest-environment happy-dom

/**
 * Coverage for `MainMenu.svelte`'s Related Links grid: the Email card is a
 * second disclosure (reusing `SourceDisclosure.svelte` with its own two
 * `mailto:` destinations), the GitHub disclosure's `https:` anchors sit
 * side by side on one page with the Email disclosure's `mailto:` anchors
 * and must keep their different `target` treatment, the Discord and
 * Website plain-link cards carry the same grey upstream marker the
 * disclosures use, and two disclosure instances are mounted at once, which
 * is where any cross-talk between their window-scoped Escape handling or
 * document-level click handling would show up.
 *
 * `MainMenu.hubStates.svelte.test.ts` asserts the Community list only for
 * `hideRealm: true`, where the realm card is absent. The first test below
 * carries the list's four-entry count with the realm card present, alongside
 * the complementary check that exactly two of the entries are disclosures.
 *
 * Mocks follow the precedent in `MainMenu.hubStates.svelte.test.ts`:
 * `src/ts/characterCards` so no network fetch fires, `src/ts/globalApi.svelte`
 * so `openURL`/`getVersionString` are inert, `src/ts/stores.svelte` for a
 * controllable `DBState.db`, and `./Realm/RealmMain.svelte` stubbed since
 * `$OpenRealmStore` never becomes true here.
 *
 * Not covered here, and not testable under `happy-dom` (see
 * `SourceDisclosure.svelte.test.ts`'s header for the full argument):
 * Enter/Space activation of a trigger, and the slide/fade transitions.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [], additionalHTML: '' })),
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
        // `src/ts/upstreamAgreement.ts` reads and writes this store directly,
        // never through `src/ts/alert.ts` -- a mock lacking it leaves the
        // agreement helper writing to `undefined`.
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

import MainMenu from './MainMenu.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { openURL } from 'src/ts/globalApi.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountMainMenu() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(MainMenu, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return target
}

// This suite's own assertions are about the Related Links grid, not the
// agreement gate, so acceptance is seeded through the module for every case.
beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    DBState.db.hideRealm = false
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

// The two disclosure triggers are the only elements in the list carrying
// aria-expanded, and each is identified by the title text inside it rather
// than DOM order, so a reorder of the entries can't silently swap which
// assertions apply to which row.
function findTrigger(target: HTMLElement, titleText: string) {
    const buttons = Array.from(target.querySelectorAll('button[aria-expanded]')) as HTMLButtonElement[]
    const match = buttons.find((b) => b.querySelector('[data-part="home-community-title"]')?.textContent === titleText)
    if (!match) {
        throw new Error(`no disclosure trigger found with title "${titleText}"`)
    }
    return match
}

// A disclosure's revealed <ul> mounts as a sibling of its trigger inside
// the same wrapping <div> (SourceDisclosure's own cardEl), so the trigger's
// parentElement scopes queries to that one disclosure's own anchors and
// excludes the other, currently-mounted disclosure entirely.
function card(trigger: HTMLButtonElement) {
    return trigger.parentElement as HTMLElement
}

function openDisclosure(target: HTMLElement, titleText: string) {
    const trigger = findTrigger(target, titleText)
    trigger.click()
    flushSync()
    return trigger
}

// Plain link rows (Discord, Website) carry no aria-expanded at all -- they
// are <button onclick> elements, not disclosures -- so they have to be
// found the same way, by their title text, from the remaining buttons.
function findPlainLinkButton(target: HTMLElement, titleText: string) {
    const buttons = Array.from(target.querySelectorAll('button:not([aria-expanded])')) as HTMLButtonElement[]
    const match = buttons.find((b) => b.querySelector('[data-part="home-community-title"]')?.textContent === titleText)
    if (!match) {
        throw new Error(`no plain link button found with title "${titleText}"`)
    }
    return match
}

// `happy-dom` does not compute an element's accessible name (there is no
// `aria-label`-replaces-content-tree logic here), so it is built by hand:
// concatenate every text node under `el` in DOM order, skipping any subtree
// rooted at an `aria-hidden="true"` element. That is what a real accessible
// name would be for this button once `aria-label` is gone -- title text,
// then the sr-only marker -- and it excludes the visible-but-decorative tag,
// which carries `aria-hidden="true"` itself. This can fail two ways that
// matter here: if the marker's `sr-only` span is removed (or never
// rendered), its text drops out of the concatenation entirely, which the
// ordering assertions below would catch as a missing marker. If the tag's
// `aria-hidden` is removed instead, the ordering assertions still pass --
// the tag's text carries no parentheses, so `indexOf('(...)')` still finds
// the sr-only marker -- but the later assertion that the tag is
// `aria-hidden="true"` fails.
function accessibleName(el: Element): string {
    let name = ''
    function walk(node: Node) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).getAttribute('aria-hidden') === 'true') {
            return
        }
        if (node.nodeType === Node.TEXT_NODE) {
            name += node.textContent ?? ''
        }
        node.childNodes.forEach(walk)
    }
    walk(el)
    return name.replace(/\s+/g, ' ').trim()
}

describe('MainMenu.svelte: the Community list with two disclosure rows present', () => {
    test('the list has four entries, two of them disclosures, and the realm card is shown beside it', () => {
        const target = mountMainMenu()
        const list = target.querySelector('[data-part="home-community"] > ul')
        expect(list).toBeTruthy()
        expect(list!.querySelectorAll(':scope > li').length).toBe(4)
        // Confirms both the GitHub and the Email entry are disclosures, not
        // just that the list has four entries -- a count alone would not
        // distinguish "two disclosures" from "one disclosure plus an
        // unrelated aria-expanded element elsewhere in the list".
        expect(list!.querySelectorAll('[aria-expanded]').length).toBe(2)
        const aside = target.querySelector('[data-part="home-side"]')
        expect(aside).toBeTruthy()
        expect(Array.from(aside!.querySelectorAll('button')).some((b) => b.getAttribute('aria-label') === language.hubBrowseMore)).toBe(true)
    })

    test('one of the two aria-expanded elements is the GitHub trigger and the other is the Email trigger', () => {
        const target = mountMainMenu()
        // Both throw (failing the test) if either title is missing.
        findTrigger(target, language.homeLinkGithubTitle)
        findTrigger(target, language.homeLinkEmailTitle)
    })
})

describe('MainMenu.svelte: the Email card is a disclosure with two mailto: destinations', () => {
    test('opening it reveals exactly the fork and upstream addresses, fork first, by exact URL', () => {
        const target = mountMainMenu()
        openDisclosure(target, language.homeLinkEmailTitle)
        const trigger = findTrigger(target, language.homeLinkEmailTitle)
        const anchors = Array.from(card(trigger).querySelectorAll('a')) as HTMLAnchorElement[]

        expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
            'mailto:yoonch1022@naver.com',
            'mailto:support@risuai.net',
        ])
    })

    test('the upstream address carries the upstream marker in its accessible name; the fork address does not', () => {
        const target = mountMainMenu()
        openDisclosure(target, language.homeLinkEmailTitle)
        const trigger = findTrigger(target, language.homeLinkEmailTitle)
        const [forkAddress, upstreamAddress] = Array.from(card(trigger).querySelectorAll('a')) as HTMLAnchorElement[]

        expect(forkAddress.hasAttribute('aria-label')).toBe(false)
        expect(upstreamAddress.getAttribute('aria-label')).toBe(
            `${language.homeSourceEmailUpstreamLabel} (${language.homeSourceUpstreamLabel})`,
        )
    })

    test('activating the fork address calls openURL with exactly that mailto: URL', () => {
        const target = mountMainMenu()
        openDisclosure(target, language.homeLinkEmailTitle)
        const trigger = findTrigger(target, language.homeLinkEmailTitle)
        const [forkAddress] = Array.from(card(trigger).querySelectorAll('a')) as HTMLAnchorElement[]

        forkAddress.click()
        flushSync()

        expect(openURL).toHaveBeenCalledWith('mailto:yoonch1022@naver.com')
        // Activating an item is one of SourceDisclosure's own close paths;
        // reusing the component for Email doesn't bypass it.
        expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })
})

describe('MainMenu.svelte: mailto: and https: anchors keep their different target treatment side by side', () => {
    test('the GitHub disclosure\'s https: anchors carry target="_blank"; the Email disclosure\'s mailto: anchors omit it', () => {
        const target = mountMainMenu()

        const githubTrigger = openDisclosure(target, language.homeLinkGithubTitle)
        const githubAnchors = Array.from(card(githubTrigger).querySelectorAll('a')) as HTMLAnchorElement[]
        expect(githubAnchors.length).toBeGreaterThan(0)
        for (const a of githubAnchors) {
            expect(a.getAttribute('target')).toBe('_blank')
            expect(a.getAttribute('rel')).toBe('noopener noreferrer')
        }

        const emailTrigger = openDisclosure(target, language.homeLinkEmailTitle)
        const emailAnchors = Array.from(card(emailTrigger).querySelectorAll('a')) as HTMLAnchorElement[]
        expect(emailAnchors.length).toBeGreaterThan(0)
        for (const a of emailAnchors) {
            expect(a.hasAttribute('target')).toBe(false)
            expect(a.getAttribute('rel')).toBe('noopener noreferrer')
        }
    })
})

describe('MainMenu.svelte: Discord and Website carry the upstream marker (MC-054), Email and GitHub do not need it on the card itself', () => {
    test('Discord\'s accessible name carries the upstream marker, with the visible pill aria-hidden', () => {
        const target = mountMainMenu()
        const discordButton = findPlainLinkButton(target, language.homeLinkDiscordTitle)

        // `aria-label` on the button *replaces* its accessible name,
        // discarding the description below, so it must stay absent here.
        // Checking only that the attribute is gone would not prove the
        // marker survived -- a version that dropped the marker outright
        // would also pass that check -- so the composed-name assertions
        // below are what actually verify it.
        expect(discordButton.hasAttribute('aria-label')).toBe(false)

        const name = accessibleName(discordButton)
        const titleIndex = name.indexOf(language.homeLinkDiscordTitle)
        const descriptionIndex = name.indexOf(language.homeLinkDiscordDescription)
        const markerIndex = name.indexOf(`(${language.homeSourceUpstreamLabel})`)
        // The row shows no description (MC-2832), so the name is the title
        // then the marker: the title is found first, the marker follows it,
        // and the description is absent. A missing marker (indexOf -1) or a
        // description back in the row fails here.
        expect(titleIndex).toBe(0)
        expect(descriptionIndex).toBe(-1)
        expect(markerIndex).toBeGreaterThan(titleIndex)

        // The visible tag duplicates the marker's text for sighted users
        // but must stay out of the accessible name, which is why it is
        // aria-hidden rather than being the sole carrier of the marker. It
        // is found by its hook: the row's leading icon is aria-hidden too.
        const pill = discordButton.querySelector('[data-part="home-upstream-tag"]')
        expect(pill).toBeTruthy()
        expect(pill!.getAttribute('aria-hidden')).toBe('true')
        expect(pill!.textContent?.trim()).toBe(language.homeSourceUpstreamLabel)
    })

    test('Website\'s accessible name carries the upstream marker, with the visible pill aria-hidden', () => {
        const target = mountMainMenu()
        const websiteButton = findPlainLinkButton(target, language.homeLinkWebsiteTitle)

        expect(websiteButton.hasAttribute('aria-label')).toBe(false)

        const name = accessibleName(websiteButton)
        const titleIndex = name.indexOf(language.homeLinkWebsiteTitle)
        const descriptionIndex = name.indexOf(language.homeLinkWebsiteDescription)
        const markerIndex = name.indexOf(`(${language.homeSourceUpstreamLabel})`)
        expect(titleIndex).toBe(0)
        expect(descriptionIndex).toBe(-1)
        expect(markerIndex).toBeGreaterThan(titleIndex)

        const pill = websiteButton.querySelector('[data-part="home-upstream-tag"]')
        expect(pill).toBeTruthy()
        expect(pill!.getAttribute('aria-hidden')).toBe('true')
        expect(pill!.textContent?.trim()).toBe(language.homeSourceUpstreamLabel)
    })

    test('Discord and Website still navigate via openURL with their own plain href on click', () => {
        const target = mountMainMenu()
        findPlainLinkButton(target, language.homeLinkDiscordTitle).click()
        flushSync()
        expect(openURL).toHaveBeenCalledWith('https://discord.gg/Exy3NrqkGm')

        findPlainLinkButton(target, language.homeLinkWebsiteTitle).click()
        flushSync()
        expect(openURL).toHaveBeenCalledWith('https://risuai.net')
    })
})

describe('MainMenu.svelte: the two disclosures do not cross-talk', () => {
    test('each disclosure gets its own aria-controls id, so the two never collide', () => {
        const target = mountMainMenu()
        const githubTrigger = openDisclosure(target, language.homeLinkGithubTitle)
        const emailTrigger = openDisclosure(target, language.homeLinkEmailTitle)

        const githubListId = githubTrigger.getAttribute('aria-controls')
        const emailListId = emailTrigger.getAttribute('aria-controls')
        expect(githubListId).toBeTruthy()
        expect(emailListId).toBeTruthy()
        expect(githubListId).not.toBe(emailListId)
    })

    test('Escape closes only the currently-open disclosure and returns focus only to that one\'s own trigger', () => {
        const target = mountMainMenu()
        const githubTrigger = openDisclosure(target, language.homeLinkGithubTitle)
        const emailTrigger = findTrigger(target, language.homeLinkEmailTitle)
        expect(emailTrigger.getAttribute('aria-expanded')).toBe('false')

        const githubItem = card(githubTrigger).querySelector('a') as HTMLAnchorElement
        githubItem.focus()
        expect(document.activeElement).toBe(githubItem)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()

        expect(githubTrigger.getAttribute('aria-expanded')).toBe('false')
        // Focus returns to the GitHub trigger specifically, not to the
        // Email trigger or nowhere at all -- a shared (rather than
        // per-instance) triggerEl reference would misdirect this.
        expect(document.activeElement).toBe(githubTrigger)
        // The Email disclosure was never open and never had an active
        // Escape listener; it stays untouched.
        expect(emailTrigger.getAttribute('aria-expanded')).toBe('false')
    })

    // Each SourceDisclosure instance closes itself on any click landing
    // outside its own card (one of the four close paths documented on the
    // component). Clicking the other disclosure's trigger is, from the
    // first instance's point of view, exactly such an outside click, so
    // opening the second disclosure closes the first as a side effect of
    // that per-instance logic -- not because the two instances share any
    // mutable state. This is the observable, current behaviour of two
    // independently-acting instances, not a targeted "only one open at a
    // time" feature; it holds symmetrically regardless of which was
    // opened first.
    test('opening the Email disclosure while the GitHub one is open closes the GitHub one, and never leaves both open', () => {
        const target = mountMainMenu()
        const githubTrigger = openDisclosure(target, language.homeLinkGithubTitle)
        expect(githubTrigger.getAttribute('aria-expanded')).toBe('true')

        const emailTrigger = openDisclosure(target, language.homeLinkEmailTitle)

        expect(emailTrigger.getAttribute('aria-expanded')).toBe('true')
        expect(githubTrigger.getAttribute('aria-expanded')).toBe('false')
    })

    test('the same holds in the opposite order: opening GitHub while Email is open closes Email', () => {
        const target = mountMainMenu()
        const emailTrigger = openDisclosure(target, language.homeLinkEmailTitle)
        expect(emailTrigger.getAttribute('aria-expanded')).toBe('true')

        const githubTrigger = openDisclosure(target, language.homeLinkGithubTitle)

        expect(githubTrigger.getAttribute('aria-expanded')).toBe('true')
        expect(emailTrigger.getAttribute('aria-expanded')).toBe('false')
    })
})
