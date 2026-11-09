// @vitest-environment happy-dom

/**
 * What one streamed chunk costs the legacy list in `Chats.svelte` and `ChatMessageBoundary.svelte`, counted rather
 * than timed: text walked by the row hash, updates forwarded to rows that did not change, and layout reads. The
 * real `Chats.svelte` and the real boundary are mounted; `Chat.svelte` is replaced by a stub that records its mounts
 * and the streaming updates it receives.
 *
 * Invariants pinned here: a row whose hash inputs did not change is not walked again; a row whose streaming state did
 * not change is not told again; the bottom position is read only for a new 'char' reply, which is the only case that
 * uses it; every input of the hash still remounts its row.
 *
 * Labels: R = regression reproducer (fails on the pre-fix base), G = guard (passes before and after).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface StubProps {
    idx: number
    message: string
}

interface Forward {
    idx: number
    state: { isOptimizedStreamingMessage: boolean, streamingOptimizationMode: string, rawStreamingText: string }
}

const rec = vi.hoisted(() => ({
    mounts: [] as StubProps[],
    forwards: [] as Forward[],
}))

vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown, props: StubProps) => {
        rec.mounts.push(props)
        return {
            updateStreamingDisplay: (state: Forward['state']) => { rec.forwards.push({ idx: props.idx, state }) },
            destroy: () => {},
        }
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

import { DBState, ReloadChatPointer } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'

type Mode = 'off' | 'balanced' | 'strong'
interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, disabled?: boolean }
interface LiveChat {
    id: string
    message: LiveMessage[]
    isStreaming?: boolean
    activeStreamingDisplayOptimizationMode?: Mode
}
interface LiveCharacter { chaId: string, name: string, image: string, chatPage: number, chats: LiveChat[] }
interface ListProps {
    messages: LiveMessage[]
    currentCharacter: LiveCharacter
    onReroll: () => void
    unReroll: () => void
    currentUsername: string
    userIcon: string
    loadPages: number
    hasNewUnreadMessage: boolean
}

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

function mountChats(message: LiveMessage[], mode: Mode = 'off', dbOverrides: Record<string, unknown> = {}) {
    const chat: LiveChat = { id: 'chat-0', message }
    const character: LiveCharacter = { chaId: 'a', name: 'A', image: '', chatPage: 0, chats: [chat] }
    DBState.db = { streamingDisplayOptimizationMode: mode, characters: [character], ...dbOverrides } as never
    const live = (DBState.db.characters as unknown as LiveCharacter[])[0]
    target = document.createElement('div')
    document.body.appendChild(target)
    const props: ListProps = $state({
        messages: live.chats[0].message,
        currentCharacter: live,
        onReroll: () => {},
        unReroll: () => {},
        currentUsername: 'User',
        userIcon: '',
        loadPages: 100,
        hasNewUnreadMessage: false,
    })
    instance = mount(Chats, { target, props: props as never })
    flushSync()
    return { chat: live.chats[0], host: target, props }
}

/** The producer's pair of writes that open a stream: the flag and the mode the stream runs in. */
function startStream(chat: LiveChat, mode: Mode) {
    chat.isStreaming = true
    chat.activeStreamingDisplayOptimizationMode = mode
    flushSync()
}

const alternating = (count: number, size: number): LiveMessage[] =>
    Array.from({ length: count }, (_, i) => ({ role: i % 2 === 0 ? 'char' : 'user', data: String.fromCharCode(97 + (i % 26)).repeat(size) }) as LiveMessage)

const mountsAt = (idx: number) => rec.mounts.filter((entry) => entry.idx === idx)

beforeEach(() => {
    rec.mounts.length = 0
    rec.forwards.length = 0
    ReloadChatPointer.set({})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
})

describe.each<Mode>(['off', 'balanced', 'strong'])('S1 and S2 a streamed chunk in %s mode', (mode) => {
    // Twenty long rows and a short streaming tail: the rows must not be walked or told again per chunk.
    const setup = () => {
        const messages = alternating(21, 5000)
        messages[20].data = 'tail '.repeat(20)
        const mounted = mountChats(messages, mode)
        startStream(mounted.chat, mode)
        return mounted
    }

    test('R T1: the text of unchanged rows is not walked again for a chunk', () => {
        const { chat } = setup()
        const original = String.prototype.charCodeAt
        let calls = 0
        String.prototype.charCodeAt = function (this: string, index: number): number {
            calls += 1
            return original.call(this, index)
        }
        const perChunk: number[] = []
        try {
            for (let chunk = 0; chunk < 3; chunk++) {
                const before = calls
                chat.message[20].data += ` c${chunk}`
                flushSync()
                perChunk.push(calls - before)
            }
        } finally {
            String.prototype.charCodeAt = original
        }
        for (const walked of perChunk) {
            expect(walked).toBeLessThan(5000)
        }
    })

    test('R T2: rows other than the streaming tail are not forwarded the unchanged streaming state', () => {
        const { chat } = setup()
        rec.forwards.length = 0
        for (let chunk = 0; chunk < 3; chunk++) {
            chat.message[20].data += ` c${chunk}`
            flushSync()
        }
        expect(rec.forwards.filter((entry) => entry.idx !== 20).map((entry) => entry.idx)).toEqual([])
    })
})

describe('S3 the bottom position is read only for a new char reply', () => {
    const rectSpy = (host: () => HTMLElement, scrolledUp: () => boolean) =>
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const isHost = this === host()
            const top = isHost || !scrolledUp() ? 0 : 1000
            return { top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
        })

    describe.each<Mode>(['off', 'balanced', 'strong'])('in %s mode', (mode) => {
        test('R T3: three streamed chunks read no layout rect', () => {
            const { chat } = mountChats(alternating(3, 20), mode, { autoScrollToNewMessage: true })
            startStream(chat, mode)
            const spy = rectSpy(() => target!, () => false)
            for (let chunk = 0; chunk < 3; chunk++) {
                chat.message[2].data += ` c${chunk}`
                flushSync()
            }
            expect(spy).toHaveBeenCalledTimes(0)
        })
    })

    describe('auto-scroll for a new message', () => {
        let scrollIntoView: ReturnType<typeof vi.fn>
        let scrolledUp = false

        beforeEach(() => {
            scrolledUp = false
            scrollIntoView = vi.fn()
            Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
        })

        afterEach(() => {
            Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
        })

        const appendAndWait = (chat: LiveChat, role: 'user' | 'char') => {
            vi.useFakeTimers()
            chat.message.push({ role, data: 'new' })
            flushSync()
            vi.advanceTimersByTime(1000)
        }

        test('G T4: at the bottom, a new char reply scrolls to the newest message after the delay', () => {
            const { chat, props } = mountChats(alternating(3, 20), 'off', { autoScrollToNewMessage: true })
            rectSpy(() => target!, () => scrolledUp)
            appendAndWait(chat, 'char')
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(props.hasNewUnreadMessage).toBe(false)
        })

        test('G T4: scrolled up, a new char reply sets the unread flag and does not scroll', () => {
            const { chat, props } = mountChats(alternating(3, 20), 'off', { autoScrollToNewMessage: true })
            scrolledUp = true
            rectSpy(() => target!, () => scrolledUp)
            appendAndWait(chat, 'char')
            expect(scrollIntoView).not.toHaveBeenCalled()
            expect(props.hasNewUnreadMessage).toBe(true)
        })

        test('G T4: scrolled up with alwaysScrollToNewMessage, a new char reply scrolls', () => {
            const { chat, props } = mountChats(alternating(3, 20), 'off', { autoScrollToNewMessage: true, alwaysScrollToNewMessage: true })
            scrolledUp = true
            rectSpy(() => target!, () => scrolledUp)
            appendAndWait(chat, 'char')
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(props.hasNewUnreadMessage).toBe(false)
        })

        test('G T4: with auto-scroll off, a new char reply does nothing', () => {
            const { chat, props } = mountChats(alternating(3, 20), 'off', { autoScrollToNewMessage: false })
            scrolledUp = true
            rectSpy(() => target!, () => scrolledUp)
            appendAndWait(chat, 'char')
            expect(scrollIntoView).not.toHaveBeenCalled()
            expect(props.hasNewUnreadMessage).toBe(false)
        })

        test('G T4: a new user message does nothing', () => {
            const { chat, props } = mountChats(alternating(3, 20), 'off', { autoScrollToNewMessage: true })
            scrolledUp = true
            rectSpy(() => target!, () => scrolledUp)
            appendAndWait(chat, 'user')
            expect(scrollIntoView).not.toHaveBeenCalled()
            expect(props.hasNewUnreadMessage).toBe(false)
        })
    })
})

describe('S5 every input of the row hash still remounts its row', () => {
    test('G T7: a data edit on a middle row remounts that row only', () => {
        const { chat } = mountChats(alternating(5, 20))
        expect(rec.mounts.length).toBe(5)

        chat.message[2].data = 'edited'
        flushSync()

        expect(mountsAt(2).length).toBe(2)
        expect(mountsAt(2)[1].message).toBe('edited')
        for (const idx of [0, 1, 3, 4]) {
            expect(mountsAt(idx).length).toBe(1)
        }
    })

    test('G T8: a reload pointer bump on a row remounts that row only', () => {
        mountChats(alternating(5, 20))

        ReloadChatPointer.update((pointers) => ({ ...pointers, 3: 1 }))
        flushSync()

        expect(mountsAt(3).length).toBe(2)
        for (const idx of [0, 1, 2, 4]) {
            expect(mountsAt(idx).length).toBe(1)
        }
    })

    test('G T8: a disabled change on a row remounts that row only', () => {
        const { chat } = mountChats(alternating(5, 20))

        chat.message[1].disabled = true
        flushSync()

        expect(mountsAt(1).length).toBe(2)
        for (const idx of [0, 2, 3, 4]) {
            expect(mountsAt(idx).length).toBe(1)
        }
    })
})
