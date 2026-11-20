// @vitest-environment jsdom

/**
 * `Help.svelte`: the button is named by its optional `name` plus "Show Help" (a `title` does not
 * count), its glyphs are hidden from assistive technology, and it sets its own rest colour so its
 * hover token differs from its rest token in every parent colour context (a parent's inherited
 * colour would otherwise make the hover cue vanish). Parent contexts are built like the real
 * producers: the `text-textcolor2 text-sm` span of `TriggerV1Data` and a `text-textcolor` span.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, textColourTokens } from 'src/lib/a11yNames.test-helpers'
import type { Component } from 'svelte'

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import Help from './Help.svelte'

type HelpProps = { key: keyof typeof language.help, name?: string, unrecommended?: boolean }

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(props: HelpProps, parent: 'bare' | 'textcolor2' | 'textcolor' = 'bare'): HTMLElement {
    const target = document.createElement(parent === 'bare' ? 'div' : 'span')
    if (parent === 'textcolor2') {
        target.className = 'text-textcolor2 text-sm'
    } else if (parent === 'textcolor') {
        target.className = 'text-textcolor'
    }
    document.body.appendChild(target)
    const app = mount(Help as Component<HelpProps>, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app as never)
        m.target.remove()
    }
})

describe('Help name and glyphs', () => {
    test('regression reproducer: the button is named "Show Help" without a name and "X Show Help" with one', () => {
        const bare = render({ key: 'additionalPrompt' })
        expect(controlName(bare.querySelector('button')!)).toBe(language.showHelp)
        const named = render({ key: 'additionalPrompt', name: 'X' })
        expect(controlName(named.querySelector('button')!)).toBe('X ' + language.showHelp)
    })

    test('regression reproducer: every glyph is hidden in the default, experimental and unrecommended variants', () => {
        for (const props of [{ key: 'additionalPrompt' }, { key: 'experimental' }, { key: 'additionalPrompt', unrecommended: true }] as HelpProps[]) {
            const target = render(props)
            expect(exposedIcons(target)).toEqual([])
            expect(target.querySelector('svg')).not.toBeNull()
        }
    })

    test('regression reproducer: the button sets its own rest and hover tokens and no palette class remains', () => {
        const target = render({ key: 'additionalPrompt' })
        const button = target.querySelector('button')!
        expect(button.classList.contains('text-textcolor2')).toBe(true)
        expect(button.classList.contains('hover:text-textcolor')).toBe(true)
        expect(paletteClasses(target)).toEqual([])
    })

    test('regression reproducer: the experimental and unrecommended glyph wrappers use the danger token with a neutral hover', () => {
        for (const props of [{ key: 'experimental' }, { key: 'additionalPrompt', unrecommended: true }] as HelpProps[]) {
            const target = render(props)
            const wrapper = target.querySelector('svg')!.parentElement!
            expect(wrapper.classList.contains('text-draculared')).toBe(true)
            expect(wrapper.classList.contains('hover:text-textcolor')).toBe(true)
            expect(paletteClasses(target)).toEqual([])
        }
    })
})

describe('Help hover token in each parent colour context', () => {
    const contexts = ['bare', 'textcolor2', 'textcolor'] as const

    test.each(contexts)('regression reproducer: the default glyph moves textcolor2 -> textcolor inside a %s parent', (parent) => {
        const target = render({ key: 'additionalPrompt' }, parent)
        const tokens = textColourTokens(target.querySelector('svg')!.parentElement!)
        expect(tokens.hover).not.toBeNull()
        expect(tokens.hover).not.toBe(tokens.rest)
        expect([tokens.rest, tokens.hover]).toEqual(['textcolor2', 'textcolor'])
    })

    test.each(contexts)('regression reproducer: the experimental and unrecommended glyphs move draculared -> textcolor inside a %s parent', (parent) => {
        for (const props of [{ key: 'experimental' }, { key: 'additionalPrompt', unrecommended: true }] as HelpProps[]) {
            const target = render(props, parent)
            const tokens = textColourTokens(target.querySelector('svg')!.parentElement!)
            expect(tokens.hover).not.toBeNull()
            expect(tokens.hover).not.toBe(tokens.rest)
            expect([tokens.rest, tokens.hover]).toEqual(['draculared', 'textcolor'])
        }
    })
})
