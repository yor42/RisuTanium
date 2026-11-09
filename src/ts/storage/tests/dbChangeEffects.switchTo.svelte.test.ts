import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database, Message } from '../database.svelte'
import { registerDbChangeEffects } from '../dbChangeEffects.svelte'
import type { toSaveType } from '../risuSave'
import { detachTail, switchTo } from '../../process/chatTree'

// The selected character's per-chat partition reads `chat.message` and `chat.alt`. switchTo assigns each
// once instead of splicing them in place, so a step must still re-run that partition and mark the
// character for save, with no `writeAt` in between.

//#region module mocks

// A genuinely reactive stand-in for stores.svelte (see dbChangeEffects.svelte.test.ts): the code under
// test is a set of effects that must re-run on mutation.
vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from '../../stores.svelte'

const SENTINEL = '__sentinel__'

function message(id: string, time: number): Message {
    return { role: time % 2 === 0 ? 'user' : 'char', data: `data ${id}`, chatId: id, time }
}

function branchedChat(): Chat {
    const chat: Chat = {
        message: [message('r0', 1), message('a1', 101), message('a2', 102), message('a3', 103)],
        note: '',
        name: 'chat',
        localLore: [],
    }
    detachTail(chat, 1)
    chat.message.push(message('b1', 1001), message('b2', 1002))
    return chat
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function installDb(): void {
    DBState.db = {
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0'],
        characters: [
            { chaId: 'char-0', name: 'Selected', type: 'character', chatPage: 0, chats: [branchedChat()] },
        ],
    } as unknown as Database
    selectedCharID.set(0)
}

function selectedChat(): Chat {
    return DBState.db.characters[0].chats[0]
}

let cleanup: (() => void) | undefined

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    selectedCharID.set(-1)
})

describe('registerDbChangeEffects: a direct switchTo is seen by the selected-character partition', () => {
    function armed() {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.character = [SENTINEL]
        tracker.chat = []
        markChanged.mockClear()
        return { tracker, markChanged }
    }

    test('a step to the other chain marks the character dirty and re-reads the chat', () => {
        const { tracker, markChanged } = armed()

        expect(switchTo(selectedChat(), 1, 'a1')).toBe(true)
        flushSync()

        expect(tracker.character[0]).toBe('char-0')
        expect(markChanged).toHaveBeenCalledWith(true)
        expect(selectedChat().message.map((entry) => entry.chatId)).toEqual(['r0', 'a1', 'a2', 'a3'])
        expect(selectedChat().alt?.map((record) => record.m.chatId)).toEqual(['b1', 'b2'])
    })

    test('a step back marks the character dirty again', () => {
        const { tracker, markChanged } = armed()
        expect(switchTo(selectedChat(), 1, 'a1')).toBe(true)
        flushSync()

        tracker.character = [SENTINEL]
        markChanged.mockClear()
        expect(switchTo(selectedChat(), 1, 'b1')).toBe(true)
        flushSync()

        expect(tracker.character[0]).toBe('char-0')
        expect(markChanged).toHaveBeenCalledWith(true)
        expect(selectedChat().message.map((entry) => entry.chatId)).toEqual(['r0', 'b1', 'b2'])
    })
})
