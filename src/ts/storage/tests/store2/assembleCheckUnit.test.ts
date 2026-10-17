// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import {
    assembleDatabase, checkUnit, chunkCountMismatch, CodecAssembleError,
    type EncodedTree, type EncodedUnit, type UnitSource,
} from 'src/ts/storage/store2/codec'
import {
    ASSET_REF_V, encodeFrame, encodeUnit, FRAME_HEADER_BYTES, FRAME_OVERHEAD, keyOfRef, refOfFrame, tailOfKey, UNIT_TYPE,
    type ChunkRef, type Ref, type UnitType,
} from 'src/ts/storage/store2/format'
import { buildSmall, encodeWith } from './codecFixtures'

/**
 * `checkUnit` (`codec/assemble.ts`): the one check every read of a unit passes, so assembly and boot-time detection
 * cannot disagree on what damaged means. Labels: new behaviour (the predicate and its non-throwing answers), guard (the
 * thrown messages of `readChecked` stay as they were).
 */

function treeOf(): EncodedTree {
    return encodeWith(buildSmall(2))
}

function unitOf(tree: EncodedTree, matches: (unit: EncodedUnit) => boolean): EncodedUnit {
    const unit = tree.units.find(matches)
    if (unit === undefined) {
        throw new Error('The fixture tree has no such unit.')
    }
    return unit
}

function sourceOf(tree: EncodedTree, replace: Map<string, Uint8Array | null> = new Map()): UnitSource {
    const bytes = new Map(tree.units.map(unit => [unit.key, unit.bytes] as const))
    for (const [key, value] of replace) {
        if (value === null) {
            bytes.delete(key)
        } else {
            bytes.set(key, value)
        }
    }
    return { get: key => bytes.get(key) }
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[at] ^= 0xff
    return out
}

function withHeader(bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array {
    const out = new Uint8Array(bytes)
    edit(out.subarray(0, 12))
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

const text = (value: string) => new TextEncoder().encode(value)

describe('new behaviour: checkUnit answers without throwing', () => {
    test('every unit of an intact tree checks ok against its own Ref and type', () => {
        const tree = treeOf()
        const source = sourceOf(tree)
        const bad = tree.units.filter(unit => unit.type !== UNIT_TYPE.manifest && checkUnit(source, unit.ref, unit.type).status !== 'ok')
        expect(bad.map(unit => unit.identity)).toEqual([])
    })

    test('an absent unit is missing', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        expect(checkUnit(sourceOf(tree, new Map([[unit.key, null]])), unit.ref, unit.type)).toEqual({ status: 'missing' })
    })

    test.each([
        ['a frame shorter than a frame header', (bytes: Uint8Array) => bytes.slice(0, FRAME_OVERHEAD - 5), true],
        ['a longer frame', (bytes: Uint8Array) => new Uint8Array([...bytes, 0]), true],
        ['a changed stored checksum', (bytes: Uint8Array) => flipped(bytes, bytes.length - 1), true],
        ['a flipped payload byte under an intact length and stored checksum', (bytes: Uint8Array) => flipped(bytes, FRAME_HEADER_BYTES + 1), false],
        ['a flipped magic byte', (bytes: Uint8Array) => flipped(bytes, 0), false],
        ['a flipped type byte', (bytes: Uint8Array) => flipped(bytes, 5), false],
        ['a flipped length field byte', (bytes: Uint8Array) => flipped(bytes, 8), false],
        ['a flipped header checksum byte', (bytes: Uint8Array) => flipped(bytes, 12), false],
        ['a valid frame of another unit type', (bytes: Uint8Array) => withHeader(bytes, header => { header[5] = UNIT_TYPE.scripts }), false],
    ])('%s is damaged (by the Ref: %s)', (_label, damage, byRef) => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        const checked = checkUnit(sourceOf(tree, new Map([[unit.key, damage(unit.bytes)]])), unit.ref, unit.type)
        expect(checked.status).toBe('damaged')
        expect(checked).toMatchObject({ byRef })
    })

    test('a valid frame whose payload is not UTF-8 JSON, under a Ref built from that very frame, is damaged', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        const forged = encodeFrame(UNIT_TYPE.characterCore, new Uint8Array([0xff, 0xfe, 0x00]))
        const checked = checkUnit(sourceOf(tree, new Map([[unit.key, forged]])), refOfFrame(unit.key, forged), unit.type)
        expect(checked).toMatchObject({ status: 'damaged', byRef: false })
    })

    test('a valid frame whose body has the wrong shape for its type is damaged', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.chatChunk)
        const forged = encodeFrame(UNIT_TYPE.chatChunk, text('[]'))
        const checked = checkUnit(sourceOf(tree, new Map([[unit.key, forged]])), refOfFrame(unit.key, forged), unit.type)
        expect(checked).toMatchObject({ status: 'damaged', byRef: false })
    })

    test('a frame a newer build wrote is too-new, whatever else is wrong with the unit', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        const newer = withHeader(unit.bytes, header => { header[4] = 9 })
        expect(checkUnit(sourceOf(tree, new Map([[unit.key, newer]])), unit.ref, unit.type).status).toBe('too-new')
    })

    test('a derived list above this build\'s version, with a frame, length and checksum that match its Ref, is a readable newer list', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.assetList)
        const newer = encodeUnit(UNIT_TYPE.assetList, { v: ASSET_REF_V + 1, h: '', l: [] })
        const ref = refOfFrame(unit.key, newer)
        const checked = checkUnit(sourceOf(tree, new Map([[unit.key, newer]])), ref, UNIT_TYPE.assetList)
        expect(checked.status).toBe('newer-list')
        expect(checked).not.toHaveProperty('body')
    })

    test.each([
        ['truncated', (bytes: Uint8Array) => bytes.slice(0, bytes.length - 1)],
        ['extended', (bytes: Uint8Array) => new Uint8Array([...bytes, 0])],
        ['checksum-damaged', (bytes: Uint8Array) => flipped(bytes, bytes.length - 1)],
    ])('a newer list that is %s fails its Ref first and is damaged, not a newer list', (_label, damage) => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.assetList)
        const newer = encodeUnit(UNIT_TYPE.assetList, { v: ASSET_REF_V + 1, h: '', l: [] })
        const ref = refOfFrame(unit.key, newer)
        expect(checkUnit(sourceOf(tree, new Map([[unit.key, damage(newer)]])), ref, UNIT_TYPE.assetList).status).toBe('damaged')
    })

    test('a chunk whose message count differs from the count its Ref holds is a mismatch; one that agrees is not', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.chatChunk)
        const checked = checkUnit(sourceOf(tree), unit.ref, unit.type)
        if (checked.status !== 'ok') {
            throw new Error('The fixture chunk does not check.')
        }
        const chunk = checked.body as { msgs: unknown[] } & Parameters<typeof chunkCountMismatch>[0]
        const right: ChunkRef = [unit.ref[0], unit.ref[1], unit.ref[2], chunk.msgs.length]
        expect(chunkCountMismatch(chunk, right)).toBe(false)
        const wrong: ChunkRef = [unit.ref[0], unit.ref[1], unit.ref[2], chunk.msgs.length + 1]
        expect(chunkCountMismatch(chunk, wrong)).toBe(true)
    })

    test('the tail of a Ref is the key without the store2 prefix, so the check reads the unit the Ref names', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.lore)
        expect(keyOfRef(unit.ref)).toBe(unit.key)
        expect(unit.ref[0]).toBe(tailOfKey(unit.key))
    })
})

describe('guard: assembly reads through the same check and keeps its messages', () => {
    function assemble(tree: EncodedTree, replace: Map<string, Uint8Array | null>) {
        return () => assembleDatabase(tree.manifest, sourceOf(tree, replace))
    }

    test('an intact tree assembles', () => {
        const tree = treeOf()
        expect(assemble(tree, new Map())).not.toThrow()
    })

    test('a missing unit still throws "is missing."', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        expect(assemble(tree, new Map([[unit.key, null]]))).toThrow(new RegExp(`unit ${unit.key} is missing\\.$`))
    })

    test('a unit that differs from its Ref still throws "does not match its Ref."', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        expect(assemble(tree, new Map([[unit.key, new Uint8Array([...unit.bytes, 0])]]))).toThrow(new RegExp(`unit ${unit.key} does not match its Ref\\.$`))
    })

    test('a flipped payload byte still throws "is damaged: <reason>"', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        expect(assemble(tree, new Map([[unit.key, flipped(unit.bytes, FRAME_HEADER_BYTES + 1)]]))).toThrow(`unit ${unit.key} is damaged: The payload checksum does not match.`)
    })

    test('a too-new unit still throws "is too-new: <reason>"', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        const newer = withHeader(unit.bytes, header => { header[4] = 9 })
        expect(assemble(tree, new Map([[unit.key, newer]]))).toThrow(`unit ${unit.key} is too-new: Frame format 9 is newer than this build.`)
    })

    test('a chunk whose message count disagrees with its Ref still throws the count message', () => {
        const tree = treeOf()
        const chunkUnit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.chatChunk)
        // Re-reference the chunk, in the shard that names it, with a count that is not the one it holds.
        for (const shard of tree.units.filter(candidate => candidate.type === UNIT_TYPE.shard)) {
            const body = JSON.parse(new TextDecoder().decode(shard.bytes.subarray(FRAME_HEADER_BYTES, shard.bytes.length - 4))) as {
                entries: { chats: { chunks: Ref[] }[] }[]
            }
            const target = body.entries.flatMap(entry => entry.chats.flatMap(chat => chat.chunks)).find(ref => ref[0] === chunkUnit.ref[0])
            if (target === undefined) {
                continue
            }
            target[3] = Number(target[3]) + 1
            const rewritten = encodeUnit(UNIT_TYPE.shard, body)
            const manifest = structuredClone(tree.manifest)
            manifest.shards = manifest.shards.map(ref => keyOfRef(ref) === shard.key ? refOfFrame(shard.key, rewritten) : ref)
            const read = () => assembleDatabase(manifest, sourceOf(tree, new Map([[shard.key, rewritten]])))
            expect(read).toThrow(/holds \d+ messages, its Ref says \d+\./)
            return
        }
        throw new Error('No fixture shard names the chunk.')
    })

    test('a frame shorter than a frame header throws a CodecAssembleError, never a RangeError', () => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === UNIT_TYPE.characterCore)
        const thrown = (() => {
            try {
                assemble(tree, new Map([[unit.key, unit.bytes.slice(0, 7)]]))()
            } catch (error) {
                return error
            }
            return null
        })()
        expect(thrown).toBeInstanceOf(CodecAssembleError)
        expect(thrown).not.toBeInstanceOf(RangeError)
    })

    test.each([
        ['character core', UNIT_TYPE.characterCore],
        ['lore', UNIT_TYPE.lore],
        ['chat core', UNIT_TYPE.chatCore],
        ['config', UNIT_TYPE.configRoot],
        ['order', UNIT_TYPE.order],
        ['module index', UNIT_TYPE.moduleIndex],
    ] as [string, UnitType][])('the check and assembly agree on a damaged %s', (_label, type) => {
        const tree = treeOf()
        const unit = unitOf(tree, candidate => candidate.type === type)
        const damaged = flipped(unit.bytes, FRAME_HEADER_BYTES + 1)
        const replace = new Map([[unit.key, damaged]])
        expect(checkUnit(sourceOf(tree, replace), unit.ref, unit.type).status).toBe('damaged')
        expect(assemble(tree, replace)).toThrow(CodecAssembleError)
    })
})
