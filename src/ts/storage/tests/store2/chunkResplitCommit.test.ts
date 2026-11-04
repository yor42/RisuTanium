// @vitest-environment node
/**
 * Changing the chunk parameters over an existing store (CHORE-412 stage S2), through the real producer and committer:
 * a store written under one parameter set is read, saved and verdicted under another. `MESSAGE_CHUNKING` is replaced by
 * a mutable object, so a test can write a greedy store (target 0) and then save under another set.
 *
 * - Compatibility guard: a re-split above 59 units commits in bulk, leaves no staging, assembles equal, reads clean
 *   and the next pass is unchanged.
 * - Compatibility guard: a character carried by a scoped pass keeps its greedy chunks under the new parameters.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import type { character } from 'src/ts/storage/database.svelte'
import { assembleDatabase, characterMatchesAcknowledged, previousFrom, splitChat, unitMapSource } from 'src/ts/storage/store2/codec'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { savedDatabase, seedTree } from '../store2SaveKit'
import {
    chat as chatFixture, dbWithCharacters, encodeWith, fakeLists, message, mulberry32, prosePool, seededEnv, sparseCharacter,
    type Obj,
} from './codecFixtures'
import { committerOf, createClock, expectInvariant, parsedCommit, testEnv } from './commitFixtures'
import { appendRigText, measureRigPass, rigBase, rigRequest, RIG_NOW } from './writeAmplificationRig'

const params = vi.hoisted(() => ({ min: 2_048, target: 32_768, max: 131_072 }))
vi.mock('src/ts/storage/store2/codec/chunkParams', () => ({ MESSAGE_CHUNKING: params }))

const DEFAULT_SET = { min: 2_048, target: 32_768, max: 131_072 }
const GREEDY_SET = { min: 0, target: 0, max: 131_072 }
const FINE_SET = { min: 1_024, target: 64, max: 8_192 }

function useSet(set: { min: number, target: number, max: number }): void {
    params.min = set.min
    params.target = set.target
    params.max = set.max
}

beforeEach(() => {
    useSet(DEFAULT_SET)
})

function longChat(rng: () => number, count: number, bytes: number): Obj {
    const pool = prosePool(rng, 30, 100, 400)
    return chatFixture(rng, 0, Array.from({ length: count }, (_, i) => message(rng, pool, i, bytes)))
}

describe('a re-split under new parameters', () => {
    test('compatibility guard: a re-split above 59 units commits in bulk, leaves no staging, assembles equal, reads clean and the next pass is unchanged', async () => {
        const rng = mulberry32(2)
        const pool = prosePool(rng, 30, 100, 400)
        const slot = sparseCharacter(rng, pool, 'cha-resplit', 'Resplit', [longChat(rng, 400, 300)], [])
        const database = dbWithCharacters([slot])

        useSet(GREEDY_SET)
        const clock = createClock()
        const memory = createMemoryBackend()
        const seeded = await seedTree(memory, database, testEnv(clock, 1))
        const greedyChunks = seeded.tree.units.filter(unit => unit.identity.includes(':chunk:')).length
        expect(greedyChunks).toBe(2)

        useSet(FINE_SET)
        const encoder = createSaveEncoder({ previous: previousFrom(seeded.tree), lists: fakeLists, env: testEnv(clock, 5), now: () => RIG_NOW })
        const plan = await encoder.plan(database, rigRequest(['cha-resplit']))
        expect(plan.unchanged).toBe(false)
        expect(plan.newUnits).toBeGreaterThan(59)
        const committer = committerOf(memory, clock, 100)
        const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('committed')
        if (result.status !== 'committed') {
            throw new Error(`Expected committed, got ${result.status}.`)
        }
        expect(result.mode).toBe('bulk')
        plan.acknowledge()
        expect((await parsedCommit(memory)).staging).toBeNull()

        const independent = encodeWith(database, { env: seededEnv(3) })
        const expected = assembleDatabase(independent.manifest, unitMapSource(independent.units))
        expect(await savedDatabase(memory)).toEqual(expected)

        const options = { env: seededEnv(5), lists: fakeLists, previous: encoder.acknowledged() }
        expect(characterMatchesAcknowledged(database.characters[0] as unknown as character, options)).toBe('clean')
        const next = await encoder.plan(database, rigRequest(['cha-resplit']))
        expect(next.unchanged).toBe(true)
        await expectInvariant(memory)
    })
})

describe('a scoped pass over a store written greedy', () => {
    test('compatibility guard (post-fix only; it needs the parameter mock): saving another character writes no chunk of the carried one', async () => {
        const rng = mulberry32(3)
        const pool = prosePool(rng, 30, 100, 400)
        const alphaChat = longChat(rng, 600, 300)
        alphaChat.id = 'chat-alpha'
        const alpha = sparseCharacter(rng, pool, 'cha-alpha', 'Alpha', [alphaChat], [])
        const beta = sparseCharacter(rng, pool, 'cha-beta', 'Beta', [chatFixture(rng, 1, [message(rng, pool, 0, 100)])], [])
        const database = dbWithCharacters([alpha, beta])

        useSet(GREEDY_SET)
        const base = rigBase(database)
        const greedyCount = splitChat(alphaChat as JsonObject, 'chat').chunks.length

        useSet(DEFAULT_SET)
        // The carried character would split differently under the default set, so a rewrite would show.
        expect(splitChat(alphaChat as JsonObject, 'chat').chunks.length).not.toBe(greedyCount)
        const pass = await measureRigPass(database, base, rigRequest(['cha-beta']), () => appendRigText(beta, 'desc'))
        expect(pass.written.length).toBeGreaterThan(0)
        expect(pass.written.filter(unit => unit.identity.includes(':chat-alpha:'))).toEqual([])
    })
})
