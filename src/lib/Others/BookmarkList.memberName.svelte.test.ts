// @vitest-environment jsdom

/**
 * The REAL `Others/BookmarkList.svelte` over a group: the speaker name handed to a bookmarked message
 * is the live member's name, else the group's join record, else "Unknown Character". Reading the list
 * writes nothing into the group.
 *
 * MOCKED: `Chat.svelte` (a marker element carries the `name` prop it was handed), the image lookups,
 * the process modules and the parser; the stores, `src/ts/util` and `groupMembers` are the real ones.
 *
 * Classes: tests titled `regression reproducer:` fail on the code before the member record existed
 * (a deleted member read "Unknown Character"); tests titled `guard:` pass before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../ChatScreens/Chat.svelte', () => ({
    default: (anchor: Comment, props: { name?: string }) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-part', 'chat-standin')
        marker.setAttribute('data-name', String(props.name))
        anchor.parentNode?.insertBefore(marker, anchor)
        return { destroy: () => {} }
    },
}))
vi.mock('src/ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: () => '' }),
}))
vi.mock('src/ts/process/composerActions.svelte', () => ({
    branchAt: vi.fn(),
    isComposerBusy: () => false, isComposerBusyIn: () => false,
}))
vi.mock('src/ts/process/index.svelte', () => ({
    doingChat: writable(false),
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

type Members = Record<string, unknown> | undefined

function member(chaId: string, name: string) {
    return { chaId, name, type: 'character', chatPage: 0, image: '', largePortrait: false, chats: [] }
}

// `members` is the group's `risutanium_members` map exactly as joinRecord writes it
// ({name: string, slot: 0..7} under the member's chaId); `live` are the characters still in the list.
function showList(members: Members, live: ReturnType<typeof member>[], saying = 'm-1'): HTMLElement {
    const group = {
        type: 'group', chaId: 'g0', name: 'Group', chatPage: 0, image: '', characters: [saying],
        chats: [{
            id: 'chat-0', name: 'chat', note: '', localLore: [], scriptstate: {},
            message: [{ role: 'char', data: 'spoken text', chatId: 'x0', saying }],
            bookmarks: ['x0'],
            bookmarkNames: {},
        }],
        ...(members === undefined ? {} : { risutanium_members: members }),
    }
    DBState.db = { characters: [group, ...live], personas: [], selectedPersona: 0 } as never
    selectedCharID.set(0)
    bookmarkListOpen.set(true)
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(BookmarkList, { target, props: {} })
    flushSync()
    return target
}

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    bookmarkListOpen.set(false)
})

// The row is collapsed; expand it so the Chat stand-in (which carries the name) renders.
function speakerName(root: HTMLElement): string | null {
    root.querySelector<HTMLElement>('div[role="button"]')?.click()
    flushSync()
    return root.querySelector('[data-part="chat-standin"]')?.getAttribute('data-name') ?? null
}

describe('BookmarkList speaker of a bookmarked group message', () => {
    test('regression reproducer: a deleted member shows the name recorded when it joined', () => {
        const root = showList({ 'm-1': { name: 'Alice', slot: 0 } }, [])
        expect(speakerName(root)).toBe('Alice')
    })

    test('guard: a live member shows its own name, not the record', () => {
        const root = showList({ 'm-1': { name: 'Alice', slot: 0 } }, [member('m-1', 'Alicia')])
        expect(speakerName(root)).toBe('Alicia')
    })

    test('guard: a deleted member with no record shows Unknown Character', () => {
        const root = showList(undefined, [])
        expect(speakerName(root)).toBe('Unknown Character')
    })

    test('guard: reading the list neither creates nor changes the member map', () => {
        const records = { 'm-1': { name: 'Alice', slot: 0 } }
        const snapshot = JSON.stringify(records)
        const root = showList(records, [])
        speakerName(root)
        expect(JSON.stringify((DBState.db.characters[0] as unknown as { risutanium_members: unknown }).risutanium_members)).toBe(snapshot)

        const bare = showList(undefined, [], 'm-2')
        speakerName(bare)
        expect(Object.hasOwn(DBState.db.characters[0], 'risutanium_members')).toBe(false)
    })
})
