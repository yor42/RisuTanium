// @vitest-environment jsdom
/**
 * Closing the search bar while a hit jump is still in flight. The close never cancels the jump: it waits for it, then judges the return chip
 * from where the reader actually is, and a close caused by the surface owes neither the chip nor a focus move.
 * REAL: `ChatShell.svelte`, `FindBar.svelte`, `findSession.ts`, `findRun.ts`, `returnChip.ts`, `shellJumpKeys.ts`. MOCKED: stores, the message list
 * (a stub whose `jumpTo` answers a promise the test resolves), the header, the composer, the other sheets, the toast post, the language table
 * and the surface state.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { JumpOptions, JumpOrigin, JumpResult } from '../../ts/chatShell/jumpTarget'

type ListProps = { searchHit: { index: number, message: object | null } | null }
type FixtureMessage = { role: 'user' | 'char', data: string, time: number }
type FixtureCharacter = { chaId: string, type: string, chatPage: number, chats: { id: string, message: FixtureMessage[] }[] }

const captured = vi.hoisted(() => ({
    list: null as null | ListProps,
    jump: null as null | { open: boolean },
    jumpTo: null as null | ((index: number, options?: JumpOptions) => Promise<JumpResult>),
    readOrigin: null as null | (() => JumpOrigin | null),
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
vi.mock('./ShellHeader.svelte', () => ({ default: (anchor: Comment) => {
    const button = document.createElement('button')
    button.setAttribute('data-part', 'chat-header-menu')
    anchor.before(button)
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
        readOrigin: () => captured.readOrigin!(),
    }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./JumpSheet.svelte', () => ({ default: (_anchor: Comment, props: { open: boolean }) => {
    captured.jump = props
    return {}
} }))
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

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let jumpTo: Mock<(index: number, options?: JumpOptions) => Promise<JumpResult>>
let toast: Mock<(init: { kind: string, text: string }) => number>
let place: JumpOrigin
let resolveJump: (result: JumpResult) => void

const pre: JumpOrigin = { index: 5, offset: 40, atBottom: false }
const root = () => target.querySelector<HTMLElement>('[data-part="chat-shell"]')!
const bar = () => target.querySelector<HTMLElement>('[data-part="chat-find-bar"]')
const field = () => target.querySelector<HTMLInputElement>('[data-part="chat-find-field"]')!
const announcer = () => target.querySelector('[data-part="chat-announcer"]')!.textContent
const chipButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-return-chip"]')
const composerField = () => target.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')!
const closeButton = () => target.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!
const character = () => DBState.db.characters[0] as unknown as FixtureCharacter

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.jump) throw new Error('waiting for the list and the sheets')
    }, { timeout: 15000 })
}

async function settle(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round++) await tick()
    flushSync()
}

// Opened from the message box, so closing by the reader returns focus there. The first hit's jump stays pending until the test resolves it.
async function openAndRequestFirstHit(): Promise<void> {
    composerField().focus()
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    composerField().dispatchEvent(event)
    await vi.waitFor(() => { flushSync(); if (!bar()) throw new Error('the bar is not open') })
    await settle()
    const input = field()
    input.value = 'needle'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
    await vi.waitFor(() => { flushSync(); expect(jumpTo).toHaveBeenCalledTimes(1) }, { timeout: 3000 })
}

beforeEach(() => {
    captured.list = null
    captured.jump = null
    place = pre
    jumpTo = vi.fn<(index: number, options?: JumpOptions) => Promise<JumpResult>>(() => new Promise<JumpResult>((resolve) => { resolveJump = resolve }))
    toast = vi.fn<(init: { kind: string, text: string }) => number>(() => 1)
    captured.jumpTo = (...args) => jumpTo(...args)
    captured.readOrigin = () => place
    captured.toast = toast
    chatSurface.hidden = false
    chatSurface.closeEpoch = 0
    character().chatPage = 0
    const messages: FixtureMessage[] = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: i === 150 ? 'a needle' : `filler ${i}`, time: 1000 + i }))
    character().chats[0].message = messages
    character().chats[1].message = messages.slice()
})
afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
})

describe('closing while a hit jump is in flight', () => {
    test('B2d-17: the close waits for the jump, then offers the pre-search place when it went more than 50 messages', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        closeButton().click()
        flushSync()
        expect(bar()).toBeNull()
        expect(captured.list!.searchHit).toBeNull()
        expect(chipButton()).toBeNull()
        place = { index: 150, offset: 0, atBottom: false }
        resolveJump({ status: 'done', from: null, to: 150 })
        await vi.waitFor(() => { flushSync(); expect(chipButton()).not.toBeNull() })
        await settle()
        expect(announcer()).toBe('Moved. Go back returns.')
        expect(jumpTo).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(composerField())
    })
    test('B2d-17: a move of 50 messages or less leaves no chip, and the match is not announced after the close', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        closeButton().click()
        flushSync()
        place = { index: 40, offset: 0, atBottom: false }
        resolveJump({ status: 'done', from: null, to: 40 })
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 50))
        flushSync()
        expect(chipButton()).toBeNull()
        expect(announcer()).toBe('')
        expect(document.activeElement).toBe(composerField())
    })
    test('B2d-17: a blocked jump after the close posts no toast and leaves no chip', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        closeButton().click()
        flushSync()
        place = { index: 150, offset: 0, atBottom: false }
        resolveJump({ status: 'blocked', from: null, to: 150 })
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 50))
        flushSync()
        expect(toast).not.toHaveBeenCalled()
        expect(chipButton()).toBeNull()
    })
    test('B2d-17: a jump that lands after a newer query was typed announces nothing and shows no stale hit', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        const input = field()
        input.value = 'needl'
        input.dispatchEvent(new InputEvent('input', { bubbles: true }))
        flushSync()
        expect(captured.list!.searchHit).toBeNull()
        resolveJump({ status: 'done', from: null, to: 150 })
        // Only microtasks run here, so the new scan has not yet announced its own result over a stale label.
        await settle()
        expect(announcer()).not.toContain('Match')
        expect(captured.list!.searchHit).toBeNull()
    })
    test('B2d-18: a close by the surface owes no chip, no focus move, no toast and no announcement', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        chatSurface.hidden = true
        chatSurface.closeEpoch += 1
        await settle()
        expect(bar()).toBeNull()
        place = { index: 150, offset: 0, atBottom: false }
        resolveJump({ status: 'done', from: null, to: 150 })
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 50))
        flushSync()
        expect(chipButton()).toBeNull()
        expect(toast).not.toHaveBeenCalled()
        expect(announcer()).toBe('')
        expect(root().contains(document.activeElement)).toBe(false)
        expect(jumpTo).toHaveBeenCalledTimes(1)
    })
    test('B2d-18: a close by a chat switch owes no chip and no focus move either', async () => {
        await mountShell()
        await openAndRequestFirstHit()
        character().chatPage = 1
        await settle()
        expect(bar()).toBeNull()
        place = { index: 150, offset: 0, atBottom: false }
        resolveJump({ status: 'done', from: null, to: 150 })
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 50))
        flushSync()
        expect(chipButton()).toBeNull()
        expect(root().contains(document.activeElement)).toBe(false)
    })
})
