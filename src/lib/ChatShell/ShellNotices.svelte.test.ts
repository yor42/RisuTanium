// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state({ db: { characters: [{ chaId: 'c', type: 'character', chatPage: 0, removedQuotes: true, creatorNotes: '', chats: [{ id: 'chat-1', message: [] as { data: string }[] }] }] } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false) }))
// Whether work is registered in the shown chat; the global flag below stands for a reply written elsewhere.
const work = $state({ shown: false })
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusyIn: vi.fn(() => work.shown) }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: vi.fn(() => false) }))
vi.mock('../../ts/process/coldstorage.svelte', () => ({ coldStorageHeader: 'COLD:', preLoadChat: vi.fn(async () => ''), retryLegacyColdChatLoad: vi.fn(async () => true) }))
vi.mock('../../ts/process/coldstorageData', () => ({
    coldChatNoticeText: vi.fn(() => 'Cold chat'),
    matchColdStorageLoadErrorKey: vi.fn((data: string | undefined) => data?.startsWith('ERROR:') ? 'error' : null),
    legacyRetryStateFor: vi.fn(() => 'retryFailed'),
    legacyRetryView: vi.fn(() => ({ text: 'Cold load failed', detail: 'Retry available', showRetry: true })),
}))
vi.mock('../../ts/storage/pageStorageMode', () => ({ getPageStorageMode: () => ({ kind: 'store2' }) }))
vi.mock('../../lang', () => ({ language: { loadingChatData: 'Loading chat', aiGenerationWarning: 'AI warning', errors: { coldStorageLegacyChatRetryButton: 'Retry' } } }))
vi.mock('../ChatScreens/CreatorQuote.svelte', () => ({ default: () => ({}) }))

describe('ShellNotices', () => {
    beforeEach(async () => {
        const { DBState } = await import('../../ts/stores.svelte')
        DBState.db.characters[0].chats[0].message = []
        vi.mocked((await import('../../ts/globalApi.svelte')).aiLawApplies).mockReturnValue(false)
    })

    test('shows the legal warning only when the law applies to an empty chat', async () => {
        const { default: ShellNotices } = await import('./ShellNotices.svelte')
        const law = vi.mocked((await import('../../ts/globalApi.svelte')).aiLawApplies)
        const target = document.createElement('div')
        const app = mount(ShellNotices, { target })
        flushSync()
        expect(target.querySelector('[data-part="chat-ai-law-notice"]')).toBeNull()
        law.mockReturnValue(true)
        const { DBState } = await import('../../ts/stores.svelte')
        DBState.db.characters[0].chats[0].message = []
        flushSync()
        expect(target.querySelector('[data-part="chat-ai-law-notice"]')?.textContent).toBe('AI warning')
        await unmount(app)
    })

    test('Retry starts the legacy cold loader', async () => {
        const { DBState } = await import('../../ts/stores.svelte')
        DBState.db.characters[0].chats[0].message = [{ role: 'char', data: 'ERROR:old' }]
        const { default: ShellNotices } = await import('./ShellNotices.svelte')
        const target = document.createElement('div')
        const app = mount(ShellNotices, { target })
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-part="chat-legacy-cold-notice"] button')?.click()
        await tick()
        expect((await import('../../ts/process/coldstorage.svelte')).retryLegacyColdChatLoad).toHaveBeenCalledWith(0, 0)
        await unmount(app)
    })

    test('T16: a reply written in another chat does not disable Retry; work in the shown chat does', async () => {
        const { DBState } = await import('../../ts/stores.svelte')
        const { doingChat } = await import('../../ts/process/index.svelte')
        DBState.db.characters[0].chats[0].message = [{ role: 'char', data: 'ERROR:old' }]
        const { default: ShellNotices } = await import('./ShellNotices.svelte')
        const target = document.createElement('div')
        const app = mount(ShellNotices, { target })
        const retry = () => target.querySelector<HTMLButtonElement>('[data-part="chat-legacy-cold-notice"] button')!
        flushSync()
        doingChat.set(true)
        flushSync()
        expect(retry().disabled).toBe(false)

        work.shown = true
        flushSync()
        expect(retry().disabled).toBe(true)
        work.shown = false
        doingChat.set(false)
        await unmount(app)
    })
})
