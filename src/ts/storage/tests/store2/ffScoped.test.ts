// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, characterBodyMatches, characterMatchesAcknowledged, isWrittenUnit, planScopedEncode, previousFrom, unitMapSource,
    type EncodedTree, type VerdictOptions,
} from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { UNIT_TYPE } from '../../store2/format'
import { previousOfTree } from '../../store2/previousOfTree'
import type { character, Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, storeOf, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database | Obj): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

/** The types whose unit bodies hold the Refs of other units: their bytes depend on the keys of the attempt. */
const REF_HOLDING_TYPES = new Set<number>([
    UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.moduleBucket, UNIT_TYPE.pluginStorageBucket,
])

describe('guard (S0-6): characterBodyMatches', () => {
    const first = encodeWith(buildSmall(6))
    const previous = previousFrom(first)
    const options: VerdictOptions = { env: seededEnv(5), lists: fakeLists, previous }

    function decoded(): Database {
        return assembleDatabase(first.manifest, unitMapSource(first.units))
    }

    function slotOf(mutate: (slot: Obj) => void = () => undefined): character {
        const db = clone(decoded())
        const slot = (db.characters as Obj[])[1]
        mutate(slot)
        return slot as unknown as character
    }

    test('a clean character is clean under both', () => {
        expect(characterMatchesAcknowledged(slotOf(), options)).toBe('clean')
        expect(characterBodyMatches(slotOf(), options)).toBe('clean')
    })

    test('where the moved fields are equal it answers as characterMatchesAcknowledged does', () => {
        const edits: { label: string, mutate: (slot: Obj) => void, expected: string }[] = [
            { label: 'a core field', mutate: (slot) => { slot.personality = 'edited' }, expected: 'dirty' },
            { label: 'a name', mutate: (slot) => { slot.name = 'Another' }, expected: 'dirty' },
            { label: 'a lore entry', mutate: (slot) => { ((slot.globalLore as Obj[])[0]).content = 'changed lore' }, expected: 'dirty' },
            { label: 'a chat message', mutate: (slot) => { ((((slot.chats as Obj[])[0]).message as Obj[])[0]).data = 'changed message' }, expected: 'dirty' },
            { label: 'a chaId nobody holds', mutate: (slot) => { slot.chaId = 'not-held' }, expected: 'unknown' },
        ]
        for (const edit of edits) {
            const whole = characterMatchesAcknowledged(slotOf(edit.mutate), options)
            expect(whole, edit.label).toBe(edit.expected)
            expect(characterBodyMatches(slotOf(edit.mutate), options), edit.label).toBe(whole)
        }
    })

    test('each moved field is ignored', () => {
        const moved: { name: string, whole: string }[] = [
            { name: 'chatPage', whole: 'dirty' },
            { name: 'firstMsgIndex', whole: 'dirty' },
            { name: 'lastInteraction', whole: 'clean' },
            { name: 'trashTime', whole: 'clean' },
        ]
        for (const field of moved) {
            const mutate = (slot: Obj): void => { slot[field.name] = 7777 }
            expect(characterMatchesAcknowledged(slotOf(mutate), options), field.name).toBe(field.whole)
            expect(characterBodyMatches(slotOf(mutate), options), field.name).toBe('clean')
        }
    })

    test('a moved field changed together with the body is still dirty', () => {
        const slot = slotOf((live) => { live.chatPage = 7777; live.personality = 'edited' })
        expect(characterBodyMatches(slot, options)).toBe('dirty')
    })
})

describe('guard (S0-5): the written map of a scoped plan', () => {
    async function planOf(mutate: (db: Obj) => void, named: string[]) {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        mutate(db)
        const plan = await planScopedEncode(
            asDatabase(db),
            { env: seededEnv(3), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
            { modules: false, characters: new Set(named) },
        )
        return { first, plan }
    }

    test('it is the identity and digest of every unit finalize writes that holds no Ref, under any mint', async () => {
        const { plan } = await planOf((db) => {
            ;(db.characters as Obj[])[1].personality = 'edited'
            ;((db.botPresets as Obj[])[1]).temperature = 999
            db.statics = { counter: 3 }
        }, [(buildSmall(6).characters[1] as { chaId: string }).chaId])
        for (const attempt of [1, 2]) {
            const tree = plan.finalize(contextOf(attempt))
            const expected = new Map<string, string>()
            for (const unit of tree.units.filter(isWrittenUnit)) {
                if (!REF_HOLDING_TYPES.has(unit.type)) {
                    expected.set(unit.identity, unit.digest)
                }
            }
            expect(plan.written).toEqual(expected)
        }
        expect(plan.written.size).toBeGreaterThanOrEqual(3)
        expect(plan.written.has('manifest')).toBe(false)
        expect([...plan.written.keys()].some(identity => identity.startsWith('shard:'))).toBe(false)
    })

    test('a pass that changes nothing writes nothing but the manifest and its shards', async () => {
        const { plan } = await planOf(() => undefined, [])
        expect(plan.written.size).toBe(0)
    })

    test('the finalized tree keeps the statics, order and preset bodies the plan made', async () => {
        const { first, plan } = await planOf((db) => {
            db.statics = { counter: 3 }
            ;((db.botPresets as Obj[])[1]).temperature = 999
        }, [])
        const tree: EncodedTree = plan.finalize(contextOf(1))
        const read = previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: storeOf(first, tree) }).objects
        const kept = previousFrom(tree).objects
        expect(kept?.statics).toEqual(read?.statics)
        expect(kept?.order).toEqual(read?.order)
        expect(kept?.presets).toEqual(read?.presets)
        expect(kept?.statics).toEqual({ v: 1, value: { counter: 3 } })
    })
})
