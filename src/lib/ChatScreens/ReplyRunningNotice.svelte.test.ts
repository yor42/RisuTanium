// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => {
    const DBState = $state({ db: { characters: [] as Array<Record<string, unknown>> } })
    return { DBState }
})
vi.mock('src/lang', () => ({ language: { chatReplyRunning: '{name} is replying' } }))

import { DBState } from 'src/ts/stores.svelte'
import { resetRunningRepliesForTests, setRunningReplies } from 'src/ts/nativeReply/runningReplies.svelte'
import ReplyRunningNotice from './ReplyRunningNotice.svelte'

const NOTICE = '[data-part="reply-running-notice"]'
const KEY = 'k1'
const RUNNING = { key: KEY, target: { chaId: 'c', chatId: 'chat-1', name: 'Ari' } }

let target: HTMLElement
let app: ReturnType<typeof mount>

function character(extra: Record<string, unknown> = {}) {
    return { chaId: 'c', name: 'Ari', type: 'character', chatPage: 0, chats: [{ id: 'chat-1', message: [] as Array<{ chatId?: string }> }], ...extra }
}

function show(): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ReplyRunningNotice, { target, props: { get character() { return DBState.db.characters[0] as never } } })
    flushSync()
}

beforeEach(() => {
    resetRunningRepliesForTests()
    DBState.db.characters = [character()] as never
})
afterEach(async () => {
    await unmount(app)
    target.remove()
})

describe('ReplyRunningNotice', () => {
    test('T34: names the character for the shown chat running key', () => {
        setRunningReplies([RUNNING])
        show()
        expect(target.querySelector(NOTICE)?.textContent).toBe('Ari is replying')
        expect(target.querySelector(NOTICE)?.getAttribute('role')).toBe('status')
    })

    test('T34: appears when the map publishes and goes when the key ends', () => {
        show()
        expect(target.querySelector(NOTICE)).toBeNull()
        setRunningReplies([RUNNING])
        flushSync()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        setRunningReplies([])
        flushSync()
        expect(target.querySelector(NOTICE)).toBeNull()
    })

    test('T34: shows nothing for another chat, a group chat or a chat that already has the message', () => {
        setRunningReplies([{ key: KEY, target: { chaId: 'c', chatId: 'other-chat', name: 'Ari' } }])
        show()
        expect(target.querySelector(NOTICE)).toBeNull()
        setRunningReplies([RUNNING])
        flushSync()
        expect(target.querySelector(NOTICE)).not.toBeNull()
        DBState.db.characters[0].chats = [{ id: 'chat-1', message: [{ chatId: KEY }] }] as never
        flushSync()
        expect(target.querySelector(NOTICE)).toBeNull()
        DBState.db.characters = [character({ type: 'group' })] as never
        flushSync()
        expect(target.querySelector(NOTICE)).toBeNull()
    })
})
