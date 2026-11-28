// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DBState, selectedCharID, selIdState } from '../stores.svelte'
import { makeDb, startMiniPage } from '../storage/tests/dbWriteMarksMiniPage.svelte'

// The parser's module-level effect reads selIdState while the stores module is still initialising; this suite never parses.
vi.mock('../parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('../parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))
vi.mock('./modules', () => ({ refreshModules: () => {}, moduleUpdate: () => {}, ensureSelectedModules: () => {}, exportModule: async () => {}, exportModuleLegacy: async () => {} }))

import { giveModuleCopyOwnId } from './moduleListOps'

// Class G (compatibility guard): giving a later copy its own id must reach the module save mark at the write, because
// the save writes the module block only when `tracker.modules` is set. The slot assignment is the write that marks.

let page: ReturnType<typeof startMiniPage>

function seedModules() {
    const db = makeDb() as unknown as { modules: { id: string, name: string, description: string }[] }
    db.modules = [
        { id: 'X', name: 'first', description: '' },
        { id: 'X', name: 'copy', description: '' },
    ]
    DBState.db = db as never
}

beforeEach(() => {
    seedModules()
    selectedCharID.set(0)
    selIdState.selId = 0
    page = startMiniPage()
})

afterEach(() => {
    page.stop()
})

describe('giveModuleCopyOwnId: dirty tracking of the re-id', () => {
    it('sets tracker.modules and marks the page dirty at the write', () => {
        page.snapshot()
        expect(page.tracker.modules).toBe(false)
        const copy = DBState.db.modules[1]
        const made = giveModuleCopyOwnId(copy, () => 'Y')
        expect(made).not.toBeNull()
        expect(DBState.db.modules[1].id).toBe('Y')
        expect(DBState.db.modules[0].id).toBe('X')
        expect(copy.id).toBe('X')
        expect(made).not.toBe(copy)
        expect(page.tracker.modules).toBe(true)
        expect(page.dirty).toBe(true)
    })

    it('a refused re-id marks nothing', () => {
        page.snapshot()
        expect(giveModuleCopyOwnId(DBState.db.modules[0], () => 'Y')).toBeNull()
        expect(page.tracker.modules).toBe(false)
        expect(page.dirty).toBe(false)
    })
})
