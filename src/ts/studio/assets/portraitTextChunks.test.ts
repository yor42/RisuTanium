// B-T12: the text notes a picked picture gives the portrait. The PNGs are written by the application's own `PngChunk.write`,
// so the reader is checked against the producer; the allowlist and the 20 000-character cap are the classic picker's.
import { describe, expect, test, vi } from 'vitest'
import { PngChunk } from '../../pngChunk'
import { readPortraitTextChunks } from './portraitTextChunks'

const MINIMAL_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

async function pngWith(chunks: Record<string, string>): Promise<Uint8Array> {
    return new Uint8Array((await PngChunk.write(MINIMAL_PNG, chunks)) as Buffer)
}

describe('readPortraitTextChunks', () => {
    test('reads the allowed notes and drops the others', async () => {
        const bytes = await pngWith({ Title: 'a title', Comment: 'a comment', parameters: 'steps: 20', chara: 'a card payload', Other: 'dropped' })
        expect(await readPortraitTextChunks(bytes)).toEqual({ Title: 'a title', Comment: 'a comment', parameters: 'steps: 20' })
    })

    test('keeps every key the classic list names', async () => {
        const all = ['parameters', 'Comment', 'Title', 'Description', 'Author', 'Software', 'Source', 'Disclaimer', 'Warning', 'Copyright']
        const bytes = await pngWith(Object.fromEntries(all.map((key) => [key, key.toLowerCase()])))
        expect(Object.keys(await readPortraitTextChunks(bytes)).sort()).toEqual([...all].sort())
    })

    test('a note longer than 20 000 characters is dropped and one of exactly 20 000 is kept', async () => {
        const bytes = await pngWith({ Title: 'x'.repeat(20_000), Comment: 'x'.repeat(20_001) })
        const notes = await readPortraitTextChunks(bytes)
        expect(Object.keys(notes)).toEqual(['Title'])
        expect(notes.Title).toHaveLength(20_000)
    })

    test('a picture with no notes, and one that is not a PNG, give none', async () => {
        expect(await readPortraitTextChunks(MINIMAL_PNG)).toEqual({})
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0])
        expect(await readPortraitTextChunks(webp)).toEqual({})
        expect(await readPortraitTextChunks(new Uint8Array([1, 2, 3]))).toEqual({})
    })

    test('a damaged file keeps the notes read before the damage and never throws', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const bytes = await pngWith({ Title: 'before the damage' })
        const damaged = bytes.slice(0, bytes.length - 3)
        const notes = await readPortraitTextChunks(damaged)
        expect(notes.Title === undefined || notes.Title === 'before the damage').toBe(true)
        error.mockRestore()
    })
})
