import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import type { character, Chat } from '../storage/database.svelte'
import * as composerDrafts from './composerDrafts.svelte'
import { attachmentsForDraft, beginChatFileUpload, createComposerSurface, fallbackDraftForChat, pendingChatFileUploads, trackChatFileAttachment, trackChatFileUpload } from './composerSurface.svelte'

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

describe('attach progress state', () => {
    const keyA = { chaId: 'owner', chatId: 'a' }
    const keyB = { chaId: 'owner', chatId: 'b' }

    test('a report adds one entry, a second report updates it in place, and null removes it', async () => {
        let finish!: () => void
        let report!: (progress: { name: string, written: number, total: number } | null) => void
        const call = trackChatFileAttachment(keyA, (r) => new Promise<void>((resolve) => { report = r; finish = resolve }))
        try {
            expect(attachmentsForDraft(keyA)).toEqual([])
            report({ name: 'clip.mp4', written: 0, total: 10 })
            const first = attachmentsForDraft(keyA)
            expect(first.map((entry) => [entry.name, entry.written, entry.total])).toEqual([['clip.mp4', 0, 10]])
            report({ name: 'clip.mp4', written: 4, total: 10 })
            const second = attachmentsForDraft(keyA)
            expect(second.length).toBe(1)
            expect(second[0].token).toBe(first[0].token)
            expect(second[0].written).toBe(4)
            report(null)
            expect(attachmentsForDraft(keyA)).toEqual([])
        }
        finally {
            finish()
            await call
        }
    })

    test('a report made after the call settled does not bring a chip back', async () => {
        let report!: (progress: { name: string, written: number, total: number } | null) => void
        await trackChatFileAttachment(keyA, async (r) => { report = r })
        report({ name: 'late.mp4', written: 1, total: 2 })
        expect(attachmentsForDraft(keyA)).toEqual([])
    })

    test('a rejected work removes the entry and rethrows the same error', async () => {
        const failure = new Error('write failed')
        const call = trackChatFileAttachment(keyA, async (report) => {
            report({ name: 'clip.mp4', written: 1, total: 2 })
            expect(attachmentsForDraft(keyA).length).toBe(1)
            throw failure
        })
        await expect(call).rejects.toBe(failure)
        expect(attachmentsForDraft(keyA)).toEqual([])
    })

    test('an entry is returned only for its own draft key, and a null-key entry only for null', async () => {
        let finish!: () => void
        const call = trackChatFileAttachment(keyA, async (report) => {
            report({ name: 'a.mp4', written: 1, total: 2 })
            await new Promise<void>((resolve) => { finish = resolve })
        })
        let finishNull!: () => void
        const nullCall = trackChatFileAttachment(null, async (report) => {
            report({ name: 'n.mp4', written: 1, total: 2 })
            await new Promise<void>((resolve) => { finishNull = resolve })
        })
        try {
            expect(attachmentsForDraft({ ...keyA }).map((entry) => entry.name)).toEqual(['a.mp4'])
            expect(attachmentsForDraft(keyB)).toEqual([])
            expect(attachmentsForDraft(null).map((entry) => entry.name)).toEqual(['n.mp4'])
        }
        finally {
            finish()
            finishNull()
            await Promise.all([call, nullCall])
        }
    })
})
