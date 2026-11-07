// @vitest-environment happy-dom

/**
 * Save marks of the new shell's chat-list edits.
 *
 * Invariant: every edit that lands marks the character it landed on for save, even when that character is not the selected
 * one (an in-place write on a non-selected character is invisible to the selected-character tracker), and an edit that is
 * refused marks nothing. The marks are the real ones: they append to the tracker the save installed.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, Database } from '../storage/database.svelte'
import type { toSaveType } from '../storage/risuSave'

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
        changeChatTo: (i: number) => { DBState.db.characters[selIdState.selId].chatPage = i },
        createChatCopyName: (name: string, type: string) => `${name} (${type})`,
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import { createFolder, deleteFolder, duplicateChat, moveChat, renameChat, renameFolder, setFolderColor, setFolderFolded } from './chatListEdits'

type Entry = Database['characters'][number]

const tracker = { character: [] as string[] } as unknown as toSaveType
const scheduled = vi.fn()

function chat(id: string, name: string): Chat {
    return { id, name, message: [{ role: 'user', data: name, time: 1 }], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, image: '', chats: [chat(`${chaId}0`, 'One'), chat(`${chaId}1`, 'Two')], chatPage: 0, chatFolders: [{ id: 'f1', name: 'F', folded: false }], ...extra } as unknown as Entry
}

function marked(): string[] {
    return [...tracker.character]
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    tracker.character.length = 0
    scheduled.mockReset()
    installCharacterSaveMarks({ tracker, schedule: scheduled })
    DBState.db = { characters: [character('A'), character('B')] } as unknown as Database
    selectedCharID.set(1)
})

describe('a landed edit marks the character it landed on', () => {
    // M13: a skipped mark leaves the edit in memory only; the next save would not re-encode the character.
    test.each([
        ['renameChat', () => renameChat('A', DBState.db.characters[0].chats[0], 'Renamed')],
        ['moveChat', () => moveChat('A', DBState.db.characters[0].chats[0], 'f1')],
        ['createFolder', () => createFolder('A') !== null],
        ['renameFolder', () => renameFolder('A', 'f1', 'Renamed')],
        ['setFolderColor', () => setFolderColor('A', 'f1', 'red')],
        ['setFolderFolded', () => setFolderFolded('A', 'f1', true)],
        ['deleteFolder', () => deleteFolder('A', 'f1')],
    ])('%s marks a character that is not selected', (_name, run) => {
        expect(run()).toBe(true)
        expect(marked()).toEqual(['A'])
        expect(scheduled).toHaveBeenCalled()
    })

    test('duplicateChat marks the selected character', () => {
        selectedCharID.set(0)
        expect(duplicateChat('A', DBState.db.characters[0].chats[0])).toBe(true)
        expect(marked()).toEqual(['A'])
    })
})

describe('a refused edit marks nothing', () => {
    test.each([
        ['renameChat', () => renameChat('A', DBState.db.characters[0].chats[0], 'Renamed')],
        ['moveChat', () => moveChat('A', DBState.db.characters[0].chats[0], 'f1')],
        ['renameFolder', () => renameFolder('A', 'f1', 'Renamed')],
        ['setFolderFolded', () => setFolderFolded('A', 'f1', true)],
        ['deleteFolder', () => deleteFolder('A', 'f1')],
    ])('%s on an archived character', (_name, run) => {
        DBState.db.characters[0].coldstorage = 'cold-id'
        expect(run()).toBe(false)
        expect(marked()).toEqual([])
        expect(scheduled).not.toHaveBeenCalled()
    })

    test('duplicateChat for a character that is not selected', () => {
        expect(duplicateChat('A', DBState.db.characters[0].chats[0])).toBe(false)
        expect(marked()).toEqual([])
    })
})
