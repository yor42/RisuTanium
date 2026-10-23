// @vitest-environment node
/**
 * The net-found counter of a measurement build (CHORE-205 stage 0 b, U1): for each idle-net tick that commits, which
 * entities came out new, by kind, by the save-mark state the tracker showed, and by which rule named the character.
 * These are meter tests of new behaviour, not regression reproducers. The tracker is simulated by a `peekMarks`
 * function that answers once at the plan's start and once at its acknowledgement.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { previousFrom } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import {
    setSplitClockForTest, startSavePass, type SaveMarkPeek, type SavePassCommitRecord, type SavePassFind, type SavePassMeterHandle,
} from '../../store2/savePassMeter'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }
type Flags = SaveMarkPeek['flags']

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

function peek(over: Partial<Omit<SaveMarkPeek, 'flags'>> & { flags?: Partial<Flags> } = {}): SaveMarkPeek {
    return {
        front: over.front ?? null,
        frontChat: over.frontChat ?? null,
        character: over.character ?? new Set(),
        flags: { botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false, ...over.flags },
        dirty: over.dirty ?? false,
    }
}

/** Answers `start` to the first call (the plan's start) and `ack` to every later one (the acknowledgement). */
function marks(start: SaveMarkPeek, ack: SaveMarkPeek = start): () => SaveMarkPeek {
    let calls = 0
    return () => calls++ === 0 ? start : ack
}

function tick(chaId: string | null, extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, net: { chaId, modules: false }, ...extra }
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

function encoderOf(db: Database): SaveEncoder {
    return createSaveEncoder({ previous: previousFrom(encodeWith(db)), lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function chaIdOf(db: Database, index = 0): string {
    return (db.characters[index] as { chaId: string }).chaId
}

function renamed(db: Database, index = 0): Database {
    const next = clone(db)
    ;(next.characters as Obj[])[index].name = `a name no fixture holds ${index}`
    return asDatabase(next)
}

/** Plans, builds and acknowledges one pass and returns the commit record it left. */
async function commitOf(encoder: SaveEncoder, db: Database, request: SavePassRequest): Promise<SavePassCommitRecord> {
    const plan = await encoder.plan(db, request)
    await plan.commitRequest().build(contextOf(1))
    plan.acknowledge()
    const records = meterOf().units()
    return records[records.length - 1]
}

function findsOf(record: SavePassCommitRecord): SavePassFind[] {
    return record.found ?? []
}

function characterFind(record: SavePassCommitRecord): SavePassFind {
    const found = findsOf(record).filter(find => find.kind === 'character')
    expect(found.length).toBe(1)
    return found[0]
}

beforeEach(() => {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
})

afterEach(() => {
    setSplitClockForTest(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

describe('the mark state of a character the net found', () => {
    test('marked: a mark existed at the start', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        const record = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek({ character: new Set([id]) })) }))
        expect(characterFind(record)).toMatchObject({ entity: id, mark: 'marked', reasons: ['net'], reason: 'net', frontChanged: false })
        expect(meterOf().netFound().entities.character.net).toMatchObject({ marked: 1, front: 0, markedLater: 0, unmarked: 0 })
    })

    test('front: an unmarked edit of the sticky front under a trimmed tracker is not reported as marked', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        // A snapshot leaves the first mark in the tracker; it is not a pending mark.
        const trimmed = peek({ front: id, frontChat: id, character: new Set(), dirty: false })
        const record = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(trimmed) }))
        expect(characterFind(record)).toMatchObject({ entity: id, mark: 'front', frontChanged: false })
        expect(meterOf().netFound().entities.character.net).toMatchObject({ marked: 0, front: 1, unmarked: 0 })
    })

    test('front: the start front is reported as front with frontChanged when the front moved during the tick', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        const record = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek({ front: id }), peek({ front: chaIdOf(db, 2) })) }))
        expect(characterFind(record)).toMatchObject({ mark: 'front', frontChanged: true })
        expect(meterOf().netFound().entities.character.net).toMatchObject({ front: 1, markedLater: 0, frontChanged: 1 })
    })

    test('markedLater: absent at the start, present at acknowledge, by a later mark or by a new front', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        const byMark = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek(), peek({ character: new Set([id]) })) }))
        expect(characterFind(byMark).mark).toBe('markedLater')
        meterOf().reset()
        const byFront = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek({ front: chaIdOf(db, 2) }), peek({ front: id })) }))
        expect(characterFind(byFront)).toMatchObject({ mark: 'markedLater', frontChanged: true })
    })

    test('unmarked: no mark at either end, and the find is kept in recent with its seq and at', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        const record = await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek()) }))
        expect(characterFind(record)).toMatchObject({ entity: id, mark: 'unmarked', reason: 'net' })
        const summary = meterOf().netFound()
        expect(summary.entities.character.net.unmarked).toBe(1)
        const recent = summary.recent.filter(entry => entry.kind === 'character')
        expect(recent).toEqual([expect.objectContaining({ entity: id, mark: 'unmarked', reason: 'net', seq: record.seq })])
        expect(Number.isFinite(recent[0].at)).toBe(true)
        expect(record.seq).toBe(meterOf().last()?.seq)
    })

    test('unknown: a request with no peek reports no mark state', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const record = await commitOf(encoderOf(original), db, tick(chaIdOf(db)))
        expect(characterFind(record).mark).toBe('unknown')
    })

    test('a marked state is not kept in recent', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        await commitOf(encoderOf(original), db, tick(id, { peekMarks: marks(peek({ character: new Set([id]) })) }))
        expect(meterOf().netFound().recent.filter(entry => entry.kind === 'character')).toEqual([])
    })
})

describe('the rule that named the character', () => {
    function withExtraCharacter(db: Database): Database {
        const next = clone(db)
        const copy = JSON.parse(JSON.stringify((next.characters as Obj[])[0])) as Obj
        copy.chaId = 'extra-character'
        copy.name = 'Extra'
        ;(next.characters as Obj[]).push(copy)
        return asDatabase(next)
    }

    test('net only: the net pick alone names it, which is the U1 count', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        await commitOf(encoderOf(original), db, tick(chaIdOf(db), { peekMarks: marks(peek()) }))
        const counts = meterOf().netFound().entities.character
        expect([counts.net.unmarked, counts.marked.unmarked, counts.unheld.unmarked, counts.ambiguous.unmarked]).toEqual([1, 0, 0, 0])
    })

    test('unheld: a character the encoding does not hold is new for that reason and does not count as net', async () => {
        const original = buildSmall(4)
        const db = withExtraCharacter(original)
        const record = await commitOf(encoderOf(original), db, tick(chaIdOf(db), { peekMarks: marks(peek()) }))
        expect(characterFind(record)).toMatchObject({ entity: 'extra-character', reasons: ['unheld'], reason: 'unheld', mark: 'unmarked' })
        const counts = meterOf().netFound().entities.character
        expect([counts.net.unmarked, counts.unheld.unmarked]).toEqual([0, 1])
    })

    test('a net pick that is itself unheld holds both reasons, summarised as unheld and not counted as net', async () => {
        const original = buildSmall(4)
        const db = withExtraCharacter(original)
        const record = await commitOf(encoderOf(original), db, tick('extra-character', { peekMarks: marks(peek()) }))
        expect(characterFind(record)).toMatchObject({ entity: 'extra-character', reasons: ['unheld', 'net'], reason: 'unheld' })
        const counts = meterOf().netFound().entities.character
        expect([counts.net.unmarked, counts.unheld.unmarked]).toEqual([0, 1])
    })

    test('marked: a request mark outranks the net pick', async () => {
        const original = buildSmall(4)
        const db = renamed(original)
        const id = chaIdOf(db)
        const record = await commitOf(encoderOf(original), db, tick(id, { marked: new Set([id]), peekMarks: marks(peek()) }))
        expect(characterFind(record)).toMatchObject({ reasons: ['marked', 'net'], reason: 'marked' })
        expect(meterOf().netFound().entities.character.net.unmarked).toBe(0)
    })

    test('ambiguous: the shared-id rule names the edited holder; the pass\'s own set is used', async () => {
        const base = clone(buildSmall(4))
        ;(base.characters as Obj[])[1].chaId = (base.characters as Obj[])[0].chaId
        const original = asDatabase(base)
        const db = renamed(original, 1)
        const shared = chaIdOf(db, 1)
        const record = await commitOf(encoderOf(original), db, tick(chaIdOf(db, 2), { peekMarks: marks(peek()) }))
        expect(characterFind(record)).toMatchObject({ entity: shared, reasons: ['ambiguous'], reason: 'ambiguous' })
        const counts = meterOf().netFound().entities.character
        expect([counts.net.unmarked, counts.ambiguous.unmarked]).toEqual([0, 1])
    })
})

describe('modules, shards and the fixed groups', () => {
    function everythingEdited(db: Database): Database {
        const next = clone(db)
        ;(next.modules as Obj[])[1].description = 'a module description no fixture holds'
        ;(next.botPresets as Obj[]).push({ name: 'Added preset', mainPrompt: 'p', jailbreak: '', temperature: 1 })
        ;(next.plugins as Obj[])[0].name = 'a plugin name no fixture holds'
        ;(next.pluginCustomStorage as Obj)['plugin-0'] = { counter: 999 }
        next.loadouts = [{ name: 'a loadout' }]
        next.statics = { messages: 13, imports: 4 }
        next.zzNetFoundConfigProbe = 'config field'
        ;(next.characters as Obj[])[0].name = 'a name no fixture holds'
        return asDatabase(next)
    }

    function unitsWithPrefix(record: SavePassCommitRecord, ...prefixes: string[]): number {
        return record.units.filter(unit => prefixes.some(prefix => unit.identity.startsWith(prefix))).length
    }

    test('each group is found with the mark state of its own flag, configLists and none always unmarked', async () => {
        const original = buildSmall(4)
        const db = everythingEdited(original)
        const start = peek({ flags: { botPreset: true } })
        const ack = peek({ flags: { botPreset: true, plugins: true } })
        const record = await commitOf(encoderOf(original), db, tick(chaIdOf(db), { modules: false, net: { chaId: chaIdOf(db), modules: true }, peekMarks: marks(start, ack) }))

        const byGroup = new Map(findsOf(record).filter(find => find.kind === 'fixed').map(find => [find.entity, find]))
        expect([...byGroup.keys()].sort()).toEqual(['botPreset', 'configLists', 'loadouts', 'none', 'plugins', 'pluginCustomStorage'].sort())
        expect(byGroup.get('botPreset')?.mark).toBe('marked')
        expect(byGroup.get('plugins')?.mark).toBe('markedLater')
        for (const group of ['pluginCustomStorage', 'loadouts', 'configLists', 'none']) {
            expect(byGroup.get(group)?.mark).toBe('unmarked')
        }
        // The unit counts come from the identities the commit wrote, not from the meter's grouping.
        expect(byGroup.get('pluginCustomStorage')?.units).toBe(unitsWithPrefix(record, 'psv:', 'bucket:'))
        expect(byGroup.get('pluginCustomStorage')?.units).toBeGreaterThanOrEqual(2)
        expect(byGroup.get('botPreset')?.units).toBe(unitsWithPrefix(record, 'preset:'))
        expect(byGroup.get('plugins')?.units).toBe(unitsWithPrefix(record, 'plugin:'))
        expect(byGroup.get('loadouts')?.units).toBe(unitsWithPrefix(record, 'loadouts'))
        expect(byGroup.get('configLists')?.units).toBe(unitsWithPrefix(record, 'al:config', 'il:config'))
        expect(byGroup.get('none')?.units).toBe(record.units.filter(unit => ['config', 'statics', 'order'].includes(unit.identity)).length)
        expect(record.unitCounts?.other).toBe(0)
        expect(record.unitCounts?.shard).toBe(unitsWithPrefix(record, 'shard:'))
        expect(record.unitCounts?.fixed).toBe(
            unitsWithPrefix(record, 'preset:', 'plugin:', 'psv:', 'bucket:', 'loadouts', 'al:config', 'il:config')
                + record.units.filter(unit => ['config', 'statics', 'order'].includes(unit.identity)).length,
        )
        const modules = findsOf(record).filter(find => find.kind === 'module')
        expect(modules.length).toBe(unitsWithPrefix(record, 'module:'))
        expect(modules.every(find => find.mark === 'unmarked')).toBe(true)
        expect(record.unitCounts?.module).toBe(unitsWithPrefix(record, 'module:', 'al:module:', 'il:module:', 'moduleIndex'))
        // The manifest is in no group.
        expect(record.unitCounts !== undefined && record.unitCounts.character + record.unitCounts.module + record.unitCounts.shard + record.unitCounts.fixed)
            .toBe(record.units.length - 1)
        expect(meterOf().netFound().units).toEqual(record.unitCounts)
    })

    test('a module find follows the modules flag: marked at the start, markedLater at acknowledge', async () => {
        const original = buildSmall(4)
        const db = everythingEdited(original)
        const net = { chaId: chaIdOf(db), modules: true }
        const early = await commitOf(encoderOf(original), db, tick(chaIdOf(db), { net, peekMarks: marks(peek({ flags: { modules: true } })) }))
        expect(findsOf(early).filter(find => find.kind === 'module').map(find => find.mark)).toEqual(['marked'])
        const later = await commitOf(encoderOf(original), db, tick(chaIdOf(db), { net, peekMarks: marks(peek(), peek({ flags: { modules: true } })) }))
        expect(findsOf(later).filter(find => find.kind === 'module').map(find => find.mark)).toEqual(['markedLater'])
        expect(meterOf().netFound().entities.module).toMatchObject({ marked: 1, markedLater: 1, unmarked: 0 })
    })
})

describe('ticks, sequence and build time', () => {
    test('ticks counts every tick plan and ticksCommitted only an acknowledged one; other passes count for neither', async () => {
        const original = buildSmall(4)
        const encoder = encoderOf(original)
        const unchanged = await encoder.plan(original, tick(chaIdOf(original), { peekMarks: marks(peek()) }))
        expect(unchanged.unchanged).toBe(true)
        await encoder.plan(original, { marked: new Set(), modules: false, whole: false })
        expect(meterOf().netFound()).toMatchObject({ ticks: 1, ticksCommitted: 0 })
        await commitOf(encoder, renamed(original), tick(chaIdOf(original), { peekMarks: marks(peek()) }))
        expect(meterOf().netFound()).toMatchObject({ ticks: 2, ticksCommitted: 1 })
    })

    test('a pass and its commit share a seq that grows per plan, and the stub-retry flag rides on the pass record', async () => {
        const original = buildSmall(4)
        const encoder = encoderOf(original)
        const first = await commitOf(encoder, renamed(original), tick(chaIdOf(original)))
        const second = await commitOf(encoder, renamed(original, 1), tick(chaIdOf(original, 1), { retry: true }))
        const passes = meterOf().all()
        expect(passes.map(pass => pass.seq)).toEqual([first.seq, second.seq])
        expect((second.seq ?? 0)).toBeGreaterThan(first.seq ?? 0)
        expect(passes.map(pass => pass.retry)).toEqual([false, true])
        expect(passes.every(pass => typeof pass.at === 'number')).toBe(true)
    })

    test('commitBuildMs sums every build call, builds counts them, and acknowledgeMs spans the copy of the tree', async () => {
        let reads = 0
        setSplitClockForTest(() => reads++)
        const original = buildSmall(4)
        const db = renamed(original)
        const plan = await encoderOf(original).plan(db, tick(chaIdOf(db)))
        await plan.commitRequest().build(contextOf(1))
        await plan.commitRequest().build(contextOf(2))
        plan.acknowledge()
        const record = meterOf().units()[0]
        // Each timed span is two consecutive reads under the counting clock.
        expect([record.builds, record.commitBuildMs, record.acknowledgeMs]).toEqual([2, 2, 1])
    })
})
