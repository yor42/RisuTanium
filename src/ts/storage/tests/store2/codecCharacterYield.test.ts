// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { Sha256 } from 'src/ts/assetHash'
import {
    encodeScoped, planScopedEncode, previousFrom, stubFromEntry,
    type EncodedTree, type EncodeOptions, type EncodeScope, type ListDerivation, type ScopedPlan,
} from '../../store2/codec'
import { ChunkMemo } from '../../store2/codec/chunkMemo'
import { createKeyMint } from '../../store2/commit'
import type { Database } from '../../database.svelte'
import {
    chat, dbWithCharacters, fakeLists, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter, uuidLike,
    type Obj,
} from './codecFixtures'

/**
 * The save pass splits the emit of one character into stages and waits between them (`characterSteps` driven by
 * `emitCharacterYielding`). Labels: the stage trace (T1) is the regression reproducer: on the base the character is one
 * synchronous stretch, so its trace has no yield between the units. The oracle (T2), the snapshot guard (T3) and the cut
 * guard (T4) are compatibility guards: they pass on a base that has no in-character wait too (T3 and T4 then loop over
 * the one wait after the character), and each is killed by a mutant of the new stages, named in the hand-back.
 */

const NOW = 1_700_000_000_000
const CHA = 'cha-big-0001'
const OTHER = 'cha-small-02'

/** The frame type bytes the trace names; every other frame (front, config shards, chunks) leaves no token. */
const FRAME_NAMES: Record<number, string> = { 4: 'core', 5: 'lore', 6: 'scripts', 7: 'chatCore', 15: 'al', 21: 'il' }

let restoreSha: (() => void) | null = null

afterEach(() => {
    restoreSha?.()
    restoreSha = null
})

/** Records a token for every RSAL frame that reaches the digest, named by its type byte. */
function recordFrames(trace: string[]): void {
    const real = Sha256.prototype.update
    Sha256.prototype.update = function (this: Sha256, bytes: Uint8Array) {
        if (bytes.length > 6 && bytes[0] === 0x52 && bytes[1] === 0x53 && bytes[2] === 0x41 && bytes[3] === 0x4c) {
            const name = FRAME_NAMES[bytes[5]]
            if (name !== undefined) {
                trace.push(name)
            }
        }
        return real.call(this, bytes)
    } as typeof real
    restoreSha = () => {
        Sha256.prototype.update = real
    }
}

/** The list derivation with a token for each character derivation it is asked for. */
function recordingLists(trace: string[]): ListDerivation {
    return {
        ...fakeLists,
        characterAssets: (owner) => {
            trace.push('assets')
            return fakeLists.characterAssets(owner)
        },
        characterInlays: (owner) => {
            trace.push('inlays')
            return fakeLists.characterInlays(owner)
        },
    }
}

/** A character with lore, a script, an inlay token in a message and two chats. */
function fullCharacter(rng: () => number, pool: string[], chaId: string): Obj {
    const first = message(rng, pool, 0, 50)
    first.data = `see {{inlay::${uuidLike(rng)}}} here`
    const slot = sparseCharacter(rng, pool, chaId, 'Big', [chat(rng, 0, [first, message(rng, pool, 1, 50)]), chat(rng, 1, [message(rng, pool, 1, 50)])], [loreEntry(rng, pool, 0, 50)])
    slot.customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }]
    return slot
}

function smallCharacter(rng: () => number, pool: string[], chaId: string): Obj {
    return sparseCharacter(rng, pool, chaId, 'Small', [chat(rng, 2, [message(rng, pool, 0, 20)])], [])
}

interface Scenario {
    label: string
    /** The slots of the database. */
    build(rng: () => number, pool: string[]): Obj[]
    /** What happens to the database after its first full encode and before the scoped pass. */
    after?(slots: Obj[], first: EncodedTree): void
    /** The chaIds the pass names. */
    names: string[]
    /** The pass skips an unreadable named character instead of failing. */
    skippable?: boolean
}

const SCENARIOS: Scenario[] = [
    { label: 'lore, a script, an inlay and two chats', build: (rng, pool) => [fullCharacter(rng, pool, CHA), smallCharacter(rng, pool, OTHER)], names: [CHA] },
    {
        label: 'a 1.5M-character description',
        build: (rng, pool) => {
            const slot = fullCharacter(rng, pool, CHA)
            slot.desc = 'a long quiet passage '.repeat(71_500).slice(0, 1_500_000)
            return [slot, smallCharacter(rng, pool, OTHER)]
        },
        names: [CHA],
    },
    {
        label: 'a character with no lore, no script and no inlay',
        build: (rng, pool) => {
            const slot = sparseCharacter(rng, pool, CHA, 'Bare', [chat(rng, 0, [message(rng, pool, 0, 30)])], [])
            delete slot.globalLore
            delete slot.customscript
            delete slot.triggerscript
            return [slot, smallCharacter(rng, pool, OTHER)]
        },
        names: [CHA],
    },
    {
        label: 'a group',
        build: (rng, pool) => {
            const slot = fullCharacter(rng, pool, CHA)
            Object.assign(slot, { type: 'group', characters: ['a', 'b'], characterTalks: [0.5, 0.5], characterActive: [true, true] })
            return [slot, smallCharacter(rng, pool, OTHER)]
        },
        names: [CHA],
    },
    {
        label: 'two holders of one chaId',
        build: (rng, pool) => [fullCharacter(rng, pool, CHA), smallCharacter(rng, pool, CHA)],
        names: [CHA],
    },
    {
        label: 'a cold stub carried beside the named character',
        build: (rng, pool) => [fullCharacter(rng, pool, CHA), smallCharacter(rng, pool, OTHER)],
        after: (slots, first) => {
            const entry = (previousFrom(first).objects?.shards ?? []).flatMap(shard => shard.entries).find(candidate => candidate.chaId === OTHER)
            if (entry === undefined) {
                throw new Error('The first encode holds no entry for the stub.')
            }
            slots[1] = stubFromEntry(entry) as unknown as Obj
        },
        names: [CHA],
    },
    {
        label: 'an unreadable named character beside a readable one',
        build: (rng, pool) => {
            const unreadable = smallCharacter(rng, pool, OTHER)
            unreadable.self = unreadable
            return [fullCharacter(rng, pool, CHA), unreadable]
        },
        names: [CHA, OTHER],
        skippable: true,
    },
]

interface Prepared {
    db: Database
    previous: EncodedTree
    memo: ChunkMemo
}

function optionsOf(lists: ListDerivation, previous: EncodedTree | null, memo: ChunkMemo, seq: number): EncodeOptions {
    return { env: seededEnv(5), lists, seq, createdAt: NOW, previous: previous === null ? null : previousFrom(previous), chunkMemo: memo }
}

/** The database after one full encode and an edit to the first character, as a pass over it would find it. */
async function prepare(scenario: Scenario, lists: ListDerivation): Promise<Prepared> {
    const rng = mulberry32(11)
    const pool = prosePool(rng, 200, 20, 100)
    const slots = scenario.build(rng, pool)
    const db = dbWithCharacters(slots)
    const memo = new ChunkMemo()
    const previous = await encodeScoped(db, optionsOf(lists, null, memo, 1), { modules: true, characters: 'all', skipUnsavableCharacters: true })
    scenario.after?.(slots, previous)
    slots[0].personality = 'edited after the first encode'
    return { db, previous, memo }
}

function scopeOf(scenario: Scenario, pause?: () => Promise<void>): EncodeScope {
    return { modules: false, characters: new Set(scenario.names), yield: pause, skipUnsavableCharacters: scenario.skippable === true ? true : undefined }
}

/** Everything a pass decides, in a form two passes compare with `toEqual`: units (with bytes), manifest, digests, counts. */
function shapeOf(plan: ScopedPlan, tree: EncodedTree): unknown {
    return {
        plan: {
            newUnits: plan.newUnits,
            unchanged: plan.unchanged,
            encoded: plan.encoded,
            listed: plan.listed,
            skipped: plan.skipped.map(one => one.chaId),
            written: [...plan.written].sort(([a], [b]) => (a < b ? -1 : 1)),
            carriedUnits: plan.carried.units,
            carriedOwners: [...plan.carried.owners].sort(([a], [b]) => (a < b ? -1 : 1)),
        },
        manifestKey: tree.manifestKey,
        manifest: tree.manifest,
        units: tree.units.map(unit => ({
            identity: unit.identity, key: unit.key, type: unit.type, digest: unit.digest, reused: unit.reused, ref: unit.ref.join(),
            bytes: unit.reused === true ? null : Buffer.from(unit.bytes).toString('base64'),
        })),
        indexUnits: [...tree.index.units.keys()].sort(),
        indexEntities: [...tree.index.entities.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    }
}

function finalized(plan: ScopedPlan): EncodedTree {
    const { mint } = createKeyMint(seededEnv(900), null)
    return plan.finalize({ mint, seq: 2, now: NOW })
}

/** One pass over a freshly prepared database; `pause` is the scope's yield. */
async function passOver(scenario: Scenario, pause?: () => Promise<void>, lists: ListDerivation = fakeLists): Promise<unknown> {
    const prepared = await prepare(scenario, lists)
    const plan = await planScopedEncode(prepared.db, optionsOf(lists, prepared.previous, prepared.memo, 2), scopeOf(scenario, pause))
    return shapeOf(plan, finalized(plan))
}

// The yields, in order, of the pass over the first scenario's character: the one after the read, one before each stage
// after the first, and the one after the character. The trace names a stage by its frame (`core`, `lore`, `scripts`,
// `chatCore`), a list by its derivation (`assets`, `inlays`) and by its frame (`al`, `il`); `al` and `il` also close the
// pass (the config's lists), after the character's last yield.
const EXPECTED_PASS_TRACE = [
    'Y', 'core', 'Y', 'lore', 'Y', 'scripts', 'Y', 'assets', 'Y', 'al', 'Y', 'inlays', 'Y', 'il', 'Y', 'chatCore', 'Y', 'chatCore', 'Y', 'al', 'il',
]

describe('the save pass waits between the stages of a character', () => {
    test('T1 regression reproducer: the pass waits after the read and between the stages, then once after the character', async () => {
        const trace: string[] = []
        const lists = recordingLists(trace)
        const prepared = await prepare(SCENARIOS[0], lists)
        trace.length = 0
        recordFrames(trace)
        await planScopedEncode(prepared.db, optionsOf(lists, prepared.previous, prepared.memo, 2), scopeOf(SCENARIOS[0], async () => {
            await null
            trace.push('Y')
        }))
        expect(trace).toEqual(EXPECTED_PASS_TRACE)
    })

    test.each(SCENARIOS)('T2 compatibility guard (oracle), $label: waiting between the stages changes no byte, key, digest or count', async (scenario) => {
        let yields = 0
        const waited = await passOver(scenario, async () => {
            await null
            yields += 1
        })
        const straight = await passOver(scenario)
        expect(yields).toBeGreaterThan(0)
        expect(waited).toEqual(straight)
    })

    test('T2 the oracle inputs are not vacuous: the skipped character is reported and the stub is carried', async () => {
        const unreadable = SCENARIOS[SCENARIOS.length - 1]
        const prepared = await prepare(unreadable, fakeLists)
        const plan = await planScopedEncode(prepared.db, optionsOf(fakeLists, prepared.previous, prepared.memo, 2), scopeOf(unreadable, async () => { await null }))
        expect(plan.skipped.map(one => one.chaId)).toEqual([OTHER])
        expect(plan.encoded).toEqual([CHA])
        const stubbed = SCENARIOS[5]
        const withStub = await prepare(stubbed, fakeLists)
        const stubPlan = await planScopedEncode(withStub.db, optionsOf(fakeLists, withStub.previous, withStub.memo, 2), scopeOf(stubbed, async () => { await null }))
        expect(stubPlan.encoded).toEqual([CHA])
        expect(stubPlan.listed).toEqual([CHA, OTHER])
    })
})

/** How many times a pass over the scenario waits. */
async function waitsOf(scenario: Scenario): Promise<number> {
    let waits = 0
    await passOver(scenario, async () => {
        await null
        waits += 1
    })
    return waits
}

/** The live edits a user can make to the fields the entry reads from the slot; each one changes what an entry written after it holds. */
function editLive(slot: Obj): void {
    slot.desc = 'edited description'
    ;(slot.tags as string[]).push('edited-tag')
    slot.creator = 'edited creator'
    slot.type = 'group'
    slot.characters = ['edited-member']
}

describe('a live edit during a wait leaves this pass as it was', () => {
    test('T3 compatibility guard: an edit at every wait, the one after the read included, is not in this pass', async () => {
        const scenario = SCENARIOS[0]
        const reference = await passOver(scenario)
        const total = await waitsOf(scenario)
        expect(total).toBeGreaterThan(0)
        for (let k = 1; k <= total; k++) {
            const prepared = await prepare(scenario, fakeLists)
            let calls = 0
            const plan = await planScopedEncode(prepared.db, optionsOf(fakeLists, prepared.previous, prepared.memo, 2), scopeOf(scenario, async () => {
                await null
                calls += 1
                if (calls === k) {
                    editLive((prepared.db.characters as unknown as Obj[])[0])
                }
            }))
            expect(calls, `the pass waited ${calls} times`).toBe(total)
            expect(shapeOf(plan, finalized(plan)), `an edit at wait ${k}`).toEqual(reference)
        }
    })

    test('T3 the edits are not vacuous: made before the pass they change it', async () => {
        const scenario = SCENARIOS[0]
        const reference = await passOver(scenario)
        const prepared = await prepare(scenario, fakeLists)
        editLive((prepared.db.characters as unknown as Obj[])[0])
        const plan = await planScopedEncode(prepared.db, optionsOf(fakeLists, prepared.previous, prepared.memo, 2), scopeOf(scenario, async () => { await null }))
        expect(shapeOf(plan, finalized(plan))).not.toEqual(reference)
    })

    test('T4 compatibility guard: a wait that throws at any point fails the pass, and a later pass is the clean one', async () => {
        const scenario = SCENARIOS[0]
        const clean = await passOver(scenario)
        const total = await waitsOf(scenario)
        expect(total).toBeGreaterThan(0)
        for (let k = 1; k <= total; k++) {
            const prepared = await prepare(scenario, fakeLists)
            const previous = prepared.previous
            let calls = 0
            await expect(planScopedEncode(prepared.db, optionsOf(fakeLists, previous, prepared.memo, 2), scopeOf(scenario, async () => {
                await null
                calls += 1
                if (calls === k) {
                    throw new Error(`cut at wait ${k}`)
                }
            }))).rejects.toThrow(`cut at wait ${k}`)
            // The same memo, lists and previous encoding that the cut pass held.
            const later = await planScopedEncode(prepared.db, optionsOf(fakeLists, previous, prepared.memo, 2), scopeOf(scenario))
            expect(shapeOf(later, finalized(later)), `a pass after a cut at wait ${k}`).toEqual(clean)
        }
    })
})
