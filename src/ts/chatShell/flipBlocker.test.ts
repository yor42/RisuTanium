// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { registerDraft, resetLocalDraftsForTest } from '../localDrafts'
import { resetComposerDraftsForTests, write } from '../process/composerDrafts.svelte'
import { beginChatFileUpload } from '../process/composerSurface.svelte'

const fixture = {
    db: { db: { characters: [{ chaId: 'char', chatPage: 0, chats: [{ id: 'chat' }] }] } },
    selection: { selId: 0 },
    busy: false,
    auto: false,
    writing: false,
}
const doingChat = writable(false)

vi.mock('../stores.svelte', () => ({ DBState: fixture.db, selIdState: fixture.selection }))
vi.mock('../process/index.svelte', () => ({ doingChat }))
vi.mock('../process/composerActions.svelte', () => ({
    isComposerBusy: () => fixture.busy,
    isAutoModeActive: () => fixture.auto,
}))
vi.mock('../process/chatOrigin', () => ({ isWriting: () => fixture.writing }))
vi.mock('../process/messageEditorController.svelte', () => ({ translationEditLoading: vi.fn(() => 0) }))

beforeEach(() => {
    fixture.db.db.characters[0].chats[0] = { id: 'chat' }
    doingChat.set(false)
    fixture.busy = false
    fixture.auto = false
    fixture.writing = false
    resetLocalDraftsForTest()
    resetComposerDraftsForTests()
})

describe('S0 flip blocker', () => {
    test('each clause returns its reason and the first match wins', async () => {
        const { shellFlipBlocker } = await import('./flipBlocker')
        expect(shellFlipBlocker()).toBeNull()
        fixture.writing = true
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedWorking')
        registerDraft('editor', 'message')
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedWorking')
        fixture.writing = false
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedEditing')
        resetLocalDraftsForTest()
        write({ chaId: 'char', chatId: 'chat' }, (record) => { record.fileInput = ['file'] })
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedAttachment')
        const settleUpload = beginChatFileUpload()
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedAttachment')
        resetComposerDraftsForTests()
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedUploading')
        settleUpload()
        expect(shellFlipBlocker()).toBeNull()
        fixture.busy = true
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedGenerating')
        fixture.busy = false
        fixture.auto = true
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedGenerating')
        fixture.auto = false
        doingChat.set(true)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedGenerating')
    })

    test('a registered message editor blocks the flip', async () => {
        const { shellFlipBlocker } = await import('./flipBlocker')
        registerDraft('message:current', 'message')
        expect(shellFlipBlocker()).toEqual({ kind: 'editing', reasonKey: 'chatShellFlipRefusedEditing' })
    })

    test('a translation load blocks while the controller reports work', async () => {
        const { shellFlipBlocker } = await import('./flipBlocker')
        const { translationEditLoading } = await import('../process/messageEditorController.svelte')
        vi.mocked(translationEditLoading).mockReturnValueOnce(1)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedEditing')
        expect(shellFlipBlocker()).toBeNull()
    })

})
