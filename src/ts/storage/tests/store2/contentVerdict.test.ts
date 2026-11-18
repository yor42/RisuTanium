// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createKeyMint } from '../../store2/commit'
import { previousFrom, type PreviousEncoding } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder } from '../../store2/saveEncoder'
import type { character, Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The two value verdicts of the save encoder for the Reload check: `contentVerdictOf` (a resident equals the
 * acknowledged encoding apart from `chatPage` and `lastInteraction`) and `frontVerdictOf` (everything a pass writes
 * outside the resident characters and the modules). Diagnostic tests: each pins an answer a mutant of the rule changes.
 */

const NOW = 1_700_000_000_000

afterEach(() => {
    vi.restoreAllMocks()
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** Four characters, 1 and 2 stamped with both moved fields so the acknowledged entries hold them. */
function fixtureDb(): Obj {
    const db = clone(buildSmall(4)) as unknown as Obj
    const slots = db.characters as Obj[]
    Object.assign(slots[1], { lastInteraction: 1000, trashTime: 2000 })
    Object.assign(slots[2], { lastInteraction: 3000, trashTime: 4000 })
    return db
}

interface Fixture {
    previous: PreviousEncoding
    encoder: SaveEncoder
    /** A fresh copy of the database the acknowledged encoding was made from. */
    live(): Obj
}

function fixture(): Fixture {
    const db = fixtureDb()
    const previous = previousFrom(encodeWith(asDatabase(db)))
    return {
        previous,
        encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW }),
        live: () => clone(db),
    }
}

const slotsOf = (db: Obj): character[] => db.characters as unknown as character[]

/** Builds a pass over `db` and keeps it as the encoder's pending attempt, as a commit whose outcome is unknown does. */
async function keepAsPending(f: Fixture, db: Database): Promise<void> {
    const plan = await f.encoder.plan(db, { marked: new Set<string>(), modules: false, whole: false })
    await plan.commitRequest().build({ mint: createKeyMint(seededEnv(900), null).mint, seq: 2, now: NOW })
    plan.keepAsPending()
}

describe('V1: contentVerdictOf leaves out exactly the view state', () => {
    test('an untouched resident is clean', () => {
        const f = fixture()
        expect(f.encoder.contentVerdictOf(slotsOf(f.live())[1])).toBe('clean')
    })

    test('chatPage alone, then chatPage with lastInteraction, are clean', () => {
        const f = fixture()
        const db = f.live()
        const slot = slotsOf(db)[1]
        const page = slot.chatPage
        slot.chatPage = (typeof page === 'number' ? page : 0) + 3
        expect(f.encoder.contentVerdictOf(slot)).toBe('clean')
        slot.lastInteraction = 99_999
        expect(f.encoder.contentVerdictOf(slot)).toBe('clean')
        expect(f.encoder.verdictOf(slot)).toBe('dirty')
    })

    test.each([
        ['firstMsgIndex', (slot: character) => { slot.firstMsgIndex = 7 }],
        ['trashTime', (slot: character) => { slot.trashTime = 12_345 }],
        ['a core field', (slot: character) => { slot.personality = 'a content edit' }],
        ['a core field with chatPage', (slot: character) => { slot.chatPage = 5; slot.personality = 'a content edit' }],
    ])('%s is dirty', (_label, mutate) => {
        const f = fixture()
        const slot = slotsOf(f.live())[1]
        mutate(slot)
        expect(f.encoder.contentVerdictOf(slot)).toBe('dirty')
    })

    test('a shared id, an unheld resident and a pending attempt are unknown', async () => {
        const f = fixture()
        const db = f.live()
        const unheld = clone(slotsOf(db)[0])
        unheld.chaId = 'a-resident-the-encoding-does-not-hold'
        expect(f.encoder.contentVerdictOf(unheld)).toBe('unknown')

        const sharedDb = fixtureDb()
        const shared = slotsOf(sharedDb)
        shared[3].chaId = shared[2].chaId
        sharedDb.characterOrder = shared.map(slot => slot.chaId)
        const previous = previousFrom(encodeWith(asDatabase(sharedDb)))
        const sharedEncoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        expect(sharedEncoder.contentVerdictOf(slotsOf(clone(sharedDb))[2])).toBe('unknown')

        await keepAsPending(f, asDatabase(f.live()))
        expect(f.encoder.contentVerdictOf(slotsOf(f.live())[0])).toBe('unknown')
    })
})

describe('V1g: a fault of the read is unknown and never escapes', () => {
    test('a trashTime getter that throws after the first read', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const f = fixture()
        const slot = slotsOf(f.live())[1]
        const acknowledged = slot.trashTime
        let reads = 0
        Object.defineProperty(slot, 'trashTime', {
            enumerable: true,
            configurable: true,
            get() {
                reads += 1
                if (reads > 1) {
                    throw new Error('a getter that faults after its first read')
                }
                return acknowledged
            },
        })
        expect(f.encoder.contentVerdictOf(slot)).toBe('unknown')
        expect(reads).toBeGreaterThanOrEqual(2)
    })
})

describe('FV1: frontVerdictOf is the fixed-group comparison with every resident carried', () => {
    test('clean after the encode, dirty for a settings edit, clean again on revert', async () => {
        const f = fixture()
        const db = asDatabase(f.live())
        expect(await f.encoder.frontVerdictOf(db)).toBe('clean')
        const record = db as unknown as Record<string, unknown>
        const original = record.username
        record.username = 'an edited username'
        expect(await f.encoder.frontVerdictOf(db)).toBe('dirty')
        record.username = original
        expect(await f.encoder.frontVerdictOf(db)).toBe('clean')
    })

    test('view state of a resident is outside it, the order and a swap of residents are inside it', async () => {
        const f = fixture()
        const live = f.live()
        const db = asDatabase(live)
        const slot = slotsOf(live)[0]
        slot.chatPage = 4
        slot.lastInteraction = 4242
        expect(await f.encoder.frontVerdictOf(db)).toBe('clean')
        slot.personality = 'a resident content edit is judged per slot'
        expect(await f.encoder.frontVerdictOf(db)).toBe('clean')

        const order = [...(live.characterOrder as string[])]
        live.characterOrder = [...order].reverse()
        expect(await f.encoder.frontVerdictOf(db)).toBe('dirty')
        live.characterOrder = order

        const slots = slotsOf(live)
        ;[slots[1], slots[2]] = [slots[2], slots[1]]
        expect(await f.encoder.frontVerdictOf(db)).toBe('dirty')
    })

    test('a pending attempt is unknown', async () => {
        const f = fixture()
        const db = asDatabase(f.live())
        await keepAsPending(f, db)
        expect(await f.encoder.frontVerdictOf(db)).toBe('unknown')
    })

    test('a database key whose read throws is never clean, and no fault escapes', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const f = fixture()
        const live = f.live()
        Object.defineProperty(live, 'aKeyThatFaultsWhenRead', {
            enumerable: true,
            configurable: true,
            get() {
                throw new Error('an unreadable settings key')
            },
        })
        expect(await f.encoder.frontVerdictOf(asDatabase(live))).not.toBe('clean')
    })

    test('statics with a throwing toJSON are unknown and no fault escapes', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const f = fixture()
        const live = f.live()
        live.statics = {
            toJSON() {
                throw new Error('statics that cannot be read')
            },
        }
        expect(await f.encoder.frontVerdictOf(asDatabase(live))).toBe('unknown')
    })
})
