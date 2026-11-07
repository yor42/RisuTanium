// @vitest-environment node
/**
 * The unit check shared by the `.rtb` export (and, later, the restore): `checkFramedUnit` is the codec's own check plus the
 * outcomes it folds away. Frames are built with `encodeUnit`, as the producer builds them.
 *
 * Labels: "guard" tests the new contract of `rtb/unitCheck`; before the module exists its red run is the missing import
 * (diagnostic), and its mutant, not that red, is what falsifies it.
 */
import { describe, expect, test } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import {
    ASSET_REF_V, BODY_V, encodeFrame, encodeUnit, FRAME_FMT, IL_REF_V, MODULE_INDEX_V, newUnitKey, refOfFrame, UNIT_TYPE,
    type Ref, type UnitType,
} from 'src/ts/storage/store2/format'
import { checkFramedUnit, checkRtbManifestReq, classifyRtbUnit } from 'src/ts/storage/store2/rtb/unitCheck'
import { seededEnv } from './codecFixtures'

const env = seededEnv(41)

function framed(type: UnitType, body: object): { ref: Ref, bytes: Uint8Array } {
    const key = newUnitKey(env)
    const bytes = encodeUnit(type, body)
    return { ref: refOfFrame(key, bytes), bytes }
}

describe('checkFramedUnit (T3-10, guard)', () => {
    test('a unit that matches its Ref is ok and carries its body', () => {
        const { ref, bytes } = framed(UNIT_TYPE.preset, { v: 1, preset: { name: 'p' } })
        const checked = checkFramedUnit(ref, UNIT_TYPE.preset, bytes)
        expect(checked.status).toBe('ok')
        expect(checked.status === 'ok' && JSON.stringify(checked.body)).toContain('"name":"p"')
    })

    test('an absent unit is missing, whether the store answered null or nothing', () => {
        const { ref } = framed(UNIT_TYPE.preset, { v: 1, preset: {} })
        expect(checkFramedUnit(ref, UNIT_TYPE.preset, null)).toEqual({ status: 'missing' })
        expect(checkFramedUnit(ref, UNIT_TYPE.preset, undefined)).toEqual({ status: 'missing' })
    })

    test('a length or checksum that differs from the Ref is damaged, whichever one differs', () => {
        const { ref, bytes } = framed(UNIT_TYPE.preset, { v: 1, preset: { name: 'p' } })
        expect(checkFramedUnit([ref[0], ref[1] + 1, ref[2]], UNIT_TYPE.preset, bytes).status).toBe('damaged')
        expect(checkFramedUnit([ref[0], ref[1], ref[2] ^ 1], UNIT_TYPE.preset, bytes).status).toBe('damaged')
    })

    test('a frame of another type, and a frame cut short, are damaged', () => {
        const { ref, bytes } = framed(UNIT_TYPE.preset, { v: 1, preset: {} })
        expect(checkFramedUnit(ref, UNIT_TYPE.plugin, bytes).status).toBe('damaged')
        expect(checkFramedUnit(ref, UNIT_TYPE.preset, bytes.subarray(0, 10)).status).toBe('damaged')
    })

    test('a body above the format version is too-new, not damaged', () => {
        const { ref, bytes } = framed(UNIT_TYPE.shard, { v: 2, entries: [] })
        expect(checkFramedUnit(ref, UNIT_TYPE.shard, bytes).status).toBe('too-new')
    })

    test('a frame of a newer format is too-new, not damaged', () => {
        const key = newUnitKey(env)
        const bytes = encodeFrame(UNIT_TYPE.preset, new TextEncoder().encode('{"v":1,"preset":{}}'))
        const newer = new Uint8Array(bytes)
        newer[4] = 2
        new DataView(newer.buffer).setUint32(12, crc32(newer.subarray(0, 12)), true)
        const checked = checkFramedUnit(refOfFrame(key, newer), UNIT_TYPE.preset, newer)
        expect(checked.status).toBe('too-new')
    })

    test('a chat chunk or an alternatives unit whose item count differs from its Ref is damaged', () => {
        const chunk = framed(UNIT_TYPE.chatChunk, { v: 1, msgs: [{ role: 'user', data: 'a' }] })
        expect(checkFramedUnit([...chunk.ref, 1], UNIT_TYPE.chatChunk, chunk.bytes).status).toBe('ok')
        expect(checkFramedUnit([...chunk.ref, 2], UNIT_TYPE.chatChunk, chunk.bytes).status).toBe('damaged')
        const alt = framed(UNIT_TYPE.chatAlt, { v: 1, recs: [{ m: { role: 'char', data: 'x' }, p: null, a: 1 }] })
        expect(checkFramedUnit([...alt.ref, 1], UNIT_TYPE.chatAlt, alt.bytes).status).toBe('ok')
        expect(checkFramedUnit([...alt.ref, 3], UNIT_TYPE.chatAlt, alt.bytes).status).toBe('damaged')
    })

    test('a list below this build\'s version is stale-list, which the codec check calls ok', () => {
        const asset = framed(UNIT_TYPE.assetList, { v: 0, h: '', l: [] })
        expect(checkFramedUnit([...asset.ref, 0], UNIT_TYPE.assetList, asset.bytes).status).toBe('stale-list')
        const inlay = framed(UNIT_TYPE.inlayList, { v: 0, u: [], h: '', o: [] })
        expect(checkFramedUnit([...inlay.ref, 0], UNIT_TYPE.inlayList, inlay.bytes).status).toBe('stale-list')
        const current = framed(UNIT_TYPE.assetList, { v: 1, h: '', l: [] })
        expect(checkFramedUnit([...current.ref, 1], UNIT_TYPE.assetList, current.bytes).status).toBe('ok')
    })

    test('a list above this build\'s version is newer-list: readable tree data, neither damaged nor too-new', () => {
        const asset = framed(UNIT_TYPE.assetList, { v: 2, h: '', l: [] })
        expect(checkFramedUnit([...asset.ref, 2], UNIT_TYPE.assetList, asset.bytes).status).toBe('newer-list')
        const inlay = framed(UNIT_TYPE.inlayList, { v: 2, u: [], h: '', o: [] })
        expect(checkFramedUnit([...inlay.ref, 2], UNIT_TYPE.inlayList, inlay.bytes).status).toBe('newer-list')
    })
})

describe('classifyRtbUnit (T4-11, guard)', () => {
    test('a derived list above or below its version is accepted as unreadable, a current one is ok', () => {
        for (const [type, body] of [
            [UNIT_TYPE.assetList, { v: ASSET_REF_V + 1, h: '', l: [] }],
            [UNIT_TYPE.assetList, { v: 0, h: '', l: [] }],
            [UNIT_TYPE.inlayList, { v: IL_REF_V + 1, u: [], h: '', o: [] }],
            [UNIT_TYPE.inlayList, { v: 0, u: [], h: '', o: [] }],
        ] as [UnitType, object][]) {
            const unit = framed(type, body)
            expect(classifyRtbUnit([...unit.ref, 1], type, unit.bytes).status, JSON.stringify(body)).toBe('unreadable-list')
        }
        const current = framed(UNIT_TYPE.assetList, { v: ASSET_REF_V, h: '', l: [] })
        expect(classifyRtbUnit([...current.ref, ASSET_REF_V], UNIT_TYPE.assetList, current.bytes).status).toBe('ok')
    })

    test('a body above its version, a module index at v 3 and a frame of a newer format are newer', () => {
        const shard = framed(UNIT_TYPE.shard, { v: BODY_V + 1, entries: [] })
        expect(classifyRtbUnit(shard.ref, UNIT_TYPE.shard, shard.bytes).status).toBe('newer')
        const index = framed(UNIT_TYPE.moduleIndex, { v: MODULE_INDEX_V + 1, handles: [] })
        expect(classifyRtbUnit(index.ref, UNIT_TYPE.moduleIndex, index.bytes).status).toBe('newer')
        const current = framed(UNIT_TYPE.moduleIndex, { v: MODULE_INDEX_V, handles: [] })
        expect(classifyRtbUnit(current.ref, UNIT_TYPE.moduleIndex, current.bytes).status).toBe('ok')
        const newer = new Uint8Array(framed(UNIT_TYPE.preset, { v: 1, preset: {} }).bytes)
        newer[4] = FRAME_FMT + 1
        new DataView(newer.buffer).setUint32(12, crc32(newer.subarray(0, 12)), true)
        expect(classifyRtbUnit(refOfFrame(newUnitKey(env), newer), UNIT_TYPE.preset, newer).status).toBe('newer')
    })

    test('damage, an absent unit and a count that differs from the Ref keep their own outcomes', () => {
        const preset = framed(UNIT_TYPE.preset, { v: 1, preset: {} })
        expect(classifyRtbUnit(preset.ref, UNIT_TYPE.preset, null)).toEqual({ status: 'missing' })
        expect(classifyRtbUnit([preset.ref[0], preset.ref[1] + 1, preset.ref[2]], UNIT_TYPE.preset, preset.bytes).status).toBe('damaged')
        const chunk = framed(UNIT_TYPE.chatChunk, { v: 1, msgs: [{ role: 'user', data: 'a' }] })
        expect(classifyRtbUnit([...chunk.ref, 5], UNIT_TYPE.chatChunk, chunk.bytes).status).toBe('damaged')
    })
})

describe('checkRtbManifestReq (T4-11, guard)', () => {
    const frameOf = (body: object): Uint8Array => encodeFrame(UNIT_TYPE.manifest, new TextEncoder().encode(JSON.stringify(body)))

    test('a known req is returned', () => {
        expect(checkRtbManifestReq(frameOf({ fmt: 1, req: ['chat-alt', 'task-presets'] }))).toEqual({ status: 'ok', req: ['chat-alt', 'task-presets'] })
        expect(checkRtbManifestReq(frameOf({ fmt: 1, req: [] }))).toEqual({ status: 'ok', req: [] })
    })

    test('an unknown token is newer and the refusal names it', () => {
        const checked = checkRtbManifestReq(frameOf({ fmt: 1, req: ['chat-alt', 'future-feature'] }))
        expect(checked.status).toBe('newer')
        expect(checked.status === 'newer' && checked.token).toBe('future-feature')
        expect(checked.status === 'newer' && checked.reason).toContain('future-feature')
    })

    test('a manifest fmt above the frame format is newer without a token, and it is judged before req', () => {
        const checked = checkRtbManifestReq(frameOf({ fmt: FRAME_FMT + 1, req: ['future-feature'] }))
        expect(checked.status).toBe('newer')
        expect(checked.status === 'newer' && checked.token).toBeUndefined()
    })

    test('a frame of a newer format is newer', () => {
        const newer = new Uint8Array(frameOf({ fmt: 1, req: [] }))
        newer[4] = FRAME_FMT + 1
        new DataView(newer.buffer).setUint32(12, crc32(newer.subarray(0, 12)), true)
        expect(checkRtbManifestReq(newer).status).toBe('newer')
    })

    test('a bad frame, a frame of another type, a payload that is not JSON and a req that is not a list are damaged', () => {
        const good = frameOf({ fmt: 1, req: [] })
        expect(checkRtbManifestReq(good.subarray(0, 12)).status).toBe('damaged')
        const flipped = new Uint8Array(good)
        flipped[good.length - 6] ^= 0xff
        expect(checkRtbManifestReq(flipped).status).toBe('damaged')
        expect(checkRtbManifestReq(encodeFrame(UNIT_TYPE.preset, new TextEncoder().encode('{"fmt":1,"req":[]}'))).status).toBe('damaged')
        expect(checkRtbManifestReq(encodeFrame(UNIT_TYPE.manifest, new TextEncoder().encode('not json'))).status).toBe('damaged')
        expect(checkRtbManifestReq(frameOf({ fmt: 1, req: 'chat-alt' })).status).toBe('damaged')
        expect(checkRtbManifestReq(frameOf({ fmt: 1, req: [1] })).status).toBe('damaged')
        expect(checkRtbManifestReq(frameOf({ req: [] })).status).toBe('damaged')
    })
})
