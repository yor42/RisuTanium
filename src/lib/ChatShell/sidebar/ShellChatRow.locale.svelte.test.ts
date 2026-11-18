// @vitest-environment happy-dom

/**
 * The time of a chat row follows the app language. A UI language code that is not an Intl tag ('cn') must still format as the language it
 * names: the row reads the app's Intl tag, not the saved language code. The row is mounted alone over a real `$state` chat.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'
import type { ListEditing } from '../../../ts/chatShell/chatListEdits'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { setAppLanguage } from '../../../ts/appIntl.svelte'
import ShellChatRow from './ShellChatRow.svelte'

const editing = {
    renamingChat: null,
    menu: null,
    openChatMenu: () => {},
    commitChatName: () => {},
    cancelRename: () => {},
} as unknown as ListEditing

const OLD_TIME = new Date(2020, 0, 5, 12).getTime()
const OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

let target: HTMLElement | undefined
let app: Record<string, unknown> | undefined

afterEach(async () => {
    if (app) await unmount(app as never)
    app = undefined
    target?.remove()
    setAppLanguage('en')
})

describe('the time of a chat row', () => {
    test("under the saved language 'cn' it shows Simplified Chinese, not the host locale", () => {
        const expected = new Date(OLD_TIME).toLocaleDateString('zh-Hans', OPTIONS)
        expect(expected).not.toBe(new Date(OLD_TIME).toLocaleDateString(undefined, OPTIONS))
        setAppLanguage('cn')
        DBState.db = { characters: [], language: 'cn' } as unknown as Database
        const chat = $state({ id: 'a', name: 'chat a', message: [{ role: 'user', data: 'hi', time: OLD_TIME }], note: '', localLore: [], fmIndex: -1 }) as unknown as Chat
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ShellChatRow, {
            target,
            props: { chat, chaId: 'c0', index: 0, open: false, tabbable: true, level: 1, posinset: 1, setsize: 1, editing, onopen: () => {} },
        }) as unknown as Record<string, unknown>
        flushSync()
        expect(target.querySelector('[data-part="chat-row-time"]')!.textContent).toBe(expected)
    })
})
