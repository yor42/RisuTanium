// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { crc32, type JsonObject } from 'src/ts/storage/blockFrame'
import type { Database, character } from 'src/ts/storage/database.svelte'
import {
    createMemoryBackend, Store2BackendFailureError, type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import {
    assembleCharacter, assembleDatabase, CodecAssembleError, stubFromEntry, unitDigest, type ListDerivation, type PluginBody, type UnitSource,
} from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import {
    encodeUnit, FRAME_HEADER_BYTES, keyOfRef, newUnitKey, randomId26, refOfFrame, UNIT_TYPE, type KeyEnv, type ShardEntry,
} from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency, type Residency } from 'src/ts/storage/store2/residency'
import { getResidency, isEntityUnitKey, registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { residentSetOf } from 'src/ts/storage/store2/residencyPolicy'
import { createSaveEncoder, type SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes, type ResidentPlanInput } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The residency library (policy, registry, `createResidency`) over a real memory backend and the real boot tree read.
 * Nothing in the application imports it yet: these cases are new behaviour, and the hand-back lists the mutant that
 * turns each red.
 */

const NOW = 1_700_000_000_000

afterEach(() => {
    resetResidencyForTest()
})

interface Booted {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    /** The `u` the boot kept resident; every other entry is a stub in `db`. */
    resident: ReadonlySet<string>
    stubs: ShardEntry[]
    encoder: SaveEncoder
    residency: Residency
    /** The units the boot's own read took (only the residents' leaves). */
    bootSource: UnitSource
    /** Every unit of the tree. */
    source: UnitSource
}

/** Boots `source` the way a store2 page will: the policy decides who is resident, the others are stubs of their entries. */
async function bootOf(source: Database, options: { backend?: (memory: MemoryBackend) => Store2Backend, lists?: ListDerivation } = {}): Promise<Booted> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const lists = options.lists ?? fakeLists
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, env, lists)
    let resident: ReadonlySet<string> = new Set()
    const read = await readTreeBytes(memory, seeded.manifestKey, {
        resident: (input) => {
            resident = residentSetOf(input)
            return resident
        },
    })
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source, {
        character: (entry, units) => (resident.has(entry.u) ? assembleCharacter(entry, units) : stubFromEntry(entry)),
    })
    const previous = previousOfTree(read.tree)
    const entries = (previous.objects?.shards ?? []).flatMap(shard => shard.entries)
    const context = { lists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists, env: seededEnv(77), now: () => NOW }) }
    const { encoder } = context
    const backend = options.backend?.(memory) ?? memory
    const residency = createResidency({ backend, context })
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    return {
        memory, db, entries, resident, stubs: entries.filter(entry => !resident.has(entry.u)), encoder, residency,
        bootSource: read.tree.source, source: full.tree.source,
    }
}

function archiving(characters = 4, extra: Obj = {}): Database {
    return { ...(buildSmall(characters) as unknown as Obj), archiveCharacters: true, ...extra } as unknown as Database
}

function entryOf(booted: Booted, index: number): ShardEntry {
    return booted.stubs[index]
}

function plan(entries: Array<{ u: string, chaId: string }>, config: JsonObject | null, plugins: PluginBody[] = []): ResidentPlanInput {
    return { entries: entries as unknown as ShardEntry[], config, plugins }
}

describe('new behaviour: the boot policy', () => {
    const ids = (...chaIds: string[]) => chaIds.map((chaId, index) => ({ u: `u${index}`, chaId }))
    const residentIds = (input: ResidentPlanInput): string[] => input.entries.filter(entry => residentSetOf(input).has(entry.u)).map(entry => entry.chaId)

    test('with archiving off, or a config that did not check, everything is resident', () => {
        const entries = ids('aaaa', 'bbbb', 'cccc')
        expect(residentIds(plan(entries, { archiveCharacters: false }))).toEqual(['aaaa', 'bbbb', 'cccc'])
        expect(residentIds(plan(entries, null))).toEqual(['aaaa', 'bbbb', 'cccc'])
    })

    test('with archiving on, or the setting absent, a plain unique id is a stub', () => {
        const entries = ids('aaaa', 'bbbb')
        expect(residentIds(plan(entries, { archiveCharacters: true }))).toEqual([])
        expect(residentIds(plan(entries, {}))).toEqual([])
    })

    test('a hidden-character id, an empty id, an id that cannot name a block and a shared id stay resident', () => {
        const entries = ids('§hidden', '', 'root', 'x'.repeat(300), 'shared', 'shared', 'plain')
        expect(residentIds(plan(entries, { archiveCharacters: true }))).toEqual(['§hidden', '', 'root', 'x'.repeat(300), 'shared', 'shared'])
    })

    test('an enabled V2.1 plugin does not change who is resident', () => {
        const entries = ids('aaaa', 'bbbb')
        const plugin: PluginBody = { v: 1, list: 'plugins', plugin: { name: 'relay', version: '2.1', enabled: true } }
        expect(residentIds(plan(entries, { archiveCharacters: true }, [plugin]))).toEqual([])
    })

    test('a tree read with the policy reads only the resident entities: a shared id is read for both holders, and a unique one not at all', async () => {
        const db = archiving(5) as unknown as Obj
        const characters = db.characters as Obj[]
        characters[1] = { ...characters[1], chaId: characters[0].chaId, name: 'Second holder' }
        characters[2] = { ...characters[2], chaId: '§hidden' }
        const booted = await bootOf(db as unknown as Database)
        const byChaId = (chaId: string): ShardEntry[] => booted.entries.filter(entry => entry.chaId === chaId)
        expect(byChaId(String(characters[0].chaId))).toHaveLength(2)
        expect(booted.stubs.map(entry => entry.chaId).sort()).toEqual([String(characters[3].chaId), String(characters[4].chaId)].sort())
        expect(booted.entries).toHaveLength(5)
        for (const entry of booted.entries) {
            const isStub = booted.stubs.some(stub => stub.u === entry.u)
            expect(booted.resident.has(entry.u), entry.chaId).toBe(!isStub)
            // The boot's own read took the leaves of the residents and none of a stub's.
            expect(booted.bootSource.get(keyOfRef(entry.core)) !== undefined, entry.chaId).toBe(!isStub)
            expect(booted.bootSource.get(keyOfRef(entry.chats[0].chunks[0])) !== undefined, entry.chaId).toBe(!isStub)
        }
        // A stub of the boot is a stub in the assembled database, a resident is a whole character.
        const live = booted.db.characters as unknown as Obj[]
        for (const slot of live) {
            expect(Boolean(slot.coldstorage), String(slot.chaId)).toBe(booted.stubs.some(stub => stub.chaId === slot.chaId))
        }
    })
})

describe('new behaviour: the registry and the entity key shape', () => {
    test('a registered residency is the one asked for, a later one replaces it, and a reset clears it', async () => {
        const booted = await bootOf(archiving())
        expect(getResidency()).toBeNull()
        registerResidency(booted.residency)
        expect(getResidency()).toBe(booted.residency)
        const later = await bootOf(archiving())
        registerResidency(later.residency)
        expect(getResidency()).toBe(later.residency)
        resetResidencyForTest()
        expect(getResidency()).toBeNull()
    })

    test('isEntityUnitKey accepts every entity id the key generator makes and nothing a legacy cold-storage key looks like', () => {
        const env: KeyEnv = seededEnv(3)
        for (let i = 0; i < 200; i++) {
            expect(isEntityUnitKey(randomId26(env))).toBe(true)
        }
        expect(isEntityUnitKey('0'.repeat(26))).toBe(true)
        expect(isEntityUnitKey('v'.repeat(26))).toBe(true)
        const uuid = '3f1c2b7e-5a49-4d6e-9b1d-0a7c8e2f4a10'
        for (const key of [uuid, `${uuid}_accessMeta`, '', 'a'.repeat(25), 'a'.repeat(27), 'w'.repeat(26), 'A'.repeat(26), `${'a'.repeat(25)}-`, uuid.replace(/-/g, '')]) {
            expect(isEntityUnitKey(key), key).toBe(false)
        }
    })
})

describe('new behaviour: a character read from its units', () => {
    test('the entry is the acknowledged encoding\'s, and an unknown entity has none', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        expect(booted.residency.entryOf(entry.u)).toEqual(entry)
        expect(booted.residency.entryOf('0'.repeat(26))).toBeNull()
    })

    test('the character comes back whole and equal to the one assembled from the full tree, with the size of its units', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 1)
        const read = await booted.residency.readCharacter(entry.u)
        if (read.status !== 'ok') {
            throw new Error(`The read was ${read.status}.`)
        }
        expect(read.value.character).toEqual(assembleCharacter(entry, booted.source))
        expect(read.bytes).toBeGreaterThan(0)
        expect((read.value.character.chats as unknown[]).length).toBe(entry.chats.length)
    })

    test('a copy read hydrates nothing, a load hydrates every unit of the entity in place', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        const units = (): Array<[string, string | undefined]> =>
            [...booted.encoder.acknowledged().units].filter(([identity]) => identity.includes(entry.u)).map(([identity, unit]) => [identity, unit.digest])
        expect(units().length).toBeGreaterThan(0)
        expect(units().every(([, digest]) => digest === undefined)).toBe(true)

        await booted.residency.readCharacter(entry.u)
        expect(units().every(([, digest]) => digest === undefined)).toBe(true)

        const held = new Map(booted.encoder.acknowledged().units)
        const read = await booted.residency.load(entry.u)
        expect(read.status).toBe('ok')
        expect(units().every(([, digest]) => digest !== undefined)).toBe(true)
        for (const [identity, unit] of booted.encoder.acknowledged().units) {
            expect(unit, identity).toBe(held.get(identity))
        }
        const core = booted.encoder.acknowledged().units.get(`char:${entry.u}:core`)
        expect(core?.digest).toBe(unitDigest(booted.source.get(keyOfRef(entry.core)) as Uint8Array))
    })

    test('a loaded character is clean, an edited one dirty, and the first pass over the loaded one writes nothing', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 2)
        const read = await booted.residency.load(entry.u)
        if (read.status !== 'ok') {
            throw new Error(`The load was ${read.status}.`)
        }
        const loaded = JSON.parse(JSON.stringify(read.value.character)) as Obj
        const live = booted.db as unknown as { characters: Obj[] }
        const index = live.characters.findIndex(slot => slot.chaId === entry.chaId)
        expect(booted.residency.verdict(loaded as unknown as character)).toBe('clean')
        live.characters[index] = loaded
        const pass = await booted.encoder.plan(booted.db, { marked: new Set([entry.chaId]), modules: false, whole: false })
        expect(pass.newUnits).toBe(1)
        expect(pass.unchanged).toBe(true)
        loaded.personality = 'edited after the load'
        expect(booted.residency.verdict(loaded as unknown as character)).toBe('dirty')
    })

    test('a character that was not loaded has no verdict: its units carry no digest', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        const copy = await booted.residency.readCharacter(entry.u)
        if (copy.status !== 'ok') {
            throw new Error('The copy read failed.')
        }
        expect(booted.residency.verdict(copy.value.character as unknown as character)).toBe('unknown')
    })
})

describe('new behaviour: a read that fails answers by the cold-storage vocabulary, and a u is never missing', () => {
    function flipByte(memory: MemoryBackend, key: string): void {
        const bytes = new Uint8Array(memory.snapshot().get(key) as Uint8Array)
        bytes[FRAME_HEADER_BYTES + 1] ^= 0xff
        memory.poke(key, bytes)
    }

    const damages: Array<[string, (booted: Booted, entry: ShardEntry) => void]> = [
        ['a unit that is absent', (booted, entry) => booted.memory.poke(keyOfRef(entry.core), null)],
        ['a chat chunk that is absent', (booted, entry) => booted.memory.poke(keyOfRef(entry.chats[0].chunks[0]), null)],
        ['a unit whose bytes are flipped', (booted, entry) => flipByte(booted.memory, keyOfRef(entry.core))],
        ['an asset list that is absent', (booted, entry) => booted.memory.poke(keyOfRef(entry.al), null)],
    ]

    test.each(damages)('%s is an error of kind damaged, for the copy read and the load', async (_label, damage) => {
        for (const how of ['readCharacter', 'load'] as const) {
            const booted = await bootOf(archiving())
            const entry = entryOf(booted, 0)
            damage(booted, entry)
            const read = await booted.residency[how](entry.u)
            expect(read.status, how).toBe('error')
            expect(read.status, how).not.toBe('missing')
            expect(read).toMatchObject({ status: 'error', kind: 'damaged' })
        }
    })

    test('an entity the acknowledged encoding does not hold is an error of kind damaged', async () => {
        const booted = await bootOf(archiving())
        for (const how of ['readCharacter', 'load'] as const) {
            const read = await booted.residency[how]('0'.repeat(26))
            expect(read).toMatchObject({ status: 'error', kind: 'damaged' })
        }
    })

    test('a backend that fails is an error with no kind, whether it throws its own error or any other', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        booted.memory.injectFault(1, 'fail')
        const failed = await booted.residency.readCharacter(entry.u)
        expect(failed.status).toBe('error')
        expect(failed).not.toHaveProperty('kind')
        expect((failed as { error: unknown }).error).toBeInstanceOf(Store2BackendFailureError)

        const thrown = await bootOf(archiving(), {
            backend: memory => ({ ...memory, readUnits: async () => { throw new TypeError('the page lost its storage') } }),
        })
        const other = await thrown.residency.load(entryOf(thrown, 0).u)
        expect(other.status).toBe('error')
        expect(other).not.toHaveProperty('kind')
        expect((other as { error: unknown }).error).toBeInstanceOf(TypeError)
    })

    test('a unit a newer build wrote is an error with no kind, not damage', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        const bytes = new Uint8Array(booted.memory.snapshot().get(keyOfRef(entry.core)) as Uint8Array)
        // The format version byte of the frame header; the header checksum is recomputed by the helper below.
        const header = bytes.subarray(0, 12)
        header[4] = 9
        new DataView(bytes.buffer, bytes.byteOffset + 12, 4).setUint32(0, crc32(header), true)
        booted.memory.poke(keyOfRef(entry.core), bytes)
        const read = await booted.residency.readCharacter(entry.u)
        expect(read.status).toBe('error')
        expect(read).not.toHaveProperty('kind')
    })

    test('units that pass their check but do not hold a character are an error of kind damaged, never missing', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        // A core unit with a valid frame and a body whose `f` is not an object: the unit check accepts it, assembly cannot.
        const bytes = encodeUnit(UNIT_TYPE.characterCore, { v: 1, f: 'not an object' })
        const key = newUnitKey(seededEnv(31))
        await booted.memory.putUnit(key, bytes)
        // `entry` is the object the acknowledged encoding holds, so the residency reads the crafted core.
        entry.core = refOfFrame(key, bytes)
        for (const how of ['readCharacter', 'load'] as const) {
            const read = await booted.residency[how](entry.u)
            expect(read.status, how).toBe('error')
            expect(read, how).toMatchObject({ status: 'error', kind: 'damaged' })
            expect((read as { error: unknown }).error, how).toBeInstanceOf(CodecAssembleError)
        }
    })

    test('a failed load leaves the digests as they were: nothing was hydrated', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 0)
        booted.memory.poke(keyOfRef(entry.chats[0].chunks[0]), null)
        await booted.residency.load(entry.u)
        const hydrated = [...booted.encoder.acknowledged().units].filter(([identity, unit]) => identity.includes(entry.u) && unit.digest !== undefined)
        expect(hydrated).toEqual([])
    })
})

describe('new behaviour: the stub for a live character', () => {
    test('it names the acknowledged entry\'s entity and carries the live fields a stub may change', async () => {
        const booted = await bootOf(archiving())
        const entry = entryOf(booted, 1)
        const read = await booted.residency.load(entry.u)
        if (read.status !== 'ok') {
            throw new Error('The load failed.')
        }
        const live = JSON.parse(JSON.stringify(read.value.character)) as Obj
        live.name = 'Renamed since the commit'
        live.trashTime = 5150
        live.lastInteraction = 99
        live.creatorNotes = 'new notes'
        live.tags = ['fresh']
        const stub = booted.residency.stubFor(live as unknown as character) as Obj
        expect(stub.coldstorage).toBe(entry.u)
        expect(stub.chaId).toBe(entry.chaId)
        expect(stub.name).toBe('Renamed since the commit')
        expect(stub.trashTime).toBe(5150)
        expect(stub.lastInteraction).toBe(99)
        expect(stub.creatorNotes).toBe('new notes')
        expect(stub.tags).toEqual(['fresh'])
        expect(stub.coldChatCount).toBe(entry.chats.length)
        expect(stub.chatPage).toBe(0)
        const untouched = booted.residency.stubFor(JSON.parse(JSON.stringify(read.value.character)) as character) as Obj
        const { chats: untouchedChats, ...untouchedFields } = untouched
        const { chats: baseChats, ...baseFields } = stubFromEntry(entry) as Obj
        expect(untouchedFields).toEqual(baseFields)
        expect(untouchedChats).toHaveLength(1)
        expect(baseChats).toHaveLength(1)
    })

    test('a character the encoding does not hold has no stub, and neither has one whose id is shared', async () => {
        const db = archiving(4) as unknown as Obj
        const characters = db.characters as Obj[]
        characters[1] = { ...characters[1], chaId: characters[0].chaId, name: 'Second holder' }
        const booted = await bootOf(db as unknown as Database)
        expect(booted.residency.stubFor({ ...(characters[2] as unknown as character), chaId: 'never-saved' })).toBeNull()
        expect(booted.residency.stubFor(characters[0] as unknown as character)).toBeNull()
        const [one] = booted.db.characters.filter(slot => slot.chaId === String(characters[2].chaId))
        expect(one.type).toBe('character')
    })
})

describe('new behaviour: the residency follows the latest acknowledged encoding', () => {
    test('after a pass renames a character the entry and the stub carry the new name, and a unit read follows the new entry', async () => {
        const booted = await bootOf(archiving(), { })
        const entry = entryOf(booted, 0)
        const read = await booted.residency.load(entry.u)
        if (read.status !== 'ok') {
            throw new Error('The load failed.')
        }
        expect(booted.residency.entryOf(entry.u)?.name).toBe(entry.name)

        const loaded = JSON.parse(JSON.stringify(read.value.character)) as Obj
        loaded.name = 'Renamed and saved'
        const live = booted.db as unknown as { characters: Obj[] }
        live.characters[live.characters.findIndex(slot => slot.chaId === entry.chaId)] = loaded
        const pass = await booted.encoder.plan(booted.db, { marked: new Set([entry.chaId]), modules: false, whole: false })
        const { mint } = createKeyMint(seededEnv(900), null)
        const built = await pass.commitRequest().build({ mint, seq: 2, now: NOW })
        for (const unit of built.units) {
            await booted.memory.putUnit(unit.key, unit.bytes)
        }
        pass.acknowledge()

        expect(booted.residency.entryOf(entry.u)?.name).toBe('Renamed and saved')
        const stub = booted.residency.stubFor(loaded as unknown as character) as Obj
        expect(stub.name).toBe('Renamed and saved')
        const again = await booted.residency.readCharacter(entry.u)
        expect(again.status === 'ok' ? again.value.character.name : null).toBe('Renamed and saved')
    })
})

describe('new behaviour: the residency works over the save loop\'s own context', () => {
    test('a verdict derives its lists from the context it was created with, and a hydrate of an earlier read makes the copy clean', async () => {
        let derivations = 0
        const counting: ListDerivation = {
            ...fakeLists,
            characterAssets: (character) => { derivations += 1; return fakeLists.characterAssets(character) },
        }
        const booted = await bootOf(archiving(), { lists: counting })
        const entry = entryOf(booted, 0)
        const copy = await booted.residency.readCharacter(entry.u)
        if (copy.status !== 'ok') {
            throw new Error('The copy read failed.')
        }
        expect(booted.residency.verdict(copy.value.character as unknown as character)).toBe('unknown')

        booted.residency.hydrate(copy)
        derivations = 0
        expect(booted.residency.verdict(copy.value.character as unknown as character)).toBe('clean')
        expect(derivations).toBeGreaterThan(0)
    })
})
