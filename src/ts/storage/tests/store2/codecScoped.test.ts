import { describe, expect, test } from 'vitest'
import {
    acknowledgedBytesOf, assembleDatabase, bucketOfKey, characterMatchesAcknowledged, CodecAssembleError, CodecInputError, COLD_POINTER_HEADER, emitCharacter, encodeCharacter,
    Encoder, encodeScoped, IDENTITY, isSkippableCharacterFault, normalizeCharacter, planScopedEncode, previousFrom, shardOfU,
    SharedChaIdStubError, StubRefusedError, unitMapSource, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type ListDerivation, type PreviousEncoding,
} from '../../store2/codec'
import { planWholeTreeInstall } from '../../store2/legacy/install'
import { buildColdStub } from '../../../process/coldCharacter'
import type { character, Database } from '../../database.svelte'
import { UNIT_TYPE, type ShardEntry } from '../../store2/format'
import {
    bodyIn, buildSmall, buildT3, buildT4, buildLegacyCases, buildT5Chat, dbWithCharacters, asDatabase, encodeWith,
    fakeLists, profileWithChats, seededEnv, sameBytes, storeOf, type Obj,
} from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function scopedOptions(seed: number, previous: EncodedTree | null, lists: ListDerivation = fakeLists): EncodeOptions {
    return { env: seededEnv(seed), lists, seq: 2, createdAt: NOW, previous: previous === null ? null : previousFrom(previous) }
}

const EVERYTHING: EncodeScope = { modules: true, characters: 'all' }

function written(tree: EncodedTree): string[] {
    return unitsToWrite(tree).map(unit => unit.identity).sort()
}

function chaIdOf(db: Database, index: number): string {
    return (db.characters[index] as { chaId: string }).chaId
}

function entryOf(tree: EncodedTree, chaId: string, ...earlier: EncodedTree[]): ShardEntry {
    for (const unit of tree.units) {
        if (unit.type === UNIT_TYPE.shard) {
            const found = (bodyIn(unit, ...earlier).entries as unknown as ShardEntry[]).find(entry => entry.chaId === chaId)
            if (found !== undefined) {
                return found
            }
        }
    }
    throw new Error(`No entry for ${chaId}`)
}

/** The entry of `chaId` as the next encode's previous shards hold it. */
function indexEntry(tree: EncodedTree, chaId: string): ShardEntry {
    for (const shard of tree.index.objects?.shards ?? []) {
        const found = shard.entries.find(entry => entry.chaId === chaId)
        if (found !== undefined) {
            return found
        }
    }
    throw new Error(`No indexed entry for ${chaId}`)
}

function counting(): { lists: ListDerivation, encoded: string[] } {
    const encoded: string[] = []
    return {
        encoded,
        lists: {
            ...fakeLists,
            characterAssets: (owner) => {
                encoded.push(String(owner.chaId))
                return fakeLists.characterAssets(owner)
            },
        },
    }
}

describe('guard: with every character named the scoped encode is encodeDatabase, key for key', () => {
    function expectSameTree(a: EncodedTree, b: EncodedTree): void {
        expect(b.manifestKey).toBe(a.manifestKey)
        expect(b.manifest).toEqual(a.manifest)
        expect(b.units.map(unit => unit.identity)).toEqual(a.units.map(unit => unit.identity))
        a.units.forEach((unit, index) => {
            const other = b.units[index]
            expect(other.key).toBe(unit.key)
            expect(other.reused).toBe(unit.reused)
            expect(other.digest).toBe(unit.digest)
            expect(other.ref).toEqual(unit.ref)
            if (unit.reused === false && other.reused === false) {
                expect(sameBytes(other.bytes, unit.bytes), `${unit.identity} bytes`).toBe(true)
            }
        })
        expect([...b.index.units.keys()].sort()).toEqual([...a.index.units.keys()].sort())
        expect([...b.index.entities]).toEqual([...a.index.entities])
    }

    async function compare(db: Database): Promise<void> {
        const full = encodeWith(db)
        const scoped = await encodeScoped(db, { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: NOW }, EVERYTHING)
        expectSameTree(full, scoped)
        // A second pass over a changed database, both against the same previous.
        const next = clone(db)
        const slot = (next.characters as Obj[])[0]
        slot.personality = 'a later personality'
        const nextDb = asDatabase(next)
        const fullNext = encodeWith(nextDb, { env: seededEnv(2), previous: previousFrom(full), seq: 2 })
        const scopedNext = await encodeScoped(nextDb, scopedOptions(2, full), EVERYTHING)
        expectSameTree(fullNext, scopedNext)
    }

    test('small profile', async () => {
        await compare(buildSmall(6))
    })

    test('T3 shape (500 characters, 164 modules)', async () => {
        await compare(buildT3().db)
    }, 120_000)

    test('T4 shape (1000 characters)', async () => {
        await compare(buildT4().db)
    }, 120_000)

    test('T5 shape (one long chat across several chunks)', async () => {
        await compare(profileWithChats([buildT5Chat(1200, { at: 700, bytes: 200_000 })]))
    }, 60_000)

    test('every legacy case', async () => {
        for (const legacy of buildLegacyCases()) {
            await compare(dbWithCharacters([legacy.character]))
        }
    }, 60_000)
})

describe('new behaviour: an unnamed resident character is carried', () => {
    test('its units and entry stay and nothing new is written for it', async () => {
        const db = buildSmall(6)
        const first = encodeWith(db)
        const lists = counting()
        const next = clone(db)
        ;(next.characters as Obj[])[0].personality = 'edited'
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first, lists.lists), { modules: false, characters: new Set([chaIdOf(db, 0)]) })

        expect(lists.encoded).toEqual([chaIdOf(db, 0)])
        for (let index = 1; index < 6; index++) {
            const chaId = chaIdOf(db, index)
            const u = first.index.entities.get(`${chaId}#0`) as string
            expect(tree.index.entities.get(`${chaId}#0`)).toBe(u)
            for (const [identity, unit] of first.index.units) {
                if (identity.includes(u)) {
                    expect(tree.index.units.get(identity)?.key, identity).toBe(unit.key)
                }
            }
            expect(tree.units.some(unit => unit.identity.includes(u))).toBe(false)
            expect(indexEntry(tree, chaId)).toEqual(indexEntry(first, chaId))
        }
        const u0 = first.index.entities.get(`${chaIdOf(db, 0)}#0`) as string
        expect(written(tree)).toEqual([`${IDENTITY.char}${u0}:core`, 'manifest', `shard:${shardOfU(u0)}`].sort())
    })

    test('an edit to an unnamed character is not encoded', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        ;((next.characters as Obj[])[1].chats as Obj[])[0].name = 'renamed'
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set() })
        expect(written(tree)).toEqual(['manifest'])
    })

    test('carried units survive a second pass that names nothing', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const second = await encodeScoped(db, scopedOptions(2, first), { modules: false, characters: new Set([chaIdOf(db, 0)]) })
        const third = await encodeScoped(db, scopedOptions(3, second), { modules: false, characters: new Set() })
        expect(written(third)).toEqual(['manifest'])
        expect([...third.index.units.keys()].sort()).toEqual([...first.index.units.keys()].sort())
        for (const [identity, unit] of first.index.units) {
            if (identity !== 'manifest') {
                expect(third.index.units.get(identity)?.key, identity).toBe(unit.key)
            }
        }
    })

    test('a character the previous encoding does not hold cannot be carried', async () => {
        const first = encodeWith(buildSmall(2))
        await expect(encodeScoped(buildSmall(3), scopedOptions(2, first), { modules: false, characters: new Set() })).rejects.toThrow(CodecInputError)
    })

    test('carrying with no previous encoding is refused', async () => {
        await expect(encodeScoped(buildSmall(2), scopedOptions(2, null), { modules: true, characters: new Set() })).rejects.toThrow(CodecInputError)
        await expect(encodeScoped(buildSmall(2), scopedOptions(2, null), { modules: false, characters: 'all' })).rejects.toThrow(CodecInputError)
    })

    test('a deleted character and a deleted chat leave the next previous', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const next = clone(db)
        const removed = chaIdOf(db, 3)
        ;(next.characters as Obj[]).pop()
        ;((next.characters as Obj[])[0].chats as Obj[]).pop()
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set([chaIdOf(db, 0)]) })
        const gone = first.index.entities.get(`${removed}#0`) as string
        expect([...tree.index.units.keys()].some(identity => identity.includes(gone))).toBe(false)
        const u0 = first.index.entities.get(`${chaIdOf(db, 0)}#0`) as string
        const chatUnits = (tree: EncodedTree) => [...tree.index.units.keys()].filter(identity => identity.startsWith(`${IDENTITY.chat}${u0}:`))
        expect(chatUnits(first).length).toBeGreaterThan(chatUnits(tree).length)
        expect(chatUnits(tree).length).toBe(2)
    })
})

describe('new behaviour: a named character is re-encoded', () => {
    test('one changed message reuses every unchanged chunk', async () => {
        const chat = buildT5Chat(1200, undefined, 5000)
        const db = profileWithChats([chat])
        const first = encodeWith(db)
        const u = first.index.entities.get(`${chaIdOf(db, 0)}#0`) as string
        const chunkIdentities = [...first.index.units.keys()].filter(identity => identity.includes(':chunk:'))
        expect(chunkIdentities.length).toBeGreaterThan(2)
        const next = clone(db)
        const messages = (((next.characters as Obj[])[0].chats as Obj[])[0].message as Obj[])
        messages[messages.length - 1].data = 'a last word'
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set([chaIdOf(db, 0)]) })
        const last = chunkIdentities.sort((a, b) => Number(a.split(':chunk:')[1]) - Number(b.split(':chunk:')[1])).at(-1)
        const changed = written(tree).filter(identity => identity.startsWith(`${IDENTITY.chat}${u}:`))
        expect(changed).toEqual([last])
        for (const identity of chunkIdentities) {
            if (identity !== last) {
                expect(tree.units.find(unit => unit.identity === identity)?.reused, identity).toBe(true)
            }
        }
    })
})

describe('chat alternatives in a scoped encode', () => {
    function withAlt(): { db: Database, chaId: string } {
        const db = buildSmall(3) as unknown as Obj
        const target = (db.characters as Obj[])[1]
        ;(target.chats as Obj[])[0].alt = [
            { m: { role: 'char', data: 'first alternative', time: 1, chatId: 'alt-1' }, p: null, a: 1 },
            { m: { role: 'char', data: 'second alternative', time: 2, chatId: 'alt-2' }, p: 'x', a: 2 },
        ]
        return { db: asDatabase(db), chaId: String(target.chaId) }
    }
    const altIdentitiesOf = (tree: EncodedTree) => [...tree.index.units.keys()].filter(identity => identity.includes(':alt:')).sort()

    test('a character that is carried keeps its alternatives units and the manifest keeps the chat-alt token (new-rule guard)', async () => {
        const { db } = withAlt()
        const first = encodeWith(db)
        expect(first.manifest.req).toEqual(['chat-alt'])
        const tree = await encodeScoped(db, scopedOptions(2, first), { modules: false, characters: new Set() })
        expect(altIdentitiesOf(tree)).toEqual(altIdentitiesOf(first))
        expect(altIdentitiesOf(tree)).toHaveLength(1)
        expect(tree.manifest.req).toEqual(['chat-alt'])
        expect(written(tree).filter(identity => identity.includes(':alt:'))).toEqual([])
    })

    test('a named character is encoded with its alternatives, and a change to them alone makes it dirty (new-rule guard)', async () => {
        const { db, chaId } = withAlt()
        const first = encodeWith(db)
        const next = clone(db)
        const chat = ((next.characters as Obj[])[1].chats as Obj[])[0]
        ;(chat.alt as Obj[]).push({ m: { role: 'char', data: 'third', time: 3, chatId: 'alt-3' }, p: null, a: 3 })
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set([chaId]) })
        const u = first.index.entities.get(`${chaId}#0`) as string
        expect(written(tree).filter(identity => identity.startsWith(`${IDENTITY.chat}${u}:`))).toEqual([`${IDENTITY.chat}${u}:${(chat as { id: string }).id}:alt:0`])
    })

    function verdictFor(mutate: (slot: Obj) => void, built: Database = withAlt().db, tweak: (previous: PreviousEncoding) => void = () => undefined): string {
        const first = encodeWith(built)
        const slot = (assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[])[1]
        mutate(slot)
        const previous = previousFrom(first)
        tweak(previous)
        return characterMatchesAcknowledged(slot as unknown as character, { env: seededEnv(5), lists: fakeLists, previous })
    }
    const firstAlt = (slot: Obj): Obj => ((slot.chats as Obj[])[0].alt as Obj[])[0]

    test.each<[string, (slot: Obj) => void, string]>([
        ['the character as acknowledged', () => undefined, 'clean'],
        ['an edit inside one record', (slot) => { (firstAlt(slot).m as Obj).data = 'edited' }, 'dirty'],
        ['an added record', (slot) => { ((slot.chats as Obj[])[0].alt as Obj[]).push({ m: { role: 'char', data: 'z', time: 9 }, p: null, a: 9 }) }, 'dirty'],
        ['a removed record', (slot) => { ((slot.chats as Obj[])[0].alt as Obj[]).pop() }, 'dirty'],
        ['all alternatives removed', (slot) => { delete (slot.chats as Obj[])[0].alt }, 'dirty'],
        ['only the departure stamp of a record', (slot) => { firstAlt(slot).a = 7 }, 'dirty'],
    ])('the verdict for %s is %s', (_label, mutate, expected) => {
        expect(verdictFor(mutate)).toBe(expected)
    })

    test('an alternatives unit without a digest (a unit the boot did not hash) leaves the verdict unknown', () => {
        const dropDigest = (previous: PreviousEncoding): void => {
            const identity = [...previous.units.keys()].find(candidate => candidate.includes(':alt:')) as string
            delete previous.units.get(identity)!.digest
        }
        expect(verdictFor(() => undefined, withAlt().db, dropDigest)).toBe('unknown')
    })

    test('the acknowledged size of an entity includes its alternatives units', () => {
        const { db, chaId } = withAlt()
        const without = clone(db)
        delete (((without.characters as Obj[])[1].chats as Obj[])[0]).alt
        const sizeOf = (built: Database): number => {
            const first = encodeWith(built)
            return acknowledgedBytesOf(previousFrom(first), indexEntry(first, chaId))
        }
        const altUnit = encodeWith(db).units.find(unit => unit.type === UNIT_TYPE.chatAlt)!
        expect(sizeOf(db) - sizeOf(asDatabase(without))).toBe(altUnit.ref[1])
    })

    test('an empty alt on a chat that has none is as clean as an absent one', () => {
        expect(verdictFor((slot) => { (slot.chats as Obj[])[0].alt = [] }, buildSmall(3))).toBe('clean')
    })
})

describe('new behaviour: modules', () => {
    test('carried when not flagged, with the previous module index and units', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.modules as Obj[])[0].description = 'changed but not flagged'
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set() })
        expect(written(tree)).toEqual(['manifest'])
        expect(tree.units.some(unit => unit.identity.startsWith(IDENTITY.module) || unit.identity === IDENTITY.moduleIndex)).toBe(false)
        expect(tree.manifest.fixed.moduleIndex).toEqual(first.manifest.fixed.moduleIndex)
        expect(tree.index.objects?.moduleIndex).toEqual(first.index.objects?.moduleIndex)
        for (const [identity, unit] of first.index.units) {
            if (identity.includes('module')) {
                expect(tree.index.units.get(identity)?.key, identity).toBe(unit.key)
            }
        }
    })

    test('re-encoded when flagged', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        const module = (next.modules as Obj[])[0]
        module.description = 'changed and flagged'
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: true, characters: new Set() })
        expect(written(tree)).toEqual([`${IDENTITY.module}${module.id as string}#0`, IDENTITY.moduleIndex, 'manifest'].sort())
    })

    test('a deleted module leaves the next previous when flagged', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        const removed = ((next.modules as Obj[]).pop() as Obj).id as string
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: true, characters: new Set() })
        expect([...tree.index.units.keys()].some(identity => identity.includes(removed))).toBe(false)
        expect([...first.index.units.keys()].some(identity => identity.includes(removed))).toBe(true)
    })
})

describe('new behaviour: whole-resident mode and yielding', () => {
    test('whole-resident mode encodes every resident non-stub character', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        const lists = counting()
        await encodeScoped(db, scopedOptions(2, first, lists.lists), { modules: false, characters: 'all' })
        expect(lists.encoded.sort()).toEqual([0, 1, 2, 3, 4].map(index => chaIdOf(db, index)).sort())
    })

    test('named mode encodes exactly the named ones', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        const lists = counting()
        await encodeScoped(db, scopedOptions(2, first, lists.lists), { modules: false, characters: new Set([chaIdOf(db, 1), chaIdOf(db, 3)]) })
        expect(lists.encoded.sort()).toEqual([chaIdOf(db, 1), chaIdOf(db, 3)].sort())
    })

    test('yields once after each encoded character and never inside the codec on its own', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        let yields = 0
        const lists = counting()
        const gate = { modules: false, characters: 'all' as const, yield: async () => { yields++ ; expect(yields).toBe(lists.encoded.length) } }
        await encodeScoped(db, scopedOptions(2, first, lists.lists), gate)
        expect(yields).toBe(5)

        yields = 0
        await encodeScoped(db, scopedOptions(2, first), { modules: false, characters: new Set([chaIdOf(db, 0)]), yield: async () => { yields++ } })
        expect(yields).toBe(1)
        yields = 0
        await encodeScoped(db, scopedOptions(2, first), { modules: false, characters: new Set(), yield: async () => { yields++ } })
        expect(yields).toBe(0)
    })
})

describe('guard: dependency closure, each field changes the expected units and nothing else', () => {
    const db = buildSmall(6)
    const first = encodeWith(db)
    const chaId = chaIdOf(db, 0)
    const u = first.index.entities.get(`${chaId}#0`) as string
    const shard = `shard:${shardOfU(u)}`
    const chatId = (((db.characters[0] as unknown as { chats: { id: string }[] }).chats)[0]).id
    const none = new Set<string>()
    const named = new Set([chaId])

    interface Case {
        label: string
        mutate: (db: Obj) => void
        scope: EncodeScope
        expected: string[]
        /** Whether a full encode of the same database writes the same units; false where the scope deliberately carries. */
        fullAgrees: boolean
    }

    const slot = (db: Obj): Obj => (db.characters as Obj[])[0]
    const fixed = (label: string, mutate: (db: Obj) => void, expected: string[]): Case => ({
        label, mutate, scope: { modules: false, characters: none }, expected: [...expected, 'manifest'].sort(), fullAgrees: true,
    })
    const owned = (label: string, mutate: (db: Obj) => void, expected: string[]): Case => ({
        label, mutate, scope: { modules: false, characters: named }, expected: [...expected, shard, 'manifest'].sort(), fullAgrees: true,
    })
    const moduleId = (db0: Obj): string => (db0.modules as Obj[])[1].id as string

    const cases: Case[] = [
        fixed('a preset', d => { ((d.botPresets as Obj[])[1]).temperature = 999 }, ['preset:1']),
        fixed('pluginV2', d => { ((d.pluginV2 as Obj[])[0]).enabled = false }, ['plugin:pluginV2:0']),
        fixed('plugins', d => { ((d.plugins as Obj[])[1]).version = 9 }, ['plugin:plugins:1']),
        fixed('characterOrder', d => { (d.characterOrder as string[]).reverse() }, ['order']),
        fixed('statics', d => { d.statics = { messages: 99 } }, ['statics']),
        fixed('loadouts', d => { d.loadouts = [{ name: 'one' }] }, ['loadouts']),
        fixed('a plugin storage value', d => { ((d.pluginCustomStorage as Obj)['plugin-3'] as Obj).counter = 77 }, ['psv:plugin-3', `bucket:${bucketOfKey('plugin-3')}`]),
        fixed('a config field', d => { d.username = 'Someone Else' }, ['config']),
        { label: 'a module when flagged', mutate: d => { (d.modules as Obj[])[1].description = 'flagged edit' }, scope: { modules: true, characters: none },
            expected: [`${IDENTITY.module}${moduleId(clone(db))}#0`, IDENTITY.moduleIndex, 'manifest'].sort(), fullAgrees: true },
        { label: 'a module when not flagged', mutate: d => { (d.modules as Obj[])[1].description = 'unflagged edit' }, scope: { modules: false, characters: none },
            expected: ['manifest'], fullAgrees: false },
        owned('a character core field', d => { slot(d).personality = 'new personality' }, [`${IDENTITY.char}${u}:core`]),
        owned('a character lore entry', d => { ((slot(d).globalLore as Obj[])[0]).content = 'new lore' }, [`${IDENTITY.char}${u}:lore`]),
        owned('a character script', d => { slot(d).customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }] }, [`${IDENTITY.char}${u}:scripts`]),
        owned('a chat message', d => { (((slot(d).chats as Obj[])[0].message as Obj[])[0]).data = 'edited message' }, [`${IDENTITY.chat}${u}:${chatId}:chunk:0`]),
        owned('a chat core field', d => { (slot(d).chats as Obj[])[0].note = 'a note' }, [`${IDENTITY.chat}${u}:${chatId}:core`]),
        owned('a moved field of a resident (trashTime)', d => { slot(d).trashTime = 4242 }, []),
        {
            label: 'a character field when it is not named', mutate: d => { slot(d).personality = 'unnamed edit' },
            scope: { modules: false, characters: none }, expected: ['manifest'], fullAgrees: false,
        },
    ]

    test.each(cases.map(one => [one.label, one] as const))('%s', async (_label, one) => {
        const next = clone(db)
        one.mutate(next)
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), one.scope)
        expect(written(tree)).toEqual(one.expected)
        if (one.fullAgrees) {
            const full = encodeWith(asDatabase(next), { env: seededEnv(2), previous: previousFrom(first), seq: 2 })
            expect(written(full)).toEqual(one.expected)
        }
    })
})

describe('stub guards (F2): the entry follows the stub, the body is never encoded', () => {
    function stubbed(): { db: Database, first: EncodedTree, chaId: string, u: string } {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const chaId = chaIdOf(db, 1)
        return { db, first, chaId, u: first.index.entities.get(`${chaId}#0`) as string }
    }

    /** `db` with the character `chaId` replaced by the stub that names its entity in `first`. */
    function withStub(first: EncodedTree, db: Database, chaId: string, trashTime: number | undefined, tweak: Obj = {}): Database {
        const next = clone(db)
        const characters = next.characters as Obj[]
        const index = characters.findIndex(slot => slot.chaId === chaId)
        const source = JSON.parse(JSON.stringify(characters[index])) as Obj
        if (trashTime !== undefined) {
            source.trashTime = trashTime
        }
        const u = first.index.entities.get(`${chaId}#0`) as string
        characters[index] = { ...(buildColdStub(source as unknown as character, u, ['chat-a']) as unknown as Obj), ...tweak }
        return asDatabase(next)
    }

    test('trashing a stub writes its trashTime into the entry and encodes no body', async () => {
        const { db, first, chaId, u } = stubbed()
        const lists = counting()
        const tree = await encodeScoped(withStub(first, db, chaId, 1234), scopedOptions(2, first, lists.lists), { modules: false, characters: 'all' })
        expect(indexEntry(tree, chaId).trashTime).toBe(1234)
        expect(written(tree)).toEqual([`shard:${shardOfU(u)}`, 'manifest'].sort())
        expect(lists.encoded).not.toContain(chaId)
        const before = indexEntry(first, chaId)
        expect({ ...indexEntry(tree, chaId), trashTime: undefined }).toEqual({ ...before, trashTime: undefined })
    })

    test('restoring a stub from trash clears the entry trashTime', async () => {
        const { db, first, chaId } = stubbed()
        const trashed = await encodeScoped(withStub(first, db, chaId, 1234), scopedOptions(2, first), { modules: false, characters: new Set() })
        expect(indexEntry(trashed, chaId).trashTime).toBe(1234)
        const restored = await encodeScoped(withStub(first, db, chaId, undefined), scopedOptions(3, trashed), { modules: false, characters: new Set() })
        expect(Object.hasOwn(indexEntry(restored, chaId), 'trashTime')).toBe(false)
        expect(indexEntry(restored, chaId)).toEqual(indexEntry(first, chaId))
        expect(entryOf(restored, chaId, trashed, first).trashTime).toBeUndefined()
    })

    test('the entry keeps the previous chat state and takes the stub\'s name and tags', async () => {
        const { db, first, chaId } = stubbed()
        const tree = await encodeScoped(withStub(first, db, chaId, undefined, { name: 'Renamed', tags: ['new-tag'], lastInteraction: 777 }), scopedOptions(2, first), { modules: false, characters: new Set() })
        const entry = indexEntry(tree, chaId)
        const before = indexEntry(first, chaId)
        expect(entry.name).toBe('Renamed')
        expect(entry.tags).toEqual(['new-tag'])
        expect(entry.lastInteraction).toBe(777)
        expect(entry.chats).toEqual(before.chats)
        expect(entry.core).toEqual(before.core)
        expect(entry.chatPage).toBe(before.chatPage)
        expect(entry.firstMsgIndex).toBe(before.firstMsgIndex)
    })

    test('a stub is never encoded even when named', async () => {
        const { db, first, chaId } = stubbed()
        const lists = counting()
        await encodeScoped(withStub(first, db, chaId, 5), scopedOptions(2, first, lists.lists), { modules: false, characters: new Set([chaId]) })
        expect(lists.encoded).not.toContain(chaId)
    })

    test('a stub the previous encoding does not hold is refused', async () => {
        const { db, first } = stubbed()
        const next = clone(db)
        ;(next.characters as Obj[]).push({ ...(buildColdStub(JSON.parse(JSON.stringify((next.characters as Obj[])[0])) as unknown as character, 'k', []) as unknown as Obj), chaId: 'unknown-stub' })
        await expect(encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set() })).rejects.toThrow(StubRefusedError)
    })

    test('new behaviour: a stub that names another entity or a legacy file is refused, one that names its own entity is carried', async () => {
        const { db, first, chaId, u } = stubbed()
        const other = first.index.entities.get(`${chaIdOf(db, 2)}#0`) as string
        const refuses = async (coldstorage: string): Promise<void> => {
            const next = withStub(first, db, chaId, undefined, { coldstorage })
            await expect(encodeScoped(next, scopedOptions(2, first), { modules: false, characters: new Set() })).rejects.toMatchObject({
                name: 'StubRefusedError', kind: 'character', chaId,
            })
        }
        await refuses(other)
        await refuses('3f1c2b7e-5a49-4d6e-9b1d-0a7c8e2f4a10')
        const own = await encodeScoped(withStub(first, db, chaId, undefined), scopedOptions(2, first), { modules: false, characters: new Set() })
        expect(indexEntry(own, chaId)).toEqual(indexEntry(first, chaId))
        expect(u).toBe(indexEntry(first, chaId).u)
    })

    test('the carried stub assembles with the previous body, so the shard entry never outruns its units', async () => {
        const { db, first, chaId } = stubbed()
        const tree = await encodeScoped(withStub(first, db, chaId, 1234), scopedOptions(2, first), { modules: false, characters: new Set() })
        const assembled = assembleDatabase(tree.manifest, storeOf(first, tree))
        const slot = (assembled.characters as unknown as { chaId: string, trashTime?: number, chats: unknown[] }[]).find(one => one.chaId === chaId)
        expect(slot?.trashTime).toBe(1234)
        expect(slot?.chats.length).toBe(2)
    })
})

describe('a shared chaId is never carried (reproducers of the duplicate-holder loss)', () => {
    function duplicated(): { db: Database, first: EncodedTree, dup: string } {
        const base = clone(buildSmall(3))
        const chars = base.characters as Obj[]
        chars[1] = { ...chars[1], chaId: chars[0].chaId as string, name: 'Second holder', personality: 'SECOND BODY' }
        const db = asDatabase(base)
        return { db, first: encodeWith(db), dup: chars[0].chaId as string }
    }

    function assembledFrom(first: EncodedTree, tree: EncodedTree): Obj[] {
        return assembleDatabase(tree.manifest, storeOf(first, tree)).characters as unknown as Obj[]
    }

    test('P1: the stub of a shared id is refused with the id named, not matched to the other holder\'s entry', async () => {
        const { db, first, dup } = duplicated()
        const next = clone(db)
        const second = JSON.parse(JSON.stringify((next.characters as Obj[])[1])) as Obj
        ;(next.characters as Obj[]).splice(0, 2, buildColdStub(second as unknown as character, 'k', []) as unknown as Obj)
        const attempt = encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set([dup]) })
        await expect(attempt).rejects.toThrow(SharedChaIdStubError)
        await expect(attempt).rejects.toMatchObject({ chaId: dup })
        await expect(attempt).rejects.toBeInstanceOf(CodecInputError)
    })

    test('a duplicate holder appended to a carried character: both are encoded, none is carried under the other\'s entry', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        const characters = next.characters as Obj[]
        characters.push({ ...JSON.parse(JSON.stringify(characters[0])) as Obj, name: 'Copy', personality: 'COPY' })
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set() })
        const stored = assembledFrom(first, tree)
        expect(stored[0].personality).toBe((db.characters[0] as unknown as Obj).personality)
        expect(stored[3].personality).toBe('COPY')
        expect(stored[3].name).toBe('Copy')
    })

    test('P1b: with one holder deleted the survivor is encoded whole, never given the deleted holder\'s entry', async () => {
        const { db, first } = duplicated()
        const next = clone(db)
        ;(next.characters as Obj[]).splice(0, 1)
        const tree = await encodeScoped(asDatabase(next), scopedOptions(2, first), { modules: false, characters: new Set() })
        const survivor = assembledFrom(first, tree)[0]
        expect(survivor.name).toBe('Second holder')
        expect(survivor.personality).toBe('SECOND BODY')
    })

    test('two resident holders are both encoded though nothing names them', async () => {
        const { db, first } = duplicated()
        const lists = counting()
        await encodeScoped(db, scopedOptions(2, first, lists.lists), { modules: false, characters: new Set() })
        expect(lists.encoded.filter(chaId => chaId === chaIdOf(db, 0)).length).toBe(2)
    })
})

describe('skipping a character whose data cannot be read', () => {
    const cycle = (): Obj => {
        const value: Obj = {}
        value.self = value
        return value
    }
    const tooDeep = (): unknown => {
        let value: unknown[] = []
        for (let i = 0; i < 200_000; i++) {
            value = [value]
        }
        return value
    }
    const OFFENDERS: Array<[string, () => unknown]> = [
        ['a cycle', cycle],
        ['a BigInt', () => BigInt(1)],
        ['a toJSON that throws', () => ({ toJSON() { throw new Error('toJSON fault') } })],
        ['nesting too deep', tooDeep],
    ]
    const SKIPPING: Pick<EncodeScope, 'skipUnsavableCharacters'> = { skipUnsavableCharacters: true }

    function unitsOf(...trees: EncodedTree[]): { get(key: string): Uint8Array | undefined } {
        return storeOf(...trees)
    }

    function assembledCharacters(...trees: EncodedTree[]): Obj[] {
        const last = trees[trees.length - 1]
        return assembleDatabase(last.manifest, unitsOf(...trees)).characters as unknown as Obj[]
    }

    /** `buildSmall(4)` encoded once; the next database is a copy whose character 1 carries the offender and character 2 an edit. */
    function offending(make: () => unknown): { db: Database, first: EncodedTree, next: Database, id1: string, id2: string } {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const copy = clone(db)
        const characters = copy.characters as Obj[]
        characters[1].personality = make()
        characters[2].personality = 'edited while the neighbour is unsavable'
        return { db, first, next: asDatabase(copy), id1: chaIdOf(db, 1), id2: chaIdOf(db, 2) }
    }

    describe('a character the previous encoding holds is carried', () => {
        test.each(OFFENDERS)('reproducer: %s is skipped, its last saved copy is kept and the other edit lands', async (_label, make) => {
            const { db, first, next, id1, id2 } = offending(make)
            const scope: EncodeScope = { modules: false, characters: new Set([id1, id2]), ...SKIPPING }
            const plan = await planScopedEncode(next, scopedOptions(2, first), scope)
            expect(plan.skipped.map(({ chaId, saved }) => ({ chaId, saved }))).toEqual([{ chaId: id1, saved: true }])
            expect(plan.encoded).toEqual([id2])

            const tree = await encodeScoped(next, scopedOptions(2, first), scope)
            // The entry and every unit of the skipped character are the previous ones, and its handle is still held.
            expect(tree.index.entities.get(`${id1}#0`)).toBe(first.index.entities.get(`${id1}#0`))
            expect(indexEntry(tree, id1)).toEqual(indexEntry(first, id1))
            for (const [identity, unit] of first.index.units) {
                if (identity.includes(indexEntry(first, id1).u)) {
                    expect(tree.index.units.get(identity)?.key, identity).toBe(unit.key)
                }
            }
            const stored = assembledCharacters(first, tree)
            expect(stored[2].personality).toBe('edited while the neighbour is unsavable')
            expect(stored[1].personality).toBe((db.characters[1] as unknown as Obj).personality)

            // A second pass over the tree that committed still holds the skipped character: its last copy survives a chain of skips.
            const again = await encodeScoped(next, scopedOptions(3, tree), scope)
            expect(again.index.entities.get(`${id1}#0`)).toBe(first.index.entities.get(`${id1}#0`))
            expect(indexEntry(again, id1)).toEqual(indexEntry(first, id1))
            expect(assembledCharacters(first, tree, again)[1].personality).toBe((db.characters[1] as unknown as Obj).personality)
        })
    })

    describe('a character the previous encoding does not hold is left out', () => {
        function appended(make: () => unknown): { db: Database, first: EncodedTree, next: Database, id2: string, fresh: string, changed: Obj[] } {
            const db = buildSmall(4)
            const first = encodeWith(db)
            const copy = clone(db)
            const characters = copy.characters as Obj[]
            characters[2].personality = 'edited while the new character is unsavable'
            characters.push({ ...JSON.parse(JSON.stringify(characters[0])) as Obj, chaId: 'never-saved-character', name: 'Never saved', personality: make() })
            return { db, first, next: asDatabase(copy), id2: chaIdOf(db, 2), fresh: 'never-saved-character', changed: characters }
        }

        test.each(OFFENDERS)('reproducer: %s is omitted with no entity id, and a later fix gives it one', async (_label, make) => {
            const { first, next, id2, fresh, changed } = appended(make)
            const scope: EncodeScope = { modules: false, characters: new Set([id2, fresh]), ...SKIPPING }
            const plan = await planScopedEncode(next, scopedOptions(2, first), scope)
            expect(plan.skipped.map(({ chaId, saved }) => ({ chaId, saved }))).toEqual([{ chaId: fresh, saved: false }])
            expect(plan.encoded).toEqual([id2])

            const tree = await encodeScoped(next, scopedOptions(2, first), scope)
            expect(tree.index.entities.has(`${fresh}#0`)).toBe(false)
            expect(() => indexEntry(tree, fresh)).toThrow()
            const stored = assembledCharacters(first, tree)
            expect(stored.length).toBe(4)
            expect(stored[2].personality).toBe('edited while the new character is unsavable')

            // `next` is the same object as the copy `changed` belongs to.
            changed[4].personality = 'fixed'
            const fixed = await encodeScoped(next, scopedOptions(3, tree), scope)
            expect(fixed.index.entities.has(`${fresh}#0`)).toBe(true)
            expect(indexEntry(fixed, fresh).chaId).toBe(fresh)
        })
    })

    describe('guard: what is not a fault of the character\'s data still fails the pass', () => {
        const fault = new Error('list derivation fault')
        const failing = (which: 'characterAssets' | 'characterInlays'): ListDerivation => ({
            ...fakeLists,
            [which]: () => { throw fault },
        })

        test.each(['characterAssets', 'characterInlays'] as const)('a %s fault after the encoder started rejects with that error for a saved character', async (which) => {
            const { first, next, id1 } = offending(() => 'fine')
            const attempt = encodeScoped(next, scopedOptions(2, first, failing(which)), { modules: false, characters: new Set([id1]), ...SKIPPING })
            await expect(attempt).rejects.toBe(fault)
        })

        test.each(['characterAssets', 'characterInlays'] as const)('a %s fault after the encoder started rejects with that error for a character never saved', async (which) => {
            const db = buildSmall(4)
            const first = encodeWith(db)
            const copy = clone(db)
            const characters = copy.characters as Obj[]
            characters.push({ ...JSON.parse(JSON.stringify(characters[0])) as Obj, chaId: 'never-saved-character', name: 'Never saved' })
            const attempt = encodeScoped(asDatabase(copy), scopedOptions(2, first, failing(which)), {
                modules: false, characters: new Set(['never-saved-character']), ...SKIPPING,
            })
            await expect(attempt).rejects.toBe(fault)
        })

        test('a shared chaId is not skipped', async () => {
            const base = clone(buildSmall(3))
            const characters = base.characters as Obj[]
            characters[1] = { ...characters[1], chaId: characters[0].chaId as string }
            const first = encodeWith(asDatabase(JSON.parse(JSON.stringify(base)) as Obj))
            characters[1].personality = cycle()
            const attempt = encodeScoped(asDatabase(base), scopedOptions(2, first), {
                modules: false, characters: new Set([characters[0].chaId as string]), ...SKIPPING,
            })
            await expect(attempt).rejects.toBeInstanceOf(CodecInputError)
        })

        test('a chat that is still a cold-storage pointer refuses with the stub error, unwrapped', async () => {
            const { first, next, id1 } = offending(() => 'fine')
            const slot = (next.characters as unknown as Obj[])[1]
            slot.chats = [{ id: 'pointer', message: [{ data: `${COLD_POINTER_HEADER}key`, role: 'char' }] }]
            const attempt = encodeScoped(next, scopedOptions(2, first), { modules: false, characters: new Set([id1]), ...SKIPPING })
            await expect(attempt).rejects.toBeInstanceOf(StubRefusedError)
        })
    })

    describe('the skip predicate', () => {
        test('data faults are skippable', () => {
            expect(isSkippableCharacterFault(new CodecInputError('not plain'))).toBe(true)
            expect(isSkippableCharacterFault(new Error('toJSON'))).toBe(true)
            expect(isSkippableCharacterFault(new RangeError('too deep'))).toBe(true)
            expect(isSkippableCharacterFault('a string thrown by a getter')).toBe(true)
        })

        test('an assemble invariant and a stub refusal are not skippable', () => {
            expect(isSkippableCharacterFault(new CodecAssembleError('has no chunk'))).toBe(false)
            expect(isSkippableCharacterFault(new StubRefusedError('chat', 'c', 0))).toBe(false)
        })
    })

    describe('guard: the flag is opt-in, so an import or an install still fails whole', () => {
        test('a pass that does not set the flag rejects a named character that cannot be read', async () => {
            const { first, next } = offending(cycle)
            await expect(encodeScoped(next, scopedOptions(2, first), EVERYTHING)).rejects.toBeInstanceOf(CodecInputError)
            await expect(planScopedEncode(next, scopedOptions(2, first), EVERYTHING)).rejects.toBeInstanceOf(CodecInputError)
        })

        test('a first encode with every character named and no previous rejects without the flag, and produces no skipped list', async () => {
            const { next } = offending(cycle)
            await expect(planScopedEncode(next, { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: NOW }, EVERYTHING)).rejects.toBeInstanceOf(CodecInputError)
        })

        test('the whole-tree install refuses the character', async () => {
            const { next } = offending(cycle)
            await expect(planWholeTreeInstall(next, { lists: fakeLists, env: seededEnv(1), convertedFrom: 'test' })).rejects.toBeInstanceOf(CodecInputError)
        })
    })

    describe('equivalence: the split of encodeCharacter changes nothing', () => {
        test('the composition of the two halves gives the entry and entity ids of encodeCharacter', () => {
            const db = buildSmall(4)
            const options: EncodeOptions = { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: NOW }
            const whole = new Encoder(options, null)
            const halves = new Encoder({ ...options, env: seededEnv(1) }, null)
            for (let position = 0; position < db.characters.length; position++) {
                const slot = db.characters[position]
                expect(emitCharacter(normalizeCharacter(slot, position), halves)).toEqual(encodeCharacter(slot, position, whole))
            }
            expect([...halves.entities]).toEqual([...whole.entities])
        })
    })
})