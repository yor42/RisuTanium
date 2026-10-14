import { describe, expect, test } from 'vitest'
import type { JsonObject, JsonValue } from '../../blockFrame'
import {
    ASSET_REF_V, carryUnknownFields, commitKeyReq, emptyChatChunk, encodeUnit, IL_REF_V, KNOWN_FIELDS, parseAssetList,
    parseChatChunk, parseCommitKey, parseContentBody, parseFenceRecord, parseInlayList, parseLegacyList, parseManifest,
    parsePluginBucket, parseShard, parseSweepRecord, parseUnitBody, readUnit, reqIsSuperset, unionReq, UNIT_TYPE,
    type CommitKey, type UnitType,
} from '../../store2/format'
import { GOLDEN_VECTORS, hexToBytes, oracleFrame } from './goldenVectors'

const vectorBody = (id: string): JsonObject => {
    const vector = GOLDEN_VECTORS.find(candidate => candidate.id === id)
    if (!vector) {
        throw new Error(`No vector ${id}.`)
    }
    return JSON.parse(vector.payload) as JsonObject
}

const clone = (body: JsonObject): JsonObject => structuredClone(body)
const child = (parent: JsonObject, key: string): JsonObject => parent[key] as JsonObject
const item = (parent: JsonObject, key: string, index = 0): JsonObject => (parent[key] as JsonObject[])[index]

/** The JSON inside the bytes `encodeUnit` wrote, cut out by offset. */
function writtenBody(type: UnitType, body: object): JsonObject {
    const bytes = encodeUnit(type, body)
    return JSON.parse(new TextDecoder().decode(bytes.subarray(16, bytes.length - 4))) as JsonObject
}

function okValue<T>(parsed: { status: string, value?: T }): T {
    expect(parsed.status).toBe('ok')
    return parsed.value as T
}

const MARK = 'future'

describe('unknown fields survive parse and encode at every level', () => {
    test('commit key: top, current, retained, pins, staging', () => {
        const body = clone(vectorBody('commit-07-20-retained-2-pins'))
        body[MARK] = 1
        child(body, 'current')[MARK] = 2
        item(body, 'retained')[MARK] = 3
        item(body, 'pins')[MARK] = 4
        body.staging = { label: 'seed', owner: 'o', prefix: 'store2/g-0000000000000001-', startedAt: 1, [MARK]: 5 }
        const written = writtenBody(UNIT_TYPE.commit, okValue(parseCommitKey(body)))
        expect(written).toEqual(body)
    })

    test('manifest: top, fixed, pluginStorage, legacyKeep and its files', () => {
        const body = clone(vectorBody('type-02-manifest'))
        const fixed = child(body, 'fixed')
        fixed.legacyKeep = {
            unit: ['u-' + 'a'.repeat(26), 1, 1], v: 1, [MARK]: 1,
            files: [{ key: 'database/database.bin', status: 'gone', [MARK]: 2 }],
        }
        body[MARK] = 3
        fixed[MARK] = 4
        child(fixed, 'pluginStorage')[MARK] = 5
        const written = writtenBody(UNIT_TYPE.manifest, okValue(parseManifest(body)))
        expect(written).toEqual(body)
    })

    test('shard: top, entry, chat entry', () => {
        const body = clone(vectorBody('type-03-shard'))
        body[MARK] = 1
        item(body, 'entries')[MARK] = 2
        const entry = item(body, 'entries')
        item(entry, 'chats')[MARK] = 3
        const written = writtenBody(UNIT_TYPE.shard, okValue(parseShard(body)))
        expect(written).toEqual(body)
    })

    test('module index: top and entry', () => {
        const body = clone(vectorBody('type-10-module-index'))
        body[MARK] = 1
        item(body, 'entries')[MARK] = 2
        const parsed = parseUnitBody(UNIT_TYPE.moduleIndex, body)
        expect(parsed.status).toBe('ok')
        expect(writtenBody(UNIT_TYPE.moduleIndex, parsed.status === 'ok' ? parsed.value : {})).toEqual(body)
    })

    test('fence record: top, prior commits, prior fences', () => {
        const body = clone(vectorBody('fence-F5-exit-over-unparsable'))
        body[MARK] = 1
        item(body, 'priorCommits')[MARK] = 2
        item(body, 'priorFences')[MARK] = 3
        const written = writtenBody(UNIT_TYPE.fenceRecord, okValue(parseFenceRecord(body)))
        expect(written).toEqual(body)
    })

    test('derived lists, chat chunk, chat core, bucket and sweep record keep an unknown top-level field too', () => {
        for (const [type, id] of [[UNIT_TYPE.assetList, 'type-15-asset-list'], [UNIT_TYPE.inlayList, 'type-21-inlay-list'], [UNIT_TYPE.legacyList, 'type-20-legacy-list'],
            [UNIT_TYPE.chatChunk, 'type-08-chat-chunk'], [UNIT_TYPE.chatCore, 'type-07-chat-core'], [UNIT_TYPE.pluginStorageBucket, 'type-19-plugin-bucket'],
            [UNIT_TYPE.sweepRecord, 'type-22-sweep-record']] as const) {
            const body = clone(vectorBody(id))
            body[MARK] = 1
            const parsed = parseUnitBody(type, body)
            expect(parsed.status, id).toBe('ok')
            expect(writtenBody(type, parsed.status === 'ok' ? parsed.value : {}), id).toEqual(body)
        }
    })

    test('a writer that rebuilds from known fields only loses them; carryUnknownFields restores them', () => {
        const body = clone(vectorBody('commit-01-current-req-empty'))
        body[MARK] = { nested: [1] }
        const prev = okValue(parseCommitKey(body))
        const rebuilt: CommitKey = {
            fmt: 1, req: prev.req, seq: prev.seq + 1, epoch: prev.epoch, current: prev.current, retained: prev.retained,
            pins: prev.pins, staging: prev.staging, convertedFrom: prev.convertedFrom, convertedAt: prev.convertedAt,
        }
        expect(writtenBody(UNIT_TYPE.commit, rebuilt)[MARK]).toBeUndefined()
        const carried = carryUnknownFields(prev, rebuilt, KNOWN_FIELDS.commitKey)
        expect(writtenBody(UNIT_TYPE.commit, carried)[MARK]).toEqual({ nested: [1] })
        expect(carried.seq).toBe(prev.seq + 1)
    })

    test('carryUnknownFields never overrides a field the new object sets', () => {
        const next = carryUnknownFields({ a: 1, extra: 'old' }, { a: 2, extra: 'new' } as Record<string, JsonValue>, ['a'])
        expect(next).toEqual({ a: 2, extra: 'new' })
    })
})

describe('req and fmt', () => {
    test('an unknown req token is too-new for a commit key and a manifest', () => {
        const commit = clone(vectorBody('commit-01-current-req-empty'))
        commit.req = ['x']
        expect(parseCommitKey(commit).status).toBe('too-new')
        const manifest = clone(vectorBody('type-02-manifest'))
        manifest.req = ['cx']
        expect(parseManifest(manifest).status).toBe('too-new')
    })

    test('fmt above 1 is too-new before any other field is read', () => {
        expect(parseCommitKey({ fmt: 2 }).status).toBe('too-new')
        expect(parseManifest({ fmt: 2 }).status).toBe('too-new')
        expect(parseCommitKey({ fmt: 255, req: 'garbage' }).status).toBe('too-new')
    })

    test('an unknown req token is too-new even when later fields are malformed', () => {
        expect(parseCommitKey({ fmt: 1, req: ['x'], seq: 'bad' }).status).toBe('too-new')
    })

    test('fmt 0, a string fmt, a missing fmt and a malformed req are damaged', () => {
        expect(parseCommitKey({ fmt: 0 }).status).toBe('damaged')
        expect(parseCommitKey({ fmt: '1' }).status).toBe('damaged')
        expect(parseCommitKey({}).status).toBe('damaged')
        expect(parseCommitKey({ fmt: 1, req: 'x' }).status).toBe('damaged')
        expect(parseCommitKey({ fmt: 1, req: [1] }).status).toBe('damaged')
    })

    test('the union of req never shrinks and keeps tokens this build does not know', () => {
        expect(unionReq(['b'], ['a'], [])).toEqual(['a', 'b'])
        expect(unionReq(['a', 'a'], ['a'])).toEqual(['a'])
        expect(unionReq(['zzz-future'], [])).toEqual(['zzz-future'])
        const own = ['a']
        const merged = unionReq(own, ['b'], ['c'])
        expect(reqIsSuperset(merged, own)).toBe(true)
        expect(reqIsSuperset(merged, ['b'])).toBe(true)
        expect(reqIsSuperset(own, merged)).toBe(false)
    })

    test('a commit key req covers its own needs and every named manifest req', () => {
        expect(commitKeyReq(['a'], [{ req: ['b'] }, { req: ['c', 'a'] }])).toEqual(['a', 'b', 'c'])
        expect(commitKeyReq([], [{ req: ['b'] }])).toEqual(['b'])
        expect(commitKeyReq(['a'], [])).toEqual(['a'])
    })
})

describe('commit key and manifest shape', () => {
    test('damage: bad epoch, unknown staging label, a key outside the prefix, missing fields', () => {
        const base = vectorBody('commit-01-current-req-empty')
        for (const mutate of [
            (b: JsonObject) => { b.epoch = 'X'.repeat(26) },
            (b: JsonObject) => { b.epoch = '0' },
            (b: JsonObject) => { b.staging = { label: 'nope', owner: 'o', prefix: 'p', startedAt: 1 } },
            (b: JsonObject) => { b.current = { key: 'elsewhere/x', at: 1 } },
            (b: JsonObject) => { b.current = { key: 'store2/', at: 1 } },
            (b: JsonObject) => { b.seq = -1 },
            (b: JsonObject) => { b.seq = 1.5 },
            (b: JsonObject) => { delete b.pins },
            (b: JsonObject) => { b.retained = {} },
        ]) {
            const body = clone(base)
            mutate(body)
            expect(parseCommitKey(body).status).toBe('damaged')
        }
        expect(parseCommitKey([] as JsonValue).status).toBe('damaged')
        expect(parseCommitKey('x').status).toBe('damaged')
    })

    test('manifest: shardCount and the ref counts must agree, a missing fixed field is damaged', () => {
        const base = vectorBody('type-02-manifest')
        const wrongShards = clone(base)
        wrongShards.shardCount = 2
        expect(parseManifest(wrongShards).status).toBe('damaged')
        const wrongBuckets = clone(base)
        child(child(wrongBuckets, 'fixed'), 'pluginStorage').buckets = 3
        expect(parseManifest(wrongBuckets).status).toBe('damaged')
        const missing = clone(base)
        delete child(missing, 'fixed').statics
        expect(parseManifest(missing).status).toBe('damaged')
        const badStatus = clone(base)
        child(badStatus, 'fixed').legacyKeep = { unit: ['u-x', 1, 1], v: 1, files: [{ key: 'k', status: 'weird' }] }
        expect(parseManifest(badStatus).status).toBe('damaged')
    })

    test('the manifest reader keeps a null legacyKeep', () => {
        expect(okValue(parseManifest(vectorBody('type-02-manifest'))).fixed.legacyKeep).toBeNull()
    })
})

describe('positional tuples', () => {
    test('a longer Ref, list tuple and chunk tuple parse and the extra elements are kept', () => {
        const body = clone(vectorBody('type-03-shard'))
        const entry = item(body, 'entries')
        ;(entry.core as JsonValue[]).push('later', { n: 1 })
        ;(entry.al as JsonValue[]).push('x')
        const chat = item(entry, 'chats')
        ;(chat.chunks as JsonValue[][])[0].push('more')
        const shard = okValue(parseShard(body))
        expect(shard.entries[0].core).toHaveLength(5)
        expect(shard.entries[0].chats[0].chunks[0]).toEqual(expect.arrayContaining(['more']))
        expect(writtenBody(UNIT_TYPE.shard, shard)).toEqual(body)
    })

    test('a tuple shorter than its prefix, a bad tail, a bad crc or a missing list version is damaged', () => {
        const mutations: ((entry: JsonObject) => void)[] = [
            (entry) => { entry.core = ['u-x', 1] },
            (entry) => { entry.core = ['', 1, 1] },
            (entry) => { entry.core = ['u-x', 1, 2 ** 32] },
            (entry) => { entry.core = ['u-x', -1, 1] },
            (entry) => { entry.core = ['u-x', 'a', 1] },
            (entry) => { entry.al = ['u-x', 1, 1] },
            (entry) => { item(entry, 'chats').chunks = [['u-x', 1, 1]] },
        ]
        for (const mutate of mutations) {
            const body = clone(vectorBody('type-03-shard'))
            mutate(item(body, 'entries'))
            expect(parseShard(body).status).toBe('damaged')
        }
    })
})

describe('shard and chat shape', () => {
    test('a chat entry without chunks is refused, and so is one with an empty chunk list', () => {
        const without = clone(vectorBody('type-03-shard'))
        delete item(item(without, 'entries'), 'chats').chunks
        expect(parseShard(without).status).toBe('damaged')
        const empty = clone(vectorBody('type-03-shard'))
        item(item(empty, 'entries'), 'chats').chunks = []
        expect(parseShard(empty).status).toBe('damaged')
    })

    test('an empty chat is one chunk with no messages and count 0', () => {
        const chunk = emptyChatChunk()
        expect(chunk).toEqual({ v: 1, msgs: [] })
        const bytes = encodeUnit(UNIT_TYPE.chatChunk, chunk)
        const read = readUnit(bytes, UNIT_TYPE.chatChunk)
        expect(read.status).toBe('ok')
        const entry = item(vectorBody('type-03-shard'), 'entries')
        const chats = entry.chats as JsonObject[]
        expect((chats[0].chunks as JsonValue[][])[0][3]).toBe(0)
        expect(parseChatChunk({ v: 1, msgs: [], st: { lastDate: 1 } }).status).toBe('ok')
    })

    test('st is optional, msgs entries are objects, optional entry fields are checked when present', () => {
        expect(parseChatChunk({ v: 1, msgs: [1] }).status).toBe('damaged')
        expect(parseChatChunk({ v: 1 }).status).toBe('damaged')
        const body = clone(vectorBody('type-03-shard'))
        item(body, 'entries').tags = ['a', 'b']
        item(body, 'entries').image = 'img'
        expect(okValue(parseShard(body)).entries[0]).toMatchObject({ tags: ['a', 'b'], image: 'img' })
        item(body, 'entries').tags = 'a'
        expect(parseShard(body).status).toBe('damaged')
    })

    test('a body v above 1 is too-new, below 1 is damaged', () => {
        expect(parseShard({ v: 2, entries: [] }).status).toBe('too-new')
        expect(parseShard({ v: 0, entries: [] }).status).toBe('damaged')
        expect(parseChatChunk({ v: 2, msgs: [] }).status).toBe('too-new')
    })
})

describe('derived lists: version rule', () => {
    test('a list one above the known version is unreadable, not too-new and not damaged', () => {
        expect(parseAssetList({ v: ASSET_REF_V + 1, h: '', l: [] }).status).toBe('unreadable')
        expect(parseInlayList({ v: IL_REF_V + 1, u: [], h: '', o: [] }).status).toBe('unreadable')
        const legacy = clone(vectorBody('type-20-legacy-list'))
        legacy.iv = IL_REF_V + 1
        expect(parseLegacyList(legacy).status).toBe('unreadable')
        const asset = clone(vectorBody('type-20-legacy-list'))
        asset.v = ASSET_REF_V + 1
        expect(parseLegacyList(asset).status).toBe('unreadable')
        const inner = clone(vectorBody('type-20-legacy-list'))
        child(inner, 'i').v = IL_REF_V + 1
        expect(parseLegacyList(inner).status).toBe('unreadable')
    })

    test('an unreadable list is not read further: a future body shape does not matter', () => {
        expect(parseAssetList({ v: 2, anything: [1, 2] }).status).toBe('unreadable')
    })

    test('the known version is ok and a version below it is stale with the value kept', () => {
        expect(parseAssetList({ v: 1, h: '', l: [] }).status).toBe('ok')
        const stale = parseAssetList({ v: 0, h: '', l: ['a'] })
        expect(stale.status).toBe('stale')
        if (stale.status === 'stale') {
            expect(stale.value.l).toEqual(['a'])
        }
        expect(parseInlayList({ v: 0, u: [], h: '', o: [] }).status).toBe('stale')
        const legacy = clone(vectorBody('type-20-legacy-list'))
        legacy.iv = 0
        expect(parseLegacyList(legacy).status).toBe('stale')
    })

    test('through a stored frame the verdict is the same', () => {
        const above = oracleFrame(UNIT_TYPE.assetList, '{"h":"","l":[],"v":2}')
        expect(readUnit(above).status).toBe('unreadable')
        const stale = oracleFrame(UNIT_TYPE.assetList, '{"h":"","l":[],"v":0}')
        expect(readUnit(stale).status).toBe('stale')
    })

    test('shape errors are damaged: stems, x flag, non-list l, bad version', () => {
        expect(parseAssetList({ v: 1, h: 'A'.repeat(42), l: [] }).status).toBe('damaged')
        expect(parseAssetList({ v: 1, h: '!'.repeat(43), l: [] }).status).toBe('damaged')
        expect(parseAssetList({ v: 1, h: '', l: 'a' }).status).toBe('damaged')
        expect(parseAssetList({ v: 'x', h: '', l: [] }).status).toBe('damaged')
        expect(parseAssetList({ h: '', l: [] }).status).toBe('damaged')
        expect(parseInlayList({ v: 1, u: [], h: '', o: [], x: false }).status).toBe('damaged')
        expect(okValue(parseInlayList({ v: 1, u: [], h: '', o: [], x: true })).x).toBe(true)
    })
})

describe('other bodies', () => {
    test('sweep record: tuples with a null revision, longer tuples, bad entries', () => {
        const record = okValue(parseSweepRecord({ v: 1, at: 5, items: [['a.png', 3], ['b.png', null, 'extra']] }))
        expect(record.items[1][1]).toBeNull()
        expect(record.items[1]).toHaveLength(3)
        expect(parseSweepRecord({ v: 1, at: 5, items: [['a.png']] }).status).toBe('damaged')
        expect(parseSweepRecord({ v: 1, at: 5, items: [[1, 1]] }).status).toBe('damaged')
        expect(parseSweepRecord({ v: 2, at: 5, items: [] }).status).toBe('too-new')
    })

    test('fence record: null prior bytes, base64url bytes, damaged shapes, too-new body version', () => {
        expect(parseFenceRecord({ v: 1, at: 1, keys: [], priorCommits: [{ at: 1, bytes: null }] }).status).toBe('ok')
        expect(parseFenceRecord({ v: 1, at: 1, keys: [], priorCommits: [{ at: 1, bytes: 'a+b' }] }).status).toBe('damaged')
        expect(parseFenceRecord({ v: 1, at: 1, keys: [], priorCommits: [], priorFences: [{ at: 1, bytes: null }] }).status).toBe('damaged')
        expect(parseFenceRecord({ v: 1, at: 1, keys: [1], priorCommits: [] }).status).toBe('damaged')
        expect(parseFenceRecord({ v: 2, at: 1, keys: [], priorCommits: [] }).status).toBe('too-new')
    })

    test('plugin-storage bucket: entries carry a name and a Ref', () => {
        expect(parsePluginBucket({ v: 1, entries: [{ k: 'a', ref: ['u-x', 1, 1] }] }).status).toBe('ok')
        expect(parsePluginBucket({ v: 1, entries: [{ k: 'a' }] }).status).toBe('damaged')
    })

    test.each([4, 5, 6, 9, 11, 12, 13, 14, 16, 17, 18])('content type %i is a plain object with a numeric v', (type) => {
        const ok = parseUnitBody(type as UnitType, { v: 1, anything: ['at', 'all'] })
        expect(ok.status).toBe('ok')
        if (ok.status === 'ok') {
            expect((ok.value as JsonObject).anything).toEqual(['at', 'all'])
        }
        expect(parseUnitBody(type as UnitType, { anything: 1 }).status).toBe('damaged')
        expect(parseUnitBody(type as UnitType, { v: 'x' }).status).toBe('damaged')
        expect(parseUnitBody(type as UnitType, [] as JsonValue).status).toBe('damaged')
        expect(parseUnitBody(type as UnitType, { v: 2 }).status).toBe('too-new')
    })

    test('parseContentBody keeps unknown fields', () => {
        expect(okValue(parseContentBody({ v: 1, a: 1 }))).toEqual({ v: 1, a: 1 })
    })
})

describe('readUnit', () => {
    test('a payload that is not UTF-8 JSON is damaged, including one with a byte-order mark', () => {
        expect(readUnit(oracleFrame(UNIT_TYPE.chatCore, 'not json')).status).toBe('damaged')
        expect(readUnit(oracleFrame(UNIT_TYPE.chatCore, '﻿{"f":{},"v":1}')).status).toBe('damaged')
        expect(readUnit(oracleFrame(UNIT_TYPE.chatCore, '[]')).status).toBe('damaged')
    })

    test('a unit of another type than expected is damaged', () => {
        const bytes = hexToBytes(GOLDEN_VECTORS.find(vector => vector.id === 'type-02-manifest')?.hex ?? '')
        expect(readUnit(bytes, UNIT_TYPE.manifest).status).toBe('ok')
        expect(readUnit(bytes, UNIT_TYPE.shard).status).toBe('damaged')
    })

    test('frame verdicts pass through', () => {
        expect(readUnit(oracleFrame(1, '{}', { codec: 1 })).status).toBe('too-new')
        expect(readUnit(new Uint8Array(3)).status).toBe('damaged')
    })
})

const R = (c: string): JsonValue[] => [`u-${c.repeat(26)}`, 100, 1]
const L = (c: string): JsonValue[] => [`u-${c.repeat(26)}`, 100, 1, 1]
const MANIFEST_KEY = `store2/m-0000001${'a'.repeat(19)}`

/** Parses `body` as `type`, re-encodes the parsed value and returns what was written. */
function roundTrip(type: UnitType, body: JsonObject): JsonObject {
    const parsed = parseUnitBody(type, body)
    expect(parsed.status).toBe('ok')
    return writtenBody(type, parsed.status === 'ok' ? parsed.value : {})
}

describe('fully populated bodies round-trip, every optional field present', () => {
    test('commit key with current, retained, pins, staging and the conversion fields', () => {
        const body: JsonObject = {
            fmt: 1, req: [], seq: 4, epoch: '0'.repeat(25) + '1',
            current: { key: MANIFEST_KEY, at: 1 },
            retained: [{ key: MANIFEST_KEY, at: 2 }],
            pins: [{ key: MANIFEST_KEY, reason: 'r' }],
            staging: { owner: 'o', prefix: 'store2/g-0000000000000001-', startedAt: 3, label: 'bulk' },
            convertedFrom: 'database/database.bin', convertedAt: 5,
        }
        expect(roundTrip(UNIT_TYPE.commit, body)).toEqual(body)
    })

    test('manifest with legacyKeep and its files', () => {
        const body = clone(vectorBody('type-02-manifest'))
        child(body, 'fixed').legacyKeep = {
            unit: R('l'), v: 1,
            files: [{ key: 'database/database.bin', status: 'ok' }, { key: 'database/dbbackup-1.bin', status: 'unreadable' }, { key: 'x', status: 'gone' }],
        }
        expect(roundTrip(UNIT_TYPE.manifest, body)).toEqual(body)
    })

    test('shard: a group entry with every optional entry field, il, lore and scripts, two chats', () => {
        const entry: JsonObject = {
            u: 'g1', type: 'group', name: 'n', image: 'img.png', chaId: 'x', lastInteraction: 9, trashTime: 8,
            characters: ['a', 'b'], creatorNotes: 'cn', chatPage: 1, firstMsgIndex: 2, tags: ['t'], creator: 'me',
            core: R('1'), lore: R('2'), scripts: R('3'), al: L('4'), il: L('5'), dsp: true,
            chats: [
                { cid: 'c1', core: R('6'), chunks: [[...R('7'), 4], [...R('8'), 2]] },
                { cid: 'c2', core: R('9'), chunks: [[...R('a'), 0]] },
            ],
        }
        const body: JsonObject = { v: 1, entries: [entry] }
        expect(roundTrip(UNIT_TYPE.shard, body)).toEqual(body)
    })

    test('module index entry with namespace, icon, hideIcon and lowLevelAccess', () => {
        const body: JsonObject = {
            v: 1,
            entries: [{
                id: 'm', unit: R('1'), al: L('2'), il: L('3'), name: 'n', description: 'd', namespace: 'ns', icon: 'i',
                hideIcon: true, lowLevelAccess: true, hasToggle: true, dsp: true,
            }],
        }
        expect(roundTrip(UNIT_TYPE.moduleIndex, body)).toEqual(body)
    })

    test('fence record with prior commits and prior fences', () => {
        const body: JsonObject = {
            v: 1, at: 1, keys: ['m-x'],
            priorCommits: [{ at: 2, bytes: 'AAAA' }, { at: 3, bytes: null }],
            priorFences: [{ at: 4, bytes: 'BBBB' }],
        }
        expect(roundTrip(UNIT_TYPE.fenceRecord, body)).toEqual(body)
    })

    test('sweep record, chat chunk with st, chat core, bucket', () => {
        const cases: [UnitType, JsonObject][] = [
            [UNIT_TYPE.sweepRecord, { v: 1, at: 1, items: [['a', 1], ['b', null]] }],
            [UNIT_TYPE.chatChunk, { v: 1, msgs: [{ role: 'user' }], st: { lastDate: 1 } }],
            [UNIT_TYPE.chatCore, { v: 1, f: { name: 'c' } }],
            [UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [{ k: 'a', ref: R('1') }] }],
        ]
        for (const [type, body] of cases) {
            expect(roundTrip(type, body), String(type)).toEqual(body)
        }
    })

    test('derived lists: asset list, inlay list with the overflow flag, legacy list', () => {
        const h = 'A'.repeat(43)
        const inlay: JsonObject = { v: 1, u: ['00000000-0000-4000-8000-000000000000'], h, o: ['t'], x: true }
        expect(roundTrip(UNIT_TYPE.assetList, { v: 1, h, l: ['a.png'] })).toEqual({ v: 1, h, l: ['a.png'] })
        expect(roundTrip(UNIT_TYPE.inlayList, inlay)).toEqual(inlay)
        const legacy: JsonObject = {
            v: 1, iv: 1, files: [{ key: 'database/database.bin', status: 'ok' }, { key: 'k', status: 'unreadable' }], h, l: ['a'], i: inlay,
        }
        expect(roundTrip(UNIT_TYPE.legacyList, legacy)).toEqual(legacy)
    })
})

describe('an own __proto__ field is an unknown field like any other', () => {
    const withProto = (value: JsonValue): JsonObject => {
        const text = JSON.stringify(vectorBody('commit-01-current-req-empty'))
        return JSON.parse(`{"__proto__":${JSON.stringify(value)},${text.slice(1)}`) as JsonObject
    }

    test.each([[{ future: 1 }], [7], ['s'], [null]])('survives a commit key round trip as %j', (value) => {
        const body = withProto(value as JsonValue)
        const parsed = okValue(parseCommitKey(body))
        expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
        const text = JSON.stringify(writtenBody(UNIT_TYPE.commit, parsed))
        expect(text).toContain(`"__proto__":${JSON.stringify(value)}`)
    })

    test('carryUnknownFields copies it into a rebuilt object', () => {
        const prev = okValue(parseCommitKey(withProto({ future: 1 })))
        const rebuilt: CommitKey = {
            fmt: 1, req: prev.req, seq: 2, epoch: prev.epoch, current: prev.current, retained: prev.retained,
            pins: prev.pins, staging: prev.staging, convertedFrom: null, convertedAt: null,
        }
        const carried = carryUnknownFields(prev, rebuilt, KNOWN_FIELDS.commitKey)
        expect(Object.getPrototypeOf(carried)).toBe(Object.prototype)
        expect(JSON.stringify(writtenBody(UNIT_TYPE.commit, carried))).toContain('"__proto__":{"future":1}')
    })
})

describe('staging.prefix', () => {
    const commitWithPrefix = (prefix: JsonValue): JsonObject => {
        const body = clone(vectorBody('commit-01-current-req-empty'))
        body.staging = { owner: 'o', prefix, startedAt: 1, label: 'seed' }
        return body
    }

    test('only store2/g-<16 digits of 0-9a-v>- is accepted', () => {
        expect(parseCommitKey(commitWithPrefix('store2/g-0123456789abcdef-')).status).toBe('ok')
        for (const prefix of ['', 'p', 'store2/g-abc-', 'store2/g-0123456789abcdef', 'store2/g-0123456789abcdef-x', 'g-0123456789abcdef-',
            'store2/g-0123456789ABCDEF-', 'store2/g-0123456789abcdew-', 'store2/g-0123456789abcdef0-', 'store2//g-0123456789abcdef-', 'store3/g-0123456789abcdef-', 'xxxxxxxg-0123456789abcdef-', 5]) {
            expect(parseCommitKey(commitWithPrefix(prefix)).status, String(prefix)).toBe('damaged')
        }
    })
})

describe('deterministic encoding of a unit', () => {
    test('the same value built in a different key order gives the same bytes', () => {
        const body = vectorBody('type-02-manifest')
        const reordered: JsonObject = {}
        for (const key of Object.keys(body).reverse()) {
            reordered[key] = body[key]
        }
        expect(encodeUnit(UNIT_TYPE.manifest, reordered)).toEqual(encodeUnit(UNIT_TYPE.manifest, body))
    })
})
