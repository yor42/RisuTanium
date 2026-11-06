import { describe, expect, it } from 'vitest'
import {
    CARD_JSON_URI_PREFIX,
    buildCardJsonTemplate,
    streamCardJson,
    type CardJsonAssetEntry,
} from './cardJsonStream'

type TestCard = { data: { name: string, assets: CardJsonAssetEntry[] & Record<string, unknown>[] } }

const trickyName = 'a \uD800 "q" \\ \u0000   😀 한글 RISUJSONASSET0Z RISUJSONASSET1Z'

function makeCard(assetCount: number, name = trickyName): TestCard {
    const assets: Record<string, unknown>[] = []
    for (let i = 0; i < assetCount; i++) {
        assets.push({ type: 'x', name: 'n' + i + ' RISUJSONASSET' + i + 'Z 한글 😀', ext: 'png', uri: 'orig' + i })
    }
    return { data: { name, assets: assets as TestCard['data']['assets'] } }
}

function bytesFor(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = (i * 31 + seed * 7 + 5) & 255
    }
    return out
}

function expectedBytes(card: TestCard, slots: number[], assetBytes: Uint8Array[]): Buffer {
    const filled = structuredClone(card)
    slots.forEach((index, j) => {
        filled.data.assets[index].uri = CARD_JSON_URI_PREFIX + Buffer.from(assetBytes[j]).toString('base64')
    })
    return Buffer.from(JSON.stringify(filled, null, 4), 'utf-8')
}

async function runStream(card: TestCard, slots: number[], assetBytes: Uint8Array[], sliceBytes?: number) {
    const clone = structuredClone(card)
    const template = buildCardJsonTemplate(clone, clone.data.assets, slots)
    const chunks: Uint8Array[] = []
    await streamCardJson(
        template.pieces,
        async (slot) => assetBytes[slot],
        async (chunk) => { chunks.push(chunk) },
        sliceBytes
    )
    return { actual: Buffer.concat(chunks), chunks, template }
}

describe('cardJsonStream byte identity (S1t)', () => {
    it('matches the plain stringify for contiguous slots with unicode and placeholder-like text', async () => {
        const card = makeCard(3)
        const slots = [0, 1, 2]
        const assets = [bytesFor(10, 1), bytesFor(11, 2), bytesFor(12, 3)]
        const { actual } = await runStream(card, slots, assets)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
    })

    it('handles non-contiguous slots', async () => {
        const card = makeCard(4)
        const slots = [1, 3]
        const assets = [bytesFor(7, 4), bytesFor(5, 5)]
        const { actual } = await runStream(card, slots, assets)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
    })

    it('handles an asset entry that had no uri key', async () => {
        const card = makeCard(2)
        delete (card.data.assets[1] as Record<string, unknown>).uri
        const slots = [0, 1]
        const assets = [bytesFor(4, 1), bytesFor(4, 2)]
        const { actual } = await runStream(card, slots, assets)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
    })

    it('handles a zero-length asset', async () => {
        const card = makeCard(2)
        const slots = [0, 1]
        const assets = [new Uint8Array(0), bytesFor(9, 2)]
        const { actual } = await runStream(card, slots, assets)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
    })

    it('handles n = 0', async () => {
        const card = makeCard(2)
        const { actual, template } = await runStream(card, [], [])
        expect(template.pieces.length).toBe(1)
        expect(actual.equals(expectedBytes(card, [], []))).toBe(true)
    })

    it('handles assets that are not a multiple of 3 and exceed a small slice size', async () => {
        const card = makeCard(3)
        const slots = [0, 1, 2]
        const assets = [bytesFor(100, 1), bytesFor(101, 2), bytesFor(102, 3)]
        const { actual, chunks } = await runStream(card, slots, assets, 9)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
        expect(chunks.length).toBeGreaterThan(30)
    })
})

describe('cardJsonStream token selection (S2t)', () => {
    it('skips candidates whose token appears in user text and stays byte-identical', async () => {
        const name = 'RISUJSONASSET0Z RISUJSONASSET1Z RISUJSONASSET0Z'
        const card = makeCard(2, name)
        const slots = [0, 1]
        const assets = [bytesFor(5, 1), bytesFor(6, 2)]
        const { actual } = await runStream(card, slots, assets)
        expect(actual.equals(expectedBytes(card, slots, assets))).toBe(true)
        expect(JSON.stringify(card)).toContain('RISUJSONASSET0Z')
    })

    it('throws a clear error past the candidate cap', () => {
        let name = ''
        for (let c = 0; c <= 64; c++) {
            name += 'RISUJSONASSET' + c + 'Z '
        }
        const card = makeCard(1, name)
        const clone = structuredClone(card)
        expect(() => buildCardJsonTemplate(clone, clone.data.assets, [0]))
            .toThrow(/no collision-free placeholder token/)
    })

    it('honours an injected smaller cap', () => {
        const card = makeCard(1, 'RISUJSONASSET0Z RISUJSONASSET1Z')
        const clone = structuredClone(card)
        expect(() => buildCardJsonTemplate(clone, clone.data.assets, [0], 2))
            .toThrow(/no collision-free placeholder token/)
    })

    it('rejects the same object in two slots', () => {
        const shared: CardJsonAssetEntry = { uri: 'x' }
        const card = { data: { assets: [shared, shared] } }
        expect(() => buildCardJsonTemplate(card, card.data.assets, [0, 1]))
            .toThrow(/share the same asset object/)
    })

    it('throws on a placeholder order mismatch (digit-order check)', () => {
        // Distinct objects whose serialization ignores the assigned uri: counts match, digits do not.
        const make = (): CardJsonAssetEntry => ({
            uri: 'x',
            toJSON() {
                return { uri: CARD_JSON_URI_PREFIX + 'RISUJSONASSET0Z0_' }
            },
        } as CardJsonAssetEntry)
        const card = { data: { assets: [make(), make()] } }
        expect(() => buildCardJsonTemplate(card, card.data.assets, [0, 1]))
            .toThrow(/placeholder order mismatch/)
    })
})

describe('cardJsonStream escaping premise (S3t)', () => {
    it('leaves the base64 alphabet and the uri prefix unescaped', () => {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
        const text = CARD_JSON_URI_PREFIX + alphabet
        expect(JSON.stringify(text)).toBe('"' + text + '"')
    })
})

describe('cardJsonStream driver (S4t)', () => {
    it('asks for slot j+1 only after slot j and piece j+1 are written', async () => {
        const events: string[] = []
        const pieces = ['P0', 'P1', 'P2']
        await streamCardJson(
            pieces,
            async (slot) => {
                events.push('produce' + slot)
                return bytesFor(7, slot)
            },
            async (chunk) => { events.push('write:' + Buffer.from(chunk).toString('latin1').slice(0, 2)) },
            3
        )
        const iProduce1 = events.indexOf('produce1')
        expect(events.indexOf('write:P1')).toBeLessThan(iProduce1)
        expect(events.indexOf('write:P0')).toBeLessThan(events.indexOf('produce0'))
        expect(events.indexOf('produce0')).toBeLessThan(events.indexOf('write:P1'))
        expect(events[events.length - 1]).toBe('write:P2')
    })

    it('skips zero-length writes', async () => {
        const sizes: number[] = []
        await streamCardJson(
            ['', '', ''],
            async () => new Uint8Array(0),
            async (chunk) => { sizes.push(chunk.length) }
        )
        expect(sizes).toEqual([])
    })

    it('rejects a slice size that is not a multiple of 3', async () => {
        await expect(streamCardJson(['a'], async () => new Uint8Array(0), async () => {}, 4))
            .rejects.toThrow(/multiple of 3/)
    })
})
