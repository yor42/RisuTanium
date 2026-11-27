// TC1 (compatibility guard, passes before and after the extraction): the per-entry migration against literal
// expectations, and the load-time `updateLorebooks` (now a map of it) behaving as before. Entries are the shape the
// classic `addLorebook` writes (no bookVersion) with the legacy fields set the way an old risu file carries them.
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../../stores.svelte', () => ({ DBState: { db: { characters: [] } }, selectedCharID: writable(0) }))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => ({ characters: [] }), defaultSdDataFunc: () => [] }))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: { errors: { noData: 'NO_DATA' } } }))
vi.mock('../../globalApi.svelte', () => ({
    downloadFile: vi.fn(), readImage: vi.fn(), AppendableBuffer: class {}, changeChatTo: vi.fn(), checkCharOrder: vi.fn(),
    getFileSrc: vi.fn(), pickedAssetLimitBytes: vi.fn(), requiresFullEncoderReload: vi.fn(),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../../process/modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../process/memory/busyActions', () => ({ beginBusy: vi.fn() }))

import type { loreBook } from '../../storage/database.svelte'
import { updateLorebooks } from '../../characters'
import { migrateLoreEntryToV2 } from '../loreEntryMigration'

function entry(overrides: Partial<loreBook> = {}): loreBook {
    return { key: '', comment: 'New Lore 1', content: 'text', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, ...overrides }
}

describe('migrateLoreEntryToV2', () => {
    test('a legacy probability becomes a first line and the field null; version 2 is stamped', () => {
        const migrated = migrateLoreEntryToV2(entry({ activationPercent: 40 }))
        expect(migrated).toMatchObject({ content: '@@probability 40\ntext', activationPercent: null, bookVersion: 2 })
    })

    test('the old end decorator and the angle-bracket names become the current forms', () => {
        const migrated = migrateLoreEntryToV2(entry({ content: '@@end\n@@@end <char> <bot> <user>' }))
        expect(migrated.content).toBe('@@depth 0\n@@depth 0 {{char}} {{char}} {{user}}')
    })

    test('an entry at version 2 or above is returned untouched', () => {
        const current = entry({ bookVersion: 2, activationPercent: 40, content: '<user>' })
        const same = migrateLoreEntryToV2(current)
        expect(same).toBe(current)
        expect(same).toMatchObject({ content: '<user>', activationPercent: 40 })
    })

    test('the entry is edited in place, as the load-time upgrade always did', () => {
        const old = entry({ content: '<user>' })
        expect(migrateLoreEntryToV2(old)).toBe(old)
        expect(old.bookVersion).toBe(2)
    })
})

describe('updateLorebooks', () => {
    test('maps every entry through the migration', () => {
        const book = [entry({ content: '<bot>' }), entry({ bookVersion: 2, content: '<bot>' }), entry({ activationPercent: 10 })]
        const out = updateLorebooks(book)
        expect(out.map((e) => e.content)).toEqual(['{{char}}', '<bot>', '@@probability 10\ntext'])
        expect(out.map((e) => e.bookVersion)).toEqual([2, 2, 2])
    })
})
