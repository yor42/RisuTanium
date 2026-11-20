// @vitest-environment jsdom

/**
 * `OptionalInput.svelte` names its checkbox with the field label in every branch and names the
 * number, string and "using default" inner inputs through the same naming element. The boolean
 * branch has no inner input; its two buttons keep their visible True and False names. The real
 * `CheckInput`, `NumberInput` and `TextInput` render.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { controlName, fieldNameProblems } from 'src/lib/a11yNames.test-helpers'
import OptionalInput from './OptionalInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>, before = ''): HTMLElement {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(OptionalInput as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('OptionalInput accessible name', () => {
    test('regression reproducer: the number, string and default branches name the inner input and the checkbox', () => {
        const number = render({ value: 5, numberMode: true, label: 'Field' })
        expect(fieldNameProblems(number, [{ name: 'Field', toggle: true }])).toEqual([])
        expect(number.querySelector('input[type="number"]')).not.toBeNull()
        const text = render({ value: 'abc', label: 'Field' })
        expect(fieldNameProblems(text, [{ name: 'Field', toggle: true }])).toEqual([])
        expect(text.querySelector('input[type="text"]')).not.toBeNull()
        const fallback = render({ value: null, label: 'Field' })
        expect(fieldNameProblems(fallback, [{ name: 'Field', toggle: true }])).toEqual([])
        expect((fallback.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(language.uiCommon.usingDefault)
    })

    test('regression reproducer: labelId names the inner input from an existing label and label names the checkbox', () => {
        const target = render({ value: 5, labelId: 'x', label: 'Ext' }, '<span id="x">Ext</span>')
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(fieldNameProblems(target, [{ name: 'Ext', toggle: true }])).toEqual([])
    })

    test('regression reproducer: the boolean branch names the checkbox exactly and keeps the True and False buttons', () => {
        const target = render({ value: true, boolMode: true, label: 'Field' })
        const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(box.getAttribute('aria-label')).toBe('Field')
        const buttons = Array.from(target.querySelectorAll('button'))
        expect(buttons.map((b) => controlName(b))).toEqual([language.uiCommon.trueLabel, language.uiCommon.falseLabel])
        expect(fieldNameProblems(target, [])).toEqual([])
    })

    test('compatibility guard: with nothing passed the inner input and checkbox get no name', () => {
        const target = render({ value: 5, numberMode: true })
        const input = target.querySelector('input[type="number"]')!
        expect(input.hasAttribute('aria-labelledby')).toBe(false)
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(target.querySelector('input[type="checkbox"]')!.hasAttribute('aria-label')).toBe(false)
    })
})
