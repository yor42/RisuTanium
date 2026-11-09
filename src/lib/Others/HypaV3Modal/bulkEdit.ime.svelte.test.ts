// @vitest-environment happy-dom

/**
 * The bulk-edit number field applies the selection on the Enter that follows a composition end. A composing
 * Enter does nothing.
 *
 * Mounts the REAL `bulk-edit-actions.svelte`. The Enter keydown is built like the Samsung WebView sequence
 * (MC-329): compositionend, then keydown Enter 13 with isComposing false. Only a live composition (isComposing or
 * keyCode 229) holds an Enter; there is no time window after compositionend. The gap test stubs `performance.now`
 * to place the Enter at +2 ms and +200 ms, so a guard that holds an Enter shortly after compositionend fails it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import type { BulkEditState } from './types'
import BulkEditActions from './bulk-edit-actions.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountBar(parse: () => void): HTMLInputElement {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{ id: 'chat-0', name: '', message: [], note: '', localLore: [], hypaV3Data: { summaries: [], categories: [], lastSelectedSummaries: [] } }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
    const bulkEditState = $state<BulkEditState>({ isEnabled: true, selectedSummaries: new Set(), selectedCategory: '', bulkSelectInput: '' })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BulkEditActions, {
        target,
        props: {
            bulkEditState,
            categories: [],
            showImportantOnly: false,
            selectedCategoryFilter: '',
            onResummarize: () => {},
            onClearSelection: () => {},
            onUpdateSelectedCategory: () => {},
            onUpdateBulkSelectInput: (input: string) => { bulkEditState.bulkSelectInput = input },
            onApplyCategory: () => {},
            onToggleImportant: () => {},
            onParseAndSelectSummaries: parse,
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target.querySelector<HTMLInputElement>('input[placeholder="1,3,5-8"]')!
}

afterEach(async () => {
    vi.restoreAllMocks()
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('T-R-Bulk the Enter that follows a composition end', () => {
    test.each([2, 200])('an Enter at +%s ms after compositionend selects once', (gap) => {
        const parse = vi.fn()
        const field = mountBar(parse)
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, '1,3')
        flushSync()
        clock.mockReturnValue(1000 + gap)
        enterKeydown(field)
        flushSync()
        expect(parse).toHaveBeenCalledTimes(1)
    })

    test('guard: a composing Enter selects nothing and is not prevented', () => {
        const parse = vi.fn()
        const field = mountBar(parse)
        imeEventSequence(field, '1,3')
        const composing = enterKeydown(field, { isComposing: true, keyCode: 229 })
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(parse).not.toHaveBeenCalled()
    })
})
