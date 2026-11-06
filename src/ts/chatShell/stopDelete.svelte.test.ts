// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest, markCharacterForSave } from '../storage/characterSaveMarks'
import type { toSaveType } from '../storage/risuSave'
import { isWriting, registerWork, type WorkHandle } from '../process/chatOrigin'
import { isStopDeletePending, requestStopDelete } from './stopDelete.svelte'

const flag = vi.hoisted(() => ({ subscribers: 0, abortChat: vi.fn<() => void>() }))
vi.mock('../process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const base = store(false)
    // Counts live subscriptions so a request that leaves one behind is observable.
    const doingChat = {
        set: base.set,
        update: base.update,
        subscribe: (run: (value: boolean) => void) => {
            flag.subscribers += 1
            const stop = base.subscribe(run)
            return () => { flag.subscribers -= 1; stop() }
        },
    }
    return { doingChat }
})
vi.mock('../process/composerActions.svelte', () => ({ abortChat: flag.abortChat }))
vi.mock('../stores.svelte', () => ({ DBState: { db: { characters: [], askRemoval: false, instantRemove: false } }, selectedCharID: writable(0), selIdState: { selId: 0 }, ReloadChatPointer: writable({} as Record<number, number>), CurrentTriggerIdStore: writable(null) }))
vi.mock('../storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn() }))
vi.mock('../alert', () => ({ alertConfirm: vi.fn(), alertSelect: vi.fn(), alertInput: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../lang', () => ({ language: {
    removeChat: 'remove?', removeOnlyThisMessage: 'one', cancel: 'cancel',
    removeThisAndFollowingMessages: 'from', removeMessageQuestion: 'which?',
    chatShellStopDeleteChanged: 'changed',
} }))
vi.mock('../process/generationOwnership.svelte', () => ({ isComposerWindowOpen: vi.fn(() => false) }))
vi.mock('../process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../process/moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn() }))
vi.mock('../process/moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('../util', () => ({ getUserName: vi.fn(() => 'User'), getUserIcon: vi.fn(() => ''), capitalize: vi.fn((value: string) => value), sleep: vi.fn(async () => {}) }))
vi.mock('../chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('../chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('../process/tts', () => ({ sayTTS: vi.fn(), stopTTS: vi.fn() }))
vi.mock('../process/ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('../parser/parser.svelte', () => ({ ParseMarkdown: vi.fn() }))

import { doingChat } from '../process/index.svelte'
import { alertNormal } from '../alert'

const message = (id: string, role: 'user' | 'char' = 'char') => ({ role, data: id, chatId: id })

function setup() {
    const chat = { id: 'chat-a', name: '', note: '', localLore: [], message: [
        message('u1', 'user'), message('c2'), message('u3', 'user'), message('c4'),
    ] }
    const owner = { chaId: 'owner-a', chats: [chat], chatPage: 0 }
    Object.assign(DBState.db, { characters: [owner], askRemoval: false, instantRemove: false })
    const live = DBState.db.characters[0]
    return { owner: live, chat: live.chats[0], origin: { chaId: 'owner-a', chatId: 'chat-a' } }
}

/** One macrotask: the settle's first check was queued before it, so it has run when this resolves. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The tail of the real send: the flag is released first, then its work ends and the settle mark is written. */
function settleSend(handle: WorkHandle, chaId: string): void {
    doingChat.set(false)
    handle.end()
    markCharacterForSave(chaId)
}

let tracker: toSaveType
let schedule = vi.fn<() => void>()

beforeEach(async () => {
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    schedule = vi.fn<() => void>()
    installCharacterSaveMarks({ tracker, schedule })
    flag.abortChat.mockReset()
    vi.mocked(alertNormal).mockReset()
    doingChat.set(false)
    selectedCharID.set(0)
    await Promise.resolve()
})

afterEach(async () => {
    doingChat.set(false)
    await Promise.resolve()
    await Promise.resolve()
    resetCharacterSaveMarksForTest()
})

describe('T24 stop and delete', () => {
    it('deletes in a macrotask after the send has fully settled, never inside the flag subscriber', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        const target = chat.message[3]
        expect(requestStopDelete(owner, chat, target, 'one')).toBe(true)
        expect(flag.abortChat).toHaveBeenCalledTimes(1)
        expect(chat.message).toHaveLength(4)

        doingChat.set(false)
        // The subscriber has run, yet the send's work is still registered and its settle mark is unwritten.
        expect(isWriting(origin)).toBe(true)
        expect(chat.message).toHaveLength(4)
        handle.end()
        markCharacterForSave(owner.chaId)
        expect(chat.message).toHaveLength(4)

        tracker.character.length = 0
        schedule.mockClear()
        let writingAtDelete: boolean | undefined
        schedule.mockImplementation(() => { writingAtDelete = isWriting(origin); expect(chat.message.includes(target)).toBe(false) })
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3'])
        expect(writingAtDelete).toBe(false)
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
        expect(alertNormal).not.toHaveBeenCalled()
    })

    it('a hand-written send tail (flag false, work end, settle mark) is followed by the delete in a macrotask', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        settleSend(handle, owner.chaId)
        expect(chat.message).toHaveLength(4)
        tracker.character.length = 0
        schedule.mockClear()
        await macrotask()
        expect(chat.message).toHaveLength(3)
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('does not delete while a registered unit for the origin is open, and deletes once it ends', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        doingChat.set(false)
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        expect(isWriting(origin)).toBe(true)
        expect(chat.message).toHaveLength(4)
        expect(isStopDeletePending(origin)).toBe(true)
        expect(alertNormal).not.toHaveBeenCalled()

        handle.end()
        await vi.waitFor(() => expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3']))
        expect(isStopDeletePending(origin)).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
    })

    it('keeps waiting while the origin is writing even though another unit holds the global flag', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        doingChat.set(false)
        const second = registerWork(origin)
        doingChat.set(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        expect(isWriting(origin)).toBe(true)
        expect(chat.message).toHaveLength(4)
        expect(isStopDeletePending(origin)).toBe(true)

        handle.end()
        await new Promise<void>((resolve) => setTimeout(resolve, 80))
        expect(chat.message).toHaveLength(4)

        second.end()
        doingChat.set(false)
        await vi.waitFor(() => expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3']))
        expect(isStopDeletePending(origin)).toBe(false)
    })

    it('a generation of another chat holding the global flag does not hold the delete', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        doingChat.set(false)
        handle.end()
        doingChat.set(true)
        await macrotask()
        expect(isWriting(origin)).toBe(false)
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3'])
        expect(isStopDeletePending(origin)).toBe(false)
    })
    it('a request made while no send is running aborts, then deletes in a macrotask', async () => {
        const { owner, chat } = setup()
        expect(requestStopDelete(owner, chat, chat.message[1], 'one')).toBe(true)
        expect(flag.abortChat).toHaveBeenCalledTimes(1)
        expect(chat.message).toHaveLength(4)
        expect(isStopDeletePending()).toBe(true)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'u3', 'c4'])
        expect(isStopDeletePending()).toBe(false)
        expect(flag.subscribers).toBe(0)
    })

    it('deletes in the origin chat although another chat is selected during the wait', async () => {
        const { owner, chat, origin } = setup()
        const other = { chaId: 'owner-b', chats: [{ id: 'chat-b', name: '', note: '', localLore: [], message: [message('other')] }], chatPage: 0 }
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        Object.assign(DBState.db, { characters: [owner, other] })
        selectedCharID.set(1)
        settleSend(handle, owner.chaId)
        tracker.character.length = 0
        schedule.mockClear()
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3'])
        expect(other.chats[0].message).toHaveLength(1)
        expect(tracker.character).toEqual([owner.chaId])
        expect(schedule).toHaveBeenCalledTimes(1)
    })

    it('removes a frozen range from the reply to the end', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[2], 'from')
        settleSend(handle, owner.chaId)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2'])
    })

    it('refuses when a late message arrived after the freeze: nothing is deleted and it is announced', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[2], 'from')
        chat.message.push(message('late'))
        settleSend(handle, owner.chaId)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3', 'c4', 'late'])
        expect(alertNormal).toHaveBeenCalledWith('changed')
        expect(isStopDeletePending()).toBe(false)
    })

    it('refuses when the target was replaced by a late result under the same slot', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        chat.message[3] = message('replacement')
        settleSend(handle, owner.chaId)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3', 'replacement'])
        expect(alertNormal).toHaveBeenCalledWith('changed')
    })

    it('refuses when the origin is gone and clears the request', async () => {
        const { owner, chat } = setup()
        doingChat.set(true)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        owner.chats.splice(0, 1)
        doingChat.set(false)
        await macrotask()
        expect(alertNormal).toHaveBeenCalledWith('changed')
        expect(isStopDeletePending()).toBe(false)
        expect(flag.subscribers).toBe(0)
    })

    it('refuses to start for a target that cannot be frozen and leaves nothing pending', () => {
        const { owner, chat } = setup()
        const stranger = message('stranger')
        expect(requestStopDelete(owner, chat, stranger, 'one')).toBe(false)
        expect(flag.abortChat).not.toHaveBeenCalled()
        expect(isStopDeletePending()).toBe(false)
    })

    it('disables deletes of its chat only while pending', async () => {
        const { owner, chat, origin } = setup()
        const unrelated = { chaId: 'owner-z', chatId: 'chat-z' }
        expect(isStopDeletePending(origin)).toBe(false)
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        expect(isStopDeletePending()).toBe(true)
        expect(isStopDeletePending(origin)).toBe(true)
        expect(isStopDeletePending(unrelated)).toBe(false)
        expect(isStopDeletePending(null)).toBe(false)
        settleSend(handle, owner.chaId)
        expect(isStopDeletePending(origin)).toBe(true)
        await macrotask()
        expect(isStopDeletePending(origin)).toBe(false)
    })

    it('refuses a second request while one is pending and still completes the first', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        expect(requestStopDelete(owner, chat, chat.message[3], 'one')).toBe(true)
        expect(requestStopDelete(owner, chat, chat.message[1], 'one')).toBe(false)
        expect(flag.abortChat).toHaveBeenCalledTimes(1)
        settleSend(handle, owner.chaId)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'c2', 'u3'])
        expect(requestStopDelete(owner, chat, chat.message[1], 'one')).toBe(true)
        await macrotask()
        expect(chat.message.map((item) => item.chatId)).toEqual(['u1', 'u3'])
    })

    it('leaves no subscription or pending request behind after it resolves', async () => {
        const { owner, chat, origin } = setup()
        doingChat.set(true)
        const handle = registerWork(origin)
        requestStopDelete(owner, chat, chat.message[3], 'one')
        expect(flag.subscribers).toBe(1)
        settleSend(handle, owner.chaId)
        expect(flag.subscribers).toBe(0)
        await macrotask()
        expect(isStopDeletePending()).toBe(false)
        // A later flag change does not delete again.
        doingChat.set(true)
        doingChat.set(false)
        await macrotask()
        expect(chat.message).toHaveLength(3)
    })
})
