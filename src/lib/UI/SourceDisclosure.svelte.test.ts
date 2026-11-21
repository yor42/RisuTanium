// @vitest-environment happy-dom

/**
 * Component-level coverage for `SourceDisclosure.svelte` (Stage 3 of the
 * home-screen rework): the disclosure trigger's `aria-expanded`/
 * `aria-controls` wiring, its four separately-specified close paths, focus
 * return on Escape, the four fixed destinations and their URLs, the
 * upstream marker's accessible-name placement, and the anchors' `rel`.
 *
 * `src/ts/globalApi.svelte` is mocked so `openURL` can be asserted on
 * without ever calling `window.open` or the Tauri `open` plugin.
 * `src/lang` is used unmocked: its default English strings are what the
 * upstream-marker and issues-label assertions check against.
 *
 * One documented gap: a native `<button>` gets Enter/Space activation from
 * the browser itself, not from application code, and `SourceDisclosure`
 * adds no explicit keydown handler for either key -- it relies entirely on
 * that native behaviour, which is the correct design (see the component's
 * own header comment). `happy-dom` does not implement this default action:
 * dispatching a synthetic `keydown` with `key: 'Enter'` or `key: ' '` on a
 * plain `<button>` produces zero `click` events, verified directly against
 * both a bare `happy-dom` button and the real mounted component before this
 * file was written. A test that dispatched such a keydown and asserted the
 * disclosure opened would fail identically whether the implementation is
 * correct or the trigger's `onclick` were deleted outright -- it cannot
 * discriminate between the two, so it would prove nothing and is not
 * written here. This is the same category of gap the plan already records
 * for simulated Tab traversal. What the tests below do cover is the
 * condition Enter/Space activation actually depends on: a real `<button>`
 * element whose open/close state is driven by a `click` handler.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import SourceDisclosure, { type Destination } from './SourceDisclosure.svelte'
import { openURL } from 'src/ts/globalApi.svelte'

const EXPECTED_URLS = [
    'https://github.com/yor42/RisuTanium',
    'https://github.com/yor42/RisuTanium/issues',
    'https://github.com/kwaroran/RisuAI',
    'https://github.com/kwaroran/RisuAI/issues',
]

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountDisclosure(destinations?: Destination[]) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(SourceDisclosure, {
        target,
        props: {
            title: 'Source & Issues',
            description: 'Browse the source code or file an issue on GitHub.',
            ...(destinations ? { destinations } : {}),
        },
    })
    mountedInstances.push(instance)
    flushSync()
    return target
}

function trigger(target: HTMLElement) {
    return target.querySelector('button') as HTMLButtonElement
}

function items(target: HTMLElement) {
    return Array.from(target.querySelectorAll('a')) as HTMLAnchorElement[]
}

function open(target: HTMLElement) {
    trigger(target).click()
    flushSync()
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

describe('SourceDisclosure.svelte: trigger state', () => {
    test('aria-expanded is false closed and true open; aria-controls points at the revealed list id', () => {
        const target = mountDisclosure()
        const btn = trigger(target)
        expect(btn.getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()

        open(target)

        expect(btn.getAttribute('aria-expanded')).toBe('true')
        const list = target.querySelector('ul')
        expect(list).toBeTruthy()
        expect(list!.id).toBeTruthy()
        expect(btn.getAttribute('aria-controls')).toBe(list!.id)
    })

    test('clicking the trigger again closes it', () => {
        const target = mountDisclosure()
        open(target)
        expect(trigger(target).getAttribute('aria-expanded')).toBe('true')

        trigger(target).click()
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()
    })
})

describe('SourceDisclosure.svelte: the four close paths', () => {
    test('Escape, dispatched on window while an item holds focus, closes it', () => {
        const target = mountDisclosure()
        open(target)
        const item = items(target)[0]
        item.focus()
        expect(document.activeElement).toBe(item)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()
    })

    test('activating an item closes it', () => {
        const target = mountDisclosure()
        open(target)
        items(target)[0].click()
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()
    })

    test('clicking outside the card closes it', () => {
        const target = mountDisclosure()
        open(target)

        const outside = document.createElement('div')
        document.body.appendChild(outside)
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()
        outside.remove()
    })

    test('focus leaving the card (focusout with a relatedTarget outside it) closes it', () => {
        const target = mountDisclosure()
        open(target)

        const outside = document.createElement('button')
        document.body.appendChild(outside)
        const item = items(target)[0]
        item.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(target.querySelector('ul')).toBeNull()
        outside.remove()
    })

    test('focus moving to another item inside the card does not close it', () => {
        const target = mountDisclosure()
        open(target)

        const [first, second] = items(target)
        first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: second }))
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('true')
    })
})

describe('SourceDisclosure.svelte: focus return on Escape', () => {
    test('focus returns to the trigger after Escape', () => {
        // happy-dom tracks document.activeElement and honours explicit
        // .focus() calls but cannot simulate native Tab traversal, so the
        // prior focus state is set up directly rather than by dispatching
        // Tab -- a version relying on simulated Tab would silently no-op.
        const target = mountDisclosure()
        open(target)
        const item = items(target)[0]
        item.focus()
        expect(document.activeElement).toBe(item)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()

        expect(document.activeElement).toBe(trigger(target))
    })

    test('clicking outside to close does not move focus to the trigger', () => {
        const target = mountDisclosure()
        open(target)
        const item = items(target)[0]
        item.focus()

        const outside = document.createElement('div')
        document.body.appendChild(outside)
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        flushSync()

        expect(document.activeElement).not.toBe(trigger(target))
        outside.remove()
    })
})

describe('SourceDisclosure.svelte: the four destinations', () => {
    test('all four render with exactly the expected URLs, in fork-then-upstream order', () => {
        const target = mountDisclosure()
        open(target)
        const hrefs = items(target).map((a) => a.getAttribute('href'))
        expect(hrefs).toEqual(EXPECTED_URLS)
    })

    test('activating each item calls openURL with that exact URL', () => {
        for (const url of EXPECTED_URLS) {
            const target = mountDisclosure()
            open(target)
            const match = items(target).find((a) => a.getAttribute('href') === url)
            expect(match).toBeTruthy()
            match!.click()
            flushSync()
            expect(openURL).toHaveBeenCalledWith(url)
        }
    })

    test('every anchor carries rel="noopener noreferrer"', () => {
        const target = mountDisclosure()
        open(target)
        for (const a of items(target)) {
            expect(a.getAttribute('rel')).toBe('noopener noreferrer')
        }
    })

    test('every anchor (all four are https: destinations here) also carries target="_blank"', () => {
        const target = mountDisclosure()
        open(target)
        for (const a of items(target)) {
            expect(a.getAttribute('target')).toBe('_blank')
        }
    })

    test('the two upstream entries carry the upstream marker in their accessible name; the two fork entries do not', () => {
        const target = mountDisclosure()
        open(target)
        const [forkRepo, forkIssues, upstreamRepo, upstreamIssues] = items(target)

        expect(forkRepo.hasAttribute('aria-label')).toBe(false)
        expect(forkIssues.hasAttribute('aria-label')).toBe(false)

        expect(upstreamRepo.getAttribute('aria-label')).toBe(
            `${language.homeSourceRepoLabel} (${language.homeSourceUpstreamLabel})`,
        )
        expect(upstreamIssues.getAttribute('aria-label')).toBe(
            `${language.homeSourceIssuesLabel} (${language.homeSourceUpstreamLabel})`,
        )

        // The visible pill duplicating the marker is decorative only: a
        // test asserting solely on visible text would pass even if the
        // marker were never attached to the accessible name above.
        expect(upstreamRepo.querySelector('[aria-hidden="true"]')).toBeTruthy()
    })
})

describe('SourceDisclosure.svelte: custom mailto: destinations (the Email card\'s reuse of this component)', () => {
    // The GitHub disclosure's own four destinations are all https:, so the
    // suite above cannot exercise the mailto: branch of the target
    // attribute at all -- these mount the component with mailto:
    // destinations directly, the same shape MainMenu.svelte's Email card
    // passes in.
    const MAILTO_DESTINATIONS: Destination[] = [
        { label: 'Contact the maintainer', href: 'mailto:yoonch1022@naver.com', upstream: false },
        { label: 'Contact official support', href: 'mailto:support@risuai.net', upstream: true },
    ]

    test('mailto: anchors omit target="_blank" while still carrying rel="noopener noreferrer"', () => {
        const target = mountDisclosure(MAILTO_DESTINATIONS)
        open(target)
        const anchors = items(target)
        expect(anchors).toHaveLength(2)
        for (const a of anchors) {
            expect(a.hasAttribute('target')).toBe(false)
            expect(a.getAttribute('rel')).toBe('noopener noreferrer')
        }
    })

    test('mailto: destinations render with exactly the expected addresses and the upstream one carries the marker', () => {
        const target = mountDisclosure(MAILTO_DESTINATIONS)
        open(target)
        const [fork, upstream] = items(target)

        expect(fork.getAttribute('href')).toBe('mailto:yoonch1022@naver.com')
        expect(upstream.getAttribute('href')).toBe('mailto:support@risuai.net')

        expect(fork.hasAttribute('aria-label')).toBe(false)
        expect(upstream.getAttribute('aria-label')).toBe(
            `Contact official support (${language.homeSourceUpstreamLabel})`,
        )
    })

    test('activating a mailto: item still closes the disclosure and calls openURL with the mailto: URL', () => {
        const target = mountDisclosure(MAILTO_DESTINATIONS)
        open(target)
        items(target)[0].click()
        flushSync()

        expect(trigger(target).getAttribute('aria-expanded')).toBe('false')
        expect(openURL).toHaveBeenCalledWith('mailto:yoonch1022@naver.com')
    })
})
