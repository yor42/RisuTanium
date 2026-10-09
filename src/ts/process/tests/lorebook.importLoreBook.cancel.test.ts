// @vitest-environment happy-dom

/**
 * Closing the file chooser of the lorebook import without choosing a file
 * leaves the lorebook as it was and shows no error. Runs the REAL
 * `importLoreBook` over the REAL `selectSingleFile`; the chooser is played by
 * `util.domPickerHarness.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { installDomPicker, settledWithin, type DomPicker } from '../../util.domPickerHarness'

const h = vi.hoisted(() => ({
    db: { characters: [] as unknown[], allowAllExtentionFiles: false },
    error: vi.fn(),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('../../alert', () => ({ alertError: h.error, alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { importLoreBook } from '../lorebook.svelte'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    h.error.mockClear()
    h.db.characters = [{ chatPage: 0, globalLore: [{ key: 'kept' }], chats: [{ localLore: [] }] }]
})

afterEach(() => {
    picker.restore()
})

describe('importLoreBook', () => {
    test('closing the chooser resolves, leaves the lorebook alone and shows no error', async () => {
        const pending = importLoreBook('global')

        picker.cancel()

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(h.error).not.toHaveBeenCalled()
        expect((h.db.characters[0] as { globalLore: unknown[] }).globalLore).toEqual([{ key: 'kept' }])
    })

    test('guard: a chosen lorebook export is appended', async () => {
        const pending = importLoreBook('global')

        picker.pick([new File([JSON.stringify({ type: 'risu', data: [{ key: 'new' }] })], 'l.json')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect((h.db.characters[0] as { globalLore: unknown[] }).globalLore).toEqual([{ key: 'kept' }, { key: 'new' }])
    })
})
