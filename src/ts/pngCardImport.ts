import { WindowedReader, type ImportSource, type ImportSourceStat } from './importSource'
import { decodeBase64Bytes } from './base64Bytes'
import {
    PNG_CHUNK_OVERHEAD_BYTES,
    PNG_SIGNATURE_BYTES,
    PNG_TEXT_KEY_SCAN_BYTES,
    readTextChunkKey,
    type PngLayoutChunk,
} from './pngChunk'

/** The longest string a 64-bit V8 builds. A card value longer than this is refused before it is read. */
export const CARD_VALUE_MAX_BYTES = 0x1FFFFFE8

// A value shorter than this many characters does not stop a later chunk with the same key from replacing it.
const SHORT_VALUE_CHARS = 5 * 1024 * 1024

export const ASSET_KEY_PREFIX = 'chara-ext-asset_'

/** The card file is not the file the first pass saw, or it could not be read. */
export class PngCardSourceChanged extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause })
    }
}

/** A card value is longer than a string can be. */
export class PngCardValueTooLarge extends Error {}

const readUint32 = (bytes: Uint8Array, at: number) => bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 0x100 + bytes[at + 3]

const valueLength = (chunk: PngLayoutChunk) => chunk.length - chunk.valueStart

/** The key of an asset chunk as the card refers to it. */
export function assetIndexOfKey(key: string): string {
    return key.replace('chara-ext-asset_:', '').replace(ASSET_KEY_PREFIX, '')
}

/** The bytes of a keyed tEXt chunk's value. */
export async function readCardValue(source: ImportSource, chunk: PngLayoutChunk): Promise<Uint8Array> {
    const length = valueLength(chunk)
    if (length > CARD_VALUE_MAX_BYTES) {
        throw new PngCardValueTooLarge('the card value is too large to read')
    }
    const from = chunk.start + 8 + chunk.valueStart
    const value = await source.read(from, from + length)
    if (value.length !== length) {
        throw new PngCardSourceChanged('the card chunk is shorter than the first read found it')
    }
    return value
}

/** A value that decodes to no text: nothing, or only a byte order mark. */
export function isEmptyCardValue(value: Uint8Array): boolean {
    return value.length === 0 || (value.length === 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf)
}

async function isShortValue(source: ImportSource, chunk: PngLayoutChunk): Promise<boolean> {
    const length = valueLength(chunk)
    if (length < SHORT_VALUE_CHARS) {
        return true //a decoded text has no more characters than its bytes
    }
    if (length > CARD_VALUE_MAX_BYTES) {
        return false
    }
    return new TextDecoder().decode(await readCardValue(source, chunk)).length < SHORT_VALUE_CHARS
}

/**
 * The chunk with this key whose value the card is read from: the first one, and then each later one for as long as the
 * value kept so far has fewer than 5 Mi characters. A first value of 5 Mi characters or more is therefore never replaced.
 */
export async function selectCardChunk(source: ImportSource, chunks: PngLayoutChunk[], key: 'chara' | 'ccv3'): Promise<PngLayoutChunk | null> {
    let selected: PngLayoutChunk | null = null
    for (const chunk of chunks) {
        if (chunk.key !== key) {
            continue
        }
        if (selected === null || await isShortValue(source, selected)) {
            selected = chunk
        }
    }
    return selected
}

/** What the first pass saw of a card file, which the second pass checks the file against. */
export type PngCardLayout = {
    chunks: PngLayoutChunk[]
    imageBytes: number
    stat: ImportSourceStat
}

async function assertUnchanged(source: ImportSource, first: ImportSourceStat): Promise<void> {
    let now: ImportSourceStat
    try {
        now = await source.stat()
    } catch (error) {
        throw new PngCardSourceChanged('the card file could not be read', error)
    }
    if (now.size !== first.size || now.modified !== first.modified) {
        throw new PngCardSourceChanged('the card file changed')
    }
}

/**
 * The decoded bytes of one asset chunk, read from the source and checked against what the first pass saw. The base64
 * text is decoded straight from the bytes read, so no string of the whole asset exists, and the decoded asset is a copy
 * that does not refer to them. The bytes read may stay in the reader's window until its next load.
 */
async function readAssetChunk(chunk: PngLayoutChunk, read: (from: number, to: number) => Promise<Uint8Array>): Promise<Uint8Array> {
    const end = chunk.start + 8 + chunk.length
    const bytes = await read(chunk.start, end)
    checkTextHeader(bytes, chunk)
    return decodeBase64Bytes(bytes.subarray(8 + chunk.valueStart, 8 + chunk.length))
}

function mismatch(what: string): PngCardSourceChanged {
    return new PngCardSourceChanged(`the card file does not match its first read: ${what}`)
}

function checkHeader(bytes: Uint8Array, chunk: PngLayoutChunk) {
    if (readUint32(bytes, 0) !== chunk.length || new TextDecoder().decode(bytes.subarray(4, 8)) !== chunk.type) {
        throw mismatch(`chunk at ${chunk.start}`)
    }
}

function checkTextHeader(bytes: Uint8Array, chunk: PngLayoutChunk) {
    checkHeader(bytes, chunk)
    const found = readTextChunkKey(bytes.subarray(8, 8 + Math.min(chunk.length, PNG_TEXT_KEY_SCAN_BYTES)))
    if ((found?.key ?? null) !== chunk.key || (found?.valueStart ?? 0) !== chunk.valueStart) {
        throw mismatch(`key of the chunk at ${chunk.start}`)
    }
}

/**
 * Second pass over a card file: hands every asset chunk, decoded, to `onAsset` in file order, one at a time, and returns
 * the card's image (the signature and every chunk that is not tEXt, as the first pass counted them). Every chunk met is
 * checked against the first pass (offset, length, type and key) and so is the size and modification time of the source;
 * a difference, a short read or a read error throws PngCardSourceChanged. An error thrown by `onAsset` passes through.
 * The card chunks are never read here: the card the first pass validated is the card that is imported.
 */
export async function walkPngCard(
    source: ImportSource,
    layout: PngCardLayout,
    wantAssets: boolean,
    onAsset: (index: string, decoded: Uint8Array) => Promise<void>,
): Promise<Uint8Array> {
    await assertUnchanged(source, layout.stat)
    const reader = new WindowedReader(source, layout.stat.size)
    const read = async (from: number, to: number): Promise<Uint8Array> => {
        let bytes: Uint8Array
        try {
            bytes = await reader.read(from, to)
        } catch (error) {
            throw new PngCardSourceChanged('the card file could not be read', error)
        }
        if (bytes.length !== to - from) {
            throw mismatch(`short read at ${from}`)
        }
        return bytes
    }

    const image = new Uint8Array(layout.imageBytes)
    image.set(await read(0, PNG_SIGNATURE_BYTES), 0)
    let at = PNG_SIGNATURE_BYTES
    for (const chunk of layout.chunks) {
        if (chunk.type === 'tEXt') {
            if (wantAssets && chunk.key !== null && chunk.key.startsWith(ASSET_KEY_PREFIX)) {
                const decoded = await readAssetChunk(chunk, read)
                await onAsset(assetIndexOfKey(chunk.key), decoded)
            }
            else {
                checkTextHeader(await read(chunk.start, chunk.start + 8 + Math.min(chunk.length, PNG_TEXT_KEY_SCAN_BYTES)), chunk)
            }
            continue
        }
        //IEND ends the image with whatever of its body and CRC the file holds
        const end = chunk.type === 'IEND'
            ? Math.min(layout.stat.size, chunk.start + PNG_CHUNK_OVERHEAD_BYTES + chunk.length)
            : chunk.start + PNG_CHUNK_OVERHEAD_BYTES + chunk.length
        const bytes = await read(chunk.start, end)
        checkHeader(bytes, chunk)
        image.set(bytes, at)
        at += bytes.length
    }
    if (at !== image.length) {
        throw mismatch('image size')
    }
    return image
}
