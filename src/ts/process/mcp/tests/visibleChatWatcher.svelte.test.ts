/**
 * The visible-chat watcher on a real `$state` database and selection: the selected character (`selIdState.selId`) and that
 * character's `chatPage` each drive `noteVisibleChat` with `${chaId}:${chatId}`, observed through the module's own answer
 * (`isVisibleChat`) and through a server grant, which a key change must clear. No selection or no chat is no visible
 * chat, and a stopped watcher reports nothing more.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selection = $state({ selId: -1 })
    return { DBState: state, selIdState: selection } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { addServerChatGrant, hasServerChatGrant, isVisibleChat, resetServerChatGrantsForTests, startVisibleChatWatcher } from '../serverChatGrants.svelte'

let stop: (() => void) | null = null

beforeEach(() => {
    resetServerChatGrantsForTests()
    DBState.db = {
        characters: [
            { chaId: 'a', chatPage: 0, chats: [{ id: 'a0' }, { id: 'a1' }] },
            { chaId: 'b', chatPage: 0, chats: [{ id: 'b0' }] },
        ],
    } as unknown as Database
    selIdState.selId = -1
})

afterEach(() => {
    stop?.()
    stop = null
})

describe('startVisibleChatWatcher', () => {
    test('no chat before a selection, then the selected character and its chat page', () => {
        stop = startVisibleChatWatcher()
        flushSync()
        expect(isVisibleChat('a:a0')).toBe(false)

        selIdState.selId = 0
        flushSync()
        expect(isVisibleChat('a:a0')).toBe(true)
    })

    test('a change of selId calls noteVisibleChat: the new chat is visible, the grant of the old one is gone', () => {
        selIdState.selId = 0
        stop = startVisibleChatWatcher()
        flushSync()
        expect(addServerChatGrant('a:a0', 'url')).toBe(true)

        selIdState.selId = 1
        flushSync()
        expect(isVisibleChat('b:b0')).toBe(true)
        expect(isVisibleChat('a:a0')).toBe(false)

        selIdState.selId = 0
        flushSync()
        expect(hasServerChatGrant('a:a0', 'url')).toBe(false)
    })

    test('a change of chatPage calls noteVisibleChat: the new chat is visible, the grant of the old one is gone', () => {
        selIdState.selId = 0
        stop = startVisibleChatWatcher()
        flushSync()
        addServerChatGrant('a:a0', 'url')

        DBState.db.characters[0].chatPage = 1
        flushSync()

        expect(isVisibleChat('a:a1')).toBe(true)
        expect(isVisibleChat('a:a0')).toBe(false)
        DBState.db.characters[0].chatPage = 0
        flushSync()
        expect(hasServerChatGrant('a:a0', 'url')).toBe(false)
    })

    test('a chat page with no chat, or a selection past the list, is no visible chat', () => {
        selIdState.selId = 0
        stop = startVisibleChatWatcher()
        flushSync()
        DBState.db.characters[0].chatPage = 9
        flushSync()
        expect(isVisibleChat('a:a0')).toBe(false)

        DBState.db.characters[0].chatPage = 0
        selIdState.selId = 7
        flushSync()
        expect(isVisibleChat('a:a0')).toBe(false)
    })

    test('after the stop function the watcher follows nothing', () => {
        selIdState.selId = 0
        stop = startVisibleChatWatcher()
        flushSync()
        stop()
        stop = null
        selIdState.selId = 1
        flushSync()
        expect(isVisibleChat('b:b0')).toBe(false)
        expect(isVisibleChat('a:a0')).toBe(true)
    })
})
