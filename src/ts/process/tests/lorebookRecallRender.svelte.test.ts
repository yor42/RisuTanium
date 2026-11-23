// @vitest-environment happy-dom

/**
 * A recalled entry is parsed by the scan as part of the prompt, with the real CBS parser and without `runVar`, so a
 * `{{setvar}}` in its body writes no chat variable. The real `chatVar` and `chatOrigin` run.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, character, Message } from '../../storage/database.svelte'
import '../../polyfill'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
        globalChatVariables: {},
    },
}))

vi.mock('../../stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        selectedCharID: store(0),
        CurrentTriggerIdStore: store(null),
        CurrentVariablePointer: store({}),
        ReloadGUIPointer: store(0),
        selIdState: { selId: 0 },
        CharEmotion: store({}),
        ReloadChatPointer: store({}),
    }
})
vi.mock('../../storage/database.svelte', () => ({
    appVer: '0.0.0',
    getDatabase: () => h.db,
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', async (importOriginal) => ({ ...(await importOriginal<object>()), downloadFile: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []), moduleUpdate: () => {}, getModules: () => [] }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'
import { createRunSubject, originOf } from '../chatOrigin'
import { promptViewOf, splitSentMessages } from '../../cbs'
import { selectedCharID } from '../../stores.svelte'
import type { LoreRecallTap } from '../memory/chroMemory/loreRecall'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('recalled entry render', () => {
    test('regression reproducer: a recalled body with {{setvar}} is placed and writes no chat variable', async () => {
        const chat = {
            id: 'chat-1',
            name: 'Chat',
            localLore: [],
            message: [{ role: 'user', data: 'hello there', time: 0 }] as Message[],
        } as unknown as Chat
        const char = {
            name: 'Char',
            chaId: 'cha-1',
            chatPage: 0,
            globalLore: [{
                key: 'zebra',
                comment: 'zebra',
                content: '{{setvar::k::1}}LoreText',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: false,
                secondkey: '',
                selective: false,
            }],
            loreSettings: { scanDepth: 5, tokenBudget: 1000, fullWordMatching: false, recursiveScanning: true },
            chats: [chat],
        } as unknown as character
        h.db.characters = [char]
        selectedCharID.set(0)
        const subject = createRunSubject(originOf(char, chat)!)
        const split = splitSentMessages(chat.message)
        const view = promptViewOf(split, split.resetAt === -1)
        const tap: LoreRecallTap = { cap: 1000, run: () => [0] }
        const result = await loadLoreBookV3Prompt(subject, view, undefined, tap)
        expect(result.recalled).toHaveLength(1)
        const placed = result.recalled![0].active
        expect(placed.pos).toBe('')
        expect(placed.inject).toBeNull()
        expect(placed.prompt).toBe('{{setvar::k::1}}LoreText')
        expect(chat.scriptstate?.['$k']).toBeUndefined()
    })
})
