import { describe, expect, test } from 'vitest'
import { groupIntoShards, shardOfU, type EncodedTree, type EncodedUnit, type PreviousEncoding, type PreviousObjects } from '../../store2/codec'
import type { Database } from '../../database.svelte'
import { parseModuleIndex, parseShard, UNIT_TYPE, type ChatEntry, type ModuleIndex, type Shard } from '../../store2/format'
import { asDatabase, bodyOf, buildSmall, encodeWith, previousFrom, seededEnv, unitOf, type JsonObject, type Obj } from './codecFixtures'

const MARK = 'futureField'

function objectsOf(tree: EncodedTree): PreviousObjects {
    const objects = tree.index.objects
    if (objects === undefined) {
        throw new Error('The encoding carries no previous objects.')
    }
    return structuredClone(objects)
}

/** A previous encoding whose parsed format objects hold an unknown field at every level the codec writes. */
function previousWithMarkers(tree: EncodedTree): { previous: PreviousEncoding, objects: PreviousObjects } {
    const objects = objectsOf(tree)
    const manifest = objects.manifest as unknown as Obj
    manifest[MARK] = 'manifest-top'
    ;(manifest.fixed as Obj)[MARK] = 'manifest-fixed'
    ;((manifest.fixed as Obj).pluginStorage as Obj)[MARK] = 'manifest-plugin-storage'
    manifest.req = ['zzz-future']
    for (const shard of objects.shards ?? []) {
        ;(shard as unknown as Obj)[MARK] = 'shard-top'
        for (const entry of shard.entries) {
            ;(entry as unknown as Obj)[MARK] = `entry-${entry.u}`
            for (const chat of entry.chats) {
                ;(chat as unknown as Obj)[MARK] = `chat-${entry.u}-${chat.cid}`
            }
        }
    }
    const index = objects.moduleIndex as unknown as Obj
    index[MARK] = 'modules-top'
    for (const entry of (objects.moduleIndex as ModuleIndex).entries) {
        ;(entry as unknown as Obj)[MARK] = `module-${entry.id}`
    }
    return { previous: { ...previousFrom(tree), objects }, objects }
}

/** The JSON inside a unit's frame, read without the parser: the manifest with a `req` token this build does not know does not parse. */
function rawBody(unit: EncodedUnit): JsonObject {
    return JSON.parse(new TextDecoder().decode(unit.bytes.subarray(16, unit.bytes.length - 4))) as JsonObject
}

function shardBodies(tree: EncodedTree): Shard[] {
    return tree.units.filter(unit => unit.type === UNIT_TYPE.shard).map(unit => bodyOf(unit) as unknown as Shard)
}

describe('unknown fields of the format objects the codec writes are carried from the previous objects', () => {
    const base = asDatabase(JSON.parse(JSON.stringify(buildSmall(4))) as Obj)
    const first = encodeWith(base, { env: seededEnv(1) })

    test('the fixture has modules, chats and entries to carry onto', () => {
        expect(shardBodies(first).flatMap(shard => shard.entries).length).toBe(4)
        expect((first.index.objects?.moduleIndex as ModuleIndex).entries.length).toBeGreaterThan(0)
        expect(shardBodies(first).flatMap(shard => shard.entries).flatMap(entry => entry.chats).length).toBeGreaterThan(0)
    })

    test('manifest: top level, fixed and fixed.pluginStorage, and the union of req', () => {
        const { previous } = previousWithMarkers(first)
        const next = encodeWith(base, { env: seededEnv(2), previous })
        const manifest = next.manifest as unknown as Obj
        expect(manifest[MARK]).toBe('manifest-top')
        expect((manifest.fixed as Obj)[MARK]).toBe('manifest-fixed')
        expect(((manifest.fixed as Obj).pluginStorage as Obj)[MARK]).toBe('manifest-plugin-storage')
        expect(next.manifest.req).toEqual(['zzz-future'])
        const written = rawBody(unitOf(next, 'manifest')) as Obj
        expect(written[MARK]).toBe('manifest-top')
        expect((written.fixed as Obj)[MARK]).toBe('manifest-fixed')
        expect(((written.fixed as Obj).pluginStorage as Obj)[MARK]).toBe('manifest-plugin-storage')
        expect(written.req).toEqual(['zzz-future'])
    })

    test('shard top level, each shard entry (by u) and each chat entry (by cid)', () => {
        const { previous } = previousWithMarkers(first)
        const next = encodeWith(base, { env: seededEnv(2), previous })
        const shards = shardBodies(next)
        expect(shards).toHaveLength(16)
        for (const shard of shards) {
            expect((shard as unknown as Obj)[MARK]).toBe('shard-top')
        }
        const entries = shards.flatMap(shard => shard.entries)
        expect(entries).toHaveLength(4)
        for (const entry of entries) {
            expect((entry as unknown as Obj)[MARK]).toBe(`entry-${entry.u}`)
            expect(entry.chats.length).toBeGreaterThan(0)
            for (const chat of entry.chats) {
                expect((chat as unknown as Obj)[MARK]).toBe(`chat-${entry.u}-${chat.cid}`)
            }
        }
    })

    test('module index top level and each module entry (by handle)', () => {
        const { previous } = previousWithMarkers(first)
        const next = encodeWith(base, { env: seededEnv(2), previous })
        const body = bodyOf(unitOf(next, 'moduleIndex')) as unknown as ModuleIndex & Obj
        expect(body[MARK]).toBe('modules-top')
        expect(body.entries.length).toBeGreaterThan(0)
        for (const entry of body.entries) {
            expect((entry as unknown as Obj)[MARK]).toBe(`module-${entry.id}`)
        }
    })

    test('the carried fields change the bytes, so the units are written again; a second encode with the result is stable', () => {
        const { previous } = previousWithMarkers(first)
        const next = encodeWith(base, { env: seededEnv(2), previous })
        const rewritten = next.units.filter(unit => !unit.reused).map(unit => unit.type)
        expect(rewritten).toContain(UNIT_TYPE.shard)
        expect(rewritten).toContain(UNIT_TYPE.moduleIndex)
        const again = encodeWith(base, { env: seededEnv(3), previous: previousFrom(next) })
        expect(again.units.filter(unit => !unit.reused).map(unit => unit.identity)).toEqual(['manifest'])
        expect((again.manifest as unknown as Obj)[MARK]).toBe('manifest-top')
        for (const shard of shardBodies(again)) {
            expect((shard as unknown as Obj)[MARK]).toBe('shard-top')
        }
    })

    test('parsed previous shards and module index, as read from stored units, carry the same way', () => {
        const shardUnits = first.units.filter(unit => unit.type === UNIT_TYPE.shard)
        const parsedShards: Shard[] = []
        for (const unit of shardUnits) {
            const body = JSON.parse(JSON.stringify(bodyOf(unit))) as JsonObject
            body[MARK] = 'parsed-shard'
            for (const entry of body.entries as JsonObject[]) {
                entry[MARK] = 'parsed-entry'
                for (const chat of entry.chats as JsonObject[]) {
                    chat[MARK] = 'parsed-chat'
                }
            }
            const parsed = parseShard(body)
            if (parsed.status !== 'ok') {
                throw new Error('shard did not parse')
            }
            parsedShards[Number(unit.identity.split(':')[1])] = parsed.value
        }
        const indexBody = JSON.parse(JSON.stringify(bodyOf(unitOf(first, 'moduleIndex')))) as JsonObject
        indexBody[MARK] = 'parsed-modules'
        for (const entry of indexBody.entries as JsonObject[]) {
            entry[MARK] = 'parsed-module'
        }
        const parsedIndex = parseModuleIndex(indexBody)
        if (parsedIndex.status !== 'ok') {
            throw new Error('module index did not parse')
        }
        const next = encodeWith(base, {
            env: seededEnv(2),
            previous: { ...previousFrom(first), objects: { shards: parsedShards, moduleIndex: parsedIndex.value } },
        })
        for (const shard of shardBodies(next)) {
            expect((shard as unknown as Obj)[MARK]).toBe('parsed-shard')
            for (const entry of shard.entries) {
                expect((entry as unknown as Obj)[MARK]).toBe('parsed-entry')
                for (const chat of entry.chats) {
                    expect((chat as unknown as Obj)[MARK]).toBe('parsed-chat')
                }
            }
        }
        const body = bodyOf(unitOf(next, 'moduleIndex')) as unknown as ModuleIndex & Obj
        expect(body[MARK]).toBe('parsed-modules')
        expect(body.entries.every(entry => (entry as unknown as Obj)[MARK] === 'parsed-module')).toBe(true)
    })

    test('a removed character, chat or module carries nothing', () => {
        const { previous } = previousWithMarkers(first)
        const db = JSON.parse(JSON.stringify(base)) as Obj
        const removed = (db.characters as Obj[]).shift() as Obj
        const kept = (db.characters as Obj[])[0]
        ;(kept.chats as Obj[]).pop()
        ;(db.modules as Obj[]).pop()
        const next = encodeWith(asDatabase(db), { env: seededEnv(2), previous })
        const removedU = (first.index.entities.get(`${String(removed.chaId)}#0`)) as string
        expect(removedU).toBeTypeOf('string')
        const text = JSON.stringify(next.units.map(unit => rawBody(unit)))
        expect(text).not.toContain(`entry-${removedU}`)
        expect(text).not.toContain(`chat-${removedU}`)
        const keptU = first.index.entities.get(`${String(kept.chaId)}#0`) as string
        const droppedChat = (base.characters[1].chats as unknown as Obj[]).at(-1) as Obj
        expect(text).not.toContain(`chat-${keptU}-${String(droppedChat.id)}`)
        expect(text).toContain(`entry-${keptU}`)
        const lastModule = (first.index.objects?.moduleIndex as ModuleIndex).entries.at(-1)
        expect(text).not.toContain(`module-${lastModule?.id}`)
        expect(shardOfU(keptU)).toBeGreaterThanOrEqual(0)
    })

    test('without parsed previous objects nothing is carried', () => {
        const next = encodeWith(base, { env: seededEnv(2), previous: { units: previousFrom(first).units, entities: first.index.entities } })
        expect((next.manifest as unknown as Obj)[MARK]).toBeUndefined()
        expect(JSON.stringify(next.units.map(unit => rawBody(unit)))).not.toContain(MARK)
    })
})

function cloneDb(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

/** The chat entries of every character of `tree`, by character `chaId`, in order. */
function chatEntriesByChaId(tree: EncodedTree): Map<string, ChatEntry[]> {
    const byChaId = new Map<string, ChatEntry[]>()
    for (const shard of shardBodies(tree)) {
        for (const entry of shard.entries) {
            byChaId.set(entry.chaId, entry.chats)
        }
    }
    return byChaId
}

describe('entries carry by entity identity, whatever the shard count of the previous encoding', () => {
    const base = asDatabase(cloneDb(buildSmall(12)))
    const first = encodeWith(base, { env: seededEnv(1) })

    test('a previous encoding written with 32 shards, re-encoded with 16, keeps every entry and chat field', () => {
        const entries = shardBodies(first).flatMap(shard => structuredClone(shard.entries))
        expect(entries).toHaveLength(12)
        expect(entries.filter(entry => shardOfU(entry.u, 32) !== shardOfU(entry.u, 16)).length).toBeGreaterThan(0)
        for (const entry of entries) {
            ;(entry as unknown as Obj)[MARK] = `entry-${entry.u}`
            for (const chat of entry.chats) {
                ;(chat as unknown as Obj)[MARK] = `chat-${entry.u}-${chat.cid}`
            }
        }
        const wide = groupIntoShards(entries, 32)
        for (const shard of wide) {
            ;(shard as unknown as Obj)[MARK] = 'shard-top'
        }
        const next = encodeWith(base, {
            env: seededEnv(2),
            previous: { ...previousFrom(first), objects: { shards: wide } },
        })
        const shards = shardBodies(next)
        expect(shards).toHaveLength(16)
        const carried = shards.flatMap(shard => shard.entries)
        expect(carried).toHaveLength(12)
        for (const entry of carried) {
            expect((entry as unknown as Obj)[MARK]).toBe(`entry-${entry.u}`)
            expect(entry.chats.length).toBeGreaterThan(0)
            for (const chat of entry.chats) {
                expect((chat as unknown as Obj)[MARK]).toBe(`chat-${entry.u}-${chat.cid}`)
            }
        }
        // With another shard count no previous shard corresponds to a new one, so a shard's own fields have no home.
        for (const shard of shards) {
            expect((shard as unknown as Obj)[MARK]).toBeUndefined()
        }
    })
})

describe('a chat or module entry carries only when its handle is a unique, non-empty real id', () => {
    /** A previous encoding of `db` whose chat entries and module entries are marked with their handle. */
    function marked(db: Database): { tree: EncodedTree, previous: PreviousEncoding } {
        const tree = encodeWith(db, { env: seededEnv(1) })
        const objects = objectsOf(tree)
        for (const shard of objects.shards ?? []) {
            for (const entry of shard.entries) {
                for (const chat of entry.chats) {
                    ;(chat as unknown as Obj)[MARK] = `was-${chat.cid}`
                }
            }
        }
        for (const entry of (objects.moduleIndex as ModuleIndex).entries) {
            ;(entry as unknown as Obj)[MARK] = `was-${entry.id}`
        }
        return { tree, previous: { ...previousFrom(tree), objects } }
    }

    function firstCharacter(db: Obj): Obj {
        return (db.characters as Obj[])[0]
    }

    test('deleting the first of two id-less chats moves no field onto the survivor', () => {
        const raw = cloneDb(buildSmall(2))
        for (const chat of firstCharacter(raw).chats as Obj[]) {
            delete chat.id
        }
        const { tree, previous } = marked(asDatabase(raw))
        const chaId = String(firstCharacter(raw).chaId)
        expect(chatEntriesByChaId(tree).get(chaId)?.map(chat => chat.cid)).toEqual(['~0', '~1'])
        ;(firstCharacter(raw).chats as Obj[]).shift()
        const next = encodeWith(asDatabase(raw), { env: seededEnv(2), previous })
        const survivors = chatEntriesByChaId(next).get(chaId) as ChatEntry[]
        expect(survivors).toHaveLength(1)
        expect((survivors[0] as unknown as Obj)[MARK]).toBeUndefined()
    })

    test('a real chat id or module id that starts with ~ carries nothing, so it never matches a positional entry', () => {
        const raw = cloneDb(buildSmall(2))
        for (const chat of firstCharacter(raw).chats as Obj[]) {
            delete chat.id
        }
        const modules = raw.modules as Obj[]
        modules[0].id = '~mod'
        const { previous } = marked(asDatabase(raw))
        // The previous encoding holds the id-less chats as `~0` and `~1` with a field; the new first chat has the real id `~0`.
        const current = cloneDb(buildSmall(2))
        const nowChats = firstCharacter(current).chats as Obj[]
        nowChats[0].id = '~0'
        nowChats.pop()
        const nowModules = current.modules as Obj[]
        nowModules[0].id = '~mod'
        const next = encodeWith(asDatabase(current), { env: seededEnv(2), previous })
        const survivors = chatEntriesByChaId(next).get(String(firstCharacter(current).chaId)) as ChatEntry[]
        expect(survivors.map(chat => chat.cid)).toEqual(['~0'])
        expect((survivors[0] as unknown as Obj)[MARK]).toBeUndefined()
        const entries = (bodyOf(unitOf(next, 'moduleIndex')) as unknown as ModuleIndex).entries
        expect((entries[0] as unknown as Obj)[MARK]).toBeUndefined()
    })

    test('chats that share an id carry nothing, however the list changes', () => {
        const raw = cloneDb(buildSmall(2))
        const chats = firstCharacter(raw).chats as Obj[]
        chats[1].id = chats[0].id
        const { previous } = marked(asDatabase(raw))
        const next = encodeWith(asDatabase(raw), { env: seededEnv(2), previous })
        for (const chat of chatEntriesByChaId(next).get(String(firstCharacter(raw).chaId)) as ChatEntry[]) {
            expect((chat as unknown as Obj)[MARK]).toBeUndefined()
        }
    })

    test('removing a chat that is not last leaves the surviving chat its own field, matched by id', () => {
        const raw = cloneDb(buildSmall(2))
        const chats = firstCharacter(raw).chats as Obj[]
        const survivorId = String(chats[1].id)
        const { previous } = marked(asDatabase(raw))
        chats.shift()
        const next = encodeWith(asDatabase(raw), { env: seededEnv(2), previous })
        const survivors = chatEntriesByChaId(next).get(String(firstCharacter(raw).chaId)) as ChatEntry[]
        expect(survivors.map(chat => chat.cid)).toEqual([survivorId])
        expect((survivors[0] as unknown as Obj)[MARK]).toBe(`was-${survivorId}`)
    })

    test('modules that share an id carry nothing; modules with a unique id still carry', () => {
        const raw = cloneDb(buildSmall(2))
        const modules = raw.modules as Obj[]
        expect(modules.length).toBeGreaterThan(2)
        modules[0].id = 'shared-id'
        modules[1].id = 'shared-id'
        const { previous } = marked(asDatabase(raw))
        const next = encodeWith(asDatabase(raw), { env: seededEnv(2), previous })
        const entries = (bodyOf(unitOf(next, 'moduleIndex')) as unknown as ModuleIndex).entries
        expect((entries[0] as unknown as Obj)[MARK]).toBeUndefined()
        expect((entries[1] as unknown as Obj)[MARK]).toBeUndefined()
        for (const entry of entries.slice(2)) {
            expect((entry as unknown as Obj)[MARK]).toBe(`was-${entry.id}`)
        }
    })

    test('a module id that becomes shared in the new index carries nothing onto either holder', () => {
        const raw = cloneDb(buildSmall(2))
        const modules = raw.modules as Obj[]
        modules[0].id = 'm'
        const { previous } = marked(asDatabase(raw))
        const next = cloneDb(asDatabase(raw))
        // A second module with id `m` is inserted before the first.
        const nextModules = next.modules as Obj[]
        nextModules.unshift(structuredClone(nextModules[0]))
        const result = encodeWith(asDatabase(next), { env: seededEnv(2), previous })
        const entries = (bodyOf(unitOf(result, 'moduleIndex')) as unknown as ModuleIndex).entries
        expect(entries.filter(entry => entry.id === 'm')).toHaveLength(2)
        for (const entry of entries.filter(one => one.id === 'm')) {
            expect((entry as unknown as Obj)[MARK]).toBeUndefined()
        }
    })

    test('deleting the first of two modules with an empty id moves no field onto the other', () => {
        const raw = cloneDb(buildSmall(2))
        const modules = raw.modules as Obj[]
        modules[0].id = ''
        modules[1].id = ''
        const { previous } = marked(asDatabase(raw))
        modules.shift()
        const next = encodeWith(asDatabase(raw), { env: seededEnv(2), previous })
        const entries = (bodyOf(unitOf(next, 'moduleIndex')) as unknown as ModuleIndex).entries
        expect((entries[0] as unknown as Obj)[MARK]).toBeUndefined()
    })
})
