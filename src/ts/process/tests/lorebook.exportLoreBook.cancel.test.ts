// @vitest-environment happy-dom

/**
 * Closing the save picker of the lorebook export shows no success notice and no
 * error, and ends the busy handle. Runs the REAL `exportLoreBook`; the
 * `downloadFile` result is played by the mock (`false` is a cancelled picker).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: { characters: [] as unknown[], allowAllExtentionFiles: false },
    error: vi.fn(),
    normal: vi.fn(),
    download: vi.fn(),
    end: vi.fn(),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('../../alert', () => ({ alertError: h.error, alertNormal: h.normal }))
vi.mock('../../../lang', () => ({ language: { successExport: 'EXPORTED' } }))
vi.mock('../../exportNotice', () => ({ downloadNotice: (text: string) => text }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: h.download }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn(() => ({ end: h.end })) }))

import { exportLoreBook } from '../lorebook.svelte'

beforeEach(() => {
    h.error.mockClear()
    h.normal.mockClear()
    h.download.mockReset()
    h.end.mockClear()
    h.db.characters = [{ chatPage: 0, globalLore: [{ key: 'kept' }], chats: [{ localLore: [] }] }]
})

describe('exportLoreBook', () => {
    test('a cancelled picker shows no notice and no error and ends the busy handle', async () => {
        h.download.mockResolvedValue(false)

        await exportLoreBook('global')

        expect(h.download).toHaveBeenCalledTimes(1)
        expect(h.normal).not.toHaveBeenCalled()
        expect(h.error).not.toHaveBeenCalled()
        expect(h.end).toHaveBeenCalledTimes(1)
    })

    test('guard: a saved export shows the success notice once', async () => {
        h.download.mockResolvedValue(true)

        await exportLoreBook('global')

        expect(h.normal).toHaveBeenCalledTimes(1)
        expect(h.normal).toHaveBeenCalledWith('EXPORTED')
        expect(h.error).not.toHaveBeenCalled()
        expect(h.end).toHaveBeenCalledTimes(1)
    })
})
