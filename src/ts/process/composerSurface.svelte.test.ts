import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import type { character, Chat } from '../storage/database.svelte'
import * as composerDrafts from './composerDrafts.svelte'
import { beginChatFileUpload, createComposerSurface, fallbackDraftForChat, pendingChatFileUploads, trackChatFileUpload } from './composerSurface.svelte'

const flipFixture = {
    db: { db: { characters: [] as character[] } },
    selection: { selId: 0 },
}
const doingChat = writable(false)

vi.mock('../stores.svelte', () => ({ DBState: flipFixture.db, selIdState: flipFixture.selection }))
vi.mock('./index.svelte', () => ({ doingChat }))
vi.mock('./composerActions.svelte', () => ({
    isComposerBusy: () => false,
    isAutoModeActive: () => false,
}))
vi.mock('./chatOrigin', () => ({ beginWork: vi.fn(() => null), isWriting: () => false }))

const roots: Array<() => void> = []
const uploads: Array<() => void> = []

function surfaceFor(char: character | null, chat: Chat | null) {
    let surface: ReturnType<typeof createComposerSurface>
    roots.push($effect.root(() => {
        surface = createComposerSurface({ character: () => char, chat: () => chat })
    }))
    return surface!
}

afterEach(() => {
    flipFixture.db.db.characters = []
    doingChat.set(false)
    for (const settle of uploads.splice(0)) settle()
    for (const stop of roots.splice(0)) stop()
    composerDrafts.resetComposerDraftsForTests()
    vi.restoreAllMocks()
})

describe('T7 composer surface', () => {
    test('an attachment in the transient record blocks the on-screen chat', async () => {
        const chat = { id: 'chat' } as Chat
        const char = { chaId: 'owner', chatPage: 0, chats: [chat] } as character
        flipFixture.db.db.characters = [char]
        const stop = $effect.root(() => {
            const surface = createComposerSurface({ character: () => char, chat: () => chat })
            surface.writeDraftAt(null, (record) => { record.fileInput.push('unkeyed') })
        })
        try {
            const { shellFlipBlocker } = await import('../chatShell/flipBlocker')
            expect(fallbackDraftForChat(chat)?.fileInput.length).toBe(1)
            expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedAttachment')
        }
        finally {
            stop()
        }
    })

    test('keyed writes use the same owner and chat ids and the shared draft record', () => {
        const char = { chaId: 'owner' } as character
        const chat = { id: 'chat' } as Chat
        const write = vi.spyOn(composerDrafts, 'write')
        const surface = surfaceFor(char, chat)
        surface.writeDraft((record) => { record.messageInput = 'hello' })
        expect(write).toHaveBeenCalledWith({ chaId: 'owner', chatId: 'chat' }, expect.any(Function))
        expect(composerDrafts.peek({ chaId: 'owner', chatId: 'chat' }).messageInput).toBe('hello')
        flushSync()
        expect(surface.currentDraftKey).toEqual({ chaId: 'owner', chatId: 'chat' })
        expect(surface.shownDraft.messageInput).toBe('hello')
    })

    test('an unkeyed record is visible across surfaces only for its chat object and resets on another chat', () => {
        const first = { message: [] } as Chat
        const second = { message: [] } as Chat
        const surface = surfaceFor(null, first)
        expect(surface.shownDraft).toBe(composerDrafts.EMPTY_DRAFT_VIEW)
        surface.writeDraftAt(null, (record) => { record.fileInput.push('first') })
        flushSync()
        expect(fallbackDraftForChat(first)?.fileInput).toEqual(['first'])
        expect(surface.shownDraft.fileInput).toEqual(['first'])
        expect(fallbackDraftForChat(second)).toBeNull()
        const other = surfaceFor(null, second)
        expect(other.shownDraft).toBe(composerDrafts.EMPTY_DRAFT_VIEW)
        other.writeDraftAt(null, (record) => { record.messageInput = 'second' })
        flushSync()
        expect(fallbackDraftForChat(first)).toBeNull()
        expect(fallbackDraftForChat(second)?.fileInput).toEqual([])
        expect(other.shownDraft.messageInput).toBe('second')
    })

    test('reader phase and picker work both count until their own settle', async () => {
        expect(pendingChatFileUploads()).toBe(0)
        const settleReader = beginChatFileUpload()
        uploads.push(settleReader)
        expect(pendingChatFileUploads()).toBe(1)
        let finishPicker!: (value: string) => void
        const picker = trackChatFileUpload(() => new Promise<string>((resolve) => { finishPicker = resolve }))
        expect(pendingChatFileUploads()).toBe(2)
        settleReader()
        expect(pendingChatFileUploads()).toBe(1)
        finishPicker('done')
        await expect(picker).resolves.toBe('done')
        expect(pendingChatFileUploads()).toBe(0)
    })

    test('a rejected upload releases its count in finally', async () => {
        const failure = new Error('upload failed')
        const work = trackChatFileUpload(() => Promise.reject(failure))
        expect(pendingChatFileUploads()).toBe(1)
        await expect(work).rejects.toBe(failure)
        expect(pendingChatFileUploads()).toBe(0)
    })

    test('a reader error or abort releases its count once', () => {
        const settleError = beginChatFileUpload()
        const settleAbort = beginChatFileUpload()
        uploads.push(settleError, settleAbort)
        expect(pendingChatFileUploads()).toBe(2)
        settleError()
        settleError()
        expect(pendingChatFileUploads()).toBe(1)
        settleAbort()
        expect(pendingChatFileUploads()).toBe(0)
    })
})
