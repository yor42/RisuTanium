/**
 * Test helpers that read and rewrite the block container of a checksummed
 * RisuSave file (header version 1): parse it into blocks, change or remove a
 * block, and assemble the file again with valid checksums, or with one broken
 * on purpose. They touch bytes only; no decoder, store or cache is involved.
 */

export const FILE_HEADER_LENGTH = 9 // "RISUSAVE" plus the format version byte

export interface RawBlock {
    type: number
    compression: number
    name: string
    payload: Uint8Array
    /** The data checksum as stored in the parsed file; absent on a block built by hand. */
    storedDataChecksum?: number
}

const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c
    }
    return table
})()

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function u32le(value: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return out
}

function readU32le(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
}

export function parseBlocks(file: Uint8Array): RawBlock[] {
    const blocks: RawBlock[] = []
    let offset = FILE_HEADER_LENGTH
    while (offset < file.length) {
        const type = file[offset]
        const compression = file[offset + 1]
        const nameLength = file[offset + 2]
        const name = new TextDecoder().decode(file.subarray(offset + 3, offset + 3 + nameLength))
        offset += 3 + nameLength
        const length = readU32le(file, offset)
        offset += 4 + 4 // length field, then the header checksum
        const payload = file.slice(offset, offset + length)
        const storedDataChecksum = readU32le(file, offset + length)
        offset += length + 4 // payload, then the data checksum
        blocks.push({ type, compression, name, payload, storedDataChecksum })
    }
    return blocks
}

function serializeBlock(block: RawBlock): Uint8Array {
    const nameBytes = new TextEncoder().encode(block.name)
    const header = new Uint8Array(3 + nameBytes.length + 4)
    header.set([block.type, block.compression, nameBytes.length], 0)
    header.set(nameBytes, 3)
    header.set(u32le(block.payload.length), 3 + nameBytes.length)
    const dataChecksum = block.storedDataChecksum ?? crc32(block.payload)
    const out = new Uint8Array(header.length + 4 + block.payload.length + 4)
    out.set(header, 0)
    out.set(u32le(crc32(header)), header.length)
    out.set(block.payload, header.length + 4)
    out.set(u32le(dataChecksum), header.length + 4 + block.payload.length)
    return out
}

export function assemble(file: Uint8Array, blocks: RawBlock[]): Uint8Array {
    const parts = blocks.map((block) => serializeBlock(block))
    const total = FILE_HEADER_LENGTH + parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    out.set(file.subarray(0, FILE_HEADER_LENGTH), 0)
    let offset = FILE_HEADER_LENGTH
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function findBlock(blocks: RawBlock[], name: string): RawBlock {
    const target = blocks.find((block) => block.name === name)
    if (!target) {
        throw new Error(`block ${name} is not in the file`)
    }
    return target
}

export function replacePayload(file: Uint8Array, name: string, payload: Uint8Array): Uint8Array {
    const blocks = parseBlocks(file)
    const target = findBlock(blocks, name)
    target.payload = payload
    target.compression = 0
    target.storedDataChecksum = undefined
    return assemble(file, blocks)
}

/**
 * Returns a file in which the block's payload does not match its stored data checksum; its framing is
 * intact. A checksum already broken in `file` stays broken, so damage composes.
 */
export function breakDataChecksum(file: Uint8Array, name: string): Uint8Array {
    const blocks = parseBlocks(file)
    const target = findBlock(blocks, name)
    target.storedDataChecksum = (crc32(target.payload) ^ 0xffffffff) >>> 0
    return assemble(file, blocks)
}

export function retypeBlock(file: Uint8Array, name: string, type: number): Uint8Array {
    const blocks = parseBlocks(file)
    findBlock(blocks, name).type = type
    return assemble(file, blocks)
}

/** Removes the block and leaves the root block's directory listing it. */
export function removeBlock(file: Uint8Array, name: string): Uint8Array {
    const blocks = parseBlocks(file)
    findBlock(blocks, name)
    return assemble(file, blocks.filter((block) => block.name !== name))
}

/** Removes the block and its entry in the root block's directory, so the file stays consistent. */
export function removeBlockAndDirectoryEntry(file: Uint8Array, name: string): Uint8Array {
    const blocks = parseBlocks(file)
    findBlock(blocks, name)
    const root = findBlock(blocks, 'root')
    const rootData = JSON.parse(new TextDecoder().decode(root.payload)) as { __directory?: string[] }
    rootData.__directory = (rootData.__directory ?? []).filter((entry) => entry !== name)
    root.payload = new TextEncoder().encode(JSON.stringify(rootData))
    root.compression = 0
    root.storedDataChecksum = undefined
    return assemble(file, blocks.filter((block) => block.name !== name))
}

/** The names the root block's directory lists, in order. */
export function directoryOf(file: Uint8Array): string[] {
    const root = findBlock(parseBlocks(file), 'root')
    const rootData = JSON.parse(new TextDecoder().decode(root.payload)) as { __directory?: string[] }
    return rootData.__directory ?? []
}
