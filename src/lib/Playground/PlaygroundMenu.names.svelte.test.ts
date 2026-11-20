// @vitest-environment jsdom

/**
 * `PlaygroundMenu.svelte`: the back arrow of a tool page is named, its glyph is hidden and it hovers
 * to a token different from its rest colour. Mounts the REAL menu with its tool pages stubbed, as in
 * `PlaygroundMenu.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { controlName, exposedIcons, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

const store = vi.hoisted(() => ({ playground: undefined as unknown as import('svelte/store').Writable<number> }))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    store.playground = writable(0)
    return {
        PlaygroundStore: store.playground,
        SizeStore: writable({ w: 1400, h: 900 }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/playgroundChat'), () => ({
    openPlaygroundChat: vi.fn(),
}) as unknown as typeof import('src/ts/playgroundChat'))

vi.mock('./PlaygroundEmbedding.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundTokenizer.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundJinja.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundSyntax.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundImageGen.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundParser.svelte', () => ({ default: () => {} }))
vi.mock('./ToolConversion.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundSubtitle.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundImageTrans.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundTranslation.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundMCP.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundDocs.svelte', () => ({ default: () => {} }))
vi.mock('./PlaygroundInlayExplorer.svelte', () => ({ default: () => {} }))

//#endregion

import PlaygroundMenu from './PlaygroundMenu.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountMenu(value: number): HTMLElement {
    store.playground.set(value)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundMenu, { target, props: {} }) as unknown as Record<string, unknown>
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

describe('PlaygroundMenu back arrow', () => {
    test('regression reproducer: the tool page back arrow is named and its glyph hidden', () => {
        const target = mountMenu(3)
        const buttons = Array.from(target.querySelectorAll('button'))
        expect(buttons).toHaveLength(1)
        expect(controlName(buttons[0])).toBe(language.settingsPage.back)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the back arrow hovers to a token different from its rest colour', () => {
        const target = mountMenu(3)
        const back = target.querySelector('button') as HTMLButtonElement
        const { rest, hover } = textColourTokens(back.querySelector('svg')!.parentElement!)
        expect(rest).toBe('textcolor2')
        expect(hover).toBe('textcolor')
    })

    test('guard: the tool grid keeps its text-named buttons', () => {
        const target = mountMenu(1)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
