// @vitest-environment jsdom
/**
 * The return chip: a labelled button that returns on a tap and reports hover and focus so the shell can keep it while the reader looks at it.
 * REAL: `ReturnChip.svelte`. MOCKED: the language table.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { ChipHold } from '../../ts/chatShell/returnChip'

vi.mock('../../lang', () => ({ language: { chatShellGoBack: 'Go back' } }))

import ReturnChip from './ReturnChip.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
let onreturn: Mock<() => void>
let onhold: Mock<(kind: ChipHold, on: boolean) => void>

function show(): HTMLButtonElement {
    target = document.createElement('div')
    document.body.appendChild(target)
    onreturn = vi.fn<() => void>()
    onhold = vi.fn<(kind: ChipHold, on: boolean) => void>()
    app = mount(ReturnChip, { target, props: { onreturn, onhold } })
    flushSync()
    return target.querySelector<HTMLButtonElement>('[data-part="chat-return-chip"]')!
}

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
})

describe('ReturnChip', () => {
    test('A2-18: it is a button named "Go back" that returns on a click', () => {
        const chip = show()
        expect(chip.tagName).toBe('BUTTON')
        expect(chip.textContent).toContain('Go back')
        chip.click()
        expect(onreturn).toHaveBeenCalledOnce()
    })
    test('A2-18: hover and focus are reported on and off', () => {
        const chip = show()
        chip.dispatchEvent(new Event('pointerenter'))
        chip.dispatchEvent(new Event('pointerleave'))
        chip.dispatchEvent(new Event('focus'))
        chip.dispatchEvent(new Event('blur'))
        expect(onhold.mock.calls).toEqual([['hover', true], ['hover', false], ['focus', true], ['focus', false]])
    })
})
