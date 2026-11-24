// @vitest-environment jsdom
/**
 * The sidebar's More menu parts of the W2 sweep, rendered. Mounts the REAL `SidebarMoreMenu.svelte` and asserts that each
 * literal `data-part` sits on the intended element, found by its tag, text or position inside the menu rather than by the part.
 * MOCKED: the stores module, the settings and developer panes, the plugin icon and the language (a proxy returning the key).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { enableDevTools: true, characters: [] as TestCharacter[] } })
const selection = $state({ selId: 0 })
const plugins = vi.hoisted(() => ({ items: [] as Array<{ id: string, name: string, callback: () => void }> }))

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return writable(false) },
    get settingsOpen() { return writable(false) },
    PlaygroundStore: writable(0),
    get additionalHamburgerMenu() { return plugins.items },
    alertStore: writable({ type: 'none', msg: '' }),
    bookmarkListOpen: writable(false),
    selectedCharID: writable(0),
}))
vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => ({}) }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => ({}) }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
const languageMock = vi.hoisted(() => ({
    language: new Proxy({ settingsPage: { back: 'Back' }, playground: { playground: 'Playground' } } as Record<string, unknown>, {
        get: (target, key) => key in target ? target[key as string] : String(key),
    }),
}))
vi.mock('src/lang', () => languageMock)
vi.mock('../../../lang', () => languageMock)

import SidebarMoreMenu from './SidebarMoreMenu.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SidebarMoreMenu, { target: host, props: { reseter: vi.fn(), onclose: vi.fn(), afterAction: vi.fn() } })
    flushSync()
}

function one(name: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
    expect(found, `exactly one element carries data-part="${name}"`).toHaveLength(1)
    return found[0]
}

beforeEach(() => {
    db.db.enableDevTools = true
    db.db.characters = [{ chaId: 'char-a', type: 'character', chatPage: 0, chats: [{ id: 'c' }] }]
    selection.selId = 0
    plugins.items = [{ id: 'p1', name: 'Plugin One', callback: vi.fn() }, { id: 'p2', name: 'Plugin Two', callback: vi.fn() }]
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
})

describe('SidebarMoreMenu parts', () => {
    test('the header holds the Back button and the title; Back is the button, the title is not', () => {
        show()
        const header = one('more-header')
        const back = one('more-back')
        const title = one('more-title')
        expect(back.tagName).toBe('BUTTON')
        expect(back.textContent?.trim()).toBe('Back')
        expect(title.tagName).toBe('SPAN')
        expect(title.textContent).toBe('chatShellMore')
        expect(title.querySelector('button')).toBeNull()
        expect(header.contains(back) && header.contains(title)).toBe(true)
        expect(header.parentElement?.getAttribute('data-part')).toBe('sidebar-more-panel')
    })

    test('each row is a button with its own label inside the list', () => {
        show()
        const list = one('more-list')
        const rows: ReadonlyArray<readonly [part: string, label: string]> = [
            ['more-character-settings', 'chatShellCharacterSettings'],
            ['more-playground', 'Playground'],
            ['more-bookmarks', 'bookmarks'],
            ['more-branches', 'chatShellBranches'],
            ['more-dev-tool', 'chatShellDevTool'],
        ]
        for (const [part, label] of rows) {
            const el = one(part)
            expect(el.tagName, part).toBe('BUTTON')
            expect(el.textContent?.trim(), part).toBe(label)
            expect(el.parentElement, part).toBe(list)
        }
        expect(Array.from(list.children).map((child) => child.getAttribute('data-part'))).toEqual([
            'more-character-settings', 'more-playground', 'more-bookmarks', 'more-branches', 'more-dev-tool', 'more-plugin-item', 'more-plugin-item',
        ])
    })

    test('every plugin entry carries the plugin part, with its own name', () => {
        show()
        const items = Array.from(document.querySelectorAll<HTMLElement>('[data-part="more-plugin-item"]'))
        expect(items.map((el) => el.textContent?.trim())).toEqual(['Plugin One', 'Plugin Two'])
        for (const el of items) expect(el.tagName).toBe('BUTTON')
    })
})
