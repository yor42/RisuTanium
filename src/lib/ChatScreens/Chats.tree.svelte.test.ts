// @vitest-environment happy-dom

/**
 * What `Chats.svelte` hands each row for the chat tree: the row's own message id as `expectedId`, the
 * shared step, branch and busy handlers, and one sibling view per chat that rows read at render time.
 *
 * Invariants pinned here: no tree data enters a row's mount hash, so a send, a switch on another row or a
 * new alternative never remounts a row (an open editor on it survives); a message that had no id when its
 * row mounted gets its row remounted with the id once the id exists. The real `Chats.svelte` is mounted;
 * `Chat.svelte` is replaced by a stub that records the props it was mounted with.
 *
 * Test kinds: every row here is a new-rule guard (the props and the view do not exist before this change).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface StubProps {
    idx: number
    message: string
    expectedId?: string
    onStep?: unknown
    onBranch?: unknown
    getBusy?: unknown
    getTreeView?: () => { at(i: number): { index: number, count: number } | null, continuation: number } | null
}

const mounts = vi.hoisted(() => [] as StubProps[])

vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown, props: StubProps) => {
        mounts.push(props)
        return { destroy: () => {} }
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        createSimpleCharacter: vi.fn(() => ({})),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    chatFoldedStateMessageIndex: { index: -1 },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

import { DBState } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'

interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, time?: number }
interface LiveAlt { m: LiveMessage, p: string | null, a: number }
interface LiveChat { id: string, message: LiveMessage[], alt?: LiveAlt[] }
interface LiveCharacter { chaId: string, name: string, image: string, chatPage: number, chats: LiveChat[] }

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

const onStep = () => {}
const onBranch = () => {}
const getBusy = () => false

function mountChats(message: LiveMessage[], alt?: LiveAlt[]): LiveChat {
    const chat: LiveChat = { id: 'chat-0', message }
    if (alt) {
        chat.alt = alt
    }
    const character: LiveCharacter = { chaId: 'a', name: 'A', image: '', chatPage: 0, chats: [chat] }
    DBState.db = { streamingDisplayOptimizationMode: 'off', characters: [character] } as never
    const live = (DBState.db.characters as unknown as LiveCharacter[])[0]
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(Chats, {
        target,
        props: {
            messages: live.chats[0].message as never,
            currentCharacter: live as never,
            onReroll: () => {},
            unReroll: () => {},
            onStep,
            onBranch,
            getBusy,
            currentUsername: 'User',
            userIcon: '',
            loadPages: 10,
        },
    })
    flushSync()
    return live.chats[0]
}

const mountsAt = (idx: number) => mounts.filter((entry) => entry.idx === idx)
const viewOf = () => {
    const getTreeView = mounts[0].getTreeView
    expect(getTreeView, 'the shared view getter').toBeTypeOf('function')
    return getTreeView!
}

beforeEach(() => {
    mounts.length = 0
})

afterEach(async () => {
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
})

describe('the props a row gets for the chat tree', () => {
    test('each row gets its own message id as expectedId and the shared handlers', () => {
        mountChats([
            { role: 'user', data: 'Hi', chatId: 'u1', time: 1 },
            { role: 'char', data: 'Hello', chatId: 'c2', time: 3 },
        ])

        expect(mountsAt(0).map((entry) => entry.expectedId)).toEqual(['u1'])
        expect(mountsAt(1).map((entry) => entry.expectedId)).toEqual(['c2'])
        for (const entry of mounts) {
            expect(entry.onStep).toBe(onStep)
            expect(entry.onBranch).toBe(onBranch)
            expect(entry.getBusy).toBe(getBusy)
        }
        expect(mountsAt(0)[0].getTreeView).toBe(mountsAt(1)[0].getTreeView)
    })

    test('a message without an id is mounted without expectedId, and remounts with it once it has one', () => {
        const chat = mountChats([
            { role: 'user', data: 'Hi' },
            { role: 'char', data: 'Hello', chatId: 'c2' },
        ])
        expect(mountsAt(0).map((entry) => entry.expectedId)).toEqual([undefined])

        chat.message[0].chatId = 'u1'
        flushSync()

        expect(mountsAt(0).map((entry) => entry.expectedId)).toEqual([undefined, 'u1'])
        expect(mountsAt(1).length).toBe(1)
    })
})

describe('the sibling view', () => {
    const records = (): LiveAlt[] => [{ m: { role: 'char', data: 'Old', chatId: 'c1', time: 2 }, p: 'u1', a: 1 }]

    test('reports the position and the count of a path message among its siblings', () => {
        mountChats([
            { role: 'user', data: 'Hi', chatId: 'u1', time: 1 },
            { role: 'char', data: 'Hello', chatId: 'c2', time: 3 },
        ], records())

        const view = viewOf()()
        expect(view?.at(1)).toEqual({ index: 2, count: 2 })
        expect(view?.at(0)).toEqual({ index: 1, count: 1 })
    })

    test('follows a new alternative without remounting any row', () => {
        const chat = mountChats([
            { role: 'user', data: 'Hi', chatId: 'u1', time: 1 },
            { role: 'char', data: 'Hello', chatId: 'c2', time: 3 },
        ], records())
        const before = mounts.length

        chat.alt!.push({ m: { role: 'char', data: 'Third', chatId: 'c0', time: 1.5 }, p: 'u1', a: 2 })
        flushSync()

        expect(viewOf()()?.at(1)).toEqual({ index: 3, count: 3 })
        expect(mounts.length).toBe(before)
    })

    test('a send keeps the previous last row mounted, and the new last row is a new mount', () => {
        const chat = mountChats([
            { role: 'user', data: 'Hi', chatId: 'u1', time: 1 },
            { role: 'char', data: 'Hello', chatId: 'c2', time: 3 },
        ], records())
        expect(mountsAt(1).length).toBe(1)

        chat.message.push({ role: 'user', data: 'More', chatId: 'u3', time: 4 })
        flushSync()

        expect(mountsAt(0).length).toBe(1)
        expect(mountsAt(1).length).toBe(1)
        expect(mountsAt(2).length).toBe(1)
    })

    test('counts the continuation of the last message and follows it', () => {
        const chat = mountChats([
            { role: 'user', data: 'Hi', chatId: 'u1', time: 1 },
            { role: 'char', data: 'Hello', chatId: 'c2', time: 3 },
        ])
        expect(viewOf()()?.continuation).toBe(0)

        chat.alt = [{ m: { role: 'user', data: 'Next', chatId: 'u9', time: 5 }, p: 'c2', a: 1 }]
        flushSync()

        expect(viewOf()()?.continuation).toBe(1)
    })
})
