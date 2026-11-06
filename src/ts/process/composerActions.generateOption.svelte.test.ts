import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const sends = vi.hoisted(() => ({ sendChat: vi.fn(async () => true) }))

vi.mock('../stores.svelte', () => ({
    DBState: { db: { characters: [], playMessage: false } },
    selectedCharID: writable(0),
}))
vi.mock('./index.svelte', () => ({ doingChat: writable(false), sendChat: sends.sendChat }))
vi.mock('./generationOwnership.svelte', () => ({
    isComposerWindowOpen: vi.fn(() => false), setComposerWindow: vi.fn(),
    abortUnitInProgress: vi.fn(), turnsReachedCount: vi.fn(() => 0),
}))
vi.mock('./coldstorageData', () => ({ isColdChat: vi.fn(() => false) }))
vi.mock('../alert', () => ({ alertError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { errors: { chatAltUnreadable: '', coldStorageChatStillLoading: '' } } }))
vi.mock('../util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('./sendCharacterMessage', () => ({ sendCharacterMessage: vi.fn() }))
vi.mock('./command', () => ({ processMultiCommand: vi.fn() }))
vi.mock('./moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn(async () => true) }))
vi.mock('./moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('../translator/translator', () => ({ isExpTranslator: vi.fn(() => false), translate: vi.fn(async () => '') }))
vi.mock('../localDrafts', () => ({ registerDraft: vi.fn(), unregisterDraft: vi.fn(), COMPOSER_DRAFT_KIND: 'composer' }))

import { DBState } from '../stores.svelte'
import { resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import { detachTail } from './chatTree'
import * as composerActions from './composerActions.svelte'

const source = { closeMenu: vi.fn() }

function setupSiblings() {
    const chat = { id: 'chat-a', name: '', note: '', localLore: [], message: [
        { role: 'user' as const, data: 'hello', chatId: 'u1' },
        { role: 'char' as const, data: 'first', chatId: 'c1' },
    ] }
    detachTail(chat, 1)
    chat.message.push({ role: 'char', data: 'second', chatId: 'c2' })
    const owner = { chaId: 'owner-a', chats: [chat], chatPage: 0 }
    Object.assign(DBState.db, { characters: [owner], playMessage: false })
    return DBState.db.characters[0].chats[0]
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    sends.sendChat.mockClear()
    source.closeMenu.mockClear()
})
afterEach(() => resetCharacterSaveMarksForTest())

describe('T3 generation option', () => {
    it('does not generate at the last sibling when generate is false; the default does', async () => {
        const chat = setupSiblings()
        await composerActions.stepSibling(source, 1, 'c2', 'forward', { generate: false })
        expect(sends.sendChat).not.toHaveBeenCalled()
        await composerActions.stepSibling(source, 1, 'c2', 'forward')
        expect(sends.sendChat).toHaveBeenCalledTimes(1)
        expect(chat.message.map((message) => message.chatId)).toEqual(['u1'])
    })

    it('regenerateNewest follows the existing generation path once', async () => {
        setupSiblings()
        await composerActions.regenerateNewest(source)
        expect(sends.sendChat).toHaveBeenCalledTimes(1)
        expect(source.closeMenu).toHaveBeenCalledTimes(1)
    })
})
