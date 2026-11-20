// @vitest-environment jsdom

/**
 * `CheckInput.svelte` names its checkbox through `aria-label` only: `label` wins over `name`, `name`
 * names a checkbox whose text is visible too, and neither adds an attribute. A checkbox never gets
 * `aria-labelledby`, because TalkBack speaks only `aria-label` in the control's own stop.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName } from 'src/lib/a11yNames.test-helpers'
import CheckInput from './CheckInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>): { target: HTMLElement, input: HTMLInputElement } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CheckInput as never, { target, props: { check: false, ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, input: target.querySelector<HTMLInputElement>('input[type="checkbox"]')! }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('CheckInput accessible name', () => {
    test('regression reproducer: a visible name also names the checkbox through aria-label', () => {
        const { input } = render({ name: 'Alpha' })
        expect(input.getAttribute('aria-label')).toBe('Alpha')
        expect(controlName(input)).toBe('Alpha')
    })

    test('regression reproducer: label overrides name for the checkbox name and leaves the visible text alone', () => {
        const { target, input } = render({ name: 'Alpha', label: 'Beta' })
        expect(input.getAttribute('aria-label')).toBe('Beta')
        expect(target.querySelector('label')!.textContent).toContain('Alpha')
    })

    test('regression reproducer: label names a checkbox that has no name text', () => {
        const { input } = render({ label: 'Beta' })
        expect(input.getAttribute('aria-label')).toBe('Beta')
    })

    test('regression reproducer: a blank label falls back to name', () => {
        const { input } = render({ name: 'Alpha', label: '   ' })
        expect(input.getAttribute('aria-label')).toBe('Alpha')
    })

    test('regression reproducer: the reverse layout names the checkbox too', () => {
        const { input } = render({ name: 'Gamma', reverse: true })
        expect(input.getAttribute('aria-label')).toBe('Gamma')
    })

    test('compatibility guard: neither name nor label adds no aria-label', () => {
        const { input } = render({})
        expect(input.hasAttribute('aria-label')).toBe(false)
    })

    test('compatibility guard: hiddenName keeps the name out of the text and in aria-label', () => {
        const { target, input } = render({ name: 'Delta', hiddenName: true })
        expect(input.getAttribute('aria-label')).toBe('Delta')
        expect(target.querySelector('label')!.textContent).not.toContain('Delta')
    })

    test('compatibility guard: no case adds aria-labelledby', () => {
        for (const props of [{}, { name: 'A' }, { label: 'B' }, { name: 'A', label: 'B' }, { name: 'A', reverse: true }, { name: 'A', hiddenName: true }]) {
            const { target } = render(props)
            expect(target.querySelector('[aria-labelledby]')).toBeNull()
        }
    })
})
