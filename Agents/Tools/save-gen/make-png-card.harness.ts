/**
 * Acceptance harness of make-png-card.mjs. The cards it generates are read by the app's own PNG card reader
 * (PngChunk.scanCard, selectCardChunk, readCardValue and walkPngCard over an ImportSource of a Uint8Array) and checked by the
 * tool's independent verifier. The app modules are imported read-only.
 *
 * Run (the file name filter keeps every other harness out):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts make-png-card.harness.ts
 * Env PNG_CARD_GENERATOR: path of another copy of make-png-card.mjs, for mutant runs.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { importSourceOfBytes } from 'src/ts/importSource'
import { decodeBase64Bytes } from 'src/ts/base64Bytes'
import { PngChunk } from 'src/ts/pngChunk'
import { CARD_VALUE_MAX_BYTES, readCardValue, selectCardChunk, walkPngCard } from 'src/ts/pngCardImport'

type AssetEntry = { index: number, bytes: number, sha256: string }
type CardEntry = { bytes: number, assetCount: number, sha256: string, cardName: string, assets: AssetEntry[] }
type Generated = { file: string, buffer: Buffer, entry: CardEntry }
type Tool = {
    generate(arg: { seed: number, size: string }): { cards: Generated[], manifest: unknown }
    verifyPng(buffer: Buffer, expected?: CardEntry | null): { ok: boolean, problems: string[] }
}

const toolPath = process.env.PNG_CARD_GENERATOR ?? path.resolve(process.cwd(), 'Agents', 'Tools', 'save-gen', 'make-png-card.mjs')
// Node's own loader (require of an ES module, Node 22.12 or newer) reads the tool, so a mutant copy outside the repository loads too
const tool = createRequire(import.meta.url)(toolPath) as Tool

const sha256Hex = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const asBytes = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)

async function readWithAppReader(buffer: Buffer) {
    const source = importSourceOfBytes('card.png', asBytes(buffer))
    const scan = await PngChunk.scanCard(source, { layout: true })
    const chunks = scan.chunks ?? []
    const chunk = await selectCardChunk(source, chunks, 'ccv3')
    expect(chunk).not.toBeNull()
    const value = await readCardValue(source, chunk!)
    const card = JSON.parse(Buffer.from(decodeBase64Bytes(value)).toString('utf-8')) as { data: { name: string, assets: { uri: string }[] } }
    const assets = new Map<string, string>()
    const image = await walkPngCard(source, { chunks, imageBytes: scan.imageBytes ?? 0, stat: await source.stat() }, true, async (index, data) => {
        assets.set(index, sha256Hex(data))
    })
    return { scan, chunks, card, assets, image }
}

describe('make-png-card', () => {
    for (const [size, count] of [['small', 5], ['medium', 10], ['large', 12]] as const) {
        test(`${size}: the verifier is ok and the app reader returns the card and ${count} assets`, async () => {
            const { cards } = tool.generate({ seed: 5, size })
            expect(cards).toHaveLength(1)
            const { buffer, entry } = cards[0]
            const verdict = tool.verifyPng(buffer, entry)
            expect(verdict.problems).toEqual([])
            const read = await readWithAppReader(buffer)
            expect(read.scan.hasCardData && read.scan.iendReached && !read.scan.cut).toBe(true)
            expect(read.scan.assetCount).toBe(count)
            expect(read.card.data.name).toBe(entry.cardName)
            expect(read.card.data.assets.map(a => a.uri)).toEqual(entry.assets.map(a => `__asset:${a.index}`))
            expect([...read.assets.keys()]).toEqual(entry.assets.map(a => String(a.index)))
            for (const a of entry.assets) expect(read.assets.get(String(a.index))).toBe(a.sha256)
            expect(read.image.length).toBe(read.scan.imageBytes)
        }, 120000)
    }

    test('sizes: about 1, 20 and 60 MB, every value far below the card value limit, the largest below 70 MB', () => {
        const bytes = Object.fromEntries((['small', 'medium', 'large'] as const).map(size => [size, tool.generate({ seed: 5, size }).cards[0].buffer.length]))
        expect(bytes.small).toBeGreaterThan(900_000)
        expect(bytes.small).toBeLessThan(1_200_000)
        expect(bytes.medium).toBeGreaterThan(19_000_000)
        expect(bytes.medium).toBeLessThan(21_000_000)
        expect(bytes.large).toBeGreaterThan(55_000_000)
        expect(bytes.large).toBeLessThan(70_000_000)
        expect(bytes.large).toBeLessThan(64 * 1024 * 1024)
        expect(bytes.large).toBeLessThan(CARD_VALUE_MAX_BYTES)
    }, 120000)

    test('set5: five small cards with distinct card names, each read by the app reader', async () => {
        const { cards, manifest } = tool.generate({ seed: 5, size: 'set5' })
        expect(cards).toHaveLength(5)
        expect(new Set(cards.map(c => c.entry.cardName)).size).toBe(5)
        expect(new Set(cards.map(c => c.file)).size).toBe(5)
        expect((manifest as { cards: unknown[] }).cards).toHaveLength(5)
        for (const c of cards) {
            expect(tool.verifyPng(c.buffer, c.entry).problems).toEqual([])
            expect((await readWithAppReader(c.buffer)).card.data.name).toBe(c.entry.cardName)
        }
    })

    test('the same seed gives identical sha256, another seed differs', () => {
        const a = tool.generate({ seed: 5, size: 'small' }).cards[0]
        const b = tool.generate({ seed: 5, size: 'small' }).cards[0]
        const c = tool.generate({ seed: 6, size: 'small' }).cards[0]
        expect(sha256Hex(a.buffer)).toBe(sha256Hex(b.buffer))
        expect(a.entry.sha256).toBe(sha256Hex(a.buffer))
        expect(sha256Hex(c.buffer)).not.toBe(sha256Hex(a.buffer))
    })

    test('a bad CRC in an asset chunk is rejected by the verifier and by the app reader with CRC checking', async () => {
        const { buffer, entry } = tool.generate({ seed: 5, size: 'small' }).cards[0]
        expect(tool.verifyPng(buffer, entry).ok).toBe(true)
        const scan = await PngChunk.scanCard(asBytes(buffer), { layout: true })
        const asset = (scan.chunks ?? []).find(chunk => chunk.key !== null && chunk.key.startsWith('chara-ext-asset_'))!
        const broken = Buffer.from(buffer)
        broken[asset.start + 8 + asset.length + 3] ^= 0xFF
        const verdict = tool.verifyPng(broken, null)
        expect(verdict.ok).toBe(false)
        expect(verdict.problems.some(p => p.includes('crc mismatch'))).toBe(true)
        const walk = async () => { for await (const _item of PngChunk.readGenerator(asBytes(broken), { checkCrc: true })) { /* drain */ } }
        await expect(walk()).rejects.toThrow('crc check failed')
        const clean = async () => { for await (const _item of PngChunk.readGenerator(asBytes(buffer), { checkCrc: true })) { /* drain */ } }
        await expect(clean()).resolves.toBeUndefined()
    })

    test('a truncated file and an unknown key are named by the verifier', () => {
        const { buffer } = tool.generate({ seed: 5, size: 'small' }).cards[0]
        expect(tool.verifyPng(buffer.subarray(0, buffer.length - 20), null).ok).toBe(false)
        expect(tool.verifyPng(Buffer.concat([Buffer.from('not a png')]), null).ok).toBe(false)
    })
})
