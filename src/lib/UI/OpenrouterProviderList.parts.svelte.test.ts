// @vitest-environment jsdom

/**
 * `OpenrouterProviderList.svelte` carries the overlay vocabulary on the elements of its opened picker only (#438 W3-5). The REAL component is
 * mounted with the real shared TextInput; each element is found by tag, aria-label, text or structure, never by its part, and the part is
 * asserted on it together with its direct parent. The inline trigger and the shared TextInput carry no part.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import OpenrouterProviderList from './OpenrouterProviderList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountList(open: boolean, onChange?: (v: string) => void): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OpenrouterProviderList, {
        target,
        props: { value: 'alpha', options: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' }], onChange },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    if (open) {
        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
    }
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element of the selector whose trimmed text is exactly `text`. */
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

describe('OpenrouterProviderList overlay parts', () => {
    test('acceptance: the layer identity root and the frame', () => {
        const target = mountList(true)
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-openrouter-provider-list')
        expect(layer.parentElement).toBe(target)
        const frame = layer.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(layer)
    })

    test('acceptance: the header, close and title', () => {
        const target = mountList(true)
        const frame = (target.firstElementChild as HTMLElement).firstElementChild as HTMLElement
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        const close = frame.querySelector(`button[aria-label="${language.settingsPage.back}"]`) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
        const title = byText(frame, 'h1', language.provider)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
    })

    test('acceptance: the shared custom field carries no part and sits in the frame', () => {
        const target = mountList(true)
        const frame = (target.firstElementChild as HTMLElement).firstElementChild as HTMLElement
        const input = frame.querySelector('input[type="text"]') as HTMLInputElement
        expect(partOf(input)).toBeNull()
        expect(partOf(input.parentElement)).toBe('modal-frame')
        expect(partOf(frame.querySelector('span.sr-only'))).toBeNull()
    })

    test('acceptance: provider rows and the whole outline', () => {
        const target = mountList(true)
        const frame = (target.firstElementChild as HTMLElement).firstElementChild as HTMLElement
        for (const text of ['Alpha (alpha)', 'Beta (beta)']) {
            const row = byText(frame, 'button', text)
            expect(partOf(row)).toBe('modal-row')
            expect(row.parentElement).toBe(frame)
        }
        expect(outline(target)).toBe('modal-openrouter-provider-list(modal-frame(modal-header(modal-close modal-title) modal-row modal-row))')
    })

    test('guard: closed, the trigger carries no part', () => {
        const target = mountList(false)
        expect(target.querySelectorAll('[data-part]')).toHaveLength(0)
    })

    test('guard: a row picks its slug and closes', () => {
        const onChange = vi.fn()
        const target = mountList(true, onChange)
        byText(target, 'button', 'Beta (beta)').click()
        flushSync()
        expect(onChange).toHaveBeenCalledWith('beta')
        expect(target.querySelector('h1')).toBeNull()
    })

    test('guard: a typed custom slug is reported on change', () => {
        const onChange = vi.fn()
        const target = mountList(true, onChange)
        const input = target.querySelector('input[type="text"]') as HTMLInputElement
        input.value = 'zz'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(onChange).toHaveBeenCalledWith('zz')
    })

    test('guard: Back and the layer close the picker', () => {
        const target = mountList(true)
        ;(target.querySelector(`button[aria-label="${language.settingsPage.back}"]`) as HTMLButtonElement).click()
        flushSync()
        expect(target.querySelector('h1')).toBeNull()
        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
        ;(target.firstElementChild as HTMLElement).click()
        flushSync()
        expect(target.querySelector('h1')).toBeNull()
    })
})
