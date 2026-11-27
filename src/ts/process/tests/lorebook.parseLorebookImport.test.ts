// @vitest-environment happy-dom

/**
 * `parseLorebookImport` is the one reader of a picked lorebook file shared by the classic import, the module editor
 * import and Studio. Files are made like the real producer (`lorebookExportBytes`) or in the external books' own shapes.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { Buffer } from 'buffer'
import crc32 from 'crc/crc32'
import golden from '../../studio/history/tests/fixtures/loreClassic.golden.json'

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => ({}),
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
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

import { convertExternalLorebook, parseLorebookImport } from '../lorebook.svelte'
import { NoLorebookInPng, lorebookExportBytes } from '../lorebookFile'

const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf-8'))

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

const novelAiBook = {
    lorebookVersion: 5,
    entries: [
        { text: 'BODY', keys: ['kw'], displayName: 'Entry', enabled: true, forceActivation: false,
            contextConfig: { prefix: '', suffix: '\n', budgetPriority: 400 } },
    ],
}

describe('parseLorebookImport', () => {
    test('a RisuAI export gives its data verbatim, non-objects included', () => {
        const list = golden.mixedRows.globalLore
        expect(list.some((row) => row === null || typeof row !== 'object')).toBe(true)
        const parsed = parseLorebookImport(lorebookExportBytes(list))
        expect(parsed).toEqual(list)
        expect(parsed).not.toBe(list)
    })

    test('an own __proto__ key and unknown keys survive the read', () => {
        const parsed = parseLorebookImport(bytes('{"type":"risu","data":[{"key":"k","__proto__":{"x":1},"extra":[1]}]}'))
        const row = parsed[0] as Record<string, unknown>
        expect(Object.prototype.hasOwnProperty.call(row, '__proto__')).toBe(true)
        expect(row.extra).toEqual([1])
    })

    test('an external book with entries equals convertExternalLorebook of those entries', () => {
        const book = { entries: { a: { key: ['k1'], comment: 'C', content: 'text', order: 5, constant: true } } }
        const parsed = parseLorebookImport(bytes(JSON.stringify(book)))
        expect(parsed).toEqual(convertExternalLorebook(book.entries as never))
        expect(parsed).toHaveLength(1)
    })

    test('a NovelAI lorebook PNG is read from its naidata chunk', () => {
        const png = syntheticPng([['naidata', Buffer.from(JSON.stringify(novelAiBook), 'utf-8').toString('base64')]])
        expect(parseLorebookImport(png)).toEqual([
            { key: 'kw', insertorder: 400, comment: 'Entry', content: 'BODY', mode: 'normal', alwaysActive: false, secondkey: '', selective: false },
        ])
    })

    test('a PNG without naidata throws NoLorebookInPng', () => {
        expect(() => parseLorebookImport(syntheticPng([]))).toThrow(NoLorebookInPng)
    })

    test('malformed JSON throws the parser SyntaxError', () => {
        expect(() => parseLorebookImport(bytes('{nope'))).toThrow(SyntaxError)
    })

    test('a JSON null throws the classic TypeError', () => {
        expect(() => parseLorebookImport(bytes('null'))).toThrow(TypeError)
    })

    test('JSON with neither branch gives an empty list', () => {
        expect(parseLorebookImport(bytes('{"type":"risu","data":null}'))).toEqual([])
        expect(parseLorebookImport(bytes('{"other":1}'))).toEqual([])
        expect(parseLorebookImport(bytes('[]'))).toEqual([])
    })
})
