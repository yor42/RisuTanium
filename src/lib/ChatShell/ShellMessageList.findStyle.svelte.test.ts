// @vitest-environment jsdom
// The search hit takes no layout space: the same row is compared with and without the decoration under the list's own style block, and no
// box-affecting computed property of the row may differ. jsdom computes no layout, so this proves the declarations, not the geometry; the
// rendered geometry is a device check.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { parse } from 'svelte/compiler'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import type { ReaderIntentSource } from '../../ts/chatShell/readerIntent'
import type { SearchHit } from '../../ts/chatShell/inChatSearch'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 15 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('./ShellMessage.svelte', () => ({
    default: (anchor: Comment, props: { idx: number }) => {
        const article = document.createElement('article')
        article.dataset.part = 'chat-message'
        article.dataset.chatIndex = String(props.idx)
        anchor.before(article)
        return {}
    },
}))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'

type Bound = { character: Character, host: HTMLElement, readerIntent: ReaderIntentSource, searchHit: SearchHit | null, searchHitNote: string }

// Every property that can change a row's box or its off-screen sizing.
const BOX_PROPERTIES = [
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'height', 'min-height', 'display', 'content-visibility', 'contain-intrinsic-size',
] as const

const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: [],
    chats: [{ id: 'room', message: [] as Message[], alt: [] }] }) as unknown as Character

// vitest runs from the repository root.
const root = process.cwd()

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let props: Bound
let style: HTMLStyleElement

// The list's own style block, taken from the component source through the compiler's parser so the test reads the declarations the build ships.
function listStyleText(): string {
    const source = readFileSync(path.join(root, 'src/lib/ChatShell/ShellMessageList.svelte'), 'utf8')
    const ast = parse(source, { modern: true })
    if (!ast.css) throw new Error('the list has no style block')
    return source.slice(ast.css.content.start, ast.css.content.end)
}

class FakeObserver {
    constructor(_callback: () => void) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true })
    // The tokens the block reads are defined here; jsdom resolves no var(), so values that read them are compared as written.
    style = document.createElement('style')
    style.textContent = `:root { --stroke-bold: 2px; --space-6: 7px; --size-39: 400px; }\n${listStyleText()}`
    document.head.appendChild(style)
    character.chats[0].message = Array.from({ length: 12 }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `m${i}` }))
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    const bound = $state<Bound>({ character, host, readerIntent: { subscribe: () => () => {} }, searchHit: null, searchHitNote: 'Match inside' })
    props = bound
    app = mount(ShellMessageList, { target: host, props: bound })
    flushSync()
    await tick()
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target.remove()
    style.remove()
    character.chats[0].message = []
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

function containerAt(index: number): HTMLElement {
    const container = host.querySelector(`article[data-chat-index="${index}"]`)?.closest<HTMLElement>('[data-part="chat-message-container"], [data-part="chat-first-message"]')
    if (!container) throw new Error(`no container at ${index}`)
    return container
}
function boxOf(element: HTMLElement): Record<string, string> {
    const computed = getComputedStyle(element)
    return Object.fromEntries(BOX_PROPERTIES.map((name) => [name, computed.getPropertyValue(name)]))
}

describe('search hit decoration style', () => {
    test('B2b-3c: decorating a row changes none of its box-affecting properties, the note is absolutely positioned and the outline sits inside the box', async () => {
        // Row 2 is older than the newest three, so the off-screen sizing rule applies to it.
        const container = containerAt(2)
        const before = boxOf(container)
        props.searchHit = { index: 2, message: character.chats[0].message[2] }
        flushSync()
        await tick()
        expect(container.classList.contains('search-hit')).toBe(true)
        const after = boxOf(container)
        for (const name of BOX_PROPERTIES) expect(after[name], name).toBe(before[name])
        const note = container.querySelector<HTMLElement>('.search-hit-note')
        expect(note).not.toBeNull()
        expect(getComputedStyle(note as HTMLElement).position).toBe('absolute')
        expect(getComputedStyle(container).position).toBe('relative')
        const offset = getComputedStyle(container).getPropertyValue('outline-offset')
        expect(offset).toMatch(/^(-|calc\(\s*-|calc\(.*\*\s*-1\))/)
    })
    test('B2b-3c: the first message container is decorated the same way', async () => {
        const first = containerAt(-1)
        const before = boxOf(first)
        props.searchHit = { index: -1, message: null }
        flushSync()
        await tick()
        const after = boxOf(first)
        for (const name of BOX_PROPERTIES) expect(after[name], name).toBe(before[name])
        expect(getComputedStyle(first.querySelector<HTMLElement>('.search-hit-note') as HTMLElement).position).toBe('absolute')
    })
})
