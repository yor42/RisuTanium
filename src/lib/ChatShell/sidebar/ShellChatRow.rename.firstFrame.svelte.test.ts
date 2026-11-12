// @vitest-environment happy-dom

/**
 * The inline rename of `ShellChatRow.svelte`, observed at the first animation frame: when the field opens from a row
 * menu, the name input holds focus before the first frame and the menu's own focus return does not take it back. The row
 * is mounted alone over a real `$state` chat; a stand-in for the menu sheet returns focus to its opener from an effect
 * cleanup, in the same flush that opens the field, as the sheet's teardown does. Real timers (the first-frame harness).
 *
 * Labels: "reproducer" fails when the row's focus wait resolves on a frame or a timer instead of before the first frame.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'
import type { ListEditing } from '../../../ts/chatShell/chatListEdits'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../../ts/tests/firstFrame.test-helpers'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import ShellChatRow from './ShellChatRow.svelte'

let renamingChat = $state<Chat | null>(null)
const editing = {
    get renamingChat() { return renamingChat },
    renamingFolder: null,
    menu: null,
    openChatMenu: () => {},
    openFolderMenu: () => {},
    commitChatName: () => {},
    commitFolderName: () => {},
    cancelRename: () => {},
} as unknown as ListEditing

let app: Record<string, unknown> | null = null
let stopMenu: (() => void) | null = null
let host: HTMLElement | null = null

function makeChat(id: string): Chat {
    const chat = $state({ id, name: `chat ${id}`, message: [{ role: 'user', data: 'hi', time: 1 }], note: '', localLore: [], fmIndex: -1 })
    return chat as unknown as Chat
}

afterEach(async () => {
    uninstallFrameQueue()
    stopMenu?.()
    stopMenu = null
    if (app) {
        await unmount(app as never)
        app = null
    }
    host?.remove()
    host = null
    renamingChat = null
})

describe('rename from a row menu, before the first frame', () => {
    test('T11 the name input is focused at the first frame and the menu return does not take it back', async () => {
        DBState.db = { characters: [], language: 'en' } as unknown as Database
        const chat = makeChat('chat-1')
        host = document.createElement('div')
        document.body.appendChild(host)
        const opener = document.createElement('button')
        host.appendChild(opener)
        const target = document.createElement('div')
        host.appendChild(target)
        app = mount(ShellChatRow, {
            target,
            props: { chat, chaId: 'c0', index: 0, open: false, tabbable: true, level: 1, posinset: 1, setsize: 1, editing, onopen: () => {} },
        }) as unknown as Record<string, unknown>
        flushSync()

        const menu = $state({ open: true })
        stopMenu = $effect.root(() => {
            $effect(() => {
                if (menu.open) return () => opener.focus()
            })
        })
        flushSync()

        installFrameQueue()
        // The menu closes and the field opens in one flush: the sheet's teardown returns focus to its opener.
        menu.open = false
        renamingChat = chat
        flushSync()
        const focusAtFirstFrame = readAtFirstFrame(() => document.activeElement?.getAttribute('data-part'))
        // Only microtasks run: a focus move that waits for an animation frame or a timer has not happened yet.
        await drainMicrotasks()
        runFrame()
        expect(await focusAtFirstFrame).toBe('chat-row-name-input')
    })
})
