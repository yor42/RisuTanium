// @vitest-environment jsdom
/**
 * The shell's in-chat search core: opening, the header swap, hit jumps, the transcript's top reserve, the surface, Back and the restart rules.
 * REAL: `ChatShell.svelte`, `FindBar.svelte`, `findSession.ts`, `findRun.ts`, `inChatSearch.ts`, `shellJumpKeys.ts`, `backHandlers.ts`, `returnChip.ts`.
 * MOCKED: stores, the message list (a stub that records its props and answers what the test sets), the header (a stub that reports concealment),
 * the composer, the other sheets, the toast post, the language table and the surface state (a rune object the test drives the way Settings does).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { flushSync, mount, tick, unmount } from 'svelte'
import { parse } from 'svelte/compiler'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { JumpOptions, JumpOrigin, JumpResult } from '../../ts/chatShell/jumpTarget'

type ListProps = { atBottom: boolean, searchHit: { index: number, message: object | null } | null, searchHitNote: string }
type HeaderProps = { onconcealed: (concealed: boolean) => void }
type JumpSheetProps = { open: boolean, onjump: (index: number) => void, onsearch?: () => void }
type FiltersSheetProps = { open: boolean, filters: { speaker: string }, onfilters: (patch: { speaker?: string }) => void, onclear: () => void, onclose: () => void }
type ResultsSheetProps = { open: boolean, hits: { index: number }[], query: string, complete: boolean, firstText: string, userName: string, charName: string, userImage: string, charImage: string, onpick: (position: number) => void, onclose: () => void }
type FixtureMessage = { role: 'user' | 'char', data: string, time: number }
type FixtureChat = { id: string, message: FixtureMessage[], isStreaming?: boolean }
type FixtureCharacter = { chaId: string, type: string, name: string, image?: string, firstMessage: string, alternateGreetings: string[], chatPage: number, chats: FixtureChat[] }

const captured = vi.hoisted(() => ({
    list: null as null | ListProps,
    header: null as null | HeaderProps,
    concealOnMount: false,
    jump: null as null | JumpSheetProps,
    thisChat: null as null | { onsearch?: (opener: HTMLElement | null) => void, onjumpsheet?: (opener: HTMLElement | null) => void },
    filters: null as null | FiltersSheetProps,
    results: null as null | ResultsSheetProps,
    headerMenu: true,
    returnTo: null as null | ((origin: JumpOrigin) => Promise<JumpResult>),
    jumpToLatest: null as null | (() => Promise<void>),
    jumpTo: null as null | ((index: number, options?: JumpOptions) => Promise<JumpResult>),
    readOrigin: null as null | (() => JumpOrigin | null),
    anchorBottom: null as null | (() => void),
    toast: null as null | ((init: { kind: string, text: string }) => number),
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const chats = [{ id: 'chat-a', message: [] as unknown[] }, { id: 'chat-b', message: [] as unknown[] }]
    const state = $state({ db: { characters: [{ chaId: 'c', type: 'character', name: 'Seraphina', firstMessage: 'Greeting text', alternateGreetings: [] as string[], chatPage: 0, chats }] } })
    const selection = $state({ selId: 0 })
    return { DBState: state, selIdState: selection, MobileGUI: store(true), DynamicGUI: store(false), sideBarClosing: store(false), sideBarStore: store(false), alertStore: store({ type: 'none', msg: '' }) }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, closeEpoch: 0 })
    return { chatSurface }
})
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: (init: { kind: string, text: string }) => captured.toast?.(init) ?? 0 }))
vi.mock('../../lang', () => ({
    language: {
        chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat',
        chatShellChatOpened: (name: string) => `Opened ${name}`, chatShellGoBack: 'Go back', chatShellJumpedBack: 'Moved. Go back returns.', chatShellJumpEditorOpen: 'Close the editor',
        hypaV3Modal: { connectedMessageNotFoundLabel: 'Message not found' },
        chatShellSearchInChat: 'Search in chat', chatShellFindPlaceholder: 'Search', chatShellFindCounter: (index: string, total: string) => `${index} of ${total}`,
        chatShellFindCounterPartial: (index: string, total: string) => `${index} of ${total}+`, chatShellFindPrev: 'Previous match', chatShellFindNext: 'Next match',
        chatShellFindFilters: 'Filters', chatShellFindFiltersOn: 'Filters on', chatShellFindSeeAll: 'See all', chatShellFindNoResults: 'No results',
        chatShellFindClearFilters: 'Clear filters', chatShellFindClose: 'Close search', chatShellFindSpeakerMe: 'Me', chatShellFindSpeakerChar: 'Character',
        chatShellFindHasImage: 'Has image', chatShellFindIncludeThinking: 'Include thinking',
        chatShellFindMatchLabel: (index: string, total: string) => `Match ${index} of ${total}`, chatShellFindMatchLabelPartial: (index: string, total: string) => `Match ${index} of ${total}+`,
        chatShellFindMatchInside: 'The match is inside this message',
    },
}))
vi.mock('./ShellHeader.svelte', () => ({ default: (anchor: Comment, props: HeaderProps) => {
    captured.header = props
    if (captured.headerMenu) {
        const button = document.createElement('button')
        button.setAttribute('data-part', 'chat-header-menu')
        anchor.before(button)
    }
    // The real header reports from an effect, after its first render.
    queueMicrotask(() => props.onconcealed(captured.concealOnMount))
    return {}
} }))
vi.mock('./ShellComposer.svelte', () => ({ default: (anchor: Comment) => {
    const field = document.createElement('textarea')
    field.setAttribute('data-part', 'chat-composer-input')
    anchor.before(field)
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: ListProps) => {
    captured.list = props
    return {
        onScroll: () => {},
        anchorNewestBottom: () => captured.anchorBottom!(),
        jumpToLatest: () => captured.jumpToLatest!(),
        jumpTo: (...args: [number, JumpOptions?]) => captured.jumpTo!(...args),
        returnTo: (origin: JumpOrigin) => captured.returnTo!(origin),
        readOrigin: () => captured.readOrigin!(),
    }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: NonNullable<typeof captured.thisChat>) => {
    captured.thisChat = props
    return {}
} }))
vi.mock('./JumpSheet.svelte', () => ({ default: (_anchor: Comment, props: JumpSheetProps) => {
    captured.jump = props
    return {}
} }))
vi.mock('./FindFiltersSheet.svelte', () => ({ default: (_anchor: Comment, props: FiltersSheetProps) => {
    captured.filters = props
    return {}
} }))
vi.mock('./FindResultsSheet.svelte', () => ({ default: (_anchor: Comment, props: ResultsSheetProps) => {
    captured.results = props
    return {}
} }))
vi.mock('../../ts/characters', () => ({ getCharImage: async (source: string) => source === '' ? null : `resolved:${source}` }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

import ChatShell from './ChatShell.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { dispatchBack } from '../../ts/backHandlers'

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let jumpTo: Mock<(index: number, options?: JumpOptions) => Promise<JumpResult>>
let readOrigin: Mock<() => JumpOrigin | null>
let anchorBottom: Mock<() => void>
let returnTo: Mock<(origin: JumpOrigin) => Promise<JumpResult>>
let jumpToLatest: Mock<() => Promise<void>>
let toast: Mock<(init: { kind: string, text: string }) => number>

const pre: JumpOrigin = { index: 5, offset: 40, atBottom: false }
const done = (to: number, from: JumpOrigin | null = null): JumpResult => ({ status: 'done', from, to })
const root = () => target.querySelector<HTMLElement>('[data-part="chat-shell"]')!
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const bar = () => target.querySelector<HTMLElement>('[data-part="chat-find-bar"]')
const field = () => target.querySelector<HTMLInputElement>('[data-part="chat-find-field"]')!
const counter = () => target.querySelector('.counter')?.textContent ?? null
const announcer = () => target.querySelector('[data-part="chat-announcer"]')!.textContent
const chipButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-return-chip"]')
const composerField = () => target.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')!
const character = () => DBState.db.characters[0] as unknown as FixtureCharacter

// Needles at 150, 100 and 20; newest first they are positions 0, 1 and 2.
function fixtureMessages(): FixtureMessage[] {
    return Array.from({ length: 200 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: [150, 100, 20].includes(i) ? `a needle at ${i}` : `filler ${i}`, time: 1000 + i }))
}

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.jump || !captured.header) throw new Error('waiting for the list, the header and the sheets')
    }, { timeout: 15000 })
}

async function settle(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round++) await tick()
    flushSync()
}

function pressFind(on: Element = transcript()): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    on.dispatchEvent(event)
    flushSync()
    return event
}

async function openBar(): Promise<void> {
    pressFind()
    await vi.waitFor(() => { flushSync(); if (!bar()) throw new Error('the bar is not open') })
    await settle()
}

function type(value: string): void {
    const input = field()
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

async function typeAndWaitForFirstHit(value = 'needle'): Promise<void> {
    type(value)
    await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(1) }, { timeout: 3000 })
    await settle()
}

beforeEach(() => {
    captured.list = null
    captured.header = null
    captured.jump = null
    captured.thisChat = null
    captured.filters = null
    captured.results = null
    captured.headerMenu = true
    captured.concealOnMount = false
    returnTo = vi.fn<(origin: JumpOrigin) => Promise<JumpResult>>(async () => done(0))
    jumpToLatest = vi.fn<() => Promise<void>>(async () => {})
    captured.returnTo = (origin) => returnTo(origin)
    captured.jumpToLatest = () => jumpToLatest()
    jumpTo =vi.fn<(index: number, options?: JumpOptions) => Promise<JumpResult>>(async (index) => done(index))
    readOrigin = vi.fn<() => JumpOrigin | null>(() => pre)
    anchorBottom = vi.fn<() => void>()
    toast = vi.fn<(init: { kind: string, text: string }) => number>(() => 1)
    captured.jumpTo = (...args) => jumpTo(...args)
    captured.readOrigin = () => readOrigin()
    captured.anchorBottom = () => anchorBottom()
    captured.toast = toast
    chatSurface.hidden = false
    chatSurface.closeEpoch = 0
    character().type = 'character'
    character().chatPage = 0
    character().image = undefined
    DBState.db.userIcon = ''
    character().firstMessage = 'Greeting text'
    character().chats[0].message = fixtureMessages()
    character().chats[0].isStreaming = false
    character().chats[1].message = fixtureMessages()
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
    document.head.querySelectorAll('style[data-test-style]').forEach((node) => node.remove())
})

describe('opening', () => {
    test('B2d-1: Ctrl+F on the transcript opens the bar, takes the key and focuses the field', async () => {
        await mountShell()
        expect(bar()).toBeNull()
        const event = pressFind()
        expect(event.defaultPrevented).toBe(true)
        await vi.waitFor(() => { flushSync(); expect(bar()).not.toBeNull() })
        await settle()
        expect(document.activeElement).toBe(field())
        expect(target.querySelector('[data-part="chat-header-menu"]')).toBeNull()
    })
    test('B2d-11: in a group chat Ctrl+F on the page body is not taken and no bar opens', async () => {
        await mountShell()
        character().type = 'group'
        flushSync()
        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
        document.body.dispatchEvent(event)
        flushSync()
        expect(event.defaultPrevented).toBe(false)
        expect(bar()).toBeNull()
    })
    test('B2d-12: Ctrl+F while open refocuses and selects the field and changes nothing else', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        const originReads = readOrigin.mock.calls.length
        const before = counter()
        field().blur()
        transcript().focus()
        const event = pressFind(transcript())
        expect(event.defaultPrevented).toBe(true)
        await settle()
        expect(document.activeElement).toBe(field())
        expect(field().selectionStart).toBe(0)
        expect(field().selectionEnd).toBe('needle'.length)
        expect(readOrigin.mock.calls.length).toBe(originReads)
        expect(jumpTo).toHaveBeenCalledTimes(1)
        expect(counter()).toBe(before)
    })
})

describe('the open bar and the first message', () => {
    test('B2d-12: Ctrl+F inside the bar field is taken by the bar, not by the browser, and selects the field', async () => {
        await mountShell()
        await openBar()
        type('needle')
        field().setSelectionRange(2, 2)
        const event = pressFind(field())
        expect(event.defaultPrevented).toBe(true)
        expect(field().selectionStart).toBe(0)
        expect(field().selectionEnd).toBe('needle'.length)
    })
    test('B2d-3: the first message is searched, last, and shows as a hit with no message object', async () => {
        await mountShell()
        await openBar()
        type('greeting')
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(1) }, { timeout: 3000 })
        expect(jumpTo).toHaveBeenLastCalledWith(-1, { recordOrigin: false, focus: false })
        expect(captured.list!.searchHit).toEqual({ index: -1, message: null })
        await settle()
        expect(counter()).toBe('1 of 1')
    })
})

describe('the header swap', () => {
    test('B2d-2: the concealment attribute is absent while the bar is open and follows the header again after close', async () => {
        await mountShell()
        await settle()
        captured.header!.onconcealed(true)
        flushSync()
        expect(root().hasAttribute('data-header-concealed')).toBe(true)
        expect(root().hasAttribute('data-find-open')).toBe(false)
        await openBar()
        expect(root().hasAttribute('data-find-open')).toBe(true)
        expect(root().hasAttribute('data-header-concealed')).toBe(false)
        // A stale report from the header while the bar is open never brings the attribute back.
        captured.header!.onconcealed(true)
        flushSync()
        expect(root().hasAttribute('data-header-concealed')).toBe(false)
        captured.concealOnMount = true
        target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!.click()
        await settle()
        expect(bar()).toBeNull()
        expect(root().hasAttribute('data-find-open')).toBe(false)
        expect(root().hasAttribute('data-header-concealed')).toBe(true)
    })
})

describe('showing hits', () => {
    test('B2d-3: the first hit shows without taking focus or recording an origin, and is announced', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        expect(jumpTo).toHaveBeenLastCalledWith(150, { recordOrigin: false, focus: false })
        expect(document.activeElement).toBe(field())
        expect(captured.list!.searchHit?.index).toBe(150)
        expect(captured.list!.searchHitNote).toBe('The match is inside this message')
        await vi.waitFor(() => { flushSync(); expect(announcer()).toBe('Match 1 of 3') })
        expect(chipButton()).toBeNull()
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(2) })
        expect(jumpTo).toHaveBeenLastCalledWith(100, { recordOrigin: false, focus: false })
        expect(document.activeElement).toBe(field())
        expect(chipButton()).toBeNull()
    })
    test('B2d-3: a query with no match announces the empty result once', async () => {
        await mountShell()
        await openBar()
        type('zzz')
        await vi.waitFor(() => { flushSync(); expect(announcer()).toBe('No results') }, { timeout: 3000 })
        expect(jumpTo).not.toHaveBeenCalled()
    })
    test('B2d-13: typing a new character clears the hit in the same flush, before any new hit', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        expect(captured.list!.searchHit).not.toBeNull()
        type('needl')
        expect(captured.list!.searchHit).toBeNull()
    })
    test('a blocked hit jump shows the editor toast and leaves the bar open', async () => {
        jumpTo.mockImplementation(async (index) => ({ status: 'blocked', from: null, to: index }))
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        expect(toast).toHaveBeenCalledWith({ kind: 'warning', text: 'Close the editor' })
        expect(bar()).not.toBeNull()
    })
})

describe('the transcript reserve', () => {
    // The shell's own style block, as the build ships it, with the :global wrapper removed so jsdom can cascade it.
    function injectShellStyle(): void {
        const source = readFileSync(path.join(process.cwd(), 'src/lib/ChatShell/ChatShell.svelte'), 'utf8')
        const ast = parse(source, { modern: true })
        if (!ast.css) throw new Error('the shell has no style block')
        const style = document.createElement('style')
        style.dataset.testStyle = ''
        style.textContent = source.slice(ast.css.content.start, ast.css.content.end).replace(/:global\((.*?)\)/g, '$1')
        document.head.appendChild(style)
    }
    const header = 'var(--header-height)'
    const reserve = 'calc(var(--header-height) + var(--size-17))'
    const paddingTop = () => getComputedStyle(transcript()).paddingTop
    const scrollPaddingTop = () => getComputedStyle(transcript()).getPropertyValue('scroll-padding-top')

    test('B2d-8: the reserve changes once at open and once at close and never while typing, stepping or the panel shows', async () => {
        injectShellStyle()
        await mountShell()
        const frame = document.createElement('div')
        frame.setAttribute('data-part', 'chat-switch-frame')
        root().appendChild(frame)
        const writes = vi.fn()
        Object.defineProperty(transcript(), 'scrollTop', { get: () => 0, set: writes, configurable: true })
        expect(paddingTop()).toBe(header)
        expect(scrollPaddingTop()).toBe(header)
        await openBar()
        expect(paddingTop()).toBe(reserve)
        expect(scrollPaddingTop()).toBe(reserve)
        expect(getComputedStyle(frame).top).toBe(reserve)
        await typeAndWaitForFirstHit()
        expect(counter()).not.toBeNull()
        expect(paddingTop()).toBe(reserve)
        expect(scrollPaddingTop()).toBe(reserve)
        type('zzz')
        await vi.waitFor(() => { flushSync(); expect(target.querySelector('[data-part="chat-find-empty"]')).not.toBeNull() }, { timeout: 3000 })
        expect(paddingTop()).toBe(reserve)
        expect(scrollPaddingTop()).toBe(reserve)
        expect(getComputedStyle(frame).top).toBe(reserve)
        expect(writes).not.toHaveBeenCalled()
        target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!.click()
        await settle()
        expect(paddingTop()).toBe(header)
        expect(scrollPaddingTop()).toBe(header)
        expect(getComputedStyle(frame).top).not.toBe(reserve)
        expect(writes).not.toHaveBeenCalled()
    })
    test('B2d-8: a reader resting at the newest message is re-anchored once after the reserve changes, at open and at close; one above is not', async () => {
        await mountShell()
        captured.list!.atBottom = true
        flushSync()
        await openBar()
        expect(anchorBottom).toHaveBeenCalledTimes(1)
        target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!.click()
        await settle()
        expect(anchorBottom).toHaveBeenCalledTimes(2)
        captured.list!.atBottom = false
        flushSync()
        await openBar()
        target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!.click()
        await settle()
        expect(anchorBottom).toHaveBeenCalledTimes(2)
    })
})

describe('the surface', () => {
    test('B2d-9: Settings or Studio opening closes the bar with no chip, no focus move and no later jump', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        chatSurface.hidden = true
        chatSurface.closeEpoch += 1
        await settle()
        expect(bar()).toBeNull()
        expect(captured.list!.searchHit).toBeNull()
        expect(chipButton()).toBeNull()
        expect(root().contains(document.activeElement)).toBe(false)
        chatSurface.hidden = false
        await settle()
        expect(jumpTo).toHaveBeenCalledTimes(1)
        expect(bar()).toBeNull()
    })
    test('B2d-9b: a hidden surface without an epoch bump never receives a hit jump', async () => {
        await mountShell()
        await openBar()
        type('needle')
        chatSurface.hidden = true
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 500))
        flushSync()
        expect(jumpTo).not.toHaveBeenCalled()
    })
})

describe('closing paths', () => {
    test('B2d-5: Back closes with a query in one step, and an idle Back is not handled', async () => {
        await mountShell()
        expect(dispatchBack()).toBe(false)
        await openBar()
        await typeAndWaitForFirstHit()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(bar()).toBeNull()
    })
    test('B2d-5: the mouse back button closes the bar; other buttons do not', async () => {
        await mountShell()
        await openBar()
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }))
        flushSync()
        expect(bar()).not.toBeNull()
        const back = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true })
        window.dispatchEvent(back)
        await settle()
        expect(back.defaultPrevented).toBe(true)
        expect(bar()).toBeNull()
    })
    test('B2d-5: Esc clears a non-empty field first, then closes', async () => {
        await mountShell()
        await openBar()
        type('needle')
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(field().value).toBe('')
        expect(bar()).not.toBeNull()
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(bar()).toBeNull()
    })
    test('B2d-6: another chat shown closes the bar with no chip', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        character().chatPage = 1
        await settle()
        expect(bar()).toBeNull()
        expect(captured.list!.searchHit).toBeNull()
        expect(chipButton()).toBeNull()
    })
    test('B2d-6: a message added under the scan restarts it without showing anything', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        character().chats[0].message.push({ role: 'char', data: 'one more needle', time: 5000 })
        flushSync()
        await vi.waitFor(() => { flushSync(); expect(counter()).toContain('4') }, { timeout: 3000 })
        expect(jumpTo).toHaveBeenCalledTimes(1)
    })
})

async function waitForSheets(): Promise<void> {
    await vi.waitFor(() => { flushSync(); if (!captured.thisChat) throw new Error('waiting for the This-chat sheet') })
}
const closeButton = () => target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!
const seeAll = () => target.querySelector<HTMLButtonElement>('button.see-all')!
const filtersButton = () => target.querySelector<HTMLButtonElement>('button[aria-label="Filters"]')!
const menuButton = () => target.querySelector<HTMLElement>('[data-part="chat-header-menu"]')
function enter(): void {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}
async function openBarFrom(opener: HTMLElement | null): Promise<void> {
    captured.thisChat!.onsearch!(opener)
    await vi.waitFor(() => { flushSync(); if (!bar()) throw new Error('the bar is not open') })
    await settle()
}

describe('the two entries', () => {
    test('B2d-7: the This-chat sheet entry opens the bar and closing it returns focus to the entry opener', async () => {
        await mountShell()
        await waitForSheets()
        expect(captured.thisChat!.onsearch).toBeTypeOf('function')
        composerField().focus()
        await openBarFrom(composerField())
        expect(document.activeElement).toBe(field())
        closeButton().click()
        await settle()
        expect(bar()).toBeNull()
        expect(document.activeElement).toBe(composerField())
    })
    test('B2d-7: the jump sheet entry closes the sheet, then opens the bar', async () => {
        await mountShell()
        await waitForSheets()
        captured.thisChat!.onjumpsheet!(null)
        flushSync()
        expect(captured.jump!.open).toBe(true)
        expect(captured.jump!.onsearch).toBeTypeOf('function')
        captured.jump!.onsearch!()
        flushSync()
        expect(captured.jump!.open).toBe(false)
        let sheetOpenWhenBarShown: boolean | null = null
        await vi.waitFor(() => {
            flushSync()
            if (!bar()) throw new Error('the bar is not open')
            sheetOpenWhenBarShown ??= captured.jump!.open
        })
        await settle()
        expect(sheetOpenWhenBarShown).toBe(false)
        expect(document.activeElement).toBe(field())
        // The sheet was opened from no element inside the shell, so its opener is the transcript, and closing the bar returns there.
        closeButton().click()
        await settle()
        expect(document.activeElement).toBe(transcript())
    })
})

describe('closing with nothing in flight', () => {
    test('B2d-4: focus returns to the opener when it is still in the shell', async () => {
        await mountShell()
        await waitForSheets()
        composerField().focus()
        await openBarFrom(composerField())
        closeButton().click()
        await settle()
        expect(document.activeElement).toBe(composerField())
    })
    test('B2d-4: without an opener focus returns to the header menu button', async () => {
        await mountShell()
        await waitForSheets()
        await openBarFrom(null)
        closeButton().click()
        await settle()
        expect(menuButton()).not.toBeNull()
        expect(document.activeElement).toBe(menuButton())
    })
    test('B2d-4: without an opener and without a menu button focus returns to the transcript', async () => {
        captured.headerMenu = false
        await mountShell()
        await waitForSheets()
        await openBarFrom(null)
        closeButton().click()
        await settle()
        expect(menuButton()).toBeNull()
        expect(document.activeElement).toBe(transcript())
    })
    const closers: [string, () => void][] = [
        ['the close button', () => closeButton().click()],
        ['Esc on an empty field', () => { field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }],
        ['Back', () => { dispatchBack() }],
        ['mouse button 3', () => { window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true })) }],
    ]
    test.each(closers)('B2d-4: %s never jumps, returns or scrolls, and shows no chip', async (_name, close) => {
        await mountShell()
        await waitForSheets()
        await openBarFrom(null)
        const writes = vi.fn()
        Object.defineProperty(transcript(), 'scrollTop', { get: () => 0, set: writes, configurable: true })
        close()
        await settle()
        expect(bar()).toBeNull()
        expect(jumpTo).not.toHaveBeenCalled()
        expect(returnTo).not.toHaveBeenCalled()
        expect(jumpToLatest).not.toHaveBeenCalled()
        expect(writes).not.toHaveBeenCalled()
        expect(chipButton()).toBeNull()
    })
})

describe('the return chip', () => {
    test('B2d-10: a jump-sheet chip stays through hit jumps, and a long move at close replaces it with the place before the search', async () => {
        await mountShell()
        await waitForSheets()
        const sheetOrigin: JumpOrigin = { index: 5, offset: 40, atBottom: false }
        const searchOrigin: JumpOrigin = { index: 80, offset: 0, atBottom: false }
        jumpTo.mockImplementationOnce(async (index) => done(index, sheetOrigin))
        captured.thisChat!.onjumpsheet!(null)
        flushSync()
        captured.jump!.onjump(190)
        await vi.waitFor(() => { flushSync(); expect(chipButton()).not.toBeNull() })
        await settle()
        let reads = 0
        readOrigin.mockImplementation(() => (reads++ === 0 ? searchOrigin : { index: 150, offset: 0, atBottom: false }))
        await openBar()
        type('needle')
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(2) }, { timeout: 3000 })
        await settle()
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(3) })
        await settle()
        expect(chipButton()).not.toBeNull()
        expect(returnTo).not.toHaveBeenCalled()
        closeButton().click()
        await vi.waitFor(() => { flushSync(); expect(announcer()).toBe('Moved. Go back returns.') })
        expect(chipButton()).not.toBeNull()
        chipButton()!.click()
        await settle()
        expect(returnTo).toHaveBeenCalledExactlyOnceWith(searchOrigin)
    })
})

describe('a message removed under the current hit', () => {
    test('B2d-14: a deleted message above the hit never makes Enter jump to the wrong message, and the next Enter follows the anchor', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        const messages = character().chats[0].message
        const shownBefore = jumpTo.mock.calls.length
        messages.splice(120, 1)
        flushSync()
        enter()
        await settle()
        await vi.waitFor(() => { flushSync(); expect(counter()).toBe('1 of 3') }, { timeout: 3000 })
        for (const [index] of jumpTo.mock.calls.slice(shownBefore)) expect(messages[index].data).toContain('needle')
        const shown = captured.list!.searchHit
        // The outline follows the message by reference, so a stale cached index never decorates another one.
        if (shown !== null) expect((shown.message as { data: string }).data).toBe('a needle at 150')
        const before = jumpTo.mock.calls.length
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpTo.mock.calls.length).toBeGreaterThan(before) })
        const last = jumpTo.mock.calls.at(-1)![0]
        expect(last).toBe(100)
        expect(messages[last].data).toBe('a needle at 100')
    })
})

describe('a blocked hit jump', () => {
    test('B2d-16: the toast shows, the bar stays open and the next Enter steps on to the next hit', async () => {
        jumpTo.mockImplementationOnce(async (index) => ({ status: 'blocked', from: null, to: index }))
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        expect(toast).toHaveBeenCalledExactlyOnceWith({ kind: 'warning', text: 'Close the editor' })
        expect(bar()).not.toBeNull()
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(2) })
        expect(jumpTo).toHaveBeenLastCalledWith(100, { recordOrigin: false, focus: false })
        expect(toast).toHaveBeenCalledTimes(1)
    })
})

describe('the results and filters sheets', () => {
    test('B2d-3: See all opens the results sheet with the hits, newest first, and a pick closes it before the hit is shown', async () => {
        character().image = 'c.png'
        DBState.db.userIcon = 'u.png'
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        expect(seeAll().disabled).toBe(false)
        expect(captured.results!.open).toBe(false)
        seeAll().click()
        flushSync()
        expect(captured.results!.open).toBe(true)
        expect(captured.results!.hits.map((hit) => hit.index)).toEqual([150, 100, 20])
        expect(captured.results!.query).toBe('needle')
        expect(captured.results!.complete).toBe(true)
        expect(captured.results!.firstText).toBe('Greeting text')
        expect(captured.results!.charName).toBe('Seraphina')
        await vi.waitFor(() => { flushSync(); expect(captured.results!.charImage).toBe('resolved:c.png') })
        expect(captured.results!.userImage).toBe('resolved:u.png')
        const openAtCall: boolean[] = []
        jumpTo.mockImplementation(async (index) => { openAtCall.push(captured.results!.open); return done(index) })
        captured.results!.onpick(2)
        flushSync()
        expect(captured.results!.open).toBe(false)
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(2) })
        expect(jumpTo).toHaveBeenLastCalledWith(20, { recordOrigin: false, focus: false })
        expect(openAtCall).toEqual([false])
        expect(captured.list!.searchHit?.index).toBe(20)
    })
    test('B2d-3: a filter change clears the hit at once and rescans; clearing the filters brings the hits back', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        filtersButton().click()
        flushSync()
        expect(captured.filters!.open).toBe(true)
        expect(captured.filters!.filters.speaker).toBe('any')
        // Every needle was said by the user, so the character filter leaves nothing.
        captured.filters!.onfilters({ speaker: 'char' })
        expect(captured.list!.searchHit).toBeNull()
        await vi.waitFor(() => { flushSync(); expect(target.querySelector('[data-part="chat-find-empty"]')).not.toBeNull() }, { timeout: 3000 })
        expect(captured.filters!.filters.speaker).toBe('char')
        captured.filters!.onclear()
        await vi.waitFor(() => { flushSync(); expect(counter()).toBe('1 of 3') }, { timeout: 3000 })
        expect(captured.filters!.filters.speaker).toBe('any')
    })
    test('B2d-3: closing the bar takes both sheets along', async () => {
        await mountShell()
        await openBar()
        await typeAndWaitForFirstHit()
        filtersButton().click()
        seeAll().click()
        flushSync()
        expect(captured.filters!.open).toBe(true)
        expect(captured.results!.open).toBe(true)
        closeButton().click()
        await settle()
        expect(captured.filters!.open).toBe(false)
        expect(captured.results!.open).toBe(false)
    })
})

describe('streaming', () => {
    test('B2d-15: chunks on the last message neither restart nor show; the end of the stream restarts once without showing', async () => {
        character().chats[0].isStreaming = true
        await mountShell()
        await openBar()
        type('needle')
        await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(1) }, { timeout: 3000 })
        await vi.waitFor(() => { flushSync(); expect(counter()).toBe('1 of 3') }, { timeout: 3000 })
        const messages = character().chats[0].message
        messages[messages.length - 1].data = 'a longer chunk of the streaming reply'
        flushSync()
        await settle()
        expect(counter()).toBe('1 of 3')
        character().chats[0].isStreaming = false
        flushSync()
        // The restart clears the hits at once; the rescan then finds them again.
        expect(counter()).toBe('')
        await vi.waitFor(() => { flushSync(); expect(counter()).toBe('1 of 3') }, { timeout: 3000 })
        expect(jumpTo).toHaveBeenCalledTimes(1)
    })
})
