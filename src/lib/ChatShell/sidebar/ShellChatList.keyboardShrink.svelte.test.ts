// @vitest-environment happy-dom

/**
 * `ShellSidebar.svelte` with its real chat list when the soft keyboard shrinks the list's viewport while an inline
 * rename is open.
 *
 * Invariants exercised here:
 * - A chat or folder rename keeps its field (same node, still focused, value intact) when the list viewport shrinks, at
 *   every row position, so the row is not unmounted and no blur commits an unchanged name.
 * - The edited row stays mounted after a short scroll that would put it above the window, with the top spacer sized to
 *   the rows before it; a scroll far enough that it cannot fit within the mounted-row cap lets it leave, and the cap holds.
 * - After the shrink a real blur commits the typed name once, Escape cancels and consumes the key without a write, and
 *   Enter commits; a regrow afterwards opens no field and puts no focus on an input.
 * - Rows the shrunken window already keeps behave the same as before.
 *
 * The ResizeObserver stub is installed at module level because Svelte creates its shared observer on the first
 * `bind:clientHeight` and keeps it for the module graph.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, ChatFolder, Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const mocks = vi.hoisted(() => ({
    markCharacterForSave: vi.fn(),
    fire: null as null | ((entries: Array<{ target: Element }>) => void),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state, selectedCharID, selIdState,
        DynamicGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(true),
        settingsOpen: writable(false), PlaygroundStore: writable(0), OpenRealmStore: writable(false),
        bookmarkListOpen: writable(false), alertStore: writable({ type: 'none', msg: '' }), additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), async () => ({ changeChatTo: vi.fn(), createChatCopyName: (n: string) => n }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null), changeChar: vi.fn(), exportAllChats: vi.fn(), importChat: vi.fn(),
    createNewChat: vi.fn(), exportChat: vi.fn(), removeChatConfirmed: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertNormal: vi.fn(), alertError: vi.fn(), alertConfirm: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: mocks.markCharacterForSave }))
vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import ShellSidebar from './ShellSidebar.svelte'

class FakeResizeObserver {
    constructor(callback: (entries: Array<{ target: Element }>) => void) { mocks.fire = callback }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

type Entry = Database['characters'][number]

// Phone 2 with the keyboard open: the list area is 363 px, then 34 px.
const OPEN_HEIGHT = 363
const SHRUNK_HEIGHT = 34

const chat = (name: string, time: number, extra: Partial<Chat> = {}) => ({ id: `id-${name}`, name, message: [{ role: 'char', data: 'x', time }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat)

let app: Record<string, unknown> | null = null
let target: HTMLElement

function render(chats: Chat[], folders: ChatFolder[] = []): Entry {
    DBState.db = { characters: [{ type: 'character', chaId: 'A', name: 'A', image: '', chats, chatPage: 0, chatFolders: folders, lastInteraction: 0 }], enableDevTools: false } as unknown as Database
    selectedCharID.set(0)
    target = document.createElement('div')
    document.body.append(target)
    app = mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>
    flushSync()
    return DBState.db.characters[0]
}

function scroller(): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="chat-list-scroller"]')!
}

// Sets the list's laid-out height and reports it the way a ResizeObserver entry does.
function resize(height: number) {
    Object.defineProperty(scroller(), 'clientHeight', { value: height, configurable: true })
    mocks.fire?.([{ target: scroller() }])
    flushSync()
}

function scrollTo(top: number) {
    let current = top
    Object.defineProperty(scroller(), 'scrollTop', { get: () => current, set: (value: number) => { current = value }, configurable: true })
    scroller().dispatchEvent(new Event('scroll'))
    flushSync()
}

function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    flushSync()
}

async function settle() {
    await tick()
    await Promise.resolve()
    await tick()
    flushSync()
}

function rowHost(name: string) {
    return Array.from(target.querySelectorAll('[data-part="chat-row"]'))
        .find((row) => row.querySelector('[data-part="chat-row-name"]')?.textContent?.trim() === name)!
        .closest('[data-part="chat-row-host"]')!
}

function nameInput(): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>('[data-part="chat-row-name-input"]')
}

function folderInput(): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>('[data-part="chat-folder-name-input"]')
}

function menuItem(action: string): Element {
    return document.querySelector(`[role^="menuitem"][data-action="${action}"]`)!
}

function indices(): number[] {
    return Array.from(target.querySelectorAll<HTMLElement>('[data-index]')).map((row) => Number(row.dataset.index))
}

function type(input: HTMLInputElement, value: string) {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

function press(el: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event
}

// Opens the rename field of the named chat from its row menu, with the list laid out at the open height.
async function startRename(name: string): Promise<HTMLInputElement> {
    resize(OPEN_HEIGHT)
    click(rowHost(name).querySelector('[data-part="chat-row-menu"]')!)
    click(menuItem('rename'))
    await settle()
    const input = nameInput()!
    expect(document.activeElement).toBe(input)
    return input
}

const chats = (count: number) => Array.from({ length: count }, (_, i) => chat(`C${i}`, 100000 - i))

beforeEach(() => {
    mocks.markCharacterForSave.mockReset()
    localStorage.clear()
    selectedCharID.set(-1)
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    if (app) unmount(app)
    app = null
    flushSync()
    target?.remove()
    document.body.innerHTML = ''
})

describe('inline rename while the soft keyboard shrinks the list', () => {
    test('the shrink alone mounts only the rows that fit', () => {
        render(chats(8))
        resize(OPEN_HEIGHT)
        expect(indices()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
        resize(SHRUNK_HEIGHT)
        expect(indices()).toEqual([0, 1, 2, 3, 4])
    })

    test('a chat row below the shrunken window keeps its field, focus and name, and Enter saves the typed name', async () => {
        const owner = render(chats(8))
        const input = await startRename('C5')
        resize(SHRUNK_HEIGHT)
        await settle()
        expect(nameInput()).toBe(input)
        expect(document.activeElement).toBe(input)
        expect(owner.chats[5].name).toBe('C5')
        type(input, 'Typed')
        press(input, 'Enter')
        flushSync()
        expect(owner.chats[5].name).toBe('Typed')
        expect(mocks.markCharacterForSave).toHaveBeenCalledTimes(1)
    })

    test('a folder header below the shrunken window keeps its field and focus', async () => {
        const folders = [{ id: 'f0', name: 'F0', folded: false }, { id: 'f1', name: 'F1', folded: false }] as ChatFolder[]
        const inFolder = [0, 1, 2, 3].map((i) => chat(`C${i}`, 100000 - i, { folderId: 'f0' } as Partial<Chat>))
        const owner = render(inFolder.concat([chat('C4', 50), chat('C5', 40)]), folders)
        resize(OPEN_HEIGHT)
        const header = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-folder"]')).find((el) => el.dataset.index === '5')!
        expect(header.textContent).toContain('F1')
        click(header.closest('[data-part="chat-folder-host"]')!.querySelector('[data-part="chat-folder-menu"]')!)
        click(menuItem('folder-rename'))
        await settle()
        const input = folderInput()!
        expect(document.activeElement).toBe(input)
        resize(SHRUNK_HEIGHT)
        await settle()
        expect(folderInput()).toBe(input)
        expect(document.activeElement).toBe(input)
        expect(owner.chatFolders![1].name).toBe('F1')
        type(input, 'Typed')
        press(input, 'Enter')
        flushSync()
        expect(owner.chatFolders![1].name).toBe('Typed')
    })

    for (const [name, index] of [['C0', 0], ['C4', 4]] as const) {
        test(`row ${index}, which the shrunken window already keeps, stays mounted with the field`, async () => {
            const owner = render(chats(8))
            const input = await startRename(name)
            resize(SHRUNK_HEIGHT)
            await settle()
            expect(nameInput()).toBe(input)
            expect(document.activeElement).toBe(input)
            expect(owner.chats[index].name).toBe(name)
        })
    }

    test('an edited row above the window after a short scroll stays mounted and the top spacer covers the rows before it', async () => {
        const owner = render(chats(30))
        const input = await startRename('C2')
        scrollTo(56 * 10)
        expect(nameInput()).toBe(input)
        expect(owner.chats[2].name).toBe('C2')
        const spacer = target.querySelector<HTMLElement>('[data-part="chat-list"] > [role="presentation"]')!
        expect(spacer.style.height).toBe('112px')
    })

    test('a scroll too far for the edited row to fit the cap keeps at most 40 rows mounted', async () => {
        render(chats(100))
        await startRename('C5')
        scrollTo(56 * 60)
        expect(target.querySelectorAll('[data-part="chat-row-host"]').length).toBeLessThanOrEqual(40)
        expect(Math.max(...indices())).toBeGreaterThanOrEqual(60)
    })

    test('a real blur after the shrink commits the typed name once and removes the field', async () => {
        const owner = render(chats(8))
        const input = await startRename('C5')
        resize(SHRUNK_HEIGHT)
        await settle()
        expect(nameInput()).toBe(input)
        type(input, 'By blur')
        input.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(owner.chats[5].name).toBe('By blur')
        expect(nameInput()).toBeNull()
        input.dispatchEvent(new FocusEvent('blur'))
        expect(mocks.markCharacterForSave).toHaveBeenCalledTimes(1)
    })

    test('Escape after the shrink cancels, consumes the key and writes nothing', async () => {
        const owner = render(chats(8))
        const input = await startRename('C5')
        resize(SHRUNK_HEIGHT)
        await settle()
        expect(nameInput()).toBe(input)
        type(input, 'Typed')
        const event = press(input, 'Escape')
        flushSync()
        expect(event.defaultPrevented).toBe(true)
        expect(nameInput()).toBeNull()
        expect(owner.chats[5].name).toBe('C5')
        input.dispatchEvent(new FocusEvent('blur'))
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    test('Enter after the shrink and a regrow leaves no field and no focus on an input', async () => {
        const owner = render(chats(8))
        const input = await startRename('C5')
        resize(SHRUNK_HEIGHT)
        await settle()
        type(input, 'Typed')
        press(input, 'Enter')
        flushSync()
        resize(OPEN_HEIGHT)
        await settle()
        expect(nameInput()).toBeNull()
        expect(document.activeElement?.tagName).not.toBe('INPUT')
        expect(owner.chats[5].name).toBe('Typed')
        expect(mocks.markCharacterForSave).toHaveBeenCalledTimes(1)
    })
})
