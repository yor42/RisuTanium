// The text notes a PNG carries that the classic picture picker copies into a character's `extentions.pngExif`: the same
// allowlist and the same 20 000-character cap per note. Only a PNG has notes; anything else, and any file the reader
// cannot parse, gives none.

import { AppendableBuffer } from '../../byteBuffer'
import { getImageType } from '../../media/imageType'
import { PngChunk } from '../../pngChunk'

const ALLOWED_KEYS: readonly string[] = ['parameters', 'Comment', 'Title', 'Description', 'Author', 'Software', 'Source', 'Disclaimer', 'Warning', 'Copyright']
const MAX_NOTE_LENGTH = 20_000

// Each allowed key once: a key that appears twice keeps its last value, as the classic assignment does.
export async function readPortraitTextChunks(bytes: Uint8Array): Promise<Record<string, string>> {
    const notes: Record<string, string> = {}
    if (getImageType(bytes) !== 'PNG') {
        return notes
    }
    try {
        for await (const chunk of PngChunk.readGenerator(bytes)) {
            if (chunk instanceof AppendableBuffer || !chunk) {
                continue
            }
            if (chunk.value.length > MAX_NOTE_LENGTH || !ALLOWED_KEYS.includes(chunk.key)) {
                continue
            }
            notes[chunk.key] = chunk.value
        }
    } catch (error) {
        // A damaged file keeps the notes read before the damage; the picture itself is still stored.
        console.error(error)
    }
    return notes
}
