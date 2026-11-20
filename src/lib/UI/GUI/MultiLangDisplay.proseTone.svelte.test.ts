// @vitest-environment jsdom

/**
 * `MultiLangDisplay.svelte` is a classic surface: its body (markdown and plain branch alike) takes
 * `prose-invert` only under a dark colour scheme. A light scheme must not get the pale inverted prose
 * colours, and a pack's fixed base tone is not what this classic surface sits on.
 *
 * The scheme store is the real `surfaceTone` store, forwarded through the `colorscheme` module mock
 * (the real module needs the whole app). `ParseMarkdown` and the language helpers are mocked: the
 * class binding is under test, not the renderer.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/gui/colorscheme', async () => {
    const { ColorSchemeTypeStore } = await import('src/ts/gui/surfaceTone')
    return { ColorSchemeTypeStore }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: async (text: string) => `<p>${text}</p>`,
}))
vi.mock('src/ts/util', () => ({
    parseMultilangString: (value: string) => ({ en: value }),
    toLangName: (code: string) => code,
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { language: 'en' } },
}))

import { ColorSchemeTypeStore, packBaseTone } from 'src/ts/gui/surfaceTone'
import MultiLangDisplay from './MultiLangDisplay.svelte'

let app: ReturnType<typeof MultiLangDisplay> | undefined
let target: HTMLElement

async function show(markdown: boolean): Promise<HTMLElement> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(MultiLangDisplay, { target, props: { value: 'hello', markdown } })
    flushSync()
    await tick()
    const body = target.querySelector<HTMLElement>('.chattext')
    expect(body, 'the body block').not.toBeNull()
    expect(body!.classList.contains('prose')).toBe(true)
    return body!
}

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    ColorSchemeTypeStore.set('dark')
    packBaseTone.set(null)
})

describe.each([true, false])('MultiLangDisplay body prose-invert follows the colour scheme (markdown: %s)', (markdown) => {
    test('RR: a light scheme does not invert the prose', async () => {
        ColorSchemeTypeStore.set('light')
        const body = await show(markdown)
        expect(body.classList.contains('prose-invert')).toBe(false)
    })

    test('RR: a light scheme under a dark pack base is still not inverted', async () => {
        ColorSchemeTypeStore.set('light')
        packBaseTone.set('dark')
        const body = await show(markdown)
        expect(body.classList.contains('prose-invert')).toBe(false)
    })

    test('CG (passes before and after): a dark scheme inverts the prose', async () => {
        const body = await show(markdown)
        expect(body.classList.contains('prose-invert')).toBe(true)
    })

    test('CG (passes before and after): a dark scheme under a light pack base is still inverted', async () => {
        packBaseTone.set('light')
        const body = await show(markdown)
        expect(body.classList.contains('prose-invert')).toBe(true)
    })

    test('RR: a live switch to light drops prose-invert and back to dark restores it', async () => {
        const body = await show(markdown)
        ColorSchemeTypeStore.set('light')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(false)
        ColorSchemeTypeStore.set('dark')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(true)
    })
})
