// @vitest-environment jsdom

/**
 * `OpenrouterProviderList.svelte` picker: the back button has an accessible name with its glyph
 * hidden, and the custom-provider field is named by the provider label. The scrim stays
 * `bg-black/50` (E2). Mounts the REAL component with the real shared TextInput.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import OpenrouterProviderList from './OpenrouterProviderList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function openPicker(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OpenrouterProviderList, {
        target,
        props: { value: 'alpha', options: [{ name: 'Alpha', slug: 'alpha' }] },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
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

describe('OpenrouterProviderList accessible names', () => {
    test('regression reproducer: the back button is named Back and its glyph is hidden', () => {
        const target = openPicker()
        const back = target.querySelector('button.shrink-0') as HTMLButtonElement
        expect(controlName(back)).toBe(language.settingsPage.back)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the custom provider field is named by the provider label', () => {
        const target = openPicker()
        const field = target.querySelector('input[type="text"]') as HTMLInputElement
        expect(controlName(field)).toBe(language.provider)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('guard: only the scrim keeps a palette class (passes before and after)', () => {
        const target = openPicker()
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
    })
})
