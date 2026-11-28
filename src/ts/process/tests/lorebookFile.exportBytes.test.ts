import { describe, expect, test } from 'vitest'
import { Buffer } from 'buffer'
import golden from '../../studio/history/tests/fixtures/loreClassic.golden.json'
import { lorebookExportBytes } from '../lorebookFile'

// Captured from the classic export expression before the extraction: the list sits verbatim under the envelope.
const CAPTURED = '{"type":"risu","ver":1,"data":[{"key":"a","content":"x","extra":{"loreCache":[1]}},null,"s",5,[],true]}'
const CAPTURED_LIST = [{ key: 'a', content: 'x', extra: { loreCache: [1] } }, null, 's', 5, [], true]

describe('lorebookExportBytes', () => {
    test('equals the bytes the classic export wrote, non-objects and unknown keys kept', () => {
        expect(Buffer.from(lorebookExportBytes(CAPTURED_LIST)).toString('utf-8')).toBe(CAPTURED)
    })

    test('the golden lists match the classic expression byte for byte', () => {
        for (const list of [golden.blank.globalLore, golden.mixedRows.globalLore, golden.folderWithId.globalLore]) {
            const classic = Buffer.from(JSON.stringify({ type: 'risu', ver: 1, data: list }), 'utf-8')
            expect(Buffer.from(lorebookExportBytes(list)).equals(classic)).toBe(true)
        }
    })

    test('keeps order and every row', () => {
        const list = golden.mixedRows.globalLore
        const parsed = JSON.parse(Buffer.from(lorebookExportBytes(list)).toString('utf-8'))
        expect(parsed.data).toEqual(list)
        expect(parsed.data).toHaveLength(list.length)
    })
})
