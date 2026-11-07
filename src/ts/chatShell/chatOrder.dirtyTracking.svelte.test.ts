// @vitest-environment happy-dom

/**
 * Save marks of a reorder, through the real database change effects.
 *
 * Invariant: a reorder of the selected character's chats or folders is seen by the dirty-tracking effects (the chats-shape child
 * and the `chatFolders` field child), and a reorder of a character that is not selected is marked through
 * `markCharacterForSave`, because an in-place write on it is invisible to the selected-character tracker.
 *
 * MOCKED: the stores module (a `$state` database and a selection store), `changeChatTo` and the alert module. The effects, the
 * marks, the live write and the list model are real.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import type { toSaveType } from '../storage/risuSave'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return { DBState: state, selectedCharID, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import { registerDbChangeEffects } from '../storage/dbChangeEffects.svelte'
import { placeChat, placeFolder } from './chatOrder'

type Entry = Database['characters'][number]

const SENTINEL = 'sentinel'
const scheduled = vi.fn()
let tracker: toSaveType
let markChanged: Mock<(markDirty: boolean) => void>
let cleanup: (() => void) | undefined

function chat(id: string): Chat {
    return { id, name: id, message: [{ role: 'user', data: id, time: 1 }], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string): Entry {
    return {
        type: 'character', chaId, name: chaId, image: '', chatPage: 0,
        chats: [chat(`${chaId}0`), chat(`${chaId}1`), chat(`${chaId}2`)],
        chatFolders: [{ id: 'f1', name: 'F1', folded: false }, { id: 'f2', name: 'F2', folded: false }],
    } as unknown as Entry
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    scheduled.mockReset()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false } as unknown as toSaveType
    markChanged = vi.fn<(markDirty: boolean) => void>()
    installCharacterSaveMarks({ tracker, schedule: scheduled })
    DBState.db = { characters: [character('A'), character('B')], botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {} } as unknown as Database
    selectedCharID.set(0)
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged })
    })
    flushSync()
    tracker.character = [SENTINEL]
    markChanged.mockClear()
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    selectedCharID.set(-1)
})

describe('a reorder of the selected character', () => {
    test('a chat move is seen by the chats-shape child and fronts the character', () => {
        const a = DBState.db.characters[0]
        expect(placeChat(a, a.chats[2], a.chats[0])).toBe(true)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        expect(tracker.character[0]).toBe('A')
    })

    test('a folder move is seen by the folder field child and fronts the character', () => {
        const a = DBState.db.characters[0]
        const folders = a.chatFolders as ChatFolder[]
        expect(placeFolder(a, folders[1], folders[0])).toBe(true)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        expect(tracker.character[0]).toBe('A')
    })
})

describe('a reorder of a character that is not selected', () => {
    test('a chat move is marked for save', () => {
        const b = DBState.db.characters[1]
        expect(placeChat(b, b.chats[2], b.chats[0])).toBe(true)
        flushSync()
        expect(tracker.character).toContain('B')
        expect(scheduled).toHaveBeenCalled()
    })

    test('a folder move is marked for save', () => {
        const b = DBState.db.characters[1]
        const folders = b.chatFolders as ChatFolder[]
        expect(placeFolder(b, folders[1], folders[0])).toBe(true)
        flushSync()
        expect(tracker.character).toContain('B')
    })
})

describe('a move that changes nothing', () => {
    test('marks nothing and does not re-run the tracked reads', () => {
        const a = DBState.db.characters[0]
        const b = DBState.db.characters[1]
        expect(placeChat(a, a.chats[1], a.chats[1])).toBe(true)
        expect(placeChat(b, b.chats[1], b.chats[2])).toBe(true)
        flushSync()
        expect(markChanged).not.toHaveBeenCalled()
        expect(tracker.character).toEqual([SENTINEL])
        expect(scheduled).not.toHaveBeenCalled()
    })
})
