// @vitest-environment happy-dom

/**
 * `chatListEdits.ts`: what the new shell's row menu and folder menu write.
 *
 * Invariants exercised here:
 * - Every edit is addressed by `chaId` and goes through the live write, so it lands on the character the user acted on even
 *   when that is not the selected one, and a character that is gone or archived refuses it with the "not saved" notice.
 * - A chat edit finds the chat again by identity or id: a chat replaced by a copy that keeps the id (a cold restore) still
 *   receives the rename or the move.
 * - Duplicate works only on the selected, live character and an unarchived chat; the copy gets a new id, no streaming flag,
 *   a copy name, goes on top and is the chat opened through the one open seam.
 * - Deleting a folder unfiles its chats and touches no other chat.
 *
 * MOCKED: the stores module (selection mirror like the real one), `changeChatTo` (writes the selected slot like the real
 * one) and `createChatCopyName`, the alert module. The live-write module, the open seam and the save marks are real.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, Database } from '../storage/database.svelte'

const mocks = vi.hoisted(() => ({
    changeChat: vi.fn(),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return { DBState: state, selectedCharID, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            mocks.changeChat(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
        createChatCopyName: (name: string, type: string) => `${name} (${type})`,
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertError: mocks.alertError,
}) as unknown as typeof import('src/ts/alert'))

import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import { coldStorageHeader } from '../process/coldstorageData'
import { createFolder, deleteFolder, duplicateChat, moveChat, renameChat, renameFolder, setFolderColor, setFolderFolded } from './chatListEdits'

type Entry = Database['characters'][number]

function chat(id: string, name: string, extra: Partial<Chat> = {}): Chat {
    return { id, name, message: [{ role: 'user', data: `${name} text`, time: 1 }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, image: '', chats, chatPage: 0, chatFolders: [], ...extra } as unknown as Entry
}

function install(...characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.alertError.mockReset()
    resetCharacterSaveMarksForTest()
    selectedCharID.set(-1)
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

test('diagnostic: the mirror follows the store', () => {
    selectedCharID.set(1)
    expect(selIdState.selId).toBe(1)
})

describe('renameChat', () => {
    test('renames a chat of a character that is not selected', () => {
        const [A, B] = install(character('A', [chat('a0', 'Old')]), character('B', [chat('b0', 'Other')]))
        selectedCharID.set(1)
        expect(renameChat('A', A.chats[0], '  New name ')).toBe(true)
        expect(A.chats[0].name).toBe('New name')
        expect(B.chats[0].name).toBe('Other')
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('an empty name reverts: nothing is written and no notice is shown', () => {
        const [A] = install(character('A', [chat('a0', 'Old')]))
        expect(renameChat('A', A.chats[0], '   ')).toBe(false)
        expect(A.chats[0].name).toBe('Old')
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    // M15: the captured object is not written; the live chat found again is.
    test('a chat replaced by a copy with the same id still gets the new name', () => {
        const [A] = install(character('A', [chat('a0', 'Old')]))
        const captured = A.chats[0]
        const replacement = $state.snapshot(captured) as Chat
        A.chats = [replacement]
        expect(renameChat('A', captured, 'New')).toBe(true)
        expect(A.chats[0].name).toBe('New')
    })

    test('an archived or removed character refuses with the not-saved notice', () => {
        const [A] = install(character('A', [chat('a0', 'Old')], { coldstorage: 'cold-id' }))
        expect(renameChat('A', A.chats[0], 'New')).toBe(false)
        expect(renameChat('gone', A.chats[0], 'New')).toBe(false)
        expect(A.chats[0].name).toBe('Old')
        expect(mocks.alertError).toHaveBeenCalledTimes(2)
        expect(mocks.alertError).toHaveBeenCalledWith(language.chatShellEditNotSaved)
    })
})

describe('moveChat', () => {
    test('sets the folder id and removes it again for no folder', () => {
        const [A] = install(character('A', [chat('a0', 'One'), chat('a1', 'Two')], { chatFolders: [{ id: 'f1', name: 'F', folded: false }] }))
        expect(moveChat('A', A.chats[1], 'f1')).toBe(true)
        expect(A.chats[1].folderId).toBe('f1')
        expect(A.chats[0].folderId).toBeUndefined()
        expect(moveChat('A', A.chats[1], null)).toBe(true)
        expect('folderId' in A.chats[1]).toBe(false)
    })

    // M30: a move that writes the captured object changes nothing the database holds.
    test('a chat replaced by a copy with the same id still moves', () => {
        const [A] = install(character('A', [chat('a0', 'One')], { chatFolders: [{ id: 'f1', name: 'F', folded: false }] }))
        const captured = A.chats[0]
        A.chats = [$state.snapshot(captured) as Chat]
        expect(moveChat('A', captured, 'f1')).toBe(true)
        expect(A.chats[0].folderId).toBe('f1')
    })

    test('a character that is not selected receives the move', () => {
        const [A] = install(character('A', [chat('a0', 'One')], { chatFolders: [{ id: 'f1', name: 'F', folded: false }] }), character('B', [chat('b0', 'Two')]))
        selectedCharID.set(1)
        expect(moveChat('A', A.chats[0], 'f1')).toBe(true)
        expect(A.chats[0].folderId).toBe('f1')
    })

    test('an archived character refuses with the notice', () => {
        const [A] = install(character('A', [chat('a0', 'One')], { coldstorage: 'cold-id' }))
        expect(moveChat('A', A.chats[0], 'f1')).toBe(false)
        expect(mocks.alertError).toHaveBeenCalledWith(language.chatShellEditNotSaved)
    })
})

describe('folders', () => {
    // TD10
    test('createFolder puts a numbered folder on top and returns its id', () => {
        const [A] = install(character('A', [chat('a0', 'One')], { chatFolders: [{ id: 'f1', name: 'F', folded: true }] }))
        const id = createFolder('A')
        expect(id).toBeTruthy()
        expect(A.chatFolders).toHaveLength(2)
        expect(A.chatFolders?.[0]).toEqual({ id, name: `${language.chatShellNewFolder} 2`, folded: false })
        expect(A.chatFolders?.[1].id).toBe('f1')
    })

    test('createFolder works for a character that has no folder list yet', () => {
        const [A] = install(character('A', [chat('a0', 'One')], { chatFolders: undefined }))
        const id = createFolder('A')
        expect(A.chatFolders?.map((f) => f.id)).toEqual([id])
    })

    test('rename, colour and fold write the one folder', () => {
        const [A] = install(character('A', [], { chatFolders: [{ id: 'f1', name: 'One', folded: false }, { id: 'f2', name: 'Two', folded: false }] }))
        expect(renameFolder('A', 'f2', ' Renamed ')).toBe(true)
        expect(setFolderColor('A', 'f2', 'green')).toBe(true)
        expect(setFolderFolded('A', 'f2', true)).toBe(true)
        expect(A.chatFolders?.[1]).toMatchObject({ id: 'f2', name: 'Renamed', color: 'green', folded: true })
        expect(A.chatFolders?.[0]).toEqual({ id: 'f1', name: 'One', folded: false })
    })

    test('an empty folder name keeps the old name', () => {
        const [A] = install(character('A', [], { chatFolders: [{ id: 'f1', name: 'One', folded: false }] }))
        expect(renameFolder('A', 'f1', '  ')).toBe(false)
        expect(A.chatFolders?.[0].name).toBe('One')
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('deleting a folder unfiles its chats and no others', () => {
        const [A] = install(character('A', [
            chat('a0', 'In f1', { folderId: 'f1' }),
            chat('a1', 'In f2', { folderId: 'f2' }),
            chat('a2', 'Loose'),
        ], { chatFolders: [{ id: 'f1', name: 'One', folded: false }, { id: 'f2', name: 'Two', folded: false }] }))
        expect(deleteFolder('A', 'f1')).toBe(true)
        expect(A.chatFolders?.map((f) => f.id)).toEqual(['f2'])
        expect(A.chats[0].folderId).toBeUndefined()
        expect(A.chats[1].folderId).toBe('f2')
        expect(A.chats).toHaveLength(3)
    })

    test('folder edits on an archived character are refused with the notice', () => {
        const [A] = install(character('A', [], { coldstorage: 'cold-id', chatFolders: [{ id: 'f1', name: 'One', folded: false }] }))
        expect(renameFolder('A', 'f1', 'X')).toBe(false)
        expect(setFolderColor('A', 'f1', 'red')).toBe(false)
        expect(setFolderFolded('A', 'f1', true)).toBe(false)
        expect(deleteFolder('A', 'f1')).toBe(false)
        expect(createFolder('A')).toBeNull()
        expect(A.chatFolders).toEqual([{ id: 'f1', name: 'One', folded: false }])
        expect(mocks.alertError).toHaveBeenCalledTimes(5)
    })
})

describe('duplicateChat', () => {
    // TD6
    test('puts a copy on top with a new id and a copy name, drops the streaming flag, and opens it', () => {
        const [A] = install(character('A', [chat('a0', 'First', { isStreaming: true }), chat('a1', 'Second')], { chatPage: 1 }))
        selectedCharID.set(0)
        const source = A.chats[0]
        expect(duplicateChat('A', source)).toBe(true)
        expect(A.chats).toHaveLength(3)
        const copy = A.chats[0]
        expect(copy).not.toBe(source)
        expect(copy.id).toBeTruthy()
        expect(copy.id).not.toBe('a0')
        expect(copy.name).toBe('First (Copy)')
        expect('isStreaming' in copy).toBe(false)
        expect(copy.message.map((m) => m.data)).toEqual(['First text'])
        expect(copy.message[0]).not.toBe(source.message[0])
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expect(A.chatPage).toBe(0)
        // The source keeps its streaming flag: only the copy is cleaned.
        expect(A.chats[1].isStreaming).toBe(true)
    })

    test('refuses a character that is not selected: nothing is written, nothing opens', () => {
        const [A, B] = install(character('A', [chat('a0', 'First')]), character('B', [chat('b0', 'Other')]))
        selectedCharID.set(1)
        expect(duplicateChat('A', A.chats[0])).toBe(false)
        expect(A.chats).toHaveLength(1)
        expect(B.chats).toHaveLength(1)
        expect(mocks.changeChat).not.toHaveBeenCalled()
        expect(mocks.alertError).toHaveBeenCalledWith(language.chatShellEditNotSaved)
    })

    // M46: the selected-owner check is what stops a duplicate for a character the user has already left.
    test('refuses when the selection moved without a flush', () => {
        const [A, B] = install(character('A', [chat('a0', 'First')]), character('B', [chat('b0', 'Other')]))
        selectedCharID.set(0)
        const source = A.chats[0]
        selectedCharID.set(1)
        expect(duplicateChat('A', source)).toBe(false)
        expect(A.chats).toHaveLength(1)
        expect(B.chats).toHaveLength(1)
    })

    // M69: a live write lands on the first holder of the id, so a selected second holder must be refused.
    test('refuses when another character holds the same id first', () => {
        const [first, second] = install(character('same', [chat('x0', 'Hidden')]), character('same', [chat('y0', 'Mine')]))
        selectedCharID.set(1)
        expect(duplicateChat('same', second.chats[0])).toBe(false)
        expect(first.chats).toHaveLength(1)
        expect(second.chats).toHaveLength(1)
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('refuses an archived character and a chat that is not in the list', () => {
        const [A, B] = install(character('A', [chat('a0', 'First')], { coldstorage: 'cold-id' }), character('B', [chat('b0', 'Other')]))
        selectedCharID.set(0)
        expect(duplicateChat('A', A.chats[0])).toBe(false)
        selectedCharID.set(1)
        expect(duplicateChat('B', chat('stranger', 'Stranger'))).toBe(false)
        expect(B.chats).toHaveLength(1)
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    // M60: the placeholder of an archived chat is not a copy of the chat.
    test('refuses an archived chat', () => {
        const archived = chat('a0', 'Old', { message: [{ role: 'char', data: `${coldStorageHeader}abc`, time: 1 }] as unknown as Chat['message'] })
        const [A] = install(character('A', [archived]))
        selectedCharID.set(0)
        expect(duplicateChat('A', A.chats[0])).toBe(false)
        expect(A.chats).toHaveLength(1)
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    // M74: opening the raw copy finds nothing, because the list holds a proxy of it.
    test('opens the copy that the list holds, once', () => {
        const [A] = install(character('A', [chat('a0', 'First'), chat('a1', 'Second')], { chatPage: 1 }))
        selectedCharID.set(0)
        duplicateChat('A', A.chats[1])
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(A.chats[A.chatPage].name).toBe('Second (Copy)')
    })
})
