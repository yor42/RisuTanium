// @vitest-environment jsdom

/**
 * Category Delete and tag Remove in the memory modal ask before they act (#818). Mounts the REAL
 * managers over a real `$state` database; only the stores module and the confirm dialog are replaced.
 * A declined confirm writes nothing; an accepted one removes exactly the confirmed row.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState: { selId: 0 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

const alertConfirm = vi.hoisted(() => vi.fn<(msg: string) => Promise<boolean>>())
vi.mock('src/ts/alert', () => ({ alertConfirm }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import CategoryManagerModal from './category-manager-modal.svelte'
import TagManagerModal from './tag-manager-modal.svelte'

function chatData() {
    return (DBState.db as unknown as { characters: { chats: { hypaV3Data: { summaries: { categoryId?: string, tags?: string[] }[], categories: { id: string, name: string }[] } }[] }[] })
        .characters[0].chats[0].hypaV3Data
}

function installDb(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [], message: [],
                hypaV3Data: {
                    summaries: [
                        { text: 's0', chatMemos: [], isImportant: false, categoryId: 'cat-a', tags: ['alpha', 'beta'] },
                        { text: 's1', chatMemos: [], isImportant: false },
                    ],
                    categories: [{ id: '', name: 'none' }, { id: 'cat-a', name: 'Alpha' }, { id: 'cat-b', name: 'Beta' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountManager(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const settle = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve(); flushSync() } }

function deleteButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll<HTMLButtonElement>(`button[aria-label="${language.uiCommon.delete}"]`))
}

beforeEach(() => {
    installDb()
    alertConfirm.mockReset()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('category Delete asks first', () => {
    function state() {
        const s = $state({ isOpen: true, editingCategory: null, selectedCategoryFilter: 'all' })
        return s
    }

    test('regression reproducer: nothing changes until the confirm is accepted, and a decline writes nothing', async () => {
        alertConfirm.mockResolvedValue(false)
        const target = mountManager(CategoryManagerModal, { categoryManagerState: state(), searchState: null })
        deleteButtons(target)[0].click()
        await settle()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertConfirm.mock.calls[0][0]).toContain('Alpha')
        expect(chatData().categories.map(c => c.id)).toEqual(['', 'cat-a', 'cat-b'])
        expect(chatData().summaries[0].categoryId).toBe('cat-a')
    })

    test('regression reproducer: an accepted confirm deletes that category and unclassifies its summaries', async () => {
        alertConfirm.mockResolvedValue(true)
        const target = mountManager(CategoryManagerModal, { categoryManagerState: state(), searchState: null })
        deleteButtons(target)[0].click()
        await settle()
        expect(chatData().categories.map(c => c.id)).toEqual(['', 'cat-b'])
        expect(chatData().summaries[0].categoryId).toBeUndefined()
    })

    test('the confirm is still pending: the delete has not happened yet', async () => {
        let answer: (v: boolean) => void = () => {}
        alertConfirm.mockReturnValue(new Promise<boolean>(r => { answer = r }))
        const target = mountManager(CategoryManagerModal, { categoryManagerState: state(), searchState: null })
        deleteButtons(target)[0].click()
        await settle()
        expect(chatData().categories).toHaveLength(3)
        answer(true)
        await settle()
        expect(chatData().categories).toHaveLength(2)
    })
})

describe('tag Remove asks first', () => {
    function state() {
        const s = $state({ isOpen: true, currentSummaryIndex: 0, editingTag: '', editingTagIndex: -1 })
        return s
    }

    test('regression reproducer: a declined confirm keeps the tag', async () => {
        alertConfirm.mockResolvedValue(false)
        const target = mountManager(TagManagerModal, { tagManagerState: state() })
        deleteButtons(target)[1].click()
        await settle()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertConfirm.mock.calls[0][0]).toContain('beta')
        expect(chatData().summaries[0].tags).toEqual(['alpha', 'beta'])
    })

    test('regression reproducer: an accepted confirm removes exactly the confirmed tag', async () => {
        alertConfirm.mockResolvedValue(true)
        const target = mountManager(TagManagerModal, { tagManagerState: state() })
        deleteButtons(target)[1].click()
        await settle()
        expect(chatData().summaries[0].tags).toEqual(['alpha'])
    })
})
