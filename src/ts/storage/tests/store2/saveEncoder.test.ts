// @vitest-environment node
import os from 'node:os'
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, bucketOfKey, CodecInputError, encodeScoped, IDENTITY, previousFrom, shardOfU, SharedChaIdStubError, StubRefusedError, unitsToWrite,
    type EncodedTree, type ListDerivation, type PreviousEncoding,
} from '../../store2/codec'
import { buildColdStub } from '../../../process/coldCharacter'
import { checkBuiltUnits, createKeyMint, type BuildContext } from '../../store2/commit'
import { encodeUnit, UNIT_TYPE } from '../../store2/format'
import { createSaveEncoder, SavePlanError, type SaveEncoder, type SavePassRequest, type SavePlan } from '../../store2/saveEncoder'
import type { character, Database } from '../../database.svelte'
import {
    asDatabase, buildSmall, buildT3, encodeWith, fakeLists, seededEnv, type Obj,
} from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function chaIdOf(db: Database, index: number): string {
    return (db.characters[index] as { chaId: string }).chaId
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
}

function attemptOf(attempt: number): { context: BuildContext, issued: Set<string> } {
    const { mint, issued } = createKeyMint(seededEnv(900 + attempt), null)
    return { context: { mint, seq: 2, now: NOW }, issued }
}

function encoderOf(previous: PreviousEncoding, lists: ListDerivation = fakeLists): SaveEncoder {
    return createSaveEncoder({ previous, lists, env: seededEnv(77), now: () => NOW })
}

interface Pass {
    plan: SavePlan
    /** The identities whose unit the pass wrote: a new key on the acknowledged encoding, the manifest included. */
    written: string[]
    issued: Set<string>
}

/** One pass the way a committed attempt runs it: plan, build under the attempt's mint, acknowledge. */
async function commitPass(encoder: SaveEncoder, db: Database, extra: Partial<SavePassRequest> = {}, attempt = 1): Promise<Pass> {
    const before = encoder.acknowledged()
    const plan = await encoder.plan(db, request(extra))
    const { context, issued } = attemptOf(attempt)
    const built = await plan.commitRequest().build(context)
    expect(checkBuiltUnits(built, issued, plan.newUnits, false)).toBeNull()
    plan.acknowledge()
    const after = encoder.acknowledged()
    const written = [...after.units].filter(([identity, unit]) => before.units.get(identity)?.key !== unit.key).map(([identity]) => identity).sort()
    expect(written.length).toBe(plan.newUnits)
    return { plan, written, issued }
}

function withStub(db: Database, chaId: string, trashTime: number | undefined): Database {
    const next = clone(db)
    const characters = next.characters as Obj[]
    const index = characters.findIndex(slot => slot.chaId === chaId)
    const source = JSON.parse(JSON.stringify(characters[index])) as Obj
    if (trashTime !== undefined) {
        source.trashTime = trashTime
    }
    characters[index] = buildColdStub(source as unknown as character, 'unit-key', ['chat-a']) as unknown as Obj
    return asDatabase(next)
}

function countingLists(): { lists: ListDerivation, encoded: string[] } {
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

describe('guard: dependency closure through the encoder, each field changes the expected units and nothing else', () => {
    const db = buildSmall(6)
    const first = encodeWith(db)
    const previous = previousFrom(first)
    const chaId = chaIdOf(db, 0)
    const u = previous.entities.get(`${chaId}#0`) as string
    const shard = `shard:${shardOfU(u)}`
    const chatId = (((db.characters[0] as unknown as { chats: { id: string }[] }).chats)[0]).id
    const moduleId = (db.modules as unknown as { id: string }[])[1].id
    const named = new Set([chaId])

    interface Case {
        label: string
        mutate: (db: Obj) => void
        extra: Partial<SavePassRequest>
        expected: string[]
        unchanged: boolean
    }

    const slot = (d: Obj): Obj => (d.characters as Obj[])[0]
    const fixed = (label: string, mutate: (d: Obj) => void, expected: string[]): Case => ({
        label, mutate, extra: {}, expected: [...expected, 'manifest'].sort(), unchanged: false,
    })
    const owned = (label: string, mutate: (d: Obj) => void, expected: string[]): Case => ({
        label, mutate, extra: { marked: named }, expected: [...expected, shard, 'manifest'].sort(), unchanged: false,
    })

    const cases: Case[] = [
        fixed('a preset', d => { ((d.botPresets as Obj[])[1]).temperature = 999 }, ['preset:1']),
        fixed('pluginV2', d => { ((d.pluginV2 as Obj[])[0]).enabled = false }, ['plugin:pluginV2:0']),
        fixed('plugins', d => { ((d.plugins as Obj[])[1]).version = 9 }, ['plugin:plugins:1']),
        fixed('characterOrder', d => { (d.characterOrder as string[]).reverse() }, ['order']),
        fixed('statics', d => { d.statics = { messages: 99 } }, ['statics']),
        fixed('loadouts', d => { d.loadouts = [{ name: 'one' }] }, ['loadouts']),
        fixed('a plugin storage value', d => { ((d.pluginCustomStorage as Obj)['plugin-3'] as Obj).counter = 77 }, ['psv:plugin-3', `bucket:${bucketOfKey('plugin-3')}`]),
        fixed('a new plugin storage key', d => { (d.pluginCustomStorage as Obj)['fresh-key'] = { n: 1 } }, ['psv:fresh-key', `bucket:${bucketOfKey('fresh-key')}`]),
        fixed('a removed plugin storage key', d => { delete (d.pluginCustomStorage as Obj)['plugin-3'] }, [`bucket:${bucketOfKey('plugin-3')}`]),
        fixed('a config field', d => { d.username = 'Someone Else' }, ['config']),
        {
            label: 'a module when flagged', mutate: d => { (d.modules as Obj[])[1].description = 'flagged edit' }, extra: { modules: true },
            expected: [`${IDENTITY.module}${moduleId}#0`, IDENTITY.moduleIndex, 'manifest'].sort(), unchanged: false,
        },
        {
            label: 'a module when not flagged is carried', mutate: d => { (d.modules as Obj[])[1].description = 'unflagged edit' }, extra: {},
            expected: ['manifest'], unchanged: true,
        },
        owned('a character core field', d => { slot(d).personality = 'new personality' }, [`${IDENTITY.char}${u}:core`]),
        owned('a character lore entry', d => { ((slot(d).globalLore as Obj[])[0]).content = 'new lore' }, [`${IDENTITY.char}${u}:lore`]),
        owned('a character script', d => { slot(d).customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }] }, [`${IDENTITY.char}${u}:scripts`]),
        owned('a chat message', d => { (((slot(d).chats as Obj[])[0].message as Obj[])[0]).data = 'edited message' }, [`${IDENTITY.chat}${u}:${chatId}:chunk:0`]),
        owned('a chat core field', d => { (slot(d).chats as Obj[])[0].note = 'a note' }, [`${IDENTITY.chat}${u}:${chatId}:core`]),
        owned('a moved field of a resident (trashTime)', d => { slot(d).trashTime = 4242 }, []),
        {
            label: 'a character field when it is not marked is carried', mutate: d => { slot(d).personality = 'unmarked edit' }, extra: {},
            expected: ['manifest'], unchanged: true,
        },
        {
            label: 'a character field when another character is marked is carried', mutate: d => { slot(d).personality = 'wrong mark' },
            extra: { marked: new Set([chaIdOf(db, 3)]) }, expected: ['manifest'], unchanged: true,
        },
    ]

    test.each(cases.map(one => [one.label, one] as const))('new behaviour and guard: %s', async (_label, one) => {
        const encoder = encoderOf(previous)
        // An unchanged pass first: the encoder is warm, as it is after its first save.
        await commitPass(encoder, db)
        const next = clone(db)
        one.mutate(next)
        const pass = await commitPass(encoder, asDatabase(next), one.extra, 2)
        expect(pass.written).toEqual(one.expected)
        expect(pass.plan.unchanged).toBe(one.unchanged)
    })

    test('guard: a stub trashTime writes the entry\'s shard and the manifest, and the stub is never encoded', async () => {
        const lists = countingLists()
        const encoder = encoderOf(previous, lists.lists)
        const stubChaId = chaIdOf(db, 1)
        const stubU = previous.entities.get(`${stubChaId}#0`) as string
        const pass = await commitPass(encoder, withStub(db, stubChaId, 1234))
        expect(pass.written).toEqual([`shard:${shardOfU(stubU)}`, 'manifest'].sort())
        expect(lists.encoded).not.toContain(stubChaId)
        // Named by a mark, a stub is still not encoded.
        const named = await commitPass(encoder, withStub(db, stubChaId, 1234), { marked: new Set([stubChaId]) }, 2)
        expect(named.written).toEqual(['manifest'])
        expect(lists.encoded).not.toContain(stubChaId)
    })

    test('guard: a stub restored from the trash clears the entry trashTime and the encoder carries its units', async () => {
        const encoder = encoderOf(previous)
        const stubChaId = chaIdOf(db, 1)
        const stubU = previous.entities.get(`${stubChaId}#0`) as string
        await commitPass(encoder, withStub(db, stubChaId, 1234))
        const restored = await commitPass(encoder, withStub(db, stubChaId, undefined), {}, 2)
        expect(restored.written).toEqual([`shard:${shardOfU(stubU)}`, 'manifest'].sort())
        const entry = encoder.acknowledged().objects?.shards?.flatMap(one => one.entries).find(one => one.u === stubU)
        expect(entry?.trashTime).toBeUndefined()
        expect([...encoder.acknowledged().units.keys()].filter(identity => identity.startsWith(`${IDENTITY.char}${stubU}:`)).length).toBeGreaterThan(0)
    })

    test('new behaviour: the fixed group is encoded on every pass, whatever is marked', async () => {
        const encoder = encoderOf(previous)
        const next = clone(db)
        ;((next.pluginV2 as Obj[])[0]).enabled = false
        next.statics = { messages: 5 }
        ;(next.botPresets as Obj[])[0].temperature = 1
        const pass = await commitPass(encoder, asDatabase(next), { marked: new Set([chaIdOf(db, 4)]) })
        expect(pass.written).toEqual(['manifest', 'plugin:pluginV2:0', 'preset:0', 'statics'])
    })
})

describe('new behaviour: the no-change pass', () => {
    test('nothing marked and nothing edited is unchanged with only the manifest to write', async () => {
        const db = buildSmall(4)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const plan = await encoder.plan(db, request())
        expect(plan.unchanged).toBe(true)
        expect(plan.newUnits).toBe(1)
    })

    test('whole-resident mode over an unchanged database is unchanged too, and so is the pass after an acknowledged one', async () => {
        const db = buildSmall(4)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const whole = await encoder.plan(db, request({ whole: true }))
        expect(whole.unchanged).toBe(true)
        expect(whole.newUnits).toBe(1)
        const pass = await commitPass(encoder, db)
        expect(pass.written).toEqual(['manifest'])
        expect((await encoder.plan(db, request())).unchanged).toBe(true)
    })

    test('a changed unit is never unchanged', async () => {
        const db = buildSmall(4)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const next = clone(db)
        next.statics = { messages: 7 }
        const plan = await encoder.plan(asDatabase(next), request())
        expect(plan.unchanged).toBe(false)
        expect(plan.newUnits).toBe(2)
    })
})

describe('new behaviour: modules only when flagged', () => {
    const db = buildSmall(4)
    const previous = previousFrom(encodeWith(db))
    const edited = (): Database => {
        const next = clone(db)
        ;(next.modules as Obj[])[2].description = 'module edit'
        return asDatabase(next)
    }
    const moduleUnits = (written: string[]): string[] => written.filter(identity => identity.includes('module'))

    test('an unflagged pass carries the modules, so an unflagged module edit is not written', async () => {
        const pass = await commitPass(encoderOf(previous), edited())
        expect(moduleUnits(pass.written)).toEqual([])
    })

    test.each([
        ['the module flag', { modules: true }],
        ['the idle net\'s first tick', { net: { chaId: null, modules: true } }],
        ['a whole-resident pass', { whole: true }],
        ['save mine', { rewriteAll: true }],
    ] as const)('%s writes the edited module', async (_label, extra) => {
        const pass = await commitPass(encoderOf(previous), edited(), extra)
        expect(moduleUnits(pass.written)).toContain(IDENTITY.moduleIndex)
        expect(moduleUnits(pass.written).some(identity => identity.startsWith(IDENTITY.module))).toBe(true)
    })
})

describe('new behaviour: whole-resident mode, the idle net and the new-character rule', () => {
    test('whole-resident mode writes what a full encode writes, over every character and the modules', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        const previous = previousFrom(first)
        const next = clone(db)
        ;(next.characters as Obj[])[0].personality = 'whole 0'
        ;(next.characters as Obj[])[3].personality = 'whole 3'
        ;(next.modules as Obj[])[1].description = 'whole module'
        next.statics = { messages: 3 }
        const pass = await commitPass(encoderOf(previous), asDatabase(next), { whole: true })
        const full = encodeWith(asDatabase(next), { env: seededEnv(2), previous, seq: 2 })
        expect(pass.written).toEqual(unitsToWrite(full).map(unit => unit.identity).sort())
    })

    test('whole-resident mode yields once after each resident character that it encodes, a stub excluded', async () => {
        const db = buildSmall(5)
        const previous = previousFrom(encodeWith(db))
        const lists = countingLists()
        let yields = 0
        const stubChaId = chaIdOf(db, 2)
        const next = withStub(db, stubChaId, undefined)
        await encoderOf(previous, lists.lists).plan(next, request({
            whole: true,
            yield: async () => {
                yields++
                expect(yields).toBe(lists.encoded.length)
            },
        }))
        expect(yields).toBe(4)
        expect(lists.encoded).not.toContain(stubChaId)
    })

    test('a marked pass yields once per marked character and an unmarked pass never', async () => {
        const db = buildSmall(5)
        const previous = previousFrom(encodeWith(db))
        let yields = 0
        const yielding = async (): Promise<void> => { yields++ }
        await encoderOf(previous).plan(db, request({ marked: new Set([chaIdOf(db, 1), chaIdOf(db, 3)]), yield: yielding }))
        expect(yields).toBe(2)
        yields = 0
        await encoderOf(previous).plan(db, request({ yield: yielding }))
        expect(yields).toBe(0)
    })

    test('the idle net encodes the one character it names and carries the others', async () => {
        const db = buildSmall(5)
        const previous = previousFrom(encodeWith(db))
        const u3 = previous.entities.get(`${chaIdOf(db, 3)}#0`) as string
        const next = clone(db)
        ;(next.characters as Obj[])[3].personality = 'caught by the net'
        ;(next.characters as Obj[])[1].personality = 'not named'
        const pass = await commitPass(encoderOf(previous), asDatabase(next), { net: { chaId: chaIdOf(db, 3), modules: false } })
        expect(pass.written).toEqual([`${IDENTITY.char}${u3}:core`, `shard:${shardOfU(u3)}`, 'manifest'].sort())
    })

    test('an unmarked new resident character is named implicitly: it is encoded, never carried', async () => {
        const db = buildSmall(4)
        const previous = previousFrom(encodeWith(db))
        const u0 = previous.entities.get(`${chaIdOf(db, 0)}#0`) as string
        const next = clone(db)
        const characters = next.characters as Obj[]
        characters.push({ ...JSON.parse(JSON.stringify(characters[0])) as Obj, chaId: 'brand-new-character', name: 'Brand new' })
        const encoder = encoderOf(previous)
        const pass = await commitPass(encoder, asDatabase(next))
        const newU = encoder.acknowledged().entities.get('brand-new-character#0') as string
        expect(newU).toBeDefined()
        expect(pass.written).toContain(`${IDENTITY.char}${newU}:core`)
        expect(pass.written).toContain('order')
        expect(pass.written.some(identity => identity.includes(u0))).toBe(false)
        expect(pass.plan.unchanged).toBe(false)
    })

    test('a removed character drops its units from the acknowledged encoding and rewrites only the order and its shard', async () => {
        const db = buildSmall(4)
        const previous = previousFrom(encodeWith(db))
        const removedU = previous.entities.get(`${chaIdOf(db, 2)}#0`) as string
        const next = clone(db)
        ;(next.characters as Obj[]).splice(2, 1)
        const encoder = encoderOf(previous)
        const pass = await commitPass(encoder, asDatabase(next))
        expect(pass.written).toEqual(['order', `shard:${shardOfU(removedU)}`, 'manifest'].sort())
        expect([...encoder.acknowledged().units.keys()].some(identity => identity.includes(removedU))).toBe(false)
        expect([...previous.units.keys()].some(identity => identity.includes(removedU))).toBe(true)
    })

    test('save mine writes every unit but the stubs\', with no unit reused and the stubs carried', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const previous = previousFrom(first)
        const stubChaId = chaIdOf(db, 1)
        const stubU = previous.entities.get(`${stubChaId}#0`) as string
        const next = withStub(db, stubChaId, undefined)
        const encoder = encoderOf(previous)
        const pass = await commitPass(encoder, next, { rewriteAll: true })
        const stubOwned = (identity: string): boolean => identity.includes(stubU)
        expect(pass.written.some(stubOwned)).toBe(false)
        expect(pass.written.length).toBe(first.units.filter(unit => !stubOwned(unit.identity)).length)
        expect(pass.plan.unchanged).toBe(false)
        expect([...encoder.acknowledged().units.keys()].filter(stubOwned).length).toBeGreaterThan(0)
        for (const [identity, unit] of encoder.acknowledged().units) {
            if (!stubOwned(identity)) {
                expect(unit.key, identity).not.toBe(previous.units.get(identity)?.key)
            }
        }
    })

    test('save mine over an unchanged database is still not unchanged', async () => {
        const db = buildSmall(3)
        const plan = await encoderOf(previousFrom(encodeWith(db))).plan(db, request({ rewriteAll: true }))
        expect(plan.unchanged).toBe(false)
    })
})

describe('new behaviour: the per-attempt mint and the acknowledged encoding', () => {
    const db = buildSmall(4)
    const previous = previousFrom(encodeWith(db))
    const edited = (): Database => {
        const next = clone(db)
        next.statics = { messages: 41 }
        return asDatabase(next)
    }

    test('every build mints its own keys through the context, and the last build is the attempt that is acknowledged', async () => {
        const encoder = encoderOf(previous)
        const plan = await encoder.plan(edited(), request())
        const request1 = plan.commitRequest()
        const a = attemptOf(1)
        const b = attemptOf(2)
        const builtA = await request1.build(a.context)
        const builtB = await request1.build(b.context)
        expect(checkBuiltUnits(builtA, a.issued, plan.newUnits, false)).toBeNull()
        expect(checkBuiltUnits(builtB, b.issued, plan.newUnits, false)).toBeNull()
        expect([...a.issued].some(key => b.issued.has(key))).toBe(false)
        plan.acknowledge()
        expect(encoder.manifestKey).toBe(builtB.manifest.key)
        expect(encoder.manifestKey).not.toBe(builtA.manifest.key)
    })

    test('the plan states the units the commit writes before any key exists, and the build writes exactly that many', async () => {
        const plan = await encoderOf(previous).plan(edited(), request())
        const commit = plan.commitRequest()
        expect(commit.newUnits).toBe(plan.newUnits)
        const { context } = attemptOf(3)
        const built = await commit.build(context)
        expect(built.units.length + 1).toBe(plan.newUnits)
    })

    test('an attempt that did not commit does not advance the acknowledged encoding, and the next plan still sees every change', async () => {
        const encoder = encoderOf(previous)
        const before = encoder.acknowledged()
        const beforeKey = encoder.manifestKey
        const failed = await encoder.plan(edited(), request())
        await failed.commitRequest().build(attemptOf(4).context)
        expect(encoder.acknowledged()).toBe(before)
        expect(encoder.manifestKey).toBe(beforeKey)
        const retry = await encoder.plan(edited(), request())
        expect(retry.newUnits).toBe(failed.newUnits)
        expect(retry.unchanged).toBe(false)
    })

    test('the acknowledged encoding is the committed tree: the same edit is then unchanged', async () => {
        const encoder = encoderOf(previous)
        await commitPass(encoder, edited())
        const again = await encoder.plan(edited(), request())
        expect(again.unchanged).toBe(true)
    })

    test('acknowledge and keepAsPending refuse a plan whose build never ran', async () => {
        const plan = await encoderOf(previous).plan(edited(), request())
        expect(() => plan.acknowledge()).toThrow(SavePlanError)
        expect(() => plan.keepAsPending()).toThrow(SavePlanError)
    })

    test('a stale plan cannot be acknowledged after another plan was', async () => {
        const encoder = encoderOf(previous)
        const one = await encoder.plan(edited(), request())
        const other = await encoder.plan(edited(), request())
        await one.commitRequest().build(attemptOf(5).context)
        await other.commitRequest().build(attemptOf(6).context)
        one.acknowledge()
        expect(() => other.acknowledge()).toThrow(SavePlanError)
    })

    test('an unknown attempt is adopted only when its own manifest is the one found current', async () => {
        const encoder = encoderOf(previous)
        const beforeKey = encoder.manifestKey
        const plan = await encoder.plan(edited(), request())
        const built = await plan.commitRequest().build(attemptOf(7).context)
        plan.keepAsPending()
        expect(encoder.adoptIfCurrent(null)).toBe(false)
        expect(encoder.adoptIfCurrent(beforeKey)).toBe(false)
        expect(encoder.adoptIfCurrent('store2/m-someone-elses-manifest')).toBe(false)
        expect(encoder.manifestKey).toBe(beforeKey)
        expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(true)
        expect(encoder.manifestKey).toBe(built.manifest.key)
        expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(false)
        expect((await encoder.plan(edited(), request())).unchanged).toBe(true)
    })

    test('a later acknowledged attempt supersedes the pending one', async () => {
        const encoder = encoderOf(previous)
        const unknown = await encoder.plan(edited(), request())
        const pending = await unknown.commitRequest().build(attemptOf(8).context)
        unknown.keepAsPending()
        const next = clone(db)
        next.statics = { messages: 42 }
        // A plan made over the same base is stale once the pending attempt is adopted, and a committed one clears it.
        await commitPass(encoder, asDatabase(next), {}, 9)
        expect(encoder.adoptIfCurrent(pending.manifest.key)).toBe(false)
    })
})

describe('new behaviour: codec errors surface typed and the encoder is left as it was', () => {
    test('SharedChaIdStubError names the id of the shared stub', async () => {
        const base = clone(buildSmall(3))
        const chars = base.characters as Obj[]
        chars[1] = { ...chars[1], chaId: chars[0].chaId as string, name: 'Second holder', personality: 'SECOND BODY' }
        const db = asDatabase(base)
        const shared = chars[0].chaId as string
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const before = encoder.acknowledged()
        const next = clone(db)
        const second = JSON.parse(JSON.stringify((next.characters as Obj[])[1])) as Obj
        ;(next.characters as Obj[]).splice(0, 2, buildColdStub(second as unknown as character, 'k', []) as unknown as Obj)
        const attempt = encoder.plan(asDatabase(next), request({ marked: new Set([shared]) }))
        await expect(attempt).rejects.toBeInstanceOf(SharedChaIdStubError)
        await expect(attempt).rejects.toMatchObject({ chaId: shared })
        await expect(attempt).rejects.toBeInstanceOf(CodecInputError)
        expect(encoder.acknowledged()).toBe(before)
    })

    test('a stub the acknowledged encoding does not hold is refused as a stub, not invented', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const next = clone(db)
        const source = JSON.parse(JSON.stringify((next.characters as Obj[])[0])) as Obj
        ;(next.characters as Obj[]).push({ ...(buildColdStub(source as unknown as character, 'k', []) as unknown as Obj), chaId: 'unknown-stub' })
        await expect(encoder.plan(asDatabase(next), request())).rejects.toBeInstanceOf(StubRefusedError)
    })

    test('a slot that is not an object is a codec input error', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const next = clone(db)
        ;(next.characters as unknown[])[1] = null
        await expect(encoder.plan(asDatabase(next), request())).rejects.toBeInstanceOf(CodecInputError)
    })
})

describe('new behaviour: hasStubs and the manifest key', () => {
    test('hasStubs sees a stub and nothing else', () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        expect(encoder.hasStubs(db)).toBe(false)
        expect(encoder.hasStubs(withStub(db, chaIdOf(db, 1), undefined))).toBe(true)
    })

    test('the manifest key is the acknowledged encoding\'s, and an encoding with no manifest is refused', () => {
        const first = encodeWith(buildSmall(3))
        expect(encoderOf(previousFrom(first)).manifestKey).toBe(first.manifestKey)
        const noManifest: PreviousEncoding = { ...previousFrom(first), units: new Map([...previousFrom(first).units].filter(([identity]) => identity !== 'manifest')) }
        expect(() => encoderOf(noManifest)).toThrow(CodecInputError)
    })
})

// Timing is hardware-bound: the measurement runs only on request (RISU_MEASURE=1) and prints; it asserts nothing about speed.
describe.skipIf(process.env.RISU_MEASURE !== '1')('measurement: one pass on the T3 profile', () => {
    function median(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length / 2)]
    }

    async function timed(run: () => Promise<SavePlan>, runs = 7): Promise<{ plan: number, finalize: number, units: number }> {
        await run()
        const plans: number[] = []
        const finalizes: number[] = []
        let units = 0
        for (let i = 0; i < runs; i++) {
            const start = performance.now()
            const plan = await run()
            plans.push(performance.now() - start)
            const { context } = attemptOf(100 + i)
            const mid = performance.now()
            const built = await plan.commitRequest().build(context)
            finalizes.push(performance.now() - mid)
            units = built.units.length + 1
        }
        return { plan: median(plans), finalize: median(finalizes), units }
    }

    test('plan and finalize, median of seven runs after a warm-up', async () => {
        const { db } = buildT3()
        const first: EncodedTree = encodeWith(db)
        const previous = previousFrom(first)
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        const chaId = chaIdOf(db, 250)
        const rows: [string, Partial<SavePassRequest>][] = [
            ['unchanged', {}],
            ['one marked character', { marked: new Set([chaId]) }],
            ['modules flagged', { modules: true }],
            ['one idle slice (one character, modules)', { net: { chaId, modules: true } }],
            ['whole-resident', { whole: true }],
        ]
        const lines: string[] = [`cpu=${os.cpus()[0]?.model ?? 'unknown'} cores=${os.cpus().length} node=${process.version} characters=${db.characters.length} modules=${db.modules.length}`]
        for (const [label, extra] of rows) {
            const result = await timed(() => encoder.plan(db, request(extra)))
            lines.push(`${label}: plan ${result.plan.toFixed(1)} ms, finalize ${result.finalize.toFixed(1)} ms, units written ${result.units}`)
        }
        process.stdout.write(`${lines.join('\n')}\n`)
        expect(lines.length).toBe(rows.length + 1)
    }, 600_000)
})

describe('guard: the encoder\'s scoped result is the codec\'s', () => {
    test('a marked pass writes what encodeScoped writes for the same scope', async () => {
        const db = buildSmall(5)
        const previous = previousFrom(encodeWith(db))
        const next = clone(db)
        ;(next.characters as Obj[])[2].personality = 'same as the codec'
        const chaId = chaIdOf(db, 2)
        const pass = await commitPass(encoderOf(previous), asDatabase(next), { marked: new Set([chaId]) })
        const direct = await encodeScoped(asDatabase(next), { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set([chaId]) })
        expect(pass.written).toEqual(unitsToWrite(direct).map(unit => unit.identity).sort())
    })
})

describe('new behaviour: a yielding pass encodes the character list as it stood when the pass began', () => {
    for (const change of ['splice-front', 'unshift-front', 'reassign-filter'] as const) {
        test(`whole pass, ${change} at the first yield: the committed tree holds exactly the pre-pass characters`, async () => {
            const db = clone(buildSmall(5))
            const first = encodeWith(asDatabase(db))
            const before = (db.characters as Obj[]).map(slot => String(slot.chaId))
            const extra = JSON.parse(JSON.stringify((db.characters as Obj[])[0])) as Obj
            extra.chaId = 'inserted-during-yield'
            let fired = false
            const encoder = encoderOf(previousFrom(first))
            const plan = await encoder.plan(asDatabase(db), request({
                whole: true,
                yield: async () => {
                    if (fired) {
                        return
                    }
                    fired = true
                    const live = db.characters as Obj[]
                    if (change === 'splice-front') {
                        live.splice(0, 1)
                    } else if (change === 'unshift-front') {
                        live.unshift(extra)
                    } else {
                        db.characters = live.filter((_slot, index) => index !== 0)
                    }
                },
            }))
            expect(fired).toBe(true)
            const { context } = attemptOf(1)
            const built = await plan.commitRequest().build(context)
            const store = new Map(first.units.map(unit => [unit.key, unit.bytes] as const))
            for (const unit of built.units) {
                store.set(unit.key, unit.bytes)
            }
            store.set(built.manifest.key, encodeUnit(UNIT_TYPE.manifest, built.manifest.body))
            const decoded = assembleDatabase(built.manifest.body, { get: key => store.get(key) }) as unknown as { characters: { chaId: string }[] }
            const saved = decoded.characters.map(slot => slot.chaId)
            expect(saved).toEqual(before)
            expect(new Set(saved).size).toBe(saved.length)
        })
    }
})

describe('new behaviour: a pending attempt keeps the next plan from reporting unchanged', () => {
    function edited(db: Database): Database {
        const next = clone(db)
        next.statics = { messages: 999 }
        return asDatabase(next)
    }

    test('edit, keepAsPending, revert: the next plan is not unchanged', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const first = await encoder.plan(edited(db), request())
        const built = await first.commitRequest().build(attemptOf(1).context)
        first.keepAsPending()
        expect(encoder.pendingKey).toBe(built.manifest.key)
        const revert = await encoder.plan(db, request())
        expect(revert.unchanged).toBe(false)
        const result = await revert.commitRequest().build(attemptOf(2).context)
        expect(result.manifest.key).not.toBe(built.manifest.key)
    })

    test('with nothing pending an unchanged pass stays unchanged', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        expect(encoder.pendingKey).toBeNull()
        expect((await encoder.plan(db, request())).unchanged).toBe(true)
    })

    test('pendingKey clears when the attempt is adopted', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const plan = await encoder.plan(edited(db), request())
        const built = await plan.commitRequest().build(attemptOf(1).context)
        plan.keepAsPending()
        expect(encoder.pendingKey).toBe(built.manifest.key)
        expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(true)
        expect(encoder.pendingKey).toBeNull()
    })

    test('pendingKey clears when a later plan is acknowledged', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const plan = await encoder.plan(edited(db), request())
        await plan.commitRequest().build(attemptOf(1).context)
        plan.keepAsPending()
        const later = await encoder.plan(db, request())
        await later.commitRequest().build(attemptOf(2).context)
        later.acknowledge()
        expect(encoder.pendingKey).toBeNull()
    })

    test('adopt, then plan: the plan over the adopted encoding acknowledges cleanly', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const plan = await encoder.plan(edited(db), request())
        const built = await plan.commitRequest().build(attemptOf(1).context)
        plan.keepAsPending()
        expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(true)
        const revert = await encoder.plan(db, request())
        expect(revert.unchanged).toBe(false)
        await revert.commitRequest().build(attemptOf(2).context)
        expect(() => revert.acknowledge()).not.toThrow()
    })

    test('a plan made before the adoption is stale and cannot be acknowledged', async () => {
        const db = buildSmall(3)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const plan = await encoder.plan(edited(db), request())
        const built = await plan.commitRequest().build(attemptOf(1).context)
        plan.keepAsPending()
        const early = await encoder.plan(db, request())
        await early.commitRequest().build(attemptOf(2).context)
        expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(true)
        expect(() => early.acknowledge()).toThrow(SavePlanError)
    })

    test('new behaviour: an adoption during a yield never yields an unchanged plan, and its acknowledgement throws', async () => {
        const db = buildSmall(4)
        const encoder = encoderOf(previousFrom(encodeWith(db)))
        const first = await encoder.plan(edited(db), request())
        const built = await first.commitRequest().build(attemptOf(1).context)
        first.keepAsPending()
        let adopted = false
        const straddled = await encoder.plan(db, request({
            whole: true,
            yield: async () => {
                if (!adopted) {
                    adopted = true
                    expect(encoder.adoptIfCurrent(built.manifest.key)).toBe(true)
                }
            },
        }))
        expect(adopted).toBe(true)
        expect(straddled.unchanged).toBe(false)
        await straddled.commitRequest().build(attemptOf(2).context)
        expect(() => straddled.acknowledge()).toThrow(SavePlanError)
    })
})
