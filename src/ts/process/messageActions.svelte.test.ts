// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import { DBState, selectedCharID, selIdState, ReloadChatPointer } from '../stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../storage/characterSaveMarks'
import type { toSaveType } from '../storage/risuSave'
import { detachTail } from './chatTree'
import { writeSupaMemoryData } from './memory/supaResume'
import { branchMessage, deleteAtSettle, deleteNow, freezeDeleteIds, handleButtonTriggerWithin, handleFormTriggerWithin, requestRemove, toggleMessageDisabled } from './messageActions.svelte'

vi.mock('../stores.svelte', () => ({ DBState: { db: { characters: [], askRemoval: false, instantRemove: false } }, selectedCharID: writable(0), selIdState: { selId: 0 }, ReloadChatPointer: writable({} as Record<number, number>), CurrentTriggerIdStore: writable(null) }))
vi.mock('../storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn() }))
vi.mock('../alert', () => ({ alertConfirm: vi.fn(), alertSelect: vi.fn(), alertInput: vi.fn() }))
vi.mock('../../lang', () => ({ language: {
    removeChat: 'remove?', removeOnlyThisMessage: 'one', cancel: 'cancel',
    removeThisAndFollowingMessages: 'from', removeMessageQuestion: 'which?',
} }))
vi.mock('./generationOwnership.svelte', () => ({ isComposerWindowOpen: vi.fn(() => false) }))
vi.mock('./scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('./triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('./moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn() }))
vi.mock('./moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('../util', () => ({ getUserName: vi.fn(() => 'User'), getUserIcon: vi.fn(() => ''), capitalize: vi.fn((value: string) => value), sleep: vi.fn(async () => {}) }))
vi.mock('../chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('../chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('./tts', () => ({ sayTTS: vi.fn(), stopTTS: vi.fn() }))
vi.mock('./ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('../parser/parser.svelte', () => ({ ParseMarkdown: vi.fn() }))

import { alertConfirm, alertSelect } from '../alert'
import { getCurrentCharacter, getCurrentChat } from '../storage/database.svelte'
import { runTrigger } from './triggers'
import { runLuaButtonTrigger, runLuaInteractionTrigger } from './scriptings'

const message = (id: string, role: 'user' | 'char' = 'char') => ({ role, data: id, chatId: id })

function setup() {
    const chat = { id: 'chat-a', name: '', note: '', localLore: [], message: [
        message('u1', 'user'), message('c2'), message('u3', 'user'), message('c4'),
    ] }
    const owner = { chaId: 'owner-a', chats: [chat], chatPage: 0 }
    Object.assign(DBState.db, { characters: [owner], askRemoval: false, instantRemove: false })
    return { owner: DBState.db.characters[0], chat: DBState.db.characters[0].chats[0] }
}

let tracker: toSaveType
let schedule = vi.fn<() => void>()

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    schedule = vi.fn<() => void>()
    installCharacterSaveMarks({ tracker, schedule })
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertSelect).mockReset()
    ReloadChatPointer.set({})
})

afterEach(() => resetCharacterSaveMarksForTest())

describe('live message index after asynchronous actions', () => {
    it('branches at the index current after the wait', async () => {
        let idx = 1
        const onBranch = vi.fn()
        const pending = branchMessage(() => idx, 'expected', onBranch)
        idx = 2
        await pending
        expect(onBranch).toHaveBeenCalledWith(2, 'expected')
    })

    it('toggles the message at the index current after the wait', async () => {
        const { chat } = setup()
        selIdState.selId = 0
        let idx = 1
        const pending = toggleMessageDisabled(() => idx, 'one')
        idx = 2
        await pending
        expect(chat.message[1]).not.toHaveProperty('disabled')
        expect(chat.message[2]).toHaveProperty('disabled', true)
    })

    it('bumps the index current when a manual trigger finishes', async () => {
        const { owner, chat } = setup()
        vi.mocked(getCurrentCharacter).mockReturnValue(owner as never)
        vi.mocked(getCurrentChat).mockReturnValue(chat as never)
        let release!: (value: boolean) => void
        vi.mocked(runTrigger).mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve }) as never)
        const button = document.createElement('button')
        button.setAttribute('risu-trigger', 'manual')
        document.body.append(button)
        let event!: UIEvent
        button.addEventListener('click', (clicked) => { event = clicked })
        button.click()
        let idx = 1
        const pending = handleButtonTriggerWithin(event, () => idx)
        idx = 2
        release(true)
        await pending
        expect(get(ReloadChatPointer)).toMatchObject({ 2: 1 })
        expect(get(ReloadChatPointer)).not.toHaveProperty('1')
    })

    it('runs a risu-trigger button with the origin of its work handle', async () => {
        const { owner, chat } = setup()
        vi.mocked(getCurrentCharacter).mockReturnValue(owner as never)
        vi.mocked(getCurrentChat).mockReturnValue(chat as never)
        vi.mocked(runTrigger).mockClear()
        vi.mocked(runTrigger).mockResolvedValueOnce(true as never)
        const button = document.createElement('button')
        button.setAttribute('risu-trigger', 'manual')
        document.body.append(button)
        let event!: UIEvent
        button.addEventListener('click', (clicked) => { event = clicked })
        button.click()
        await handleButtonTriggerWithin(event, () => 1)
        expect(runTrigger).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runTrigger).mock.calls[0][2]).toMatchObject({ origin: { chaId: 'owner-a', chatId: 'chat-a' } })
    })

    it('runs a risu-btn button with the origin of its work handle as the third argument', async () => {
        const { owner, chat } = setup()
        vi.mocked(getCurrentCharacter).mockReturnValue(owner as never)
        vi.mocked(getCurrentChat).mockReturnValue(chat as never)
        vi.mocked(runLuaButtonTrigger).mockClear()
        vi.mocked(runLuaButtonTrigger).mockResolvedValueOnce(true as never)
        const button = document.createElement('button')
        button.setAttribute('risu-btn', 'press')
        document.body.append(button)
        let event!: UIEvent
        button.addEventListener('click', (clicked) => { event = clicked })
        button.click()
        await handleButtonTriggerWithin(event, () => 1)
        expect(runLuaButtonTrigger).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runLuaButtonTrigger).mock.calls[0][2]).toEqual({ chaId: 'owner-a', chatId: 'chat-a' })
    })

    it('runs a form trigger with the origin of its work handle as the fifth argument', async () => {
        const { owner, chat } = setup()
        vi.mocked(getCurrentCharacter).mockReturnValue(owner as never)
        vi.mocked(getCurrentChat).mockReturnValue(chat as never)
        vi.mocked(runLuaInteractionTrigger).mockClear()
        vi.mocked(runLuaInteractionTrigger).mockResolvedValueOnce(true as never)
        const form = document.createElement('form')
        form.setAttribute('risu-form', 'answer')
        const event = new SubmitEvent('submit', { cancelable: true })
        Object.defineProperty(event, 'target', { value: form })
        await handleFormTriggerWithin(event, () => 1)
        expect(runLuaInteractionTrigger).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runLuaInteractionTrigger).mock.calls[0][4]).toEqual({ chaId: 'owner-a', chatId: 'chat-a' })
    })
    it('bumps the index current when a form trigger finishes', async () => {
        const { owner, chat } = setup()
        vi.mocked(getCurrentCharacter).mockReturnValue(owner as never)
        vi.mocked(getCurrentChat).mockReturnValue(chat as never)
        let release!: (value: boolean) => void
        vi.mocked(runLuaInteractionTrigger).mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve }) as never)
        const form = document.createElement('form')
        form.setAttribute('risu-form', 'answer')
        const event = new SubmitEvent('submit', { cancelable: true })
        Object.defineProperty(event, 'target', { value: form })
        let idx = 1
        const pending = handleFormTriggerWithin(event, () => idx)
        idx = 2
        release(true)
        await pending
        expect(event.defaultPrevented).toBe(true)
        expect(get(ReloadChatPointer)).toMatchObject({ 2: 1 })
        expect(get(ReloadChatPointer)).not.toHaveProperty('1')
    })
})

describe('T34 delete core', () => {
    it('reparents children and repoints memory before exactly one save mark', () => {
        const { owner, chat } = setup()
        detachTail(chat, 2)
        writeSupaMemoryData(chat, 'c2\nsummary')
        const target = chat.message[1]
        tracker.character.length = 0
        schedule.mockClear()
        schedule.mockImplementation(() => {
            expect(chat.message.includes(target)).toBe(false)
            expect(tracker.character).toEqual([owner.chaId])
        })
        expect(deleteNow(owner, chat, target, 'one')).toBe(true)
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1'])
        expect(chat.alt?.[0].p).toBe('u1')
        expect(chat.supaMemoryData).not.toBe('c2\nsummary')
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('truncates from the target and clears alternatives and memory on full clear', () => {
        const { owner, chat } = setup()
        detachTail(chat, 1)
        writeSupaMemoryData(chat, 'u1\nsummary')
        tracker.character.length = 0
        schedule.mockClear()
        expect(deleteNow(owner, chat, chat.message[0], 'from')).toBe(true)
        expect(chat.message).toEqual([])
        expect(chat.alt).toBeUndefined()
        expect(chat.supaMemoryData).toBe('')
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('keeps the old confirm then select order and cancellation', async () => {
        const { owner, chat } = setup()
        DBState.db.askRemoval = true
        DBState.db.instantRemove = true
        const order: string[] = []
        vi.mocked(alertConfirm).mockImplementation(async () => { order.push('confirm'); return true })
        vi.mocked(alertSelect).mockImplementation(async () => { order.push('select'); return '2' })
        expect(await requestRemove(owner, chat, chat.message[1], { rec: false })).toBe(true)
        expect(order).toEqual(['confirm', 'select'])
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1'])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('uses the three-way select for rec and leaves the target on cancel', async () => {
        const { owner, chat } = setup()
        vi.mocked(alertSelect).mockResolvedValue('1')
        expect(await requestRemove(owner, chat, chat.message[1], { rec: true })).toBe(false)
        expect(vi.mocked(alertConfirm)).not.toHaveBeenCalled()
        expect(vi.mocked(alertSelect)).toHaveBeenCalledWith(['one', 'cancel', 'from'], 'which?')
        expect(chat.message).toHaveLength(4)
        expect(schedule).not.toHaveBeenCalled()
    })

    it('removes immediately when both dialog settings are off', async () => {
        const { owner, chat } = setup()
        expect(await requestRemove(owner, chat, chat.message[1])).toBe(true)
        expect(vi.mocked(alertConfirm)).not.toHaveBeenCalled()
        expect(vi.mocked(alertSelect)).not.toHaveBeenCalled()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'u3', 'c4'])
    })

    it('confirms without a select when only askRemoval is enabled', async () => {
        const { owner, chat } = setup()
        DBState.db.askRemoval = true
        vi.mocked(alertConfirm).mockResolvedValue(true)
        expect(await requestRemove(owner, chat, chat.message[1])).toBe(true)
        expect(alertConfirm).toHaveBeenCalledWith('remove?')
        expect(alertSelect).not.toHaveBeenCalled()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'u3', 'c4'])
    })

    it('selects without a confirm when only instantRemove is enabled', async () => {
        const { owner, chat } = setup()
        DBState.db.instantRemove = true
        vi.mocked(alertSelect).mockResolvedValue('2')
        expect(await requestRemove(owner, chat, chat.message[1])).toBe(true)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertSelect).toHaveBeenCalledWith(['one', 'cancel', 'from'], 'which?')
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1'])
    })

    it('refuses a removed owner, chat, or message without a mark', () => {
        const { owner, chat } = setup()
        const target = chat.message[1]
        chat.message.splice(1, 1)
        expect(deleteNow(owner, chat, target, 'one')).toBe(false)
        owner.chats.splice(0, 1)
        expect(deleteNow(owner, chat, chat.message[0], 'one')).toBe(false)
        expect(schedule).not.toHaveBeenCalled()
    })
})

describe('T24 settled delete', () => {
    it('deletes one when unrelated messages have no ids but refuses a range', () => {
        const { owner, chat } = setup()
        Object.assign(chat.message[2], { chatId: undefined })
        const target = chat.message[1]
        const one = freezeDeleteIds(chat, target, 'one')
        expect(one).not.toBeNull()
        expect(freezeDeleteIds(chat, target, 'from')).toBeNull()
        expect(deleteAtSettle({ chaId: owner.chaId, chatId: chat.id }, one!, 'one')).toBe(true)
        expect(chat.message.includes(target)).toBe(false)
    })
    it('deletes in the origin chat after selection changes and marks its owner', () => {
        const { owner, chat } = setup()
        const ids = freezeDeleteIds(chat, chat.message[1], 'one')!
        const other = { chaId: 'owner-b', chats: [{ id: 'chat-b', name: '', note: '', localLore: [], message: [message('other')] }], chatPage: 0 }
        Object.assign(DBState.db, { characters: [owner, other] })
        selectedCharID.set(1)
        const origin = { chaId: owner.chaId, chatId: chat.id! }
        tracker.character.length = 0
        schedule.mockClear()
        expect(deleteAtSettle(origin, ids, 'one')).toBe(true)
        expect(chat.message.some((item) => item.chatId === ids.targetId)).toBe(false)
        expect(other.chats[0].message).toHaveLength(1)
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('reparents children and repoints memory when a settled delete removes a middle reply', () => {
        const { owner, chat } = setup()
        detachTail(chat, 2)
        writeSupaMemoryData(chat, 'c2\nsummary')
        const target = chat.message[1]
        const ids = freezeDeleteIds(chat, target, 'one')!
        tracker.character.length = 0
        schedule.mockClear()
        expect(deleteAtSettle({ chaId: owner.chaId, chatId: chat.id! }, ids, 'one')).toBe(true)
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1'])
        expect(chat.alt?.[0].p).toBe('u1')
        expect(chat.supaMemoryData).not.toBe('c2\nsummary')
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })
    it('returns false for a gone origin, missing target, or changed sibling ids', () => {
        const { owner, chat } = setup()
        detachTail(chat, 3)
        const ids = freezeDeleteIds(chat, chat.message[1], 'one')!
        const origin = { chaId: owner.chaId, chatId: chat.id! }
        expect(deleteAtSettle({ chaId: owner.chaId, chatId: 'gone' }, ids, 'one')).toBe(false)
        expect(schedule).not.toHaveBeenCalled()
        chat.message[1].chatId = 'replacement'
        expect(deleteAtSettle(origin, ids, 'one')).toBe(false)
        chat.message[1].chatId = ids.targetId
        chat.alt?.push({ m: message('new-sibling'), p: 'u1', a: 3 })
        expect(deleteAtSettle(origin, ids, 'one')).toBe(false)
        expect(chat.message).toHaveLength(3)
    })

    it('refuses a changed ordered range and deletes an unchanged one', () => {
        const { owner, chat } = setup()
        const ids = freezeDeleteIds(chat, chat.message[1], 'from')!
        const origin = { chaId: owner.chaId, chatId: chat.id! }
        chat.message[2].chatId = 'changed'
        expect(deleteAtSettle(origin, ids, 'from')).toBe(false)
        expect(chat.message).toHaveLength(4)
        chat.message[2].chatId = 'u3'
        tracker.character.length = 0
        schedule.mockClear()
        expect(deleteAtSettle(origin, ids, 'from')).toBe(true)
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1'])
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })
})
