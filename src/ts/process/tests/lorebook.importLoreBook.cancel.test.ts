// @vitest-environment happy-dom

/**
 * Closing the file chooser of the lorebook import without choosing a file
 * leaves the lorebook as it was and shows no error, and a picked NovelAI
 * lorebook PNG is read from its naidata chunk. Runs the REAL
 * `importLoreBook` over the REAL `selectSingleFile`; the chooser is played by
 * `util.domPickerHarness.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { Buffer } from 'buffer'
import crc32 from 'crc/crc32'
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
vi.mock('../../../lang', () => ({ language: { errors: { noData: 'NO_DATA' } } }))
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

// A synthetic PNG (signature, IHDR, IDAT, optional tEXt chunks, IEND) with real CRCs.
function syntheticPng(texts: [string, string][]): Uint8Array<ArrayBuffer> {
    const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]
    const chunk = (type: string, body: Uint8Array) => {
        const out = new Uint8Array(12 + body.length)
        const view = new DataView(out.buffer)
        view.setUint32(0, body.length)
        out.set(Buffer.from(type, 'latin1'), 4)
        out.set(body, 8)
        view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length) as Buffer))
        parts.push(out)
    }
    chunk('IHDR', new Uint8Array(13).fill(1))
    chunk('IDAT', new Uint8Array(20).fill(7))
    for (const [key, value] of texts) {
        chunk('tEXt', Buffer.from(key + '\0' + value, 'latin1'))
    }
    chunk('IEND', new Uint8Array(0))
    return new Uint8Array(Buffer.concat(parts))
}

// A NovelAI lorebook in its own shape: an entries array with text, keys and contextConfig.
const novelAiBook = {
    lorebookVersion: 5,
    entries: [
        { text: 'BODY', keys: ['kw'], displayName: 'Entry', enabled: true, forceActivation: false,
            contextConfig: { prefix: '', suffix: '\n', budgetPriority: 400 } },
    ],
}

describe('importLoreBook: NovelAI lorebook PNG', () => {
    test('reproducer: the naidata chunk of a picked PNG is imported as a NovelAI lorebook', async () => {
        const png = syntheticPng([['naidata', Buffer.from(JSON.stringify(novelAiBook), 'utf-8').toString('base64')]])
        const pending = importLoreBook('global')

        picker.pick([new File([png], 'book.png', { type: 'image/png' })])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(h.error).not.toHaveBeenCalled()
        expect((h.db.characters[0] as { globalLore: unknown[] }).globalLore).toEqual([
            { key: 'kept' },
            { key: 'kw', insertorder: 400, comment: 'Entry', content: 'BODY', mode: 'normal', alwaysActive: false, secondkey: '', selective: false },
        ])
    })

    test('reproducer: a PNG without naidata shows the no-data error and leaves the lorebook alone', async () => {
        const png = syntheticPng([['chara', Buffer.from('{}').toString('base64')]])
        const pending = importLoreBook('global')

        picker.pick([new File([png], 'card.png', { type: 'image/png' })])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(h.error).toHaveBeenCalledWith('NO_DATA')
        expect((h.db.characters[0] as { globalLore: unknown[] }).globalLore).toEqual([{ key: 'kept' }])
    })

    test('guard (passes before and after): a NovelAI .lorebook JSON file still imports', async () => {
        const pending = importLoreBook('global')

        picker.pick([new File([JSON.stringify(novelAiBook)], 'book.lorebook')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect((h.db.characters[0] as { globalLore: unknown[] }).globalLore).toHaveLength(2)
    })
})
