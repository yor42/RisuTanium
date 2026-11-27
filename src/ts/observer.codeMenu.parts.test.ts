// @vitest-environment jsdom
// The code-block context menu built in observer.svelte.ts carries chat parts (#438 W3-7): the menu and its two options, found here by
// id, text and structure, never by their parts. The menu is a direct child of document.body and holds exactly its two options, so an
// extra element or part fails. The menu's hard-coded gray classes are theme classes (MC-4164, MC-4166), with the layout classes kept.
// Tests starting `acceptance:` fail on the base. Tests starting `guard:` pass before and after.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/util', () => ({
    sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}))

let startFn: () => () => void
let dispose: (() => void) | null = null
let writeText: ReturnType<typeof vi.fn>

const codeBlock = (lang: string, text = 'let a = 1') =>
    `<pre class="hljs" x-hl-lang="${lang}"><code>${text}</code></pre>`

function rightClick(target: Element) {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 }))
}

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

function openMenu(): HTMLElement {
    document.body.innerHTML = codeBlock('js')
    startFn()
    rightClick(document.querySelector('code')!)
    const menu = document.getElementById('code-contextmenu')
    expect(menu).not.toBeNull()
    return menu!
}

function option(menu: HTMLElement, label: string): HTMLElement {
    const found = Array.from(menu.children).filter((el) => el.textContent === label)
    expect(found, label).toHaveLength(1)
    return found[0] as HTMLElement
}

beforeEach(async () => {
    vi.useFakeTimers()
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.resetModules()
    startFn = (await import('./observer.svelte')).startObserveDom as unknown as () => () => void
})

afterEach(() => {
    if (typeof dispose === 'function') dispose()
    dispose = null
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('code block context menu parts', () => {
    it('acceptance C1: the menu is a body child with the menu part and exactly two children, no deeper element', () => {
        const menu = openMenu()
        expect(partOf(menu)).toBe('chat-code-menu')
        expect(menu.parentElement).toBe(document.body)
        expect(menu.children).toHaveLength(2)
        expect(menu.querySelectorAll('*')).toHaveLength(2)
    })

    it('acceptance C2: Copy and Download carry their own parts, directly under the menu', () => {
        const menu = openMenu()
        const copy = option(menu, 'Copy')
        const download = option(menu, 'Download')
        expect(partOf(copy)).toBe('chat-code-menu-copy')
        expect(copy.parentElement).toBe(menu)
        expect(partOf(download)).toBe('chat-code-menu-download')
        expect(download.parentElement).toBe(menu)
    })

    it('acceptance C3: the menu uses theme classes, not gray', () => {
        const menu = openMenu()
        const classes = (el: Element) => el.getAttribute('class') ?? ''
        expect(classes(menu)).toContain('bg-darkbg')
        expect(classes(menu)).toContain('border-darkborderc')
        for (const label of ['Copy', 'Download']) {
            expect(classes(option(menu, label))).toContain('text-textcolor')
            expect(classes(option(menu, label))).toContain('hover:bg-selected')
        }
        for (const el of [menu, ...Array.from(menu.children)]) expect(classes(el)).not.toMatch(/gray-/)
    })

    it('guard: the layout classes are kept', () => {
        const menu = openMenu()
        const classes = (el: Element) => (el.getAttribute('class') ?? '').split(' ')
        expect(classes(menu)).toEqual(expect.arrayContaining(['fixed', 'z-50', 'min-w-[160px]', 'py-2', 'rounded-lg', 'border']))
        for (const label of ['Copy', 'Download']) {
            expect(classes(option(menu, label))).toEqual(expect.arrayContaining(['px-4', 'py-2', 'text-sm', 'cursor-pointer']))
        }
    })

    it('guard: Copy writes the code text and a second right-click leaves one menu', () => {
        const menu = openMenu()
        rightClick(document.querySelector('code')!)
        expect(document.querySelectorAll('#code-contextmenu')).toHaveLength(1)
        option(document.getElementById('code-contextmenu')!, 'Copy').click()
        expect(writeText).toHaveBeenCalledWith('let a = 1')
        expect(menu.isConnected).toBe(false)
    })
})
