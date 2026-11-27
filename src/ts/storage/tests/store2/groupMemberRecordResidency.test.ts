// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import type { Database, character, groupChat } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type ListDerivation, type UnitSource } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import type { ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency, type Residency } from 'src/ts/storage/store2/residency'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { residentSetOf } from 'src/ts/storage/store2/residencyPolicy'
import { createSaveEncoder, type SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { joinRecord, memberName } from 'src/ts/process/groupMembers'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { buildLegacyCases, buildSmall, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * #283 T27 and T28, compatibility guards over the store2 residency: the fork-only group key `risutanium_members` lives in
 * the group's core unit, so it survives a group being a stub (default residency, archiving on) and is back whenever the
 * group is loaded. Both cases pass whenever the core carries the key and fail when characterCoreFields leaves it out
 * (mutant MG1). memberName is new API; the store2 survival part does not depend on it.
 * The record is hand-built in the shape joinRecord writes ({name: string, slot: int 0..7} under group.risutanium_members[chaId]).
 */

const NOW = 1_700_000_000_000
const GROUP_ID = 'group-283'
const KEY = 'risutanium_members'

afterEach(() => {
    resetResidencyForTest()
})

interface Booted {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    stubs: ShardEntry[]
    encoder: SaveEncoder
    residency: Residency
    seq: number
}

async function bootOf(source: Database, lists: ListDerivation = fakeLists): Promise<Booted> {
    const memory = createMemoryBackend()
    const env = testEnv(createClock(), 4242)
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
    const residency = createResidency({ backend: memory, context })
    return { memory, db, entries, stubs: entries.filter(entry => !resident.has(entry.u)), encoder: context.encoder, residency, seq: 2 }
}

/** The group is a stub of a 3-character archiving profile; its core holds a record for the first character. */
function profile(): { db: Database, memberId: string } {
    const small = buildSmall(3) as unknown as Obj
    const characters = small.characters as Obj[]
    const memberId = String(characters[0].chaId)
    const base = buildLegacyCases().find(one => one.label === 'group')
    if (base === undefined) {
        throw new Error('The group case is missing.')
    }
    const group: Obj = {
        ...base.character,
        chaId: GROUP_ID,
        name: 'Group',
        characters: [memberId, String(characters[1].chaId)],
        characterTalks: [1, 1],
        characterActive: [true, true],
        [KEY]: { [memberId]: { name: 'Alice', slot: 0 } },
    }
    return { db: { ...small, archiveCharacters: true, characters: [...characters, group], characterOrder: [...characters.map(slot => slot.chaId), GROUP_ID] } as unknown as Database, memberId }
}

/** One marked pass, written to the backend and acknowledged, as the save loop does. */
async function commitPass(booted: Booted, marked: string[]): Promise<void> {
    const pass = await booted.encoder.plan(booted.db, { marked: new Set(marked), modules: false, whole: false })
    const { mint } = createKeyMint(seededEnv(900 + booted.seq), null)
    const built = await pass.commitRequest().build({ mint, seq: booted.seq, now: NOW })
    booted.seq += 1
    for (const unit of built.units) {
        await booted.memory.putUnit(unit.key, unit.bytes)
    }
    pass.acknowledge()
}

function slotIndex(booted: Booted, chaId: string): number {
    return (booted.db as unknown as { characters: Obj[] }).characters.findIndex(slot => slot.chaId === chaId)
}

function characters(booted: Booted): (character | groupChat)[] {
    return booted.db.characters as unknown as (character | groupChat)[]
}

describe('T27 default residency: a stub group keeps its record and a deleted member still gives its name', () => {
    test('the group boots as a stub without the key, its core holds it, and the name of a permanently deleted member is the record name', async () => {
        const { db, memberId } = profile()
        const booted = await bootOf(db)
        const entry = booted.stubs.find(candidate => candidate.chaId === GROUP_ID)
        expect(entry).toBeDefined()
        const stub = characters(booted)[slotIndex(booted, GROUP_ID)] as unknown as Obj
        expect(Object.hasOwn(stub, KEY)).toBe(false)

        // The member is deleted for good: its slot leaves characters, the group's member list keeps the id.
        const list = booted.db as unknown as { characters: Obj[] }
        list.characters.splice(slotIndex(booted, memberId), 1)
        await commitPass(booted, [memberId])

        const read = await booted.residency.load((entry as ShardEntry).u)
        if (read.status !== 'ok') {
            throw new Error(`The load was ${read.status}.`)
        }
        const loaded = read.value.character as unknown as groupChat & Obj
        expect(loaded[KEY]).toEqual({ [memberId]: { name: 'Alice', slot: 0 } })
        expect(loaded.characters).toContain(memberId)
        expect(memberName(characters(booted), loaded, memberId)).toBe('Alice')
        expect(memberName(characters(booted), loaded, 'nobody-here')).toBe('Unknown Character')
    })
})

describe('T28 a resident group joined this session keeps the key through put-back to a stub and a reload', () => {
    test('dirty after the join, clean after the commit, and the key is in the core after the group is a stub again', async () => {
        const { db } = profile()
        const base = JSON.parse(JSON.stringify(db)) as Obj
        const groupSlot = (base.characters as Obj[]).find(slot => slot.chaId === GROUP_ID) as Obj
        delete groupSlot[KEY]
        const booted = await bootOf(base as unknown as Database)
        const entry = booted.stubs.find(candidate => candidate.chaId === GROUP_ID) as ShardEntry
        const read = await booted.residency.load(entry.u)
        if (read.status !== 'ok') {
            throw new Error(`The load was ${read.status}.`)
        }
        const loaded = JSON.parse(JSON.stringify(read.value.character)) as unknown as groupChat & Obj
        expect(Object.hasOwn(loaded, KEY)).toBe(false)
        const live = booted.db as unknown as { characters: Obj[] }
        live.characters[slotIndex(booted, GROUP_ID)] = loaded as unknown as Obj
        expect(booted.residency.verdict(loaded as unknown as character)).toBe('clean')

        // A join, as addGroupChar does it: the pushes, then the record, with the same member written for real by joinRecord.
        loaded.characters.push('new-member')
        loaded.characterTalks.push(1)
        loaded.characterActive.push(true)
        joinRecord(loaded, 'new-member', 'Cara')
        expect(loaded[KEY]).toEqual({ 'new-member': { name: 'Cara', slot: 0 } })
        expect(booted.residency.verdict(loaded as unknown as character)).toBe('dirty')

        await commitPass(booted, [GROUP_ID])
        expect(booted.residency.verdict(loaded as unknown as character)).toBe('clean')
        const stub = booted.residency.stubFor(loaded as unknown as character) as Obj | null
        expect(stub).not.toBeNull()
        expect(Object.hasOwn(stub as Obj, KEY)).toBe(false)

        live.characters[slotIndex(booted, GROUP_ID)] = stub as unknown as Obj
        await commitPass(booted, [GROUP_ID])

        const again = await booted.residency.readCharacter(entry.u)
        if (again.status !== 'ok') {
            throw new Error(`The reload was ${again.status}.`)
        }
        expect((again.value.character as Obj)[KEY]).toEqual({ 'new-member': { name: 'Cara', slot: 0 } })

        const snapshot = booted.memory.snapshot()
        const source: UnitSource = { get: (key) => snapshot.get(key) }
        const acknowledged = booted.residency.entryOf(entry.u) as ShardEntry
        expect((assembleCharacter(acknowledged, source) as Obj)[KEY]).toEqual({ 'new-member': { name: 'Cara', slot: 0 } })
    })
})
