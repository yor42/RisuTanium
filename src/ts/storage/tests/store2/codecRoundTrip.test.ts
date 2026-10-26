import { describe, expect, test, vi } from 'vitest'
import {
    assembleCharacter, assembleDatabase, CodecAssembleError, RESIDUAL_NORMALISATIONS, unitMapSource,
    type EncodedTree, type UnitSource,
} from '../../store2/codec'
import { UNIT_TYPE, type ShardEntry } from '../../store2/format'
import {
    asDatabase, bodyOf, buildLegacyCases, buildSmall, buildT3, buildT4, buildT5Chat, bytesOf, dbWithCharacters, differingIdentities,
    encodeWith, previousFrom, profileWithChats, roundTrip, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

// The profile-sized cases encode megabytes; a loaded machine must not turn that into a timeout.
vi.setConfig({ testTimeout: 60_000 })

/** The assembled tree re-encodes to identical units, by key replay and by reuse. */
function expectStable(db: ReturnType<typeof buildSmall>): { first: EncodedTree, assembled: ReturnType<typeof buildSmall> } {
    const { first, second, assembled } = roundTrip(db)
    expect(differingIdentities(first, second)).toEqual([])
    const reuse = encodeWith(assembled, { env: seededEnv(99), previous: previousFrom(first) })
    expect(reuse.units.filter(unit => !unit.reused).map(unit => unit.identity)).toEqual(['manifest'])
    return { first, assembled }
}

describe('encode, assemble, encode', () => {
    test('a small profile re-encodes byte for byte', () => {
        expectStable(buildSmall())
    })

    test('every legacy and edge shape re-encodes byte for byte', () => {
        for (const { label, character } of buildLegacyCases()) {
            const db = dbWithCharacters([character])
            const { first } = roundTrip(db)
            const again = roundTrip(db).second
            expect(differingIdentities(first, again), label).toEqual([])
        }
    })

    test('T3, T4 and T5 shaped profiles re-encode byte for byte', () => {
        expectStable(buildT3().db)
        expectStable(buildT4().db)
        expectStable(profileWithChats([buildT5Chat(3000)]))
    })

    test('the assembled characters keep their order and their chats', () => {
        const db = buildSmall(8)
        const { assembled } = roundTrip(db)
        expect(assembled.characters.map(slot => slot.chaId)).toEqual(db.characters.map(slot => slot.chaId))
        expect(assembled.characters.map(slot => slot.chats.length)).toEqual(db.characters.map(slot => slot.chats.length))
    })

    test('the assembled database equals the original for a database that needs no normalisation', () => {
        const db = buildSmall(4)
        const { assembled } = roundTrip(db)
        expect(JSON.parse(JSON.stringify(assembled))).toEqual(JSON.parse(JSON.stringify(db)))
    })
})

describe('residual normalisations', () => {
    function characterOf(slot: Obj): Obj {
        const { assembled } = roundTrip(dbWithCharacters([slot]))
        return assembled.characters[0] as unknown as Obj
    }
    const base = (): Obj => {
        const small = buildSmall(1)
        return JSON.parse(JSON.stringify(small.characters[0])) as Obj
    }

    test(`${RESIDUAL_NORMALISATIONS.jsonPlain}: undefined props are absent, array undefined is null, NaN is null, -0 is 0, Date is its ISO string`, () => {
        const slot = base()
        slot.image = undefined
        slot.tags = ['a', undefined, 'b']
        slot.depth_prompt = { depth: Number.NaN, prompt: 'x' }
        slot.creation_date = -0
        slot.modification_date = new Date(1_700_000_000_000)
        const out = characterOf(slot)
        expect('image' in out).toBe(false)
        expect(out.tags).toEqual(['a', null, 'b'])
        expect(out.depth_prompt).toEqual({ depth: null, prompt: 'x' })
        expect(Object.is(out.creation_date, 0)).toBe(true)
        expect(out.modification_date).toBe('2023-11-14T22:13:20.000Z')
    })

    test(`${RESIDUAL_NORMALISATIONS.volatileStripped}: streaming state and reloadKeys are not stored`, () => {
        const slot = base()
        slot.reloadKeys = 4
        const chats = slot.chats as Obj[]
        chats[0].isStreaming = true
        chats[0].activeStreamingDisplayOptimizationMode = 'strong'
        const out = characterOf(slot)
        const chat = (out.chats as Obj[])[0]
        expect('reloadKeys' in out).toBe(false)
        expect('isStreaming' in chat).toBe(false)
        expect('activeStreamingDisplayOptimizationMode' in chat).toBe(false)
    })

    test(`${RESIDUAL_NORMALISATIONS.derivedColdStripped}: derived cold fields on a loaded character are not stored`, () => {
        const slot = base()
        slot.coldVersion = 3
        slot.coldChatCount = 2
        slot.coldStoragedChats = ['x']
        const out = characterOf(slot)
        for (const name of ['coldstorage', 'coldVersion', 'coldChatCount', 'coldStoragedChats']) {
            expect(name in out).toBe(false)
        }
    })

    test(`${RESIDUAL_NORMALISATIONS.absentListEmpty}: absent or null lists come back empty`, () => {
        const slot = base()
        delete slot.chats
        expect(characterOf(slot).chats).toEqual([])
        const withNull = base()
        const chats = withNull.chats as Obj[]
        chats[0].message = null
        delete chats[1].message
        const out = characterOf(withNull)
        expect((out.chats as Obj[])[0].message).toEqual([])
        const db = buildSmall(1) as unknown as Obj
        delete db.modules
        db.loadouts = null
        delete db.pluginV2
        const result = roundTrip(asDatabase(db)).assembled as unknown as Obj
        expect(result.modules).toEqual([])
        expect(result.loadouts).toEqual([])
        expect(result.pluginV2).toEqual([])
        delete db.pluginCustomStorage
        expect((roundTrip(asDatabase(db)).assembled as unknown as Obj).pluginCustomStorage).toEqual({})
    })

    test('the shapes that are not normalised are kept: an absent chatPage and a first-message index of -1', () => {
        const slot = base()
        delete slot.chatPage
        slot.firstMsgIndex = -1
        const out = characterOf(slot)
        expect('chatPage' in out).toBe(false)
        expect(out.firstMsgIndex).toBe(-1)
        const odd = base()
        odd.chatPage = '0'
        odd.lastInteraction = 'recently'
        const oddOut = characterOf(odd)
        expect(oddOut.chatPage).toBe('0')
        expect(oddOut.lastInteraction).toBe('recently')
    })
})

describe('assemble refuses what it cannot trust', () => {
    function encoded() {
        const first = encodeWith(buildSmall(3))
        return { tree: first, source: unitMapSource(first.units) }
    }

    test('a missing unit', () => {
        const { tree, source } = encoded()
        const gone = unitOf(tree, 'config')
        const partial: UnitSource = { get: key => (key === gone.key ? undefined : source.get(key)) }
        expect(() => assembleDatabase(tree.manifest, partial)).toThrow(CodecAssembleError)
    })

    test('a unit whose bytes do not match its Ref', () => {
        const { tree, source } = encoded()
        const victim = unitOf(tree, 'statics')
        const other = unitOf(tree, 'loadouts')
        const swapped: UnitSource = { get: key => (key === victim.key ? bytesOf(other) : source.get(key)) }
        expect(() => assembleDatabase(tree.manifest, swapped)).toThrow(/does not match its Ref/)
    })

    function firstEntry(tree: EncodedTree): ShardEntry {
        for (const unit of tree.units.filter(one => one.type === UNIT_TYPE.shard)) {
            const entries = bodyOf(unit).entries as unknown as ShardEntry[]
            if (entries.length > 0) {
                return structuredClone(entries[0])
            }
        }
        throw new Error('No shard entry.')
    }

    test('a chunk whose message count differs from its Ref', () => {
        const { tree, source } = encoded()
        const entry = firstEntry(tree)
        expect(() => assembleCharacter(entry, source)).not.toThrow()
        entry.chats[0].chunks[0][3] += 1
        expect(() => assembleCharacter(entry, source)).toThrow(/Ref says/)
    })

    test('an entry listed in a shard its id does not name', () => {
        const { tree, source } = encoded()
        const filled = tree.manifest.shards.findIndex((_, index) => (bodyOf(unitOf(tree, `shard:${index}`)).entries as unknown[]).length > 0)
        const other = (filled + 1) % 16
        const shards = [...tree.manifest.shards]
        ;[shards[filled], shards[other]] = [shards[other], shards[filled]]
        expect(() => assembleDatabase({ ...tree.manifest, shards }, source)).toThrow(/not the one its id names/)
    })

    test('an order unit that names an entity no shard lists, and a shard entry the order does not name', () => {
        const small = encodeWith(buildSmall(2), { env: seededEnv(1) })
        const large = encodeWith(buildSmall(3), { env: seededEnv(2) })
        const both = unitMapSource([...small.units, ...large.units])
        const fewerInOrder = { ...large.manifest, fixed: { ...large.manifest.fixed, order: small.manifest.fixed.order } }
        expect(() => assembleDatabase(fewerInOrder, both)).toThrow(/not in the order unit|names entity/)
        const moreInOrder = { ...small.manifest, fixed: { ...small.manifest.fixed, order: large.manifest.fixed.order } }
        expect(() => assembleDatabase(moreInOrder, both)).toThrow(/names entity|not in the order unit/)
    })

    test('a unit of the wrong type under a Ref', () => {
        const { tree, source } = encoded()
        const config = unitOf(tree, 'config')
        const statics = unitOf(tree, 'statics')
        const swapped: UnitSource = { get: key => (key === config.key ? bytesOf(statics) : source.get(key)) }
        expect(() => assembleDatabase(tree.manifest, swapped)).toThrow(CodecAssembleError)
    })
})
