// @vitest-environment jsdom

/**
 * The REAL `Others/BookmarkList.svelte`: the busy answer handed to an expanded row's tree controls belongs to the
 * selected chat and is re-evaluated when the selected character changes while the list stays mounted.
 *
 * MOCKED: `Chat.svelte` (captures `getBusy`), the image lookups, the process modules and the parser.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({ getBusy: null as null | (() => boolean), busyKeys: [] as string[] }))

vi.mock('../ChatScreens/Chat.svelte', () => ({
    default: (_anchor: Comment, props: { getBusy: () => boolean }) => {
        captured.getBusy ??= props.getBusy
        return { destroy: () => {} }
    },
}))
vi.mock('src/ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: () => '' }),
}))
vi.mock('src/ts/process/composerActions.svelte', () => ({
    branchAt: vi.fn(),
    isComposerBusyIn: (target: { chaId: string, chatId: string }) => captured.busyKeys.includes(`${target.chaId}/${target.chatId}`),
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    ParseMarkdown: vi.fn(async (text: string) => text),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('src/ts/alert', () => ({
    alertInput: vi.fn(async () => ''),
}))

import { DBState, bookmarkListOpen, selectedCharID } from 'src/ts/stores.svelte'
import BookmarkList from './BookmarkList.svelte'

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

const character = (chaId: string) => ({
    chaId, name: chaId, type: 'character', chatPage: 0, image: '', largePortrait: false,
    chats: [{
        id: `${chaId}-chat`, name: 'chat', note: '', localLore: [], scriptstate: {},
        message: [{ role: 'char', data: 'text', chatId: 'm0' }],
        bookmarks: ['m0'], bookmarkNames: {},
    }],
})

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    captured.getBusy = null
    captured.busyKeys = []
    bookmarkListOpen.set(false)
})

describe('BookmarkList tree controls busy', () => {
    test('regression reproducer: the busy answer follows a change of the selected character', () => {
        DBState.db = { characters: [character('c0'), character('c1')], personas: [], selectedPersona: 0 } as never
        selectedCharID.set(0)
        bookmarkListOpen.set(true)
        captured.busyKeys = ['c1/c1-chat']
        target = document.createElement('div')
        document.body.appendChild(target)
        instance = mount(BookmarkList, { target, props: {} })
        flushSync()
        target.querySelector<HTMLElement>('div[role="button"]')!.click()
        flushSync()
        expect(captured.getBusy).not.toBeNull()
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            $effect(() => { seen.push(captured.getBusy!()) })
        })
        flushSync()
        expect(seen).toEqual([false])
        selectedCharID.set(1)
        flushSync()
        expect(seen).toEqual([false, true])
        stop()
    })
})
