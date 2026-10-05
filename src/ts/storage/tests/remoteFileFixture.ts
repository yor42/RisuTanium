import { assemble, parseBlocks } from './risuSaveBlockFile'

/**
 * Test-only: rewrites the named character blocks of a block-format file as the
 * v2 remote pointers, and hands each character's payload to `writeRemote` under
 * its content-addressed `remotes/` key. The application writes no remote block,
 * so only a fixture can make one; a legacy main file that holds them is what the
 * REMOTE read path must still load, so the tests build one here.
 *
 * Characters must be uncompressed, as the encoder with `compression: false`
 * frames them. The file's other blocks are carried over unchanged.
 */
export async function withRemoteCharacters(
    file: Uint8Array,
    names: readonly string[],
    writeRemote: (key: string, bytes: Uint8Array) => void | Promise<void>,
): Promise<Uint8Array> {
    // Loaded when called: a suite that mocks the application's modules must not have the codec evaluated ahead of its mocks.
    const { hashRemoteBlockContent, RisuSaveType } = await import('../risuSave')
    const blocks = parseBlocks(file)
    for (const block of blocks) {
        if (!names.includes(block.name)) {
            continue
        }
        const hash = await hashRemoteBlockContent(block.payload)
        await writeRemote(`remotes/${block.name}.${hash}.bin`, block.payload)
        block.payload = new TextEncoder().encode(JSON.stringify({ v: 2, type: block.type, name: block.name, hash }))
        block.type = RisuSaveType.REMOTE
        block.compression = 0
        block.storedDataChecksum = undefined
    }
    return assemble(file, blocks)
}
