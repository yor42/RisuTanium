// @vitest-environment happy-dom

/**
 * The tag manager's add and edit fields act on the Enter that follows a composition end (the tag is added, the
 * edit is saved). A composing Enter does nothing.
 *
 * Mounts the REAL `tag-manager-modal.svelte` over a real `$state` database. The Enter keydown is built like the
 * Samsung WebView sequence (MC-329): compositionend, then keydown Enter 13 with isComposing false. Only a live
 * composition (isComposing or keyCode 229) holds an Enter; there is no time window after compositionend. The gap
 * tests stub `performance.now` to place the Enter at +2 ms and +200 ms, so a guard that holds an Enter shortly
 * after compositionend fails them.
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import type { TagManagerState } from './types'
import TagManagerModal from './tag-manager-modal.svelte'

function installDb(tags: string[]): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat-0', name: '', message: [], note: '', localLore: [],
                hypaV3Data: { summaries: [{ text: 's0', chatMemos: [], isImportant: false, tags }], categories: [], lastSelectedSummaries: [] },
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

const tagsOf = () => DBState.db.characters[0].chats[0].hypaV3Data.summaries[0].tags ?? []

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountManager(editingTagIndex: number, editingTag: string): { target: HTMLElement, state: TagManagerState } {
    const state = $state<TagManagerState>({ isOpen: true, currentSummaryIndex: 0, editingTag, editingTagIndex })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(TagManagerModal, { target, props: { tagManagerState: state } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, state }
}

beforeEach(() => {
    resetBackHandlersForTests()
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    resetBackHandlersForTests()
})

describe('T-R-TagAdd the Enter that follows a composition end in the add field', () => {
    test.each([2, 200])('an Enter at +%s ms after compositionend adds the tag once', (gap) => {
        installDb([])
        const { target, state } = mountManager(-1, '')
        const field = target.querySelector<HTMLInputElement>('input')!
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, '간')
        flushSync()
        expect(state.editingTag).toBe('간')
        clock.mockReturnValue(1000 + gap)
        enterKeydown(field)
        flushSync()
        expect(tagsOf()).toEqual(['간'])
        expect(state.editingTag).toBe('')
    })

    test.each([
        ['isComposing', { isComposing: true }],
        ['keyCode 229', { keyCode: 229 }],
    ] as const)('guard: a composing Enter (%s) adds no tag and is not prevented', (_name, init) => {
        installDb([])
        const { target } = mountManager(-1, '')
        const field = target.querySelector<HTMLInputElement>('input')!
        imeEventSequence(field, '간')
        const composing = enterKeydown(field, init)
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(tagsOf()).toEqual([])
    })
})

describe('T-R-TagEdit the Enter that follows a composition end in the edit field', () => {
    test.each([2, 200])('an Enter at +%s ms after compositionend saves the edit once', (gap) => {
        installDb(['old'])
        const { target, state } = mountManager(0, 'old')
        const field = target.querySelectorAll<HTMLInputElement>('input')[1]
        expect(field).toBeDefined()
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, '간')
        flushSync()
        expect(state.editingTag).toBe('간')
        clock.mockReturnValue(1000 + gap)
        enterKeydown(field)
        flushSync()
        expect(tagsOf()).toEqual(['간'])
        expect(state.editingTagIndex).toBe(-1)
    })

    test.each([
        ['isComposing', { isComposing: true }],
        ['keyCode 229', { keyCode: 229 }],
    ] as const)('guard: a composing Enter (%s) saves no edit and is not prevented', (_name, init) => {
        installDb(['old'])
        const { target } = mountManager(0, 'old')
        const field = target.querySelectorAll<HTMLInputElement>('input')[1]
        imeEventSequence(field, '간')
        const composing = enterKeydown(field, init)
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(tagsOf()).toEqual(['old'])
    })
})
