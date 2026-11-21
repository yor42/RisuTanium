// @vitest-environment jsdom

/**
 * `bulk-edit-actions.svelte`: the category select has no visible label, so an sr-only span holding the existing
 * `hypaV3Modal.categoryFilter` text names it. Mounts the REAL component; only the store module is replaced, as in
 * `bulk.names.svelte.test.ts`.
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

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import BulkEditActions from './bulk-edit-actions.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

beforeEach(() => {
    DBState.db = {
        characters: [{ chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, chats: [{ id: 'chat-a', message: [], hypaV3Data: { summaries: [], categories: [] } }] }],
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const KNOWN_UNNAMED: string[] = []

describe('bulk-edit-actions value-control names', () => {
    test.each([[[]], [[0, 1]]])('regression reproducer: the category select (selected %j) is named by the category label', (selected: number[]) => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(BulkEditActions, {
            target,
            props: {
                bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>(selected), selectedCategory: '', bulkSelectInput: '' },
                categories: [{ id: '', name: 'none' }],
                showImportantOnly: false,
                selectedCategoryFilter: 'all',
                onResummarize: () => {},
                onClearSelection: () => {},
                onUpdateSelectedCategory: () => {},
                onUpdateBulkSelectInput: () => {},
                onApplyCategory: () => {},
                onToggleImportant: () => {},
                onParseAndSelectSummaries: () => {},
            },
        } as never) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        expect(fieldNameProblems(target, [{ name: language.hypaV3Modal.categoryFilter }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
