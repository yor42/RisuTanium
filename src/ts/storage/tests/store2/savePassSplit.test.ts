// @vitest-environment node
/**
 * The split timers of a measurement build (CHORE-205 stage 0 a). The clock is a counting clock that advances by one per
 * read, so every span is the number of clock reads it contains plus one. The expected put counts come from the
 * identities of an independent encode of the same database and scope (grouped by identity prefix, nothing hard-coded),
 * and the expected spans are computed from those counts and from the position of every clock read in the hooks. A
 * dropped hook, a wrong section tag or a wrong identity grouping therefore fails the exact comparison.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { previousFrom } from '../../store2/codec'
import { encodeScoped } from '../../store2/codec/scoped'
import type { EncodedTree } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { setSplitClockForTest, startSavePass, type SavePassMeterHandle, type SavePassSplit } from '../../store2/savePassMeter'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }
type Section = 'front' | 'modules' | 'characters' | 'finish'

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
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

/** Counts every read, starting at 0. */
function countingClock(): () => number {
    let reads = 0
    return () => reads++
}

function groupOf(identity: string): Section {
    if (identity.startsWith('preset:') || identity.startsWith('plugin:') || identity.startsWith('psv:') || identity.startsWith('bucket:')) {
        return 'front'
    }
    if (identity.startsWith('module:') || identity.startsWith('al:module:') || identity.startsWith('il:module:') || identity === 'moduleIndex') {
        return 'modules'
    }
    if (identity.startsWith('char:') || identity.startsWith('chat:') || identity.startsWith('al:char:') || identity.startsWith('il:char:')) {
        return 'characters'
    }
    return 'finish'
}

function entityOfCharacterUnit(identity: string): string | null {
    const body = /^(?:char|chat):([^:]+):/.exec(identity) ?? /^(?:al|il):char:(.+)$/.exec(identity)
    return body === null ? null : body[1]
}

function handleOfModuleUnit(identity: string): string | null {
    const match = /^(?:al:|il:)?module:(.+)$/.exec(identity)
    return match === null ? null : match[1]
}

/** The fields of the record the exact comparison covers (the per-character list and the sections are compared apart). */
type ComparedSplit = Omit<SavePassSplit, 'characters' | 'sections'>

interface Expectation {
    puts: Record<Section, number>
    split: ComparedSplit
}

function comparedOf(split: SavePassSplit): ComparedSplit {
    const { characters: _characters, sections: _sections, ...rest } = split
    return rest
}

/**
 * The counts and spans a pass must record under the counting clock, from the tree of an independent encode of the same
 * database and scope. `named` is the number of characters the pass encoded, `modulesScoped` whether it encoded the modules.
 */
function expectationOf(tree: EncodedTree, characterCount: number, modulesScoped: boolean): Expectation {
    const puts: Record<Section, number> = { front: 0, modules: 0, characters: 0, finish: 0 }
    const shardPuts = tree.units.filter(unit => unit.identity.startsWith('shard:')).length
    const perCharacter = new Map<string, number>()
    const perModule = new Map<string, { puts: number, derived: boolean }>()
    for (const unit of tree.units) {
        puts[groupOf(unit.identity)]++
        const owner = entityOfCharacterUnit(unit.identity)
        if (owner !== null) {
            perCharacter.set(owner, (perCharacter.get(owner) ?? 0) + 1)
        }
        const handle = handleOfModuleUnit(unit.identity)
        if (handle !== null) {
            const row = perModule.get(handle) ?? { puts: 0, derived: false }
            row.puts++
            row.derived = row.derived || unit.identity.startsWith('al:module:')
            perModule.set(handle, row)
        }
    }
    let modulesMs = 1
    let readMs = 0
    let listsMs = 0
    if (modulesScoped) {
        modulesMs = 4
        for (const row of perModule.values()) {
            modulesMs += 2 + 3 * row.puts + (row.derived ? 4 : 0)
            readMs += 1
            listsMs += row.derived ? 2 : 0
        }
    }
    let charactersMs = 0
    for (const count of perCharacter.values()) {
        charactersMs += 2 + 3 * count
    }
    const named = perCharacter.size
    const carriedCount = characterCount - named
    const carriedMs = carriedCount + (carriedCount > 0 ? 2 : 0)
    const frontMs = 3 * puts.front + 1
    const finishTreeMs = 8 + 3 * puts.finish
    const syncMs = 1 + 1 + 1 + frontMs + modulesMs + charactersMs + carriedMs + 1 + finishTreeMs + 1
    return {
        puts,
        split: {
            scopeMs: 1,
            sinkMs: 1,
            listMs: 1,
            frontMs,
            modulesMs,
            moduleCount: modulesScoped ? perModule.size : 0,
            module: modulesScoped
                ? { readMs, listsMs, unitEncodeMs: puts.modules, unitDigestMs: puts.modules }
                : null,
            charactersCount: named,
            charactersMs,
            carriedMs,
            previousEntriesMs: carriedCount > 0 ? 1 : 0,
            carriedUnitsMs: 1,
            finishTreeMs,
            finish: { shardsMs: 1 + 3 * shardPuts, fixedMs: 10, configMs: 10, manifestMs: 4 },
            planTailMs: 1,
            unitEncodeMs: puts.front + puts.modules + puts.characters + puts.finish,
            unitDigestMs: puts.front + puts.modules + puts.characters + puts.finish,
            puts: puts.front + puts.modules + puts.characters + puts.finish,
            syncMs,
        },
    }
}

beforeEach(() => {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
    setSplitClockForTest(countingClock())
})

afterEach(() => {
    setSplitClockForTest(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

function editedModule(db: Database): Database {
    const next = clone(db)
    ;(next.modules as Obj[])[1].description = 'a description no fixture holds'
    return asDatabase(next)
}

function renamedFirst(db: Database): Database {
    const next = clone(db)
    ;(next.characters as Obj[])[0].name = 'a name no fixture holds'
    return asDatabase(next)
}

describe('the split of a module tick', () => {
    test('every section, put count and span equals what the pass\'s own units imply', async () => {
        const original = buildSmall(4)
        const db = editedModule(renamedFirst(original))
        const chaId = chaIdOf(db)
        const encoder = encoderOf(original)
        await encoder.plan(db, request({ net: { chaId, modules: true } }))

        const independent = await encodeScoped(
            db,
            { env: seededEnv(5), lists: fakeLists, seq: 0, createdAt: NOW, previous: previousFrom(encodeWith(original)) },
            { modules: true, characters: new Set([chaId]), skipUnsavableCharacters: true },
        )
        const expected = expectationOf(independent, db.characters.length, true)
        const record = meterOf().last()
        const split = record?.split
        expect(split).toBeDefined()
        if (split === undefined) {
            return
        }

        expect(split.sections.front.puts).toBe(expected.puts.front)
        expect(split.sections.modules.puts).toBe(expected.puts.modules)
        expect(split.sections.characters.puts).toBe(expected.puts.characters)
        expect(split.sections.finish.puts).toBe(expected.puts.finish)
        // Every put costs one framing read pair and one digest read pair under the counting clock.
        for (const name of ['front', 'modules', 'characters', 'finish'] as const) {
            expect(split.sections[name].unitEncodeMs).toBe(expected.puts[name])
            expect(split.sections[name].unitDigestMs).toBe(expected.puts[name])
        }
        expect(split.puts).toBe(independent.units.length)

        expect(split.moduleCount).toBe((db.modules as unknown[]).length)
        expect(comparedOf(split)).toEqual(expected.split)
        expect(split.characters.map(entry => [entry.chaId, entry.ms, entry.skipped])).toEqual([[chaId, split.charactersMs, false]])
        expect(split.characters[0].normalizeMs).toBe(1)
        expect(split.characters[0].emitMs).toBe(split.charactersMs - 1)
        expect(record?.seq).toBeGreaterThan(0)
        expect(typeof record?.at).toBe('number')
    })

    test('a marked pass that carries the modules records the carried branch and no module sub-split', async () => {
        const original = buildSmall(4)
        const db = renamedFirst(original)
        const chaId = chaIdOf(db)
        const encoder = encoderOf(original)
        await encoder.plan(db, request({ marked: new Set([chaId]) }))

        const independent = await encodeScoped(
            db,
            { env: seededEnv(5), lists: fakeLists, seq: 0, createdAt: NOW, previous: previousFrom(encodeWith(original)) },
            { modules: false, characters: new Set([chaId]), skipUnsavableCharacters: true },
        )
        const expected = expectationOf(independent, db.characters.length, false)
        const split = meterOf().last()?.split
        expect(split).toBeDefined()
        if (split === undefined) {
            return
        }
        expect(split.module).toBeNull()
        expect(split.moduleCount).toBe(0)
        expect(split.modulesMs).toBe(expected.split.modulesMs)
        expect(split.sections.modules.puts).toBe(0)
        expect(split.carriedMs).toBe(expected.split.carriedMs)
        expect(split.previousEntriesMs).toBe(1)
        expect(split.charactersMs).toBe(expected.split.charactersMs)
        expect(split.characters.map(entry => entry.chaId)).toEqual([chaId])
        expect(split.frontMs).toBe(expected.split.frontMs)
        expect(split.finishTreeMs).toBe(expected.split.finishTreeMs)
        expect(split.finish).toEqual(expected.split.finish)
        expect(split.syncMs).toBe(expected.split.syncMs)
    })

    test('a character whose data cannot be read is recorded as skipped and the others as encoded', async () => {
        const original = buildSmall(3)
        const db = renamedFirst(original)
        const cyclic: Obj = { name: 'cycle' }
        cyclic.self = cyclic
        ;(db.characters[1] as unknown as Obj).extra = cyclic
        const encoder = encoderOf(original)
        await encoder.plan(db, request({ marked: new Set([chaIdOf(db, 0), chaIdOf(db, 1)]) }))
        const split = meterOf().last()?.split
        expect(split?.characters.map(entry => [entry.chaId, entry.skipped])).toEqual([[chaIdOf(db, 0), false], [chaIdOf(db, 1), true]])
        expect(split?.charactersCount).toBe(2)
        expect(meterOf().last()?.characters).toBe(1)
    })

    test('the pass record is cumulative with a monotonic seq and carries the page\'s isolation state', async () => {
        const db = buildSmall(2)
        const encoder = encoderOf(db)
        await encoder.plan(db, request())
        await encoder.plan(db, request())
        const [first, second] = meterOf().all()
        expect(second.seq).toBe((first.seq ?? 0) + 1)
        expect(first.crossOriginIsolated === null || typeof first.crossOriginIsolated === 'boolean').toBe(true)
        expect(first.retry).toBe(false)
    })
})
