// @vitest-environment jsdom
/**
 * In-text marks for the shown search hit, seen from the shell: which hit carries marks, when the list gets the outline instead, and what
 * clears them. REAL: `ChatShell.svelte`, `FindBar.svelte`, `findSession.ts`, `findRun.ts`, `inChatSearch.ts`, `hitMarks.ts`.
 * MOCKED: stores, the message list (a stub whose `jumpTo` mounts an article with a message body and calls the jump's `aim`, as the real
 * list does after it mounts the target row), the header, the composer, the other sheets, the toast post, the language table and the surface state.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JumpOptions, JumpOrigin, JumpResult } from '../../ts/chatShell/jumpTarget'

type ListProps = { searchHit: { index: number, message: object | null } | null, searchHitNote: string }
type FiltersSheetProps = { onfilters: (patch: { speaker?: string, thinking?: boolean }) => void }
type FixtureMessage = { role: 'user' | 'char', data: string, time: number }
type FixtureChat = { id: string, message: FixtureMessage[], isStreaming?: boolean }
type FixtureCharacter = { chaId: string, type: string, name: string, image?: string, firstMessage: string, alternateGreetings: string[], chatPage: number, chats: FixtureChat[] }

const captured = vi.hoisted(() => ({
    list: null as null | ListProps,
    header: null as null | object,
    filters: null as null | FiltersSheetProps,
    jumpTo: null as null | ((index: number, options?: JumpOptions) => Promise<JumpResult>),
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
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: () => 0 }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({
    language: {
        cot: 'Chain of Thoughts',
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
vi.mock('./ShellHeader.svelte', () => ({ default: (anchor: Comment, props: { onconcealed: (concealed: boolean) => void }) => {
    captured.header = props
    const button = document.createElement('button')
    button.setAttribute('data-part', 'chat-header-menu')
    anchor.before(button)
    queueMicrotask(() => props.onconcealed(false))
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
        anchorNewestBottom: () => {},
        jumpToLatest: async () => {},
        jumpTo: (...args: [number, JumpOptions?]) => captured.jumpTo!(...args),
        returnTo: async (): Promise<JumpResult> => ({ status: 'done', from: null, to: 0 }),
        readOrigin: (): JumpOrigin => ({ index: 5, offset: 40, atBottom: false }),
    }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./JumpSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./FindFiltersSheet.svelte', () => ({ default: (_anchor: Comment, props: FiltersSheetProps) => {
    captured.filters = props
    return {}
} }))
vi.mock('./FindResultsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, isComposerBusyIn: () => false, branchAt: vi.fn() }))

import ChatShell from './ChatShell.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
// The mounted article of each shown message, created on first show.
let articles: Map<number, HTMLElement>
// Per message index: the body HTML its article mounts with, and any attribute the article carries.
let bodies: Map<number, string>
let streaming: Set<number>
let jumpCalls: { index: number, options: JumpOptions | undefined }[]

const done = (to: number): JumpResult => ({ status: 'done', from: null, to })
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const field = () => target.querySelector<HTMLInputElement>('[data-part="chat-find-field"]')!
const bar = () => target.querySelector<HTMLElement>('[data-part="chat-find-bar"]')
const closeButton = () => target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!
const character = () => DBState.db.characters[0] as unknown as FixtureCharacter
const marksIn = (article: HTMLElement | undefined) => article?.querySelectorAll('mark.search-mark').length ?? 0
const markText = (article: HTMLElement | undefined) => Array.from(article?.querySelectorAll('mark.search-mark') ?? []).map((mark) => mark.textContent).join('|')

function mountArticle(index: number): HTMLElement {
    const article = document.createElement('article')
    if (streaming.has(index)) article.setAttribute('data-streaming', '')
    const body = document.createElement('div')
    body.setAttribute('data-part', 'chat-message-body')
    body.innerHTML = bodies.get(index) ?? `<p>a needle at ${index}</p>`
    article.append(body)
    document.body.append(article)
    articles.set(index, article)
    return article
}

// What the real list does after it mounts the target row: hand the article to the jump's aim, then land.
async function defaultJump(index: number, options?: JumpOptions): Promise<JumpResult> {
    jumpCalls.push({ index, options })
    const article = articles.get(index) ?? mountArticle(index)
    await options?.aim?.(article)
    return done(index)
}

function fixtureMessages(): FixtureMessage[] {
    return Array.from({ length: 200 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: [150, 100, 20].includes(i) ? `a needle at ${i}` : `filler ${i}`, time: 1000 + i }))
}

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.header || !captured.filters) throw new Error('waiting for the list, the header and the sheets')
    }, { timeout: 15000 })
}

async function settle(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round++) await tick()
    flushSync()
}

async function openBar(): Promise<void> {
    transcript().dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    flushSync()
    await vi.waitFor(() => { flushSync(); if (!bar()) throw new Error('the bar is not open') })
    await settle()
}

function type(value: string): void {
    const input = field()
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

async function showFirstHit(value = 'needle'): Promise<void> {
    await openBar()
    type(value)
    await vi.waitFor(() => { flushSync(); expect(jumpCalls.length).toBeGreaterThanOrEqual(1) }, { timeout: 3000 })
    await settle()
}

function enter(): void {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

beforeEach(() => {
    captured.list = null
    captured.header = null
    captured.filters = null
    articles = new Map()
    bodies = new Map()
    streaming = new Set()
    jumpCalls = []
    captured.jumpTo = defaultJump
    chatSurface.hidden = false
    chatSurface.closeEpoch = 0
    character().type = 'character'
    character().chatPage = 0
    character().image = undefined
    DBState.db.userIcon = ''
    character().chats[0].message = fixtureMessages()
    character().chats[0].isStreaming = false
    character().chats[1].message = fixtureMessages()
})
afterEach(async () => {
    vi.restoreAllMocks()
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
})

describe('a hit with marks', () => {
    test('C1: a done hit marks its occurrences in the article and the list gets no outline', async () => {
        await mountShell()
        await showFirstHit()
        expect(jumpCalls[0].index).toBe(150)
        expect(jumpCalls[0].options?.aim).toBeTypeOf('function')
        expect(markText(articles.get(150))).toBe('needle')
        expect(captured.list!.searchHit).toBeNull()
    })
    test('C2: a hit inside a Thoughts block opens it while shown and a step closes it', async () => {
        bodies.set(150, '<details><summary>Chain of Thoughts</summary>a needle thought</details>')
        character().chats[0].message[150].data = '<Thoughts>a needle thought</Thoughts>'
        await mountShell()
        await showFirstHit()
        // Thinking is off, so the first hit is the plain message below it.
        expect(jumpCalls[0].index).toBe(100)
        captured.filters!.onfilters({ thinking: true })
        flushSync()
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(150) }, { timeout: 3000 })
        await settle()
        const details = articles.get(150)!.querySelector('details')!
        expect(markText(articles.get(150))).toBe('needle')
        expect(details.open).toBe(true)
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(100) }, { timeout: 3000 })
        await settle()
        expect(details.open).toBe(false)
        expect(marksIn(articles.get(150))).toBe(0)
    })
})

describe('the outline fallback', () => {
    test('C3: a hit that cannot be located gets no marks and the list outline', async () => {
        bodies.set(150, '<p>nothing that matches</p>')
        await mountShell()
        await showFirstHit()
        expect(marksIn(articles.get(150))).toBe(0)
        expect(captured.list!.searchHit?.index).toBe(150)
        expect(captured.list!.searchHitNote).toBe('The match is inside this message')
    })
    test('C5: a streaming message gets the outline and no marks', async () => {
        streaming.add(150)
        await mountShell()
        await showFirstHit()
        expect(marksIn(articles.get(150))).toBe(0)
        expect(captured.list!.searchHit?.index).toBe(150)
    })
    test('a jump that never reached marking falls back to the outline', async () => {
        captured.jumpTo = async (index, options) => {
            jumpCalls.push({ index, options })
            return { status: 'cancelled', from: null, to: index }
        }
        await mountShell()
        await showFirstHit()
        expect(captured.list!.searchHit?.index).toBe(150)
    })
})

describe('clearing', () => {
    test('C4: an edit that re-renders the hit body removes the marks, shows the outline, and the next step marks again', async () => {
        await mountShell()
        await showFirstHit()
        expect(marksIn(articles.get(150))).toBe(1)
        articles.get(150)!.querySelector('[data-part="chat-message-body"]')!.innerHTML = '<p>an edited needle</p>'
        await settle()
        expect(marksIn(articles.get(150))).toBe(0)
        expect(captured.list!.searchHit?.index).toBe(150)
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(100) }, { timeout: 3000 })
        await settle()
        expect(marksIn(articles.get(100))).toBe(1)
        expect(captured.list!.searchHit).toBeNull()
    })
    test('C4: a step removes the previous hit marks', async () => {
        await mountShell()
        await showFirstHit()
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(100) }, { timeout: 3000 })
        await settle()
        expect(marksIn(articles.get(150))).toBe(0)
        expect(marksIn(articles.get(100))).toBe(1)
    })
    const clearers: [string, () => void | Promise<void>][] = [
        ['closing the bar', () => closeButton().click()],
        ['a new query', () => type('needl')],
        ['a filter change', () => captured.filters!.onfilters({ speaker: 'char' })],
        ['a chat switch', () => { character().chatPage = 1 }],
        ['the surface opening', () => { chatSurface.hidden = true; chatSurface.closeEpoch += 1 }],
    ]
    test.each(clearers)('C4: %s removes the marks and the outline', async (_name, clear) => {
        await mountShell()
        await showFirstHit()
        expect(marksIn(articles.get(150))).toBe(1)
        await clear()
        await settle()
        expect(marksIn(articles.get(150))).toBe(0)
        expect(captured.list!.searchHit).toBeNull()
    })
})

describe('races', () => {
    test('C6: a hit whose body renders after a newer hit was shown is never marked', async () => {
        bodies.set(150, '')
        await mountShell()
        await showFirstHit()
        // The body is still pending: neither marks nor the outline yet.
        expect(marksIn(articles.get(150))).toBe(0)
        expect(captured.list!.searchHit).toBeNull()
        type('needle at 100')
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(100) }, { timeout: 3000 })
        await settle()
        articles.get(150)!.querySelector('[data-part="chat-message-body"]')!.innerHTML = '<p>a needle at 150</p>'
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(marksIn(articles.get(150))).toBe(0)
        expect(marksIn(articles.get(100))).toBe(1)
        expect(captured.list!.searchHit).toBeNull()
    })
})

describe('closing with an opened details', () => {
    async function closeWithDetailsAt(top: number): Promise<{ details: HTMLDetailsElement, writes: ReturnType<typeof vi.fn> }> {
        bodies.set(150, '<details><summary>Chain of Thoughts</summary>a needle thought</details>')
        character().chats[0].message[150].data = '<Thoughts>a needle thought</Thoughts>'
        await mountShell()
        await openBar()
        captured.filters!.onfilters({ thinking: true })
        type('needle')
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.length).toBeGreaterThanOrEqual(1) }, { timeout: 3000 })
        await settle()
        const details = articles.get(150)!.querySelector('details')!
        expect(details.open).toBe(true)
        vi.spyOn(transcript(), 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
        vi.spyOn(details, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect)
        const writes = vi.fn()
        Object.defineProperty(transcript(), 'scrollTop', { get: () => 0, set: writes, configurable: true })
        closeButton().click()
        await settle()
        return { details, writes }
    }
    test('C7: one above the visible top stays open at the close and nothing scrolls', async () => {
        const { details, writes } = await closeWithDetailsAt(40)
        expect(details.open).toBe(true)
        expect(writes).not.toHaveBeenCalled()
    })
    test('C7: one below the visible top closes at the close and nothing scrolls', async () => {
        const { details, writes } = await closeWithDetailsAt(300)
        expect(details.open).toBe(false)
        expect(writes).not.toHaveBeenCalled()
    })
})

describe('data', () => {
    test('C8: showing, stepping and closing leave the chat data untouched', async () => {
        await mountShell()
        const chat = character().chats[0]
        const messages = chat.message
        const before = JSON.stringify(chat)
        await showFirstHit()
        enter()
        await vi.waitFor(() => { flushSync(); expect(jumpCalls.at(-1)!.index).toBe(100) }, { timeout: 3000 })
        await settle()
        closeButton().click()
        await settle()
        expect(character().chats[0].message).toBe(messages)
        expect(JSON.stringify(character().chats[0])).toBe(before)
    })
})
