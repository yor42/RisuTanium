import { Buffer } from 'buffer'
import { PngChunk } from '../pngChunk'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG picked as a lorebook carries no NovelAI `naidata` chunk. */
export class NoLorebookInPng extends Error {
    constructor() {
        super('The PNG holds no NovelAI lorebook')
        this.name = 'NoLorebookInPng'
    }
}

function isPng(data: Uint8Array): boolean {
    return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => data[i] === byte)
}

/**
 * The parsed JSON of a picked lorebook file. A PNG is a NovelAI lorebook
 * image: its `naidata` tEXt chunk holds the lorebook JSON in base64, which
 * then goes through the same branches as a NovelAI `.lorebook` file. A PNG
 * without that chunk throws NoLorebookInPng; any other file is parsed as
 * UTF-8 JSON and a malformed one throws the parser's SyntaxError.
 */
export function readLorebookFileJson(data: Uint8Array): unknown {
    if (isPng(data)) {
        const naidata = PngChunk.read(data, ['naidata']).naidata
        if (!naidata) {
            throw new NoLorebookInPng()
        }
        return JSON.parse(Buffer.from(naidata, 'base64').toString('utf-8'))
    }
    return JSON.parse(Buffer.from(data).toString('utf-8'))
}
