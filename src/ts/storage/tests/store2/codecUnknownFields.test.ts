import { describe, expect, test } from 'vitest'
import { differingIdentities, asDatabase, bodyOf, buildSmall, encodeWith, roundTrip, unitOf, type Obj } from './codecFixtures'
import type { Database } from '../../database.svelte'

/** A database with a field this build has never heard of at each level the codec splits. */
const FUTURE = { nested: [1, { deep: 'value' }, null], flag: true }

function databaseWithUnknownFields(): { db: Database, source: Obj } {
    const source = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    source.futureDatabaseField = { ...FUTURE, level: 'database' }
    const characters = source.characters as Obj[]
    characters[0].futureCharacterField = { ...FUTURE, level: 'character' }
    const chats = characters[0].chats as Obj[]
    chats[0].futureChatField = { ...FUTURE, level: 'chat' }
    ;(chats[0].message as Obj[])[1].futureMessageField = { ...FUTURE, level: 'message' }
    ;(source.modules as Obj[])[0].futureModuleField = { ...FUTURE, level: 'module' }
    ;(source.botPresets as Obj[])[0].futurePresetField = { ...FUTURE, level: 'preset' }
    ;(source.plugins as Obj[])[0].futurePluginField = { ...FUTURE, level: 'plugin' }
    return { db: asDatabase(source), source }
}

describe('unknown fields round trip (MC-175)', () => {
    test('a database with an unknown field at each level re-encodes byte for byte and comes back whole', () => {
        const { db, source } = databaseWithUnknownFields()
        const { first, second, assembled } = roundTrip(db)
        expect(differingIdentities(first, second)).toEqual([])
        expect(JSON.parse(JSON.stringify(assembled))).toEqual(source)
    })

    test('the database level: in the config root', () => {
        const { db } = databaseWithUnknownFields()
        const tree = encodeWith(db)
        expect((bodyOf(unitOf(tree, 'config')).f as Obj).futureDatabaseField).toEqual({ ...FUTURE, level: 'database' })
        expect((roundTrip(db).assembled as unknown as Obj).futureDatabaseField).toEqual({ ...FUTURE, level: 'database' })
    })

    test('the character level: in the character core', () => {
        const { db } = databaseWithUnknownFields()
        const { first, assembled } = roundTrip(db)
        const core = first.units.find(unit => unit.identity.endsWith(':core') && unit.identity.startsWith('char:'))!
        const cores = first.units.filter(unit => unit.identity.startsWith('char:') && unit.identity.endsWith(':core')).map(unit => bodyOf(unit).f as Obj)
        expect(core).toBeDefined()
        expect(cores.filter(f => 'futureCharacterField' in f)).toHaveLength(1)
        expect((assembled.characters[0] as unknown as Obj).futureCharacterField).toEqual({ ...FUTURE, level: 'character' })
    })

    test('the chat level: in the chat core', () => {
        const { db } = databaseWithUnknownFields()
        const { first, assembled } = roundTrip(db)
        const cores = first.units.filter(unit => unit.identity.startsWith('chat:') && unit.identity.endsWith(':core')).map(unit => bodyOf(unit).f as Obj)
        expect(cores.filter(f => 'futureChatField' in f)).toHaveLength(1)
        expect((assembled.characters[0].chats[0] as unknown as Obj).futureChatField).toEqual({ ...FUTURE, level: 'chat' })
    })

    test('the message level: in the chunk', () => {
        const { db } = databaseWithUnknownFields()
        const { first, assembled } = roundTrip(db)
        const messages = first.units.filter(unit => unit.identity.includes(':chunk:')).flatMap(unit => bodyOf(unit).msgs as Obj[])
        expect(messages.filter(message => 'futureMessageField' in message)).toHaveLength(1)
        expect((assembled.characters[0].chats[0].message[1] as unknown as Obj).futureMessageField).toEqual({ ...FUTURE, level: 'message' })
    })

    test('the module level: in the module unit', () => {
        const { db } = databaseWithUnknownFields()
        const { first, assembled } = roundTrip(db)
        const modules = first.units.filter(unit => unit.identity.startsWith('module:')).map(unit => bodyOf(unit).module as Obj)
        expect(modules.filter(module => 'futureModuleField' in module)).toHaveLength(1)
        expect((assembled.modules[0] as unknown as Obj).futureModuleField).toEqual({ ...FUTURE, level: 'module' })
    })

    test('presets and plugins keep theirs too', () => {
        const { db } = databaseWithUnknownFields()
        const { assembled } = roundTrip(db)
        expect((assembled.botPresets[0] as unknown as Obj).futurePresetField).toEqual({ ...FUTURE, level: 'preset' })
        expect((assembled.plugins[0] as unknown as Obj).futurePluginField).toEqual({ ...FUTURE, level: 'plugin' })
    })

    test('an unknown field on a group and one named like a built-in object member survive', () => {
        const source = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
        const slot = (source.characters as Obj[])[0]
        slot.type = 'group'
        slot.characters = ['m']
        Reflect.set(slot, 'hasOwnProperty', 'shadowed')
        Reflect.set(slot, 'toString', 'also shadowed')
        const { assembled } = roundTrip(asDatabase(source))
        const out = assembled.characters[0] as unknown as Obj
        expect(out.hasOwnProperty).toBe('shadowed')
        expect(out.toString).toBe('also shadowed')
    })
})
