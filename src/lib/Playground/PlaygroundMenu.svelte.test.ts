// @vitest-environment happy-dom

/**
 * `PlaygroundMenu.svelte`: the tool grid is shown for both store values that mean "the
 * Playground home" (1, and 2 which `openPlaygroundChat` writes), and a tool's page is
 * shown for its own value.
 *
 * Mounts the REAL `PlaygroundMenu.svelte` with its tool pages stubbed. Titles beginning
 * "regression reproducer:" fail against a menu that renders no grid for store value 2.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { language } from 'src/lang'

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

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountMenu(value: number): HTMLElement {
    store.playground.set(value)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundMenu, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const shows = (target: HTMLElement, text: string) =>
    Array.from(target.querySelectorAll('h1, h2')).some((h) => h.textContent?.trim() === text)

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the playground menu', () => {
    test('guard: store value 1 shows the tool grid', () => {
        const target = mountMenu(1)
        expect(shows(target, language.playground.playground)).toBe(true)
        expect(shows(target, language.embedding)).toBe(true)
    })

    test('regression reproducer: store value 2 shows the tool grid', () => {
        const target = mountMenu(2)
        expect(shows(target, language.playground.playground)).toBe(true)
        expect(shows(target, language.embedding)).toBe(true)
    })

    test('guard: a tool value shows the tool page and not the grid', () => {
        const target = mountMenu(3)
        expect(shows(target, language.playground.playground)).toBe(false)
        expect(target.querySelector('button')).not.toBeNull()
    })
})
