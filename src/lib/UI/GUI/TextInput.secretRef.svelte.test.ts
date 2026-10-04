// @vitest-environment happy-dom

/**
 * TextInput with hideText: a value that is wholly a ${NAME} reference holds no secret and is shown
 * as plain text; every other value stays masked. Switching between the two while typing keeps the
 * same element, so focus and the bound value survive.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import TextInput from './TextInput.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(props: { value: string, hideText?: boolean, oninput?: (e: Event) => void }) {
    const state = $state({ ...props })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(TextInput, {
        target,
        props: {
            get value() { return state.value },
            set value(next: string) { state.value = next },
            get hideText() { return state.hideText },
            get oninput() { return state.oninput },
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const input = target.querySelector('input') as HTMLInputElement
    return { input, state }
}

function type(input: HTMLInputElement, text: string) {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('TextInput shows whole ${NAME} references unmasked when hideText is on', () => {
    test('a whole reference is shown as text', () => {
        const { input } = render({ value: '${RISU_OPENAI_KEY}', hideText: true })
        expect(input.type).toBe('text')
        expect(input.value).toBe('${RISU_OPENAI_KEY}')
    })

    test('guard: a real key stays masked with the new-password autocomplete', () => {
        const { input } = render({ value: 'sk-abc', hideText: true })
        expect(input.type).toBe('password')
        expect(input.autocomplete).toBe('new-password')
    })

    test('guard: a text containing a reference but not wholly one stays masked', () => {
        const { input } = render({ value: 'sk-${RISU_X_KEY}', hideText: true })
        expect(input.type).toBe('password')
    })

    test('guard: without hideText nothing changes', () => {
        const ref = render({ value: '${RISU_OPENAI_KEY}' })
        const key = render({ value: 'sk-abc' })
        expect(ref.input.type).toBe('text')
        expect(key.input.type).toBe('text')
        expect(key.input.autocomplete).toBe('off')
    })

    test('typing a reference unmasks it and deleting the closing brace masks it again, keeping the element, focus and bound value', () => {
        const oninput = vi.fn()
        const { input, state } = render({ value: '', hideText: true, oninput })
        input.focus()
        expect(document.activeElement).toBe(input)

        type(input, '${RISU_X_KEY}')
        expect(state.value).toBe('${RISU_X_KEY}')
        expect(input.type).toBe('text')

        type(input, '${RISU_X_KEY')
        expect(state.value).toBe('${RISU_X_KEY')
        expect(input.type).toBe('password')
        expect(input.value).toBe('${RISU_X_KEY')

        expect(mounted[0].target.querySelectorAll('input')).toHaveLength(1)
        expect(mounted[0].target.querySelector('input')).toBe(input)
        expect(document.activeElement).toBe(input)
        expect(oninput).toHaveBeenCalledTimes(2)
    })
})
