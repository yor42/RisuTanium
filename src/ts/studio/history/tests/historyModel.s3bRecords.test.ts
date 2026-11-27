// @vitest-environment jsdom
// The records of the Studio S3b portrait steps. The real service writes one step of each portrait intent (an add with
// notes, an add without, make main, remove an alternate, remove the main); the record equals the committed fixture, reads
// back through the strict parser and every step undoes. The fixture is rewritten only with RISU_WRITE_S3B_RECORDS=1. B-T9
// then breaks the committed record shape by shape: a record that holds more or less than the strict shape, and a portrait
// label or op on an owner that has no portrait, is refused whole. The version 2 fixture written before S3b still parses.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { parseOwnerRecord, type OwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import baseFixture from './fixtures/historyV2.b0.json'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 's3bRecords.json')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const A = characterOwnerKey('A')
const hash = (letter: string): string => `assets/${letter.repeat(64)}.png`
const M = hash('m')
const N = hash('n')
const P = hash('p')
const Q = hash('q')

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function character(): unknown {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        image: M,
        ccAssets: [{ type: 'icon', name: 'iconx', uri: P, ext: 'png' }],
        extentions: { pngExif: { Title: 'old' }, unrelated: { keep: true } },
    }
}

async function session(): Promise<{ service: OwnerHistoryService; clock: ReturnType<typeof createFakeClock> }> {
    DBState.db.characters = [character()] as unknown as typeof DBState.db.characters
    const clock = createFakeClock(1000)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
    return { service, clock }
}

// One step per portrait intent through the real service.
async function produce(): Promise<unknown> {
    const { service, clock } = await session()
    const run = (result: ReturnType<OwnerHistoryService['portraitAdd']>): void => {
        if (!result.ok) throw new Error(`step refused: ${JSON.stringify(result)}`)
        clock.tick(60_000)
    }
    run(service.portraitAdd(A, N, { Title: 'new', Comment: 'c' }))
    run(service.portraitAdd(A, Q, {}))
    run(service.portraitMakeMain(A, 0))
    run(service.portraitRemove(A, 1))
    run(service.portraitRemove(A, 'main'))
    const view = service.view(A)
    return JSON.parse(JSON.stringify({ ownerKey: A, touchedAt: clock.now(), done: view.done, undone: view.undone, deleted: view.deleted, restore: view.restore }))
}

type Json = Record<string, unknown>

function committed(): OwnerRecord & Json {
    return JSON.parse(readFileSync(FIXTURE, 'utf8'))
}

describe('the records the S3b writer produces', () => {
    test('they equal the committed fixture and read back through the strict parser', async () => {
        const produced = await produce()
        if (process.env.RISU_WRITE_S3B_RECORDS === '1') {
            writeFileSync(FIXTURE, JSON.stringify(produced, null, 2) + '\n')
        }
        const stored = committed()
        expect(produced).toEqual(stored)
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(stored)), A)).toEqual(stored)
        const text = JSON.stringify(stored)
        for (const kind of ['portraitAdd', 'portraitMain', 'portraitRemove']) {
            expect(text, kind).toContain(`"kind":"${kind}"`)
        }
        // The notes pair is on the add that carried notes and on no other step.
        const withPair = stored.done.filter((step) => step.ops.some((op) => 'pngExif' in op))
        expect(withPair).toHaveLength(1)
        expect(stored.done).toHaveLength(5)
    })

    test('every step of the committed record undoes on the character it was written for, back to where it began', async () => {
        const { service, clock } = await session()
        const began = structuredClone(JSON.parse(JSON.stringify(DBState.db.characters[0]))) as Json
        for (const result of [
            service.portraitAdd(A, N, { Title: 'new', Comment: 'c' }),
            service.portraitAdd(A, Q, {}),
            service.portraitMakeMain(A, 0),
            service.portraitRemove(A, 1),
            service.portraitRemove(A, 'main'),
        ]) {
            expect(result.ok).toBe(true)
            clock.tick(60_000)
        }
        for (let left = 5; left > 0; left--) {
            expect(service.undo(A).ok).toBe(true)
        }
        const now = JSON.parse(JSON.stringify(DBState.db.characters[0])) as Json
        delete now.risutanium_asset_retained
        expect(now).toEqual(began)
    })
})

describe('B-T9: the strict shape of a portrait record', () => {
    const parse = (record: unknown, key: StoredOwnerKey = A): OwnerRecord | null => parseOwnerRecord(JSON.parse(JSON.stringify(record)), key)
    const firstOp = (record: Json): Json => ((record.done as Json[])[0].ops as Json[])[0]

    test('the committed record reads back with every op as written', () => {
        expect(parse(committed())).not.toBeNull()
    })

    test.each([
        ['an alternate row with an extra key', (record: Json) => { (((firstOp(record).after as Json).alternates as Json).rows as Json[])[0].extra = 'x' }],
        ['an alternate row whose uri is not a string', (record: Json) => { (((firstOp(record).after as Json).alternates as Json).rows as Json[])[0].uri = 5 }],
        ['an alternate row missing a key', (record: Json) => { delete (((firstOp(record).after as Json).alternates as Json).rows as Json[])[0].ext }],
        ['an image that is not a string', (record: Json) => { ((firstOp(record).before as Json).image as Json).value = 7 }],
        ['an image with an extra key', (record: Json) => { ((firstOp(record).before as Json).image as Json).extra = true }],
        ['a portrait value with an extra key', (record: Json) => { (firstOp(record).before as Json).extra = true }],
        ['an op with an extra key', (record: Json) => { firstOp(record).extra = true }],
        ['an exif pair with an extra key', (record: Json) => { (firstOp(record).pngExif as Json).extra = true }],
        ['an exif value that holds a value without had', (record: Json) => { ((firstOp(record).pngExif as Json).after as Json).had = 'maybe' }],
        ['a label with an extra key', (record: Json) => { ((record.done as Json[])[0].label as Json).extra = 1 }],
    ])('%s is refused whole', (_name, break_) => {
        const record = committed() as Json
        break_(record)
        expect(parse(record)).toBeNull()
    })

    test('a portrait op on a module or a chat owner is refused whole', () => {
        const record = committed() as Json
        // The label is one the owner kind accepts, so only the op can refuse the record.
        for (const key of [moduleOwnerKey('M1'), chatOwnerKey('A', 'c1')]) {
            const other = { ...record, ownerKey: key, done: (record.done as Json[]).map((step) => ({ ...step, label: { kind: 'assetAdd', count: 1 } })) }
            expect(parse(other, key), key).toBeNull()
        }
    })

    test('A6: a portrait label alone, with no op, is refused for a module owner, so only the label rule can refuse it', () => {
        const module = { ownerKey: moduleOwnerKey('M1'), touchedAt: 1, done: [{ id: 's1', at: 1, label: { kind: 'portraitAdd' }, ops: [] }], undone: [], deleted: [], restore: null }
        expect(parse(module, moduleOwnerKey('M1'))).toBeNull()
        const control = { ...module, done: [{ id: 's1', at: 1, label: { kind: 'assetAdd', count: 1 }, ops: [] }] }
        expect(parse(control, moduleOwnerKey('M1'))).not.toBeNull()
        const character = { ownerKey: A, touchedAt: 1, done: [{ id: 's1', at: 1, label: { kind: 'portraitAdd' }, ops: [] }], undone: [], deleted: [], restore: null }
        expect(parse(character)).not.toBeNull()
    })

    test('the version 2 record written before S3b still parses', () => {
        const stored = baseFixture as unknown as { ownerKey: StoredOwnerKey; record: unknown }
        expect(parse(stored.record, stored.ownerKey)).not.toBeNull()
    })
})
