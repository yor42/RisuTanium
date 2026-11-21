// @vitest-environment node
/**
 * The seams a streamed import shares with the whole-tree import (CHORE-807 S1-B): the id check and the per-character id
 * repair (`chatIds.ts`), the character and root halves of the resolve (`resolve.ts`), the import prepare steps
 * (`importTree.ts`), the sink drain and the streamed encode (`codec/scoped.ts`). Labels in test names: `guard` may pass
 * before and after the change, `new seam` asserts a function that exists only after it.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import type { Database } from 'src/ts/storage/database.svelte'
import { chaIdRepairNeeded, repairCharacterIds, repairDatabaseIds } from 'src/ts/process/chatIds'
import {
    CodecError, createStreamedEncode, encodeScoped, planScopedEncode, UnitSink, unitsToWrite,
    type ContentIndex, type EncodedTree, type EncodeOptions, type EncodeScope, type ReusableUnit,
} from 'src/ts/storage/store2/codec'
import { carryManifest } from 'src/ts/storage/store2/codec/manifest'
import { createKeyMint, type BuildContext, type BuiltCommit } from 'src/ts/storage/store2/commit'
import { decodeFrame, tailOfKey, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import {
    applyImportOverlay, buildImport, confirmImportIncomplete, repairImportRoot,
} from 'src/ts/storage/store2/legacy/importTree'
import {
    LegacyReadError, resolveLegacyCharacter, resolveLegacyRoot, resolveLegacyTree, type IncompleteItem, type LegacyEntryReader,
} from 'src/ts/storage/store2/legacy/resolve'
import { buildSmall, dbWithCharacters, fakeLists, seededEnv, type Obj } from './codecFixtures'
import { ID, loadGolden, readerOver } from './legacyFixtures'

const NOW = 1_700_000_000_000
const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }

afterEach(() => {
    vi.restoreAllMocks()
})

// ---- T-B1: the id seam ----

describe('chaIdRepairNeeded: true exactly when repairDatabaseIds would change a chaId (uuid is not mocked)', () => {
    /** What `repairDatabaseIds` does to a copy: whether any entry that is an object ends with another chaId. */
    function changedByRepair(characters: unknown[]): boolean {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const before = characters.map(entry => (entry !== null && typeof entry === 'object' ? (entry as Obj).chaId : undefined))
        const copy = structuredClone(characters)
        repairDatabaseIds({ characters: copy })
        return copy.some((entry, index) => entry !== null && typeof entry === 'object' && !Object.is((entry as Obj).chaId, before[index]))
    }

    const CASES: [string, unknown[], boolean][] = [
        ['a missing chaId', [{ chaId: 'a' }, { name: 'no id' }], true],
        ['an empty chaId', [{ chaId: '' }], true],
        ['a zero chaId', [{ chaId: 0 }], true],
        ['5 and the string "5" are different ids', [{ chaId: 5 }, { chaId: '5' }], false],
        ['the number 5 twice', [{ chaId: 5 }, { chaId: 5 }], true],
        ['a duplicate string chaId', [{ chaId: 'a' }, { chaId: 'b' }, { chaId: 'a' }], true],
        ['a chaId equal to an earlier chat id', [{ chaId: 'a', chats: [{ id: 'x' }] }, { chaId: 'x' }], true],
        ['a chat id equal to an earlier chaId changes the chat only', [{ chaId: 'a' }, { chaId: 'b', chats: [{ id: 'a' }] }], false],
        ['a chat id equal to a later chaId', [{ chaId: 'a', chats: [{ id: 'z' }] }, { chaId: 'b' }, { chaId: 'z' }], true],
        ['chats that are not an array are skipped', [{ chaId: 'a', chats: 'x' }, { chaId: 'b', chats: 7 }], false],
        ['chats that are absent or null', [{ chaId: 'a' }, { chaId: 'b', chats: null }], false],
        ['a duplicate chat id without a chaId problem', [{ chaId: 'a', chats: [{ id: 'c' }, { id: 'c' }, {}] }], false],
        ['a chat that is not an object', [{ chaId: 'a', chats: [null, 4, 'x', { id: 'c' }] }, { chaId: 'b' }], false],
        ['entries that are null or primitive are skipped', [null, 5, 'x', { chaId: 'a' }], false],
        ['no characters', [], false],
    ]

    test.each(CASES)('%s', (_label, characters, expected) => {
        expect(changedByRepair(characters)).toBe(expected)
        expect(chaIdRepairNeeded(characters)).toBe(expected)
    })

    test('a list that is not an array changes nothing', () => {
        expect(chaIdRepairNeeded(undefined)).toBe(false)
        expect(chaIdRepairNeeded({ 0: { chaId: '' } })).toBe(false)
    })

    test('the id set spans every character, not one', () => {
        expect(chaIdRepairNeeded([{ chaId: 'same' }, { chaId: 'other' }, { chaId: 'same' }])).toBe(true)
    })
})

describe('repairCharacterIds: the per-character step, run with one shared id set, is repairDatabaseIds', () => {
    afterEach(() => {
        vi.doUnmock('uuid')
        vi.resetModules()
    })

    test('under a counting uuid the loop of steps and the whole function give the same list', async () => {
        const state = { next: 0 }
        vi.resetModules()
        vi.doMock('uuid', () => ({ v4: () => `fresh-${state.next++}` }))
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const ids = await import('src/ts/process/chatIds')
        const listOf = (): unknown[] => [
            { chaId: 'a', chats: [{ id: 'c1' }, { id: 'c1' }, {}, { id: 'a' }] },
            { chaId: 'a', chats: undefined },
            { chaId: '', chats: null },
            { name: 'bare', chats: [{ id: 'c1' }] },
            null,
            7,
            { chaId: 'b', chats: 'not a list' },
            { chaId: 'c1' },
        ]

        const whole = { characters: listOf() }
        state.next = 0
        ids.repairDatabaseIds(whole)

        const stepped = listOf()
        state.next = 0
        const assigned = new Set<string>()
        for (const cha of stepped) {
            ids.repairCharacterIds(cha, assigned)
        }

        expect(stepped).toEqual(whole.characters)
        expect(state.next).toBeGreaterThan(3)
    })

    test('the step leaves an entry that is not an object alone', () => {
        const assigned = new Set<string>()
        expect(() => repairCharacterIds(null, assigned)).not.toThrow()
        expect(() => repairCharacterIds(3, assigned)).not.toThrow()
        expect(assigned.size).toBe(0)
    })
})

// ---- T-B2: the resolve halves ----

describe('resolveLegacyCharacter and resolveLegacyRoot compose into resolveLegacyTree (new seam; the whole-tree half is a guard)', () => {
    const STUB_TREE = (): Database => ({
        characters: [
            { chaId: 'cha-stub', name: 'Stub Bob', type: 'character', coldstorage: ID.stubBlob, chats: [] },
            { chaId: 'cha-inline', name: 'Inline', type: 'character', chats: [{ id: 'c1', message: [{ role: 'char', data: 'hi', time: 1 }] }] },
        ],
        pluginCustomStorage: { _coldplugin: { slot1: ID.pluginUnit } },
        taskPresets: [{ name: 'dropped' }],
        botPresets: [],
    }) as unknown as Database

    async function composed(db: Database, reader: LegacyEntryReader): Promise<{ database: Database, incomplete: IncompleteItem[] }> {
        const incomplete: IncompleteItem[] = []
        const source = db.characters as unknown[]
        const characters: unknown[] = []
        for (let index = 0; index < source.length; index++) {
            characters.push(await resolveLegacyCharacter(source[index], index, reader, incomplete, OPTIONS))
        }
        return { database: await resolveLegacyRoot(db, characters, reader, incomplete, OPTIONS), incomplete }
    }

    test('the incomplete items are the characters first and the plugins after, the whole tree and the halves alike', async () => {
        const tree = STUB_TREE()
        const reader = readerOver(new Map())

        const whole = await resolveLegacyTree(tree, reader, OPTIONS)
        const halves = await composed(tree, reader)

        expect(whole.incomplete.map(item => item.kind)).toEqual(['character', 'plugin'])
        expect(halves.incomplete).toEqual(whole.incomplete)
        expect(halves.database).toEqual(whole.database)
        expect(Object.hasOwn(halves.database, 'taskPresets')).toBe(false)
        expect(Object.keys(halves.database)).toEqual(Object.keys(whole.database))
    })

    test('the first read failure is the character one, whole or in halves', async () => {
        const tree = STUB_TREE()
        const faulty = (): LegacyEntryReader => readerOver(new Map(), { throwKeys: new Set([ID.stubBlob, ID.pluginUnit]) })

        const wholeError = await resolveLegacyTree(tree, faulty(), OPTIONS).catch((error: unknown) => error)
        const halfError = await composed(tree, faulty()).catch((error: unknown) => error)

        expect(wholeError).toBeInstanceOf(LegacyReadError)
        expect((wholeError as LegacyReadError).key).toBe(ID.stubBlob)
        expect(halfError).toBeInstanceOf(LegacyReadError)
        expect((halfError as LegacyReadError).key).toBe(ID.stubBlob)
    })

    test('a plugin read failure alone surfaces from the root half', async () => {
        const tree = STUB_TREE()
        const reader = readerOver(new Map(), { throwKeys: new Set([ID.pluginUnit]) })

        const wholeError = await resolveLegacyTree(tree, reader, OPTIONS).catch((error: unknown) => error)

        expect((wholeError as LegacyReadError).key).toBe(ID.pluginUnit)
        await expect(resolveLegacyRoot(tree, [], reader, [], OPTIONS)).rejects.toMatchObject({ key: ID.pluginUnit })
    })

    test.each(['upstream-missing-unit.bin', 'upstream-plugin-object-no-entry.bin', 'fork-full.bin'])('%s: the halves give the whole tree\'s database and incomplete list', async (file) => {
        const golden = await loadGolden(file)

        const whole = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)
        const halves = await composed(golden.tree, readerOver(golden.units))

        expect(halves.database).toEqual(whole.database)
        expect(halves.incomplete).toEqual(whole.incomplete)
    })

    test('a slot that is not an object passes through, as the whole resolve places it', async () => {
        const incomplete: IncompleteItem[] = []
        expect(await resolveLegacyCharacter(null, 0, readerOver(new Map()), incomplete, OPTIONS)).toBeNull()
        expect(await resolveLegacyCharacter(5, 1, readerOver(new Map()), incomplete, OPTIONS)).toBe(5)
        expect(incomplete).toEqual([])
    })
})

// ---- importTree.ts shared prepare steps ----

describe('the shared prepare steps (new seam)', () => {
    test('confirmImportIncomplete asks only when something is incomplete, and false is a decline', async () => {
        const asked: (readonly IncompleteItem[])[] = []
        const hooks = (answer: boolean) => ({ async confirmIncomplete(items: readonly IncompleteItem[]) { asked.push(items); return answer } })
        const item: IncompleteItem = { kind: 'plugin', slotKey: 's', key: 'k', reason: 'missing' }

        expect(await confirmImportIncomplete([], hooks(false))).toBe(true)
        expect(asked).toEqual([])
        expect(await confirmImportIncomplete([item], hooks(true))).toBe(true)
        expect(await confirmImportIncomplete([item], hooks(false))).toBe(false)
        expect(asked).toEqual([[item], [item]])
    })

    test('applyImportOverlay drops the file\'s theme keys and sets only what the request passes', () => {
        const database = { themePacks: ['file'], activeThemePack: 'file', taskPresets: undefined } as unknown as Database
        applyImportOverlay(database, { themePacks: [{ id: 'p1' }], activeThemePack: 'builtin:x', taskPresets: [{ name: 't' }] })
        expect(database.themePacks).toEqual([{ id: 'p1' }])
        expect(database.activeThemePack).toBe('builtin:x')
        expect(database.taskPresets).toEqual([{ name: 't' }])

        const bare = { themePacks: ['file'], activeThemePack: 'file' } as unknown as Database
        applyImportOverlay(bare, {})
        expect(Object.hasOwn(bare, 'themePacks')).toBe(false)
        expect(Object.hasOwn(bare, 'activeThemePack')).toBe(false)
    })

    test('T26 guard: the import overlay keeps the file\'s colour scheme and sets only the page\'s active pack', () => {
        const scheme = { bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050', textcolor: '#606060', textcolor2: '#707070', darkBorderc: '#808080', darkbutton: '#909090', type: 'dark' }
        const custom = { ...scheme, bgcolor: '#111111' }
        const database = { colorSchemeName: 'ocean', colorScheme: scheme, customColorScheme: custom } as unknown as Database
        const before = structuredClone(database)

        applyImportOverlay(database, { activeThemePack: 'builtin:origin-navy' })

        expect(database.colorSchemeName).toBe(before.colorSchemeName)
        expect(database.colorScheme).toEqual(before.colorScheme)
        expect(database.customColorScheme).toEqual(before.customColorScheme)
        expect(database.activeThemePack).toBe('builtin:origin-navy')
        expect(Object.hasOwn(database, 'themePackSchemeSnapshot')).toBe(false)
    })
    test('repairImportRoot completes the containers the encoder reads', () => {
        const tree = { characters: [] } as unknown as Database
        repairImportRoot(tree)
        expect(tree.modules).toEqual([])
        expect(tree.loadouts).toEqual([])
        expect(tree.plugins).toEqual([])
        expect(tree.botPresets).toHaveLength(1)
    })

    test('buildImport builds from a finalize that returns the built commit itself, carrying the base as it does for a plan', async () => {
        const manifest = { key: 'm-key', body: { seq: 1, fixed: {} } as unknown as Manifest }
        const built: BuiltCommit = { units: [{ key: 'u-key', bytes: new Uint8Array([1]) }], manifest }
        const context = { mint: createKeyMint(seededEnv(3), null).mint, seq: 4, now: NOW } satisfies BuildContext

        const build = buildImport({ newUnits: 2, finalize: async () => built })
        const result = build.build(context)

        expect(build.newUnits).toBe(2)
        expect(result).toBeInstanceOf(Promise)
        const resolved = await result
        expect(resolved.units).toEqual(built.units)
        expect(resolved.manifest.key).toBe('m-key')
        expect(resolved.manifest.body).toEqual(carryManifest(undefined, manifest.body))
    })
})

// ---- T-B3: the drain and the streamed encode ----

describe('UnitSink.drain keeps no frame (new seam)', () => {
    test('the units come out with their bytes once, and what stays holds identity, key, type, Ref and digest only', () => {
        const sink = new UnitSink(seededEnv(1), null)
        sink.put('statics', UNIT_TYPE.statics, { v: 1 })
        sink.put('order', UNIT_TYPE.order, { v: 1, chars: [] })

        const out = sink.drain()

        expect(out.map(unit => unit.identity)).toEqual(['statics', 'order'])
        expect(out.every(unit => unit.bytes.length > 0)).toBe(true)
        expect(sink.units).toEqual([])
        expect(sink.drained.map(unit => unit.identity)).toEqual(['statics', 'order'])
        for (const kept of sink.drained) {
            expect(Object.keys(kept).sort()).toEqual(['digest', 'identity', 'key', 'ref', 'type'])
            expect('bytes' in kept).toBe(false)
        }
        expect(sink.drain()).toEqual([])
    })

    test('a drained identity is still refused as a duplicate', () => {
        const sink = new UnitSink(seededEnv(1), null)
        sink.put('statics', UNIT_TYPE.statics, { v: 1 })
        sink.drain()
        expect(() => sink.put('statics', UNIT_TYPE.statics, { v: 1 })).toThrow(CodecError)
    })
})

type BuiltUnits = BuiltCommit['units']

/**
 * A key-free picture of a tree: every unit by the content of its body, a Ref to another unit replaced by that unit's
 * picture (children come before their parents in both encodes), and the manifest without `seq` and `createdAt`.
 */
function pictureOf(units: BuiltUnits, manifest: Manifest): { units: string[], manifest: string } {
    const named = new Map<string, string>()
    const isRef = (value: unknown[]): value is [string, number, number, ...unknown[]] =>
        (value.length === 3 || value.length === 4) && typeof value[0] === 'string' && typeof value[1] === 'number' && typeof value[2] === 'number'
    const norm = (value: unknown): unknown => {
        if (Array.isArray(value)) {
            const target = isRef(value) ? named.get(value[0]) : undefined
            return target !== undefined ? ['ref', target, ...value.slice(3).map(norm)] : value.map(norm)
        }
        if (typeof value === 'object' && value !== null) {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, norm(item)]))
        }
        return value
    }
    const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
    const pictures: string[] = []
    for (const unit of units) {
        const frame = decodeFrame(unit.bytes)
        if (frame.status !== 'ok') {
            throw new Error('a unit of the tree is not a frame')
        }
        const text = `${frame.type}:${JSON.stringify(norm(JSON.parse(new TextDecoder().decode(frame.payload))))}`
        const picture = digest(text)
        named.set(tailOfKey(unit.key), picture)
        pictures.push(picture)
    }
    const { seq: _seq, createdAt: _createdAt, ...rest } = manifest as unknown as Obj
    return { units: pictures.sort(), manifest: JSON.stringify(norm(rest)) }
}

const EVERYTHING: EncodeScope = { modules: true, characters: 'all' }

function scopedOptions(): EncodeOptions {
    return { env: seededEnv(5), lists: fakeLists, seq: 2, createdAt: NOW, previous: null, keys: createKeyMint(seededEnv(99), null).mint }
}

async function streamedOver(
    db: Database, context?: BuildContext, content?: ContentIndex,
): Promise<{ units: BuiltUnits, manifest: Manifest, count: number, reused: number, handed: BuiltUnits[] }> {
    const encode = createStreamedEncode(seededEnv(5), fakeLists, undefined, context, content)
    const handed: BuiltUnits[] = []
    const source = db.characters as unknown[]
    for (let index = 0; index < source.length; index++) {
        handed.push(await encode.character(source[index], index))
    }
    const finished = await encode.finish({ ...db, characters: [] } as Database)
    return { units: [...handed.flat(), ...finished.built.units], manifest: finished.built.manifest.body, count: finished.count, reused: finished.reused, handed }
}

/** An index over every unit of `tree` an import may take (never the manifest, shards or `order`). */
function contentOf(tree: EncodedTree): ContentIndex {
    const units = new Map<string, ReusableUnit[]>()
    for (const unit of tree.units) {
        if (unit.type === UNIT_TYPE.manifest || unit.type === UNIT_TYPE.shard || unit.type === UNIT_TYPE.order) {
            continue
        }
        units.set(unit.digest, [...(units.get(unit.digest) ?? []), { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest }])
    }
    return { units }
}

function scopedPicture(tree: EncodedTree): { units: string[], manifest: string } {
    const written = unitsToWrite(tree).filter(unit => unit.type !== UNIT_TYPE.manifest)
    return pictureOf(written.map(unit => ({ key: unit.key, bytes: unit.bytes })), tree.manifest)
}

describe('createStreamedEncode: characters first, the root last, is encodeScoped (new seam)', () => {
    test('the units, their references and the manifest match once keys are taken out, and the count is the plan\'s', async () => {
        const db = buildSmall(6)
        const tree = await encodeScoped(db, scopedOptions(), EVERYTHING)

        const streamed = await streamedOver(db)

        expect(streamed.count).toBe(tree.units.length)
        expect(pictureOf(streamed.units, streamed.manifest)).toEqual(scopedPicture(tree))
        // Each character's units come out of its own call, and the call after the last character holds none of them.
        expect(streamed.handed.every(units => units.length > 0)).toBe(true)
    })

    test('under a build context the keys are the context mint\'s, and its seq, clock and legacyKeep are the manifest\'s', async () => {
        const db = buildSmall(3)
        const issuing = createKeyMint(seededEnv(7), null)
        const keep = { unit: ['u-keep', 1, 2], v: 1, files: [] } as unknown as NonNullable<Manifest['fixed']['legacyKeep']>

        const streamed = await streamedOver(db, { mint: issuing.mint, seq: 9, now: NOW + 5, legacyKeep: keep })

        expect(streamed.manifest.seq).toBe(9)
        expect(streamed.manifest.createdAt).toBe(NOW + 5)
        expect(streamed.manifest.fixed.legacyKeep).toBe(keep)
        // Every unit but the manifest was issued by the attempt's mint; the manifest key was issued too.
        for (const unit of streamed.units) {
            expect(issuing.issued.has(unit.key)).toBe(true)
        }
        expect(issuing.issued.size).toBe(streamed.count)
    })

    test('an empty character list is a tree of the root alone', async () => {
        const db = dbWithCharacters([])
        const tree = await encodeScoped(db, scopedOptions(), EVERYTHING)

        const streamed = await streamedOver(db)

        expect(streamed.count).toBe(tree.units.length)
        expect(pictureOf(streamed.units, streamed.manifest)).toEqual(scopedPicture(tree))
    })
})

describe('createStreamedEncode over a content index makes the plan\'s decisions (new seam)', () => {
    async function baseIndex(): Promise<{ content: ContentIndex, base: EncodedTree }> {
        const base = await encodeScoped(buildSmall(6), { ...scopedOptions(), env: seededEnv(1), seq: 1, keys: createKeyMint(seededEnv(50), null).mint }, EVERYTHING)
        return { content: contentOf(base), base }
    }

    test('every unit is written or reused, none twice; the leaves are all reused and only the parents the plan also writes (and a parent whose claim order differs) are written', async () => {
        const { content } = await baseIndex()
        const plan = await planScopedEncode(buildSmall(6), { ...scopedOptions(), content }, EVERYTHING)

        const streamed = await streamedOver(buildSmall(6), undefined, content)

        expect(plan.carried.units).toBeGreaterThan(0)
        expect(streamed.reused).toBeGreaterThan(0)
        // Without the index nothing is reused and every unit is written: reuse only moves a unit from one count to the other.
        const bare = await streamedOver(buildSmall(6))
        expect(bare.reused).toBe(0)
        expect(streamed.count + streamed.reused).toBe(bare.count)
        expect(plan.newUnits + plan.carried.units).toBe(bare.count)
        // The streamed encode puts the characters before the modules, the plan the other way round. Equal units (an empty
        // asset list of a module and of a character) therefore claim the stored copies in another order, and a parent that
        // names them can differ: the streamed encode writes at least what the plan writes, and only parents more.
        const writtenTypes = new Set(streamed.units.map(unit => (decodeFrame(unit.bytes) as { type: number }).type))
        for (const type of writtenTypes) {
            expect([UNIT_TYPE.order, UNIT_TYPE.shard, UNIT_TYPE.moduleBucket, UNIT_TYPE.moduleIndex, UNIT_TYPE.pluginStorageBucket]).toContain(type)
        }
        expect(streamed.count).toBeGreaterThanOrEqual(plan.newUnits)
    })

    test('a dry pass under placeholder keys and the attempt\'s pass under real keys decide alike over one index', async () => {
        const { content } = await baseIndex()
        const dry = await streamedOver(buildSmall(6), undefined, content)
        const real = await streamedOver(buildSmall(6), { mint: createKeyMint(seededEnv(7), null).mint, seq: 2, now: NOW }, content)

        expect([real.count, real.reused]).toEqual([dry.count, dry.reused])
        const baseKeys = new Set((await baseIndex()).base.units.map(unit => unit.key))
        // Every unit this pass hands out is new: a reused unit is in no frame list, and its key is the base's.
        for (const unit of real.units) {
            expect(baseKeys.has(unit.key)).toBe(false)
        }
    })
})

// ---- T-B5: the CodecError precedence lives in the codec ----

describe('createStreamedEncode holds a character CodecError and reports it in encodeScoped\'s order (new seam)', () => {
    type Mutate = (db: Obj) => void
    const badChats: Mutate = (db) => { ((db.characters as Obj[])[1]).chats = [5] }
    const PLACEMENTS: [string, Mutate[]][] = [
        ['front only', [(db) => { db.plugins = 'x' }]],
        ['character only', [badChats]],
        ['two characters, the first wins', [badChats, (db) => { ((db.characters as Obj[])[2]).chats = [6] }]],
        ['character plus front', [badChats, (db) => { db.plugins = 'x' }]],
        ['character plus modules', [badChats, (db) => { db.modules = 'x' }]],
        ['front plus modules', [(db) => { db.plugins = 'x' }, (db) => { db.modules = 'x' }]],
        ['finish only', [(db) => { db.loadouts = 'x' }]],
        ['character plus finish', [badChats, (db) => { db.loadouts = 'x' }]],
        ['character plus the inputs check', [badChats, (db) => { db.botPresets = 'x' }]],
    ]

    async function errorOf(run: () => Promise<unknown>): Promise<Error> {
        try {
            await run()
        } catch (error) {
            return error as Error
        }
        throw new Error('the encode did not fail')
    }

    test.each(PLACEMENTS)('%s', async (_label, mutations) => {
        const db = buildSmall(3) as unknown as Obj
        for (const mutate of mutations) {
            mutate(db)
        }
        const tree = db as unknown as Database

        const expected = await errorOf(() => encodeScoped(tree, scopedOptions(), EVERYTHING))
        const actual = await errorOf(() => streamedOver(tree))

        expect(expected).toBeInstanceOf(CodecError)
        expect(actual.constructor).toBe(expected.constructor)
        expect(actual.message).toBe(expected.message)
    })

    test('after a held error no later character is encoded or handed out', async () => {
        const db = buildSmall(3) as unknown as Obj
        badChats(db)
        const encode = createStreamedEncode(seededEnv(5), fakeLists)
        const source = (db as unknown as Database).characters as unknown[]

        expect((await encode.character(source[0], 0)).length).toBeGreaterThan(0)
        expect(await encode.character(source[1], 1)).toEqual([])
        expect(await encode.character(source[2], 2)).toEqual([])
        await expect(encode.finish({ ...(db as unknown as Database), characters: [] } as Database)).rejects.toThrow('characters[1].chats[0] is not an object.')
    })

    test('an error that is not a CodecError is thrown by the call, not held', async () => {
        const encode = createStreamedEncode(seededEnv(5), { ...fakeLists, characterAssets: () => { throw new TypeError('lists broke') } })
        const db = buildSmall(1)

        await expect(encode.character((db.characters as unknown[])[0], 0)).rejects.toThrow(TypeError)
    })
})
