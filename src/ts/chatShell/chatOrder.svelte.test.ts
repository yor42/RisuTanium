// @vitest-environment happy-dom

/**
 * The live reorder writes of the new shell's chat list: `placeChat` and `placeFolder`.
 *
 * Invariants:
 * - A landed move permutes the owner's `chats` (or `chatFolders`) and marks that owner for save, selected or not; the open
 *   chat stays open by identity (`chatPage` follows it) and nothing opens or reloads a chat.
 * - A move that changes nothing reports success and writes, marks and announces nothing, and keeps the same array.
 * - A refusal shows the "not saved" notice and writes and marks nothing.
 * - No reorder touches a chat's `folderId`.
 *
 * MOCKED: the stores module (a `$state` database), `changeChatTo` (a spy) and the alert module. The save marks, the live write and the
 * list model are real.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import type { toSaveType } from '../storage/risuSave'

const mocks = vi.hoisted(() => ({ changeChat: vi.fn(), alertError: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return { DBState: state, selectedCharID, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: mocks.changeChat }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/alert'), () => ({ alertError: mocks.alertError }) as unknown as typeof import('src/ts/alert'))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { resolveOriginWithHint } from '../process/chatOrigin'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import { placeChat, placeFolder } from './chatOrder'

type Entry = Database['characters'][number]

const tracker = { character: [] as string[] } as unknown as toSaveType
const scheduled = vi.fn()

function chat(id: string, folderId?: string): Chat {
    return { id, name: id, message: [{ role: 'user', data: id, time: 1 }], note: '', localLore: [], fmIndex: -1, ...(folderId ? { folderId } : {}) } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, image: '', chats, chatPage: 0, chatFolders: [{ id: 'f1', name: 'F1', folded: false }, { id: 'f2', name: 'F2', folded: false }, { id: 'f3', name: 'F3', folded: false }], ...extra } as unknown as Entry
}

function ids(owner: Entry): string[] {
    return owner.chats.map((c) => c.id as string)
}

function folderIds(owner: Entry): string[] {
    return (owner.chatFolders ?? []).map((f) => f.id)
}

function marked(): string[] {
    return [...tracker.character]
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    tracker.character.length = 0
    scheduled.mockReset()
    mocks.changeChat.mockReset()
    mocks.alertError.mockReset()
    installCharacterSaveMarks({ tracker, schedule: scheduled })
    DBState.db = { characters: [] } as unknown as Database
    selectedCharID.set(-1)
})

function install(...characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

describe('placeChat', () => {
    test('moves a chat inside its group, keeps every other chat in its slot and marks the owner', () => {
        const [a] = install(character('A', [chat('u1'), chat('m1', 'f1'), chat('u2'), chat('m2', 'f1'), chat('u3')]))
        selectedCharID.set(0)
        const u3 = a.chats[4]
        const u1 = a.chats[0]
        expect(placeChat(a, u3, u1)).toBe(true)
        expect(ids(a)).toEqual(['u3', 'm1', 'u1', 'm2', 'u2'])
        expect(marked()).toEqual(['A'])
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('keeps the open chat open by identity without opening anything', () => {
        const [a] = install(character('A', [chat('c0'), chat('c1'), chat('c2')], { chatPage: 1 }))
        selectedCharID.set(0)
        const open = a.chats[1]
        expect(placeChat(a, a.chats[2], a.chats[0])).toBe(true)
        expect(ids(a)).toEqual(['c2', 'c0', 'c1'])
        expect(a.chatPage).toBe(2)
        expect(a.chats[a.chatPage]).toBe(open)
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('marks an owner that is not selected', () => {
        const [, b] = install(character('A', [chat('a0')]), character('B', [chat('b0'), chat('b1')]))
        selectedCharID.set(0)
        expect(placeChat(b, b.chats[1], b.chats[0])).toBe(true)
        expect(ids(b)).toEqual(['b1', 'b0'])
        expect(marked()).toEqual(['B'])
    })

    test('never writes or deletes a folderId', () => {
        const [a] = install(character('A', [chat('u1'), chat('m1', 'f1'), chat('d1', 'gone'), chat('m2', 'f1')]))
        const before = a.chats.map((c) => [c.id, c.folderId, Object.keys(c).join()])
        expect(placeChat(a, a.chats[3], a.chats[1])).toBe(true)
        expect(placeChat(a, a.chats[0], null)).toBe(true)
        const after = new Map(a.chats.map((c) => [c.id, [c.id, c.folderId, Object.keys(c).join()]]))
        for (const row of before) {
            expect(after.get(row[0] as string)).toEqual(row)
        }
    })

    test('two chats that share an id are told apart by identity', () => {
        const [a] = install(character('A', [chat('dup'), chat('dup'), chat('c2')]))
        selectedCharID.set(0)
        const [first, second] = [a.chats[0], a.chats[1]]
        expect(placeChat(a, second, first)).toBe(true)
        expect(a.chats[0]).toBe(second)
        expect(a.chats[1]).toBe(first)
        expect(marked()).toEqual(['A'])
        expect(placeChat(a, first, null)).toBe(true)
        expect(a.chats.map((c) => c.id)).toEqual(['dup', 'c2', 'dup'])
        expect(a.chats[2]).toBe(first)
    })

    test('a chat unshifted after the list was drawn does not shift the target', () => {
        const [a] = install(character('A', [chat('c0'), chat('c1'), chat('c2')]))
        selectedCharID.set(0)
        const c2 = a.chats[2]
        const c1 = a.chats[1]
        a.chats.unshift(chat('fresh'))
        expect(placeChat(a, c2, c1)).toBe(true)
        expect(ids(a)).toEqual(['fresh', 'c0', 'c2', 'c1'])
    })

    test('a move that changes nothing keeps the array, writes nothing and marks nothing', () => {
        const [a] = install(character('A', [chat('c0'), chat('c1'), chat('c2')]))
        const chats = a.chats
        const raw = $state.snapshot(a.chats)
        expect(placeChat(a, chats[1], chats[1])).toBe(true)
        expect(placeChat(a, chats[1], chats[2])).toBe(true)
        expect(placeChat(a, chats[2], null)).toBe(true)
        expect(a.chats).toBe(chats)
        expect($state.snapshot(a.chats)).toEqual(raw)
        expect(marked()).toEqual([])
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    describe('refusals write and mark nothing and show the notice', () => {
        function refused(run: () => boolean, owner: Entry, expectedIds: string[]) {
            expect(run()).toBe(false)
            expect(mocks.alertError).toHaveBeenCalledWith(language.chatShellEditNotSaved)
            expect(ids(owner)).toEqual(expectedIds)
            expect(marked()).toEqual([])
        }

        test('an archived owner', () => {
            const [a] = install(character('A', [chat('c0'), chat('c1')], { coldstorage: 'cold' }))
            refused(() => placeChat(a, a.chats[1], a.chats[0]), a, ['c0', 'c1'])
        })

        test('a chat id two slots share: only the first holder is written', () => {
            const [a, dup] = install(character('A', [chat('c0'), chat('c1')]), character('A', [chat('d0'), chat('d1')]))
            refused(() => placeChat(dup, dup.chats[1], dup.chats[0]), dup, ['d0', 'd1'])
            expect(ids(a)).toEqual(['c0', 'c1'])
        })

        test('a chat that is not in the list, including a raw copy of one that is', () => {
            const [a] = install(character('A', [chat('c0'), chat('c1')]))
            refused(() => placeChat(a, chat('stranger'), a.chats[0]), a, ['c0', 'c1'])
            refused(() => placeChat(a, structuredClone($state.snapshot(a.chats[1])), a.chats[0]), a, ['c0', 'c1'])
        })

        test('a before that is not in the list', () => {
            const [a] = install(character('A', [chat('c0'), chat('c1')]))
            refused(() => placeChat(a, a.chats[1], chat('stranger')), a, ['c0', 'c1'])
        })

        test('a before in another group', () => {
            const [a] = install(character('A', [chat('u1'), chat('m1', 'f1'), chat('u2')]))
            refused(() => placeChat(a, a.chats[2], a.chats[1]), a, ['u1', 'm1', 'u2'])
        })
    })
})

describe('placeFolder', () => {
    test('moves a folder among the folders by identity and marks the owner', () => {
        const [a] = install(character('A', [chat('c0')]))
        selectedCharID.set(0)
        const folders = a.chatFolders as ChatFolder[]
        expect(placeFolder(a, folders[2], folders[0])).toBe(true)
        expect(folderIds(a)).toEqual(['f3', 'f1', 'f2'])
        expect(marked()).toEqual(['A'])
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('moves to the end for a null before', () => {
        const [a] = install(character('A', [chat('c0')]))
        const folders = a.chatFolders as ChatFolder[]
        expect(placeFolder(a, folders[0], null)).toBe(true)
        expect(folderIds(a)).toEqual(['f2', 'f3', 'f1'])
    })

    test('a move onto itself or the next folder keeps the array and marks nothing', () => {
        const [a] = install(character('A', [chat('c0')]))
        const folders = a.chatFolders as ChatFolder[]
        expect(placeFolder(a, folders[0], folders[0])).toBe(true)
        expect(placeFolder(a, folders[0], folders[1])).toBe(true)
        expect(placeFolder(a, folders[2], null)).toBe(true)
        expect(a.chatFolders).toBe(folders)
        expect(marked()).toEqual([])
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('refuses an archived owner, a folder that is not listed and a before that is not listed', () => {
        const [a, archived] = install(character('A', [chat('c0')]), character('Z', [chat('z0')], { coldstorage: 'cold' }))
        const folders = a.chatFolders as ChatFolder[]
        const strangers = [{ id: 'x', name: 'X', folded: false }, { id: 'y', name: 'Y', folded: false }] as ChatFolder[]
        expect(placeFolder(archived, (archived.chatFolders as ChatFolder[])[1], null)).toBe(false)
        expect(placeFolder(a, strangers[0], folders[0])).toBe(false)
        expect(placeFolder(a, folders[1], strangers[1])).toBe(false)
        expect(mocks.alertError).toHaveBeenCalledTimes(3)
        expect(folderIds(a)).toEqual(['f1', 'f2', 'f3'])
        expect(marked()).toEqual([])
    })

    test('a copy of a listed folder is not that folder: it is refused, as is a before that is only a copy', () => {
        const [a] = install(character('A', [chat('c0')]))
        const folders = a.chatFolders as ChatFolder[]
        const copy = { ...$state.snapshot(folders[2]) } as ChatFolder
        expect(placeFolder(a, copy, folders[0])).toBe(false)
        const beforeCopy = { ...$state.snapshot(folders[0]) } as ChatFolder
        expect(placeFolder(a, folders[2], beforeCopy)).toBe(false)
        expect(mocks.alertError).toHaveBeenCalledTimes(2)
        expect(folderIds(a)).toEqual(['f1', 'f2', 'f3'])
        expect(marked()).toEqual([])
    })
})

// Compatibility guard: it passes with and without the reorder code, because the origin lookup only reads the list.
describe('a work origin after a reorder', () => {
    test('TR4: the origin of a send started before the move resolves to the same chat object at its new index', () => {
        const [a] = install(character('A', [chat('c0'), chat('c1'), chat('c2')], { chatPage: 1 }))
        selectedCharID.set(0)
        const open = a.chats[1]
        const origin = { chaId: 'A', chatId: 'c1' }
        expect(resolveOriginWithHint(origin, { owner: a, chat: open })?.chatIndex).toBe(1)

        expect(placeChat(a, a.chats[2], a.chats[0])).toBe(true)
        expect(ids(a)).toEqual(['c2', 'c0', 'c1'])
        const ctx = resolveOriginWithHint(origin, { owner: a, chat: open })
        expect(ctx?.chat).toBe(open)
        expect(ctx?.chatIndex).toBe(2)
        expect(a.chats[a.chatPage]).toBe(ctx?.chat)
    })

    test('TR4: a chat id two chats share still resolves to the hinted chat after the move', () => {
        const [a] = install(character('A', [chat('shared'), chat('shared'), chat('c2')], { chatPage: 1 }))
        selectedCharID.set(0)
        const first = a.chats[0]
        const open = a.chats[1]
        const origin = { chaId: 'A', chatId: 'shared' }

        expect(placeChat(a, a.chats[2], a.chats[0])).toBe(true)
        expect(placeChat(a, open, a.chats[0])).toBe(true)
        expect(a.chats[a.chatPage]).toBe(open)
        expect(resolveOriginWithHint(origin, { owner: a, chat: open })?.chat).toBe(open)
        expect(resolveOriginWithHint(origin, { owner: a, chat: first })?.chat).toBe(first)
    })
})
