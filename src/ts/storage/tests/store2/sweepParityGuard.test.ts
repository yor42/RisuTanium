/**
 * Parity of the asset sweep's keep-set with the boot-time collector (`getUncleanablesSync`), over trees the real encoder
 * and the real list derivation produced from a database that holds every asset field kind on owners that are stored and
 * not resident (the sweep's resident references are empty): the sweep deletes only the assets nothing refers to, in two
 * passes a day apart, and keeps what the collector keeps for the same database. The expected keep is computed by the
 * collector itself, never listed by hand, so a field the collector reads and the derivation does not read leaves its asset
 * in the candidates and fails the two-pass test.
 *
 * The read-path guard (G1) records every property the collector reads on a database and requires the derivation to read
 * the same path on the owner that holds it, so a reference field added to the collector later fails here even before any
 * fixture populates it. The restore-point leg shows that an asset only a retained tree names is kept while that tree is
 * retained, and becomes an ordinary candidate once the tree is no longer retained.
 *
 * Classes: the two-pass and restore-point tests are compatibility guards (they pass before and after the wiring of the
 * sweep; a mutant that drops a field from the derivation turns them red), and G1 is a compatibility guard that a mutant
 * which adds a field to the collector alone turns red. A mocked backend says nothing about a native one.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

// The collector is a function of the database; the modules below only start effects that need a live UI.
vi.mock('../../../translator/translator', () => ({}))
vi.mock('../../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../../process/modules', () => ({ moduleUpdate: vi.fn() }))

import { getBasename, getUncleanablesSync } from 'src/ts/globalApi.svelte'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { ADMISSION_INTERVAL_MS, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { AssetRefCollector, collectCharacterAssets, collectConfigAssets, collectModuleAssets } from 'src/ts/storage/store2/lists/assetList'
import { Store2Session } from 'src/ts/storage/store2/session'
import { runAssetSweep, type AssetSweepEnv, type AssetSweepResult } from 'src/ts/storage/store2/sweep'
import type { Database } from 'src/ts/storage/database.svelte'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { createClock, seedTree, startStore2, testEnv, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { flushConfirming } from './flushConfirmBackend'
import { PARITY_ASSETS, PARITY_ORPHANS, parityDatabase, parityLoadoutIcons } from './sweepParityFixture'

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_900_000_000_000

beforeEach(() => {
    vi.restoreAllMocks()
})

async function tauriSession(memory: ReturnType<typeof createMemoryBackend>): Promise<Store2Session> {
    const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: flushConfirming(memory).backend, upstreamMainFile: async () => false })
    expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
    expect(session.idleReason).toBeNull()
    return session
}

/** One pass on a quiet page at the device time `now`; the resident database refers to nothing. */
async function passAt(session: Store2Session, store: MemoryByteStore, now: number): Promise<AssetSweepResult> {
    const env: AssetSweepEnv = {
        session,
        store,
        now: () => now,
        residentRefs: () => [],
        writtenCount: () => 0,
        writtenThisPage: () => [],
        peers: async () => 'alone',
        shouldStop: () => false,
        release: () => { },
        hold: remove => remove(),
    }
    return runAssetSweep(env)
}

function plant(store: MemoryByteStore, names: Iterable<string>): void {
    for (const name of names) {
        store.files.set(`assets/${name}`, new Uint8Array([1]))
    }
}

function storedNames(store: MemoryByteStore): string[] {
    return [...store.files.keys()].filter(key => key.startsWith('assets/')).map(key => key.slice('assets/'.length)).sort()
}

/** What the collector keeps for `db`, and the loadout icons it does not read (the config list holds them). */
function expectedKeep(db: Database): string[] {
    return [...new Set([...getUncleanablesSync(db), ...parityLoadoutIcons().map(getBasename)])].sort()
}

describe('the sweep keeps what the boot-time collector keeps', () => {
    test('precondition: the fixture puts every field kind into the collector\'s keep list', () => {
        const kept = new Set(expectedKeep(parityDatabase()))
        for (const [label, asset] of Object.entries(PARITY_ASSETS)) {
            expect(kept.has(asset.name), `${label} (${asset.kind}) is kept by the collector`).toBe(true)
        }
    })

    test('guard D4: two passes a day apart delete only the orphans of a stored tree that holds every field kind', async () => {
        const db = parityDatabase()
        const keep = expectedKeep(db)
        const clock = createClock()
        const memory = createMemoryBackend()
        await seedTree(memory, db, testEnv(clock, 11), createListDerivation())
        const store = createMemoryByteStore()
        plant(store, [...keep, ...PARITY_ORPHANS])
        const session = await tauriSession(memory)

        const first = await passAt(session, store, T0)
        expect(first).toMatchObject({ status: 'done', phase: 'recorded', candidates: PARITY_ORPHANS.length, deleted: 0, recorded: true })
        expect(storedNames(store), 'nothing is deleted by the first pass').toEqual([...keep, ...PARITY_ORPHANS].sort())

        const young = await passAt(session, store, T0 + DAY - 1)
        expect(young).toMatchObject({ status: 'done', phase: 'young', deleted: 0, recorded: false })

        const second = await passAt(session, store, T0 + DAY + 1)
        expect(second).toMatchObject({ status: 'done', phase: 'swept', candidates: PARITY_ORPHANS.length, deleted: PARITY_ORPHANS.length })
        expect(storedNames(store), 'only the orphans are gone').toEqual(keep)
    })
})

describe('an asset only a retained tree names', () => {
    const ONLY_IN_A = 'only-in-tree-a.png'

    function withTreeAAsset(db: Database): Database {
        const characters = db.characters as unknown as Record<string, unknown>[]
        characters.push({ chaId: 'cha-a', name: 'cha-a', type: 'character', chatPage: 0, chats: [{ id: 'cha-a-chat', message: [], note: '', name: '', localLore: [] }], image: `assets/${ONLY_IN_A}` })
        return db
    }

    /**
     * A peer page's commit over the store, as `peerCommit` of the save kit does it, but derived with the real list
     * derivation: the kit's helper uses empty asset lists, which would leave every asset an orphan.
     */
    async function commitEdit(kit: Store2Kit, edit: (db: Database) => void, seed: number): Promise<void> {
        const db = JSON.parse(JSON.stringify(kit.seedDb)) as Database
        edit(db)
        const encoder = createSaveEncoder({ previous: kit.context.previous, lists: createListDerivation(), env: testEnv(kit.clock, seed) })
        const plan = await encoder.plan(db, { marked: new Set(), modules: true, whole: true })
        const result = await kit.committer.commit(await kit.committer.readCommit(), { ...plan.commitRequest(), carry: IMPORT_REPLACES_BASE })
        expect(result.status).toBe('committed')
    }

    test('guard D4 restore-point leg: kept while the replaced tree is retained, a candidate once it is not', async () => {
        const kit = await startStore2({ db: withTreeAAsset(parityDatabase()), kind: 'tauri', lists: createListDerivation() })
        const treeA = kit.seeded.manifestKey
        // The import replaces the whole tree; the clock has passed the admission window, so tree A is admitted to retained.
        kit.clock.advance(ADMISSION_INTERVAL_MS + 1)
        await commitEdit(kit, db => {
            const characters = db.characters as unknown as { chaId: string }[]
            db.characters = characters.filter(character => character.chaId !== 'cha-a') as unknown as Database['characters']
        }, 50)
        expect((await kit.commitKey()).retained.map(entry => entry.key), 'precondition: tree A is retained').toContain(treeA)

        const store = createMemoryByteStore()
        plant(store, [...expectedKeep(parityDatabase()), ONLY_IN_A, 'orphan-one.png'])
        const session = await tauriSession(kit.memory)

        expect(await passAt(session, store, T0)).toMatchObject({ phase: 'recorded', candidates: 1 })
        expect(await passAt(session, store, T0 + DAY + 1)).toMatchObject({ phase: 'swept', deleted: 1 })
        expect(store.files.has(`assets/${ONLY_IN_A}`), 'the asset only retained tree A names survives two passes').toBe(true)
        expect(store.files.has('assets/orphan-one.png')).toBe(false)

        // Newer trees push tree A out of the retained list.
        for (let i = 0; i < RETAINED_MAX + 2; i++) {
            kit.clock.advance(ADMISSION_INTERVAL_MS + 1)
            await commitEdit(kit, db => {
                const characters = db.characters as unknown as { chaId: string }[]
                db.characters = characters.filter(character => character.chaId !== 'cha-a') as unknown as Database['characters']
                db.mainPrompt = `later-${i}`
            }, 100 + i)
        }
        const key = await kit.commitKey()
        expect(key.retained.map(entry => entry.key), 'precondition: tree A is no longer retained').not.toContain(treeA)
        expect(key.pins, 'precondition: no pin holds tree A').toEqual([])

        const later = await tauriSession(kit.memory)
        expect(await passAt(later, store, T0 + 3 * DAY)).toMatchObject({ phase: 'swept', candidates: 1, deleted: 0 })
        expect(await passAt(later, store, T0 + 4 * DAY + 1)).toMatchObject({ phase: 'swept', deleted: 1 })
        expect(store.files.has(`assets/${ONLY_IN_A}`), 'once nothing retains tree A the asset is an ordinary orphan').toBe(false)
    })
})

//#region G1: the read paths of the collector

/** The normalised read paths, and the paths whose keys were enumerated (their keys are data, not field names). */
interface Sink {
    reads: Set<string>
    enumerated: Set<string>
}

function newSink(): Sink {
    return { reads: new Set(), enumerated: new Set() }
}

/** Reads of a property that belong to the language's containers, not to the database's fields. */
function isContainerMember(target: object, key: string): boolean {
    return key in Object.prototype || (Array.isArray(target) && key in Array.prototype)
}

/**
 * A recording view of `value`: every string-keyed read (`get` and `in`) of a database field adds its normalised path to
 * the sink. A list index reads as `[]`; the keys of an object whose keys were enumerated are data, and read as `*`.
 */
function tracked<T extends object>(value: T, path: string, sink: Sink): T {
    function pathOf(target: object, key: string): string {
        if (Array.isArray(target)) {
            return `${path}[]`
        }
        return `${path}.${sink.enumerated.has(path) ? '*' : key}`
    }
    return new Proxy(value, {
        get(target, key, receiver) {
            const result: unknown = Reflect.get(target, key, receiver)
            if (typeof key !== 'string' || isContainerMember(target, key)) {
                return result
            }
            const child = pathOf(target, key)
            sink.reads.add(child)
            return typeof result === 'object' && result !== null ? tracked(result, child, sink) : result
        },
        has(target, key) {
            if (typeof key === 'string' && !isContainerMember(target, key)) {
                sink.reads.add(pathOf(target, key))
            }
            return Reflect.has(target, key)
        },
        ownKeys(target) {
            sink.enumerated.add(path)
            return Reflect.ownKeys(target)
        },
    })
}

/** Reads the derivation does: the config owner's walk, each character's and each module's. */
function derivationReads(db: Database): Set<string> {
    const sink = newSink()
    const root = tracked(db as unknown as Record<string, unknown>, '', sink)
    collectConfigAssets(new AssetRefCollector(), root, root.characterOrder, root.loadouts)
    for (const character of db.characters) {
        collectCharacterAssets(new AssetRefCollector(), tracked(character as unknown as object, '.characters[]', sink))
    }
    for (const module of db.modules) {
        collectModuleAssets(new AssetRefCollector(), tracked(module as unknown as object, '.modules[]', sink))
    }
    return sink.reads
}

function collectorReads(db: Database, collector: (db: Database) => unknown = getUncleanablesSync): Set<string> {
    const sink = newSink()
    collector(tracked(db as unknown as object, '', sink) as unknown as Database)
    return sink.reads
}

/** Reads of the collector that are not reference fields: a container, a discriminator the derivation does not need. */
const DISCRIMINATORS = new Set([
    // A group has no `ccAssets`; the derivation reads the field whatever the type.
    '.characters[].type',
])

/** Whether a path the collector read is covered by a path the derivation read (itself, or a field below it). */
function covered(path: string, derived: Set<string>): boolean {
    for (const read of derived) {
        if (read === path || read.startsWith(`${path}.`) || read.startsWith(`${path}[]`)) {
            return true
        }
    }
    return false
}

function uncovered(db: Database, collector?: (db: Database) => unknown): string[] {
    const derived = derivationReads(db)
    return [...collectorReads(db, collector)].filter(path => !DISCRIMINATORS.has(path) && !covered(path, derived)).sort()
}

describe('G1: every field the collector reads is read by the list derivation', () => {
    test('guard: the collector reads nothing on the fixture that the derivation does not read', () => {
        expect(uncovered(parityDatabase())).toEqual([])
    })

    test('guard: the recorder reports a field only the collector reads, even where the database holds none', () => {
        const added = (db: Database): unknown => {
            getUncleanablesSync(db)
            return (db as unknown as { addedReferenceField?: string }).addedReferenceField
        }
        expect(uncovered(parityDatabase(), added)).toEqual(['.addedReferenceField'])
    })

    test('guard: the recorder sees the fields of every owner kind', () => {
        const reads = collectorReads(parityDatabase())
        for (const path of [
            '.characters[].image', '.characters[].emotionImages[][]', '.characters[].vits.files.*', '.modules[].icon',
            '.personas[].embeddedModule.assets[][]', '.characterOrder[].imgFile', '.themePacks',
        ]) {
            expect([...reads].some(read => read === path || read.startsWith(path)), path).toBe(true)
        }
    })
})

//#endregion
