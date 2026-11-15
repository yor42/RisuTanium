// @vitest-environment jsdom
// The asset intents of the history service: the removal refusals by phase, the one owner write (rows, folders, text,
// retained paths), the retained-path recompute by phase, the module owner (selection, shared ids, stubs), the
// no-op result, and file-gone replays. Real service, real history model and real setters over the memory store
// double; the page database and its save marks are plain objects.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { setFolderEntries } from 'src/ts/studio/assets/folderCodec'
import type { MergePreview } from 'src/ts/studio/assets/mergePreview'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { stubModule, watchBodyKeys } from 'src/ts/studio/studioFixtures.test-helpers'
import { createElementHashCache } from '../elementHashCache'
import type { Op, Step } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioRefusal, type StudioResult } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, type ClaimDouble, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0, cleared: [] as string[] }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: (chaId: string) => {
            h.cleared.push(chaId)
        },
    }
})

type Row = string[]

interface LiveTriggerList {
    comment: string
    type: string
    conditions: object[]
    effect: object[]
}

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage?: string
    exampleMessage?: string
    systemPrompt?: string
    depth_prompt?: { depth: number; prompt: string }
    globalLore?: { key: string; content: string }[]
    customscript?: { in: string; out: string; type: string }[]
    triggerscript?: LiveTriggerList[]
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: Row[]
    emotionImages: Row[]
    extentions?: Record<string, unknown>
    [ASSET_RETAINED_KEY]?: unknown
}

interface LiveModule {
    id: string
    name: string
    assets: Row[]
    lorebook?: { key: string; content: string }[]
    trigger?: LiveTriggerList[]
    backgroundEmbedding?: string
    cjs?: string
    [ASSET_FOLDER_KEY]?: unknown
    [ASSET_RETAINED_KEY]?: unknown
}

const SMILE = ['smile', 'assets/smile.png', 'png']
const SMILE_COPY = ['smile2', 'assets/smile.png', 'png']
const GRIN = ['grin', 'assets/grin.png', 'png']
const WAVE = ['wave', 'assets/wave.png', 'png']

function makeCharacter(chaId: string, over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1'],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        additionalAssets: [[...SMILE], [...GRIN], [...WAVE], [...SMILE_COPY]],
        emotionImages: [['happy', 'assets/happy.png']],
        ...over,
    }
}

function makeModule(id: string, over: Partial<LiveModule> = {}): LiveModule {
    return { id, name: id, assets: [[...SMILE], [...GRIN], [...WAVE], [...SMILE_COPY]], ...over }
}

function putCharacters(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

function putModules(...modules: unknown[]): void {
    DBState.db.modules = modules as unknown as typeof DBState.db.modules
}

const live = (chaId = 'A'): LiveCharacter =>
    (DBState.db.characters as unknown as LiveCharacter[]).find((c) => c.chaId === chaId) as LiveCharacter

const liveModule = (id = 'M1'): LiveModule => (DBState.db.modules as unknown as LiveModule[]).find((m) => m.id === id) as LiveModule

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')

// A survivor check that finds one by path only: the rows these tests remove share a path with a row that stays.
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    openModule: string | null
    landed: [OwnerKey, string | null][]
    gone: Set<string>
}

let harness: Harness

// `reading` gives the service a file reader that answers `gone` for the paths in `gone` and `present` for the rest;
// without it nothing is checked and the synchronous undo and redo put rows back as they always did.
function build(reading = false): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore()
    const claim = createClaimDouble()
    const built: Harness = { clock, store, claim, openModule: null, landed: [], gone: new Set(), service: undefined as unknown as OwnerHistoryService }
    built.service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => built.openModule,
        onLanded: (owner, top) => built.landed.push([owner, top]),
        ...(reading ? { openAssetFileReader: async () => ({ concurrency: 1, stateOf: async (path: string) => (built.gone.has(path) ? ('gone' as const) : ('present' as const)) }) } : {}),
    })
    return built
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    h.cleared.length = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacters(makeCharacter('A'))
    putModules(makeModule('M1'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

async function ready(owner: OwnerKey): Promise<void> {
    await harness.service.whenReady(owner)
}

// Lets a queued save job finish.
async function settle(): Promise<void> {
    await drainMicrotasks()
}

const retained = (owner: LiveCharacter | LiveModule): unknown => owner[ASSET_RETAINED_KEY]

// ---------------------------------------------------------------- refusals by phase

type PhaseName = 'otherTab' | 'noLocks' | 'failed' | 'unavailable' | 'keptUnreadable' | 'unwritable'

const PHASES: PhaseName[] = ['otherTab', 'noLocks', 'failed', 'unavailable', 'keptUnreadable', 'unwritable']

// Brings the owner to the phase before its first use, except `unwritable`, which needs a landed write and a save
// the store refuses.
const arrayOf = (owner: OwnerKey): 'additionalAssets' | 'assets' => (owner === M1 ? 'assets' : 'additionalAssets')

async function reachPhase(phase: PhaseName, owner: OwnerKey): Promise<void> {
    switch (phase) {
        case 'otherTab':
            harness.claim.forced = 'held'
            break
        case 'noLocks':
            harness.claim.unsupported = true
            break
        case 'failed':
            harness.claim.forced = 'failed'
            break
        case 'unavailable':
            harness.store.hooks.open = () => {
                throw new Error('open failed')
            }
            break
        case 'keptUnreadable':
            harness.store.load = async () => ({ kind: 'keptUnreadable' })
            break
        case 'unwritable':
            break
    }
    await ready(owner)
    if (phase === 'unwritable') {
        harness.store.forcedSave = { kind: 'unwritable' }
        expect(harness.service.assetRename(owner, arrayOf(owner), 2, 'wave2').ok).toBe(true)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.service.view(owner).banner).toBe('unwritable')
    }
}

function refusalFor(phase: PhaseName, kind: 'character' | 'module'): StudioRefusal {
    if (phase === 'otherTab') {
        return kind === 'module' ? 'asset-other-tab-module' : 'asset-other-tab-character'
    }
    return 'asset-no-undo'
}

function mergeModel(array: 'additionalAssets' | 'assets' = 'additionalAssets'): MergePreview {
    return {
        ownerKind: array === 'assets' ? 'module' : 'character',
        kind: 'asset',
        keptName: 'smile',
        removedNames: ['smile2'],
        array,
        rowOps: [{ kind: 'assetRowRemove', array, index: 3, tuple: [...SMILE_COPY], count: 1 }],
        keptRows: [[...SMILE]],
        missingRows: [],
        folderOps: [],
        textEdits: [],
        preWrite: [],
        alreadyShows: [],
        notRewritten: [],
        closeNames: [],
        nameLists: [],
        modulesHolding: [],
        folderOutcome: { state: 'absent', kept: null, from: 'none', dropped: [] },
        partialNames: [],
        matchedExactly: false,
    }
}

const REMOVALS: Record<string, (service: OwnerHistoryService, owner: OwnerKey) => StudioResult> = {
    'a delete': (service, owner) => service.assetDelete(owner, arrayOf(owner), [0]),
    'a bulk delete': (service, owner) => service.assetDelete(owner, arrayOf(owner), [0, 1]),
    'remove extras': (service, owner) => service.assetRemoveExtras(owner, arrayOf(owner), 'smile', [3], byPathOnly),
    'a merge': (service, owner) => service.assetMerge(owner, mergeModel(arrayOf(owner)), byPathOnly),
}

function snapshot(kind: 'character' | 'module'): string {
    return JSON.stringify(kind === 'module' ? DBState.db.modules : DBState.db.characters)
}

describe('a removal-type asset write is refused where history cannot persist, and a refusal changes nothing', () => {
    for (const kind of ['character', 'module'] as const) {
        const owner = kind === 'module' ? M1 : A
        for (const phase of PHASES) {
            for (const [name, intent] of Object.entries(REMOVALS)) {
                test(`${kind} owner, ${phase}: ${name} is refused with its own copy; rows, field and marks stay`, async () => {
                    harness.openModule = 'M1'
                    await reachPhase(phase, owner)
                    const before = snapshot(kind)
                    const marks = h.marks
                    const done = harness.service.view(owner).done.length
                    const landed = harness.landed.length

                    expect(intent(harness.service, owner)).toEqual({ ok: false, reason: refusalFor(phase, kind) })

                    expect(snapshot(kind)).toBe(before)
                    expect(h.marks).toBe(marks)
                    expect(harness.service.view(owner).done).toHaveLength(done)
                    expect(harness.landed).toHaveLength(landed)
                })
            }
        }
    }

    test('ready with no reason, with the stored copy trimmed, and with an unreadable stored copy all accept a removal', async () => {
        await ready(A)
        expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)

        harness.store.forcedSave = { kind: 'ok', asided: false, trimmed: true }
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.service.view(A).banner).toBe('trimmed')
        expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)

        const second = build()
        second.store.load = async () => ({ kind: 'unreadable' })
        putCharacters(makeCharacter('A'))
        await second.service.whenReady(A)
        expect(second.service.view(A).banner).toBe('unreadable')
        expect(second.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
    })

    test('a redo of a delete is a removal and is refused once history cannot persist, while the undo that put the row back was allowed', async () => {
        await ready(A)
        expect(harness.service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        harness.store.simulateClose()
        const before = snapshot('character')
        expect(harness.service.redo(A)).toEqual({ ok: false, reason: 'asset-no-undo' })
        expect(snapshot('character')).toBe(before)
        expect(harness.service.view(A).undone).toHaveLength(1)
    })

    test('a revert across an insert removes the row and is refused, and a revert across a delete only puts a row back', async () => {
        await ready(A)
        expect(harness.service.assetRename(A, 'additionalAssets', 2, 'wave2').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']])
        harness.store.simulateClose()
        const before = snapshot('character')
        expect(harness.service.revertTo(A, base)).toEqual({ ok: false, reason: 'asset-no-undo' })
        expect(snapshot('character')).toBe(before)
    })

    test('a revert whose chain removes a row inserted while only memory held the history is refused with the other-tab copy', async () => {
        harness.claim.forced = 'held'
        await ready(A)
        expect(harness.service.assetRename(A, 'additionalAssets', 2, 'wave2').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        const before = snapshot('character')
        expect(harness.service.revertTo(A, base)).toEqual({ ok: false, reason: 'asset-other-tab-character' })
        expect(snapshot('character')).toBe(before)
    })

    test('an added row and a created folder are recorded with their own step labels', async () => {
        await ready(A)
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png'], ['fresh2', 'assets/fresh2.png', 'png']]).ok).toBe(true)
        expect(harness.service.assetFolder(A, { kind: 'create', name: ' Poses ' }).ok).toBe(true)
        expect(harness.service.view(A).done.map((entry) => entry.label)).toEqual([{ kind: 'assetAdd', count: 2 }, { kind: 'folderCreate', name: 'Poses' }])
    })

    test('the undo of a row inserted while only memory held the history is refused', async () => {
        harness.claim.forced = 'held'
        await ready(A)
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        const before = snapshot('character')
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'asset-other-tab-character' })
        expect(snapshot('character')).toBe(before)
    })

    test('a step whose undo re-points a row to another file is a removal of the file it leaves', async () => {
        const step = {
            id: 's1',
            at: 1,
            label: { kind: 'assetRename', from: 'a', to: 'b' } as const,
            ops: [{ op: 'assetRowSet' as const, array: 'additionalAssets' as const, index: 0, before: ['smile', 'assets/old.png', 'png'], after: [...SMILE] }],
        }
        seedOwner(harness.store.shared, { ownerKey: A, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }, 'seed:1')
        await ready(A)
        harness.store.simulateClose()
        const before = snapshot('character')
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'asset-no-undo' })
        expect(snapshot('character')).toBe(before)
    })
})

// ---------------------------------------------------------------- the owner write and the retained field

describe('one owner write carries rows, folders, text and the retained field', () => {
    test('a delete is one write: the row leaves, the field names its path, and the owner is marked once', async () => {
        await ready(A)
        const result = harness.service.assetDelete(A, 'additionalAssets', [1])
        expect(result).toMatchObject({ ok: true })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'smile2'])
        expect(retained(live())).toEqual([['grin', 'assets/grin.png']])
        expect(h.marks).toBe(1)
        expect(tracker.character).toEqual(['A'])
    })

    test('an undo and a redo keep the path, and an edit outside Studio after the undo does not drop it', async () => {
        await ready(A)
        harness.service.assetDelete(A, 'additionalAssets', [1])
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().additionalAssets).toHaveLength(4)
        // The restored row is still live, and the step sits in `undone`: the path stays a root.
        expect(retainedNamesOf(retained(live()))).toEqual(['assets/grin.png'])
        live().additionalAssets.splice(1, 1)
        expect(retainedNamesOf(retained(live()))).toEqual(['assets/grin.png'])
        expect(harness.service.redo(A)).toMatchObject({ ok: true, already: 'redo' })
        expect(retainedNamesOf(retained(live()))).toEqual(['assets/grin.png'])
    })

    test('a stored copy trimmed while memory still holds the step does not prune its path', async () => {
        await ready(A)
        harness.service.assetDelete(A, 'additionalAssets', [1])
        harness.store.forcedSave = { kind: 'ok', asided: false, trimmed: true }
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.service.assetRename(A, 'additionalAssets', 0, 'smile3').ok).toBe(true)
        // The rename names its own row's path as well; the deleted row's path is still there.
        expect(retainedNamesOf(retained(live()))).toEqual(['assets/grin.png', 'assets/smile.png'])
    })

    test('after a reload with no stored step, the next asset write prunes the path, and an empty field is removed', async () => {
        live()[ASSET_RETAINED_KEY] = [['grin', 'assets/grin.png']]
        await ready(A)
        // A folder step names no path, so nothing is retained after it.
        expect(harness.service.assetFolder(A, { kind: 'create', name: 'F' }).ok).toBe(true)
        expect(Object.hasOwn(live(), ASSET_RETAINED_KEY)).toBe(false)
    })

    test('a load with no write leaves the field as it was stored, even when no step names a path in it', async () => {
        const stored = [['grin', 'assets/grin.png'], ['old', 'assets/old.png']]
        live()[ASSET_RETAINED_KEY] = stored.map((pair) => [...pair])
        await ready(A)
        await harness.clock.advance(SAVE_DEBOUNCE_MS * 6)
        expect(retained(live())).toEqual(stored)
        expect(h.marks).toBe(0)
    })

    test('an unreadable field is never overwritten: a rename keeps it, a removal is refused', async () => {
        for (const value of [{ a: ['assets/K.png'] }, [['x']]]) {
            putCharacters(makeCharacter('A', { [ASSET_RETAINED_KEY]: value }))
            harness = build()
            await ready(A)
            expect(harness.service.assetDelete(A, 'additionalAssets', [0])).toEqual({ ok: false, reason: 'asset-no-undo' })
            expect(harness.service.assetRename(A, 'additionalAssets', 0, 'smile3').ok).toBe(true)
            expect(retained(live())).toEqual(value)
        }
    })

    test('an owner holding an upstream field of the bare name is not refused and keeps it', async () => {
        putCharacters(makeCharacter('A', { assetRetained: { foo: 1 } } as Partial<LiveCharacter>))
        await ready(A)
        expect(harness.service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        expect((live() as unknown as Record<string, unknown>).assetRetained).toEqual({ foo: 1 })
        expect(retained(live())).toEqual([['smile', 'assets/smile.png']])
    })

    test('a removal of an emotion image drops the character cached emotion path', async () => {
        await ready(A)
        expect(harness.service.assetDelete(A, 'emotionImages', [0]).ok).toBe(true)
        expect(h.cleared).toEqual(['A'])
        expect(harness.service.assetRename(A, 'additionalAssets', 0, 'smile3').ok).toBe(true)
        expect(h.cleared).toEqual(['A'])
    })

    test('in memoryOnly an insert adds its path and loses none, and a folder move prunes nothing', async () => {
        live()[ASSET_RETAINED_KEY] = [['old', 'assets/old.png']]
        harness.claim.forced = 'held'
        await ready(A)
        const inserted = harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']])
        expect(inserted.ok).toBe(true)
        // Sorted by path.
        const both = [['fresh', 'assets/fresh.png'], ['old', 'assets/old.png']]
        expect(retained(live())).toEqual(both)
        expect(harness.service.assetFolder(A, { kind: 'create', name: 'F' }).ok).toBe(true)
        expect(harness.service.assetFolder(A, { kind: 'move', names: ['smile'], folder: 'F' }).ok).toBe(true)
        expect(retained(live())).toEqual(both)
    })

    test('an asset write whose step moves in the ready phase saves at once, and a rename waits for the debounce', async () => {
        await ready(A)
        harness.service.assetDelete(A, 'additionalAssets', [1])
        await settle()
        expect(harness.store.counts.save).toBe(1)
        harness.service.assetRename(A, 'additionalAssets', 0, 'smile3')
        await settle()
        expect(harness.store.counts.save).toBe(1)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.store.counts.save).toBe(2)
    })
})

// ---------------------------------------------------------------- results

describe('an asset intent that changes nothing lands nothing', () => {
    test('a same-name rename, a move into the current folder and an empty delete give unchanged: no step, mark, landing or save', async () => {
        await ready(A)
        expect(harness.service.assetFolder(A, { kind: 'create', name: 'F' }).ok).toBe(true)
        expect(harness.service.assetFolder(A, { kind: 'move', names: ['smile'], folder: 'F' }).ok).toBe(true)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const marks = h.marks
        const saves = harness.store.counts.save
        const done = harness.service.view(A).done.length
        const landed = harness.landed.length

        expect(harness.service.assetRename(A, 'additionalAssets', 0, 'smile')).toEqual({ ok: true, unchanged: true })
        expect(harness.service.assetFolder(A, { kind: 'move', names: ['smile'], folder: 'F' })).toEqual({ ok: true, unchanged: true })
        expect(harness.service.assetDelete(A, 'additionalAssets', [])).toEqual({ ok: true, unchanged: true })
        await harness.clock.advance(SAVE_DEBOUNCE_MS * 6)

        expect(h.marks).toBe(marks)
        expect(harness.store.counts.save).toBe(saves)
        expect(harness.service.view(A).done).toHaveLength(done)
        expect(harness.landed).toHaveLength(landed)
    })

    test('every landed action reports the step on top, and a refusal reports nothing', async () => {
        await ready(A)
        const first = harness.service.assetRename(A, 'additionalAssets', 0, 'a1')
        expect(first).toMatchObject({ ok: true })
        const top = harness.service.view(A).done.at(-1)?.id
        expect(harness.landed.at(-1)).toEqual([A, top])
        harness.service.undo(A)
        expect(harness.landed.at(-1)).toEqual([A, null])
        const refused = harness.landed.length
        expect(harness.service.assetDelete(A, 'additionalAssets', [99])).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.landed).toHaveLength(refused)
    })
})

// ---------------------------------------------------------------- Ctrl+Z against a row that came back

describe('an undo of a delete whose row is already back', () => {
    test('moves the step to undone with all its ops, writes nothing and adds no duplicate row', async () => {
        await ready(A)
        harness.service.assetDelete(A, 'additionalAssets', [1])
        live().additionalAssets.splice(1, 0, [...GRIN])
        const marks = h.marks
        const field = JSON.stringify(retained(live()))

        expect(harness.service.undo(A)).toEqual({ ok: true, already: 'undo' })

        expect(live().additionalAssets.filter((row) => row[0] === 'grin')).toHaveLength(1)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone[0].ops).toHaveLength(1)
        expect(JSON.stringify(retained(live()))).toBe(field)
    })
})

// ---------------------------------------------------------------- a removal whose row is already gone

describe('a step that removes a row already gone is refused where history cannot persist', () => {
    const FRESH = ['fresh', 'assets/fresh.png', 'png']

    function removeOutsideStudio(name: string): void {
        live().additionalAssets = live().additionalAssets.filter((row) => row[0] !== name)
    }

    for (const reason of ['otherTab', 'noLocks'] as const) {
        test(`${reason}: Ctrl+Z of an insert whose row was removed elsewhere returns the refusal and changes nothing`, async () => {
            if (reason === 'otherTab') {
                harness.claim.forced = 'held'
            } else {
                harness.claim.unsupported = true
            }
            await ready(A)
            expect(harness.service.assetInsert(A, 'additionalAssets', [[...FRESH]]).ok).toBe(true)
            removeOutsideStudio('fresh')
            const before = snapshot('character')
            const marks = h.marks
            const view = harness.service.view(A)
            const done = view.done.map((entry) => entry.id)
            const undone = view.undone.length
            const landed = harness.landed.length

            expect(harness.service.undo(A)).toEqual({ ok: false, reason: refusalFor(reason, 'character') })

            expect(snapshot('character')).toBe(before)
            expect(h.marks).toBe(marks)
            expect(harness.service.view(A).done.map((entry) => entry.id)).toEqual(done)
            expect(harness.service.view(A).undone).toHaveLength(undone)
            expect(harness.landed).toHaveLength(landed)
        })
    }

    test('ready and unwritable: Ctrl+Z of an insert whose row was removed elsewhere returns the refusal and changes nothing', async () => {
        await reachPhase('unwritable', A)
        expect(harness.service.assetInsert(A, 'additionalAssets', [[...FRESH]]).ok).toBe(true)
        removeOutsideStudio('fresh')
        const before = snapshot('character')
        const marks = h.marks
        const done = harness.service.view(A).done.map((entry) => entry.id)
        const landed = harness.landed.length

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'asset-no-undo' })

        expect(snapshot('character')).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done.map((entry) => entry.id)).toEqual(done)
        expect(harness.service.view(A).undone).toHaveLength(0)
        expect(harness.landed).toHaveLength(landed)
    })

    test('Redo of a delete whose row is already gone returns the refusal once history cannot persist, and changes nothing', async () => {
        await ready(A)
        expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        removeOutsideStudio('grin')
        harness.store.simulateClose()
        const before = snapshot('character')
        const marks = h.marks
        const landed = harness.landed.length

        expect(harness.service.redo(A)).toEqual({ ok: false, reason: 'asset-no-undo' })

        expect(snapshot('character')).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(1)
        expect(harness.landed).toHaveLength(landed)
    })
})

// ---------------------------------------------------------------- folders

function folderDoc(order: string[], of: [string, string][]): unknown {
    return { v: 1, additional: { order, of } }
}

describe('the folder document of an owner write', () => {
    test('a rename, a delete and a merge on a newer document change the rows and keep the stored value byte for byte', async () => {
        const newer = { v: 9, x: 1 }
        const text = JSON.stringify(newer)
        putCharacters(makeCharacter('A', { extentions: { [ASSET_FOLDER_KEY]: newer } }))
        harness = build()
        await ready(A)
        expect(harness.service.assetMerge(A, mergeModel(), byPathOnly).ok).toBe(true)
        expect(harness.service.assetRename(A, 'additionalAssets', 1, 'grin2').ok).toBe(true)
        expect(harness.service.assetDelete(A, 'additionalAssets', [2]).ok).toBe(true)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin2'])
        expect(JSON.stringify(live().extentions?.[ASSET_FOLDER_KEY])).toBe(text)
        // Only an explicit folder action refuses on it.
        expect(harness.service.assetFolder(A, { kind: 'create', name: 'F' })).toEqual({ ok: false, reason: 'precondition' })
    })

    test('deleting a folder over two entries that fold alike lands one step, the entry leaves the document, and Undo restores the first entry', async () => {
        const stored = folderDoc(['F', 'G'], [['IMAGE1', 'F'], ['image1', 'G']])
        putCharacters(makeCharacter('A', { additionalAssets: [['image1', 'assets/i.png', 'png']], extentions: { [ASSET_FOLDER_KEY]: stored } }))
        harness = build()
        await ready(A)
        expect(harness.service.assetFolder(A, { kind: 'delete', name: 'F' }).ok).toBe(true)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['G'], of: [] } })
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['F', 'G'], of: [['IMAGE1', 'F']] } })
    })

    test('a merge of two names on one path lands one step with the kept name in the removed name folder, and Undo gives the rows and the entry back', async () => {
        const stored = folderDoc(['F', 'G'], [['Grin', 'F'], ['GRIN', 'G']])
        putCharacters(
            makeCharacter('A', {
                additionalAssets: [['smile', 'assets/s.png', 'png'], ['Grin', 'assets/s.png', 'png']],
                extentions: { [ASSET_FOLDER_KEY]: stored },
            }),
        )
        harness = build()
        await ready(A)
        const moved = setFolderEntries(stored, [{ name: 'smile', folder: 'F' }, { name: 'Grin', folder: null }])
        expect(moved.ok).toBe(true)
        const model = mergeModel()
        model.keptName = 'smile'
        model.removedNames = ['Grin']
        model.rowOps = [{ kind: 'assetRowRemove', array: 'additionalAssets', index: 1, tuple: ['Grin', 'assets/s.png', 'png'], count: 1 }]
        model.folderOps = moved.ok ? moved.ops : []
        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)
        expect(live().additionalAssets).toHaveLength(1)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['F', 'G'], of: [['smile', 'F']] } })
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().additionalAssets).toHaveLength(2)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['F', 'G'], of: [['Grin', 'F']] } })
    })

    test('a merge model built before a folder move landed is refused as out of date and nothing changes', async () => {
        const stored = folderDoc(['G'], [['Grin', 'G']])
        putCharacters(makeCharacter('A', { extentions: { [ASSET_FOLDER_KEY]: stored } }))
        harness = build()
        await ready(A)
        const model = mergeModel()
        // The model was built when `Grin` had no folder entry.
        model.folderOps = [{ kind: 'assetFolderSet', name: 'Grin', before: { had: false }, after: { had: true, value: 'G' } }]
        const before = snapshot('character')
        const marks = h.marks
        expect(harness.service.assetMerge(A, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
        expect(snapshot('character')).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(0)
    })

    test('a module owner with no folder key creates a folder and Undo leaves no key behind, never an undefined value', async () => {
        harness.openModule = 'M1'
        await ready(M1)
        expect(harness.service.assetFolder(M1, { kind: 'create', name: 'X' }).ok).toBe(true)
        expect(liveModule()[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['X'], of: [] } })
        expect(harness.service.undo(M1).ok).toBe(true)
        expect(Object.hasOwn(liveModule(), ASSET_FOLDER_KEY)).toBe(false)
    })

    test('a folder reorder lands one step labelled folderReorder, Undo restores the order and Redo applies it again', async () => {
        putCharacters(makeCharacter('A', { extentions: { [ASSET_FOLDER_KEY]: folderDoc(['F', 'G'], []) } }))
        harness = build()
        await ready(A)
        expect(harness.service.assetFolder(A, { kind: 'reorder', order: ['G', 'F'] }).ok).toBe(true)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['G', 'F'], of: [] } })
        expect(harness.service.view(A).done.map((entry) => entry.label)).toEqual([{ kind: 'folderReorder' }])
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['F', 'G'], of: [] } })
        expect(harness.service.redo(A).ok).toBe(true)
        expect(live().extentions?.[ASSET_FOLDER_KEY]).toEqual({ v: 1, additional: { order: ['G', 'F'], of: [] } })
    })

    test('a folder reorder over a newer or unreadable document is refused and changes nothing', async () => {
        for (const stored of [{ v: 9, x: 1 }, 'not a folder document']) {
            putCharacters(makeCharacter('A', { extentions: { [ASSET_FOLDER_KEY]: stored } }))
            harness = build()
            await ready(A)
            const before = snapshot('character')
            const marks = h.marks
            expect(harness.service.assetFolder(A, { kind: 'reorder', order: ['G', 'F'] })).toEqual({ ok: false, reason: 'precondition' })
            expect(snapshot('character')).toBe(before)
            expect(h.marks).toBe(marks)
            expect(harness.service.view(A).done).toHaveLength(0)
        }
    })
})

// ---------------------------------------------------------------- text edits of a merge

describe('text edits of a merge land in the same write', () => {
    test('a lorebook edit of a module and a greeting edit of a character are one step with the rows', async () => {
        putModules(makeModule('M1', { lorebook: [{ key: 'k', content: 'see smile2 now' }] }))
        harness.openModule = 'M1'
        await ready(M1)
        const model = mergeModel()
        model.ownerKind = 'module'
        model.array = 'assets'
        model.rowOps = [{ kind: 'assetRowRemove', array: 'assets', index: 3, tuple: [...SMILE_COPY], count: 1 }]
        model.textEdits = [{ target: 'lore/0/content', offset: 4, from: 'smile2', to: 'smile' }]
        expect(harness.service.assetMerge(M1, model, byPathOnly).ok).toBe(true)
        expect(liveModule().lorebook?.[0].content).toBe('see smile now')
        expect(liveModule().assets).toHaveLength(3)
        expect(harness.service.view(M1).done).toHaveLength(1)
        expect(harness.service.undo(M1).ok).toBe(true)
        expect(liveModule().lorebook?.[0].content).toBe('see smile2 now')

        await ready(A)
        const own = mergeModel()
        own.textEdits = [
            { target: 'desc', offset: 0, from: 'd0', to: 'smile' },
            { target: 'alternateGreetings/1', offset: 0, from: 'g1', to: 'smile' },
        ]
        expect(harness.service.assetMerge(A, own, byPathOnly).ok).toBe(true)
        expect(live().desc).toBe('smile')
        expect(live().alternateGreetings).toEqual(['g0', 'smile'])
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().desc).toBe('d0')
        expect(live().alternateGreetings).toEqual(['g0', 'g1'])
    })

    test('a merge whose removed row has no survivor is refused', async () => {
        await ready(A)
        const model = mergeModel()
        model.rowOps = [{ kind: 'assetRowRemove', array: 'additionalAssets', index: 1, tuple: [...GRIN], count: 1 }]
        expect(harness.service.assetMerge(A, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
        expect(live().additionalAssets).toHaveLength(4)
    })
})

// ---------------------------------------------------------------- whole-value text writes through the service

function valueEffect(value: string, mode = 'value'): object {
    return { type: 'v2SetVar', var: 'v', varType: 'var', operator: '=', valueType: mode, value }
}

function triggers(...effects: object[]): LiveTriggerList[] {
    return [{ comment: 'event', type: 'manual', conditions: [], effect: effects }]
}

// A merge of text edits alone: no row is removed.
function textOnlyModel(array: 'additionalAssets' | 'assets', edits: MergePreview['textEdits']): MergePreview {
    const model = mergeModel(array)
    model.rowOps = []
    model.textEdits = edits
    return model
}

describe('a merge edit of a registry text lands in the live owner, undoes and redoes', () => {
    test('a character: the first message, the system prompt, a depth prompt and a trigger value change once per undo and redo', async () => {
        putCharacters(makeCharacter('A', {
            firstMessage: 'hi smile2 there',
            systemPrompt: 'sys smile2',
            depth_prompt: { depth: 4, prompt: 'dp smile2' },
            triggerscript: triggers(valueEffect('eff smile2')),
        }))
        await ready(A)
        const model = textOnlyModel('additionalAssets', [
            { target: 'firstMessage', offset: 3, from: 'smile2', to: 'smile' },
            { target: 'systemPrompt', offset: 4, from: 'smile2', to: 'smile' },
            { target: 'depth_prompt/prompt', offset: 3, from: 'smile2', to: 'smile' },
            { target: 'trigger/0/effect/0/value', offset: 4, from: 'smile2', to: 'smile' },
        ])
        const merged = (): void => {
            expect(live().firstMessage).toBe('hi smile there')
            expect(live().systemPrompt).toBe('sys smile')
            expect(live().depth_prompt?.prompt).toBe('dp smile')
            expect((live().triggerscript?.[0].effect[0] as { value: string }).value).toBe('eff smile')
        }
        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)
        merged()
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().firstMessage).toBe('hi smile2 there')
        expect(live().systemPrompt).toBe('sys smile2')
        expect(live().depth_prompt?.prompt).toBe('dp smile2')
        expect((live().triggerscript?.[0].effect[0] as { value: string }).value).toBe('eff smile2')
        expect(harness.service.redo(A).ok).toBe(true)
        merged()
    })

    test('a character: a merge that rewrites the first message and the example message gives the restore point both keys, and restoring puts both texts back', async () => {
        putCharacters(makeCharacter('A', { firstMessage: 'hi smile2 there', exampleMessage: 'ex smile2' }))
        await ready(A)
        expect(harness.service.editField(A, 'desc', 'studio desc').ok).toBe(true)
        const model = textOnlyModel('additionalAssets', [
            { target: 'firstMessage', offset: 3, from: 'smile2', to: 'smile' },
            { target: 'exampleMessage', offset: 3, from: 'smile2', to: 'smile' },
        ])
        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)
        expect(live().firstMessage).toBe('hi smile there')
        expect(live().exampleMessage).toBe('ex smile')
        const fields = harness.service.view(A).restore?.fields
        expect(fields?.firstMessage).toEqual({ before: { had: true, value: 'hi smile2 there' }, last: { had: true, value: 'hi smile there' } })
        expect(fields?.exampleMessage).toEqual({ before: { had: true, value: 'ex smile2' }, last: { had: true, value: 'ex smile' } })
        expect(harness.service.restore(A, new Set()).ok).toBe(true)
        expect(live().desc).toBe('d0')
        expect(live().firstMessage).toBe('hi smile2 there')
        expect(live().exampleMessage).toBe('ex smile2')
    })

    test('a module: the background embedding and a trigger value change once per undo and redo, next to a removed row', async () => {
        putModules(makeModule('M1', { backgroundEmbedding: 'be smile2', trigger: triggers(valueEffect('eff smile2')) }))
        harness.openModule = 'M1'
        await ready(M1)
        const model = textOnlyModel('assets', [
            { target: 'backgroundEmbedding', offset: 3, from: 'smile2', to: 'smile' },
            { target: 'trigger/0/effect/0/value', offset: 4, from: 'smile2', to: 'smile' },
        ])
        model.rowOps = [{ kind: 'assetRowRemove', array: 'assets', index: 3, tuple: [...SMILE_COPY], count: 1 }]
        expect(harness.service.assetMerge(M1, model, byPathOnly).ok).toBe(true)
        expect(liveModule().backgroundEmbedding).toBe('be smile')
        expect((liveModule().trigger?.[0].effect[0] as { value: string }).value).toBe('eff smile')
        expect(liveModule().assets).toHaveLength(3)
        expect(harness.service.undo(M1).ok).toBe(true)
        expect(liveModule().backgroundEmbedding).toBe('be smile2')
        expect((liveModule().trigger?.[0].effect[0] as { value: string }).value).toBe('eff smile2')
        expect(liveModule().assets).toHaveLength(4)
        expect(harness.service.redo(M1).ok).toBe(true)
        expect(liveModule().backgroundEmbedding).toBe('be smile')
        expect((liveModule().trigger?.[0].effect[0] as { value: string }).value).toBe('eff smile')
        expect(liveModule().assets).toHaveLength(3)
    })

    test('a stale edit, whose text is no longer the one it was planned on, is refused with nothing written and no mark', async () => {
        putCharacters(makeCharacter('A', { systemPrompt: 'sys smile2' }))
        await ready(A)
        const before = snapshot('character')
        const marks = h.marks
        const model = textOnlyModel('additionalAssets', [{ target: 'systemPrompt', offset: 4, from: 'other', to: 'smile' }])
        expect(harness.service.assetMerge(A, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
        expect(snapshot('character')).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(0)
    })
})

describe('a merge edit of a target that may not be rewritten is refused whole', () => {
    interface Case {
        name: string
        owner: 'character' | 'module'
        set: () => void
        edit: MergePreview['textEdits'][number]
    }

    const proto = JSON.parse('{"type":"v2SetVar","valueType":"value","value":"v","__proto__":"smile2 x","__proto__Type":"value"}') as object

    const CASES: Case[] = [
        { name: 'a module cjs', owner: 'module', set: () => putModules(makeModule('M1', { cjs: 'code smile2' })), edit: { target: 'cjs', offset: 5, from: 'smile2', to: 'smile' } },
        {
            name: 'trigger script code',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { triggerscript: triggers({ type: 'triggerlua', code: 'print(smile2)' }) })),
            edit: { target: 'trigger/0/effect/0/code', offset: 6, from: 'smile2', to: 'smile' },
        },
        {
            name: 'a regex pattern of an extractRegex effect',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { triggerscript: triggers({ type: 'extractRegex', regex: 'smile2', result: 'r', value: 'v', flags: 'g', inputVar: 'i' }) })),
            edit: { target: 'trigger/0/effect/0/regex', offset: 0, from: 'smile2', to: 'smile' },
        },
        {
            name: 'a regex script pattern',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { customscript: [{ in: 'smile2', out: 'o', type: 'editoutput' }] })),
            edit: { target: 'regex/0/in', offset: 0, from: 'smile2', to: 'smile' },
        },
        {
            name: 'a lore entry beyond the list, with an insertion',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { globalLore: [{ key: 'k', content: 'c' }] })),
            edit: { target: 'lore/9/content', offset: 0, from: '', to: 'x' },
        },
        {
            name: 'a trigger value that is in var mode now',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { triggerscript: triggers(valueEffect('smile2 x', 'var')) })),
            edit: { target: 'trigger/0/effect/0/value', offset: 0, from: 'smile2', to: 'smile' },
        },
        {
            name: 'an own __proto__ key of a trigger effect',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { triggerscript: triggers(proto) })),
            edit: { target: 'trigger/0/effect/0/__proto__', offset: 0, from: 'smile2', to: 'smile' },
        },
        {
            name: 'a trigger field key that is not a stored target shape',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { triggerscript: triggers({ type: 'v2SetVar', 'a-b': 'smile2 x', 'a-bType': 'value' }) })),
            edit: { target: 'trigger/0/effect/0/a-b', offset: 0, from: 'smile2', to: 'smile' },
        },
        { name: 'a text field of a module', owner: 'module', set: () => putModules(makeModule('M1')), edit: { target: 'desc', offset: 0, from: 'M', to: 'X' } },
        { name: 'a first message of a module', owner: 'module', set: () => putModules(makeModule('M1')), edit: { target: 'firstMessage', offset: 0, from: 'M', to: 'X' } },
        {
            name: 'a first message entry with a non-canonical index',
            owner: 'character',
            set: () => putCharacters(makeCharacter('A', { alternateGreetings: ['g0', 'g1'] })),
            edit: { target: 'alternateGreetings/01', offset: 0, from: 'g', to: 'x' },
        },
    ]

    for (const entry of CASES) {
        test(`${entry.name}: the step is refused, nothing is written or marked, and no step is recorded`, async () => {
            entry.set()
            harness.openModule = 'M1'
            const owner = entry.owner === 'module' ? M1 : A
            await ready(owner)
            const before = snapshot(entry.owner)
            const marks = h.marks
            const model = textOnlyModel(entry.owner === 'module' ? 'assets' : 'additionalAssets', [entry.edit])
            expect(harness.service.assetMerge(owner, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
            expect(snapshot(entry.owner)).toBe(before)
            expect(h.marks).toBe(marks)
            expect(harness.service.view(owner).done).toHaveLength(0)
        })
    }
})

// ---------------------------------------------------------------- the module owner

describe('a module owner is selected through the open module, found by id and never a stub or a shared id', () => {
    test('an owner is selected only while the port returns its id, and a null port or another id refuses not-selected', async () => {
        await ready(M1)
        harness.openModule = null
        expect(harness.service.assetDelete(M1, 'assets', [0])).toEqual({ ok: false, reason: 'not-selected' })
        harness.openModule = 'other'
        expect(harness.service.assetDelete(M1, 'assets', [0])).toEqual({ ok: false, reason: 'not-selected' })
        expect(liveModule().assets).toHaveLength(4)
        harness.openModule = 'M1'
        expect(harness.service.assetDelete(M1, 'assets', [0]).ok).toBe(true)
        expect(liveModule().assets).toHaveLength(3)
    })

    test('the module is found by id after a reorder, and the write replaces the slot with one new object', async () => {
        harness.openModule = 'M1'
        putModules(makeModule('M0'), makeModule('M1'))
        await ready(M1)
        const before = DBState.db.modules[1]
        const list = DBState.db.modules
        expect(harness.service.assetDelete(M1, 'assets', [0]).ok).toBe(true)
        ;(DBState.db.modules as unknown as LiveModule[]).reverse()
        // The list moved under an owner that already wrote once: the next write finds the module again by id.
        expect(harness.service.assetDelete(M1, 'assets', [0]).ok).toBe(true)
        expect(DBState.db.modules).toBe(list)
        expect(liveModule('M1').assets).toHaveLength(2)
        expect(liveModule('M0').assets).toHaveLength(4)
        // The captured object is not the one written.
        expect((before as unknown as LiveModule).assets).toHaveLength(4)
        expect(DBState.db.modules[0]).not.toBe(before)
        expect(harness.service.view(M1).done).toHaveLength(2)
        // Each step names the row it removed from the module found by id, not from a module the service kept.
        expect(retained(liveModule('M1'))).toEqual([['grin', 'assets/grin.png'], ['smile', 'assets/smile.png']])
    })

    test('two slots with one id, one of them a stub, refuse every asset intent and call the history port for none of them', async () => {
        harness.openModule = 'M1'
        const reads: string[] = []
        putModules(makeModule('M1'), watchBodyKeys(stubModule('M1'), reads))
        const claims = harness.claim.calls.length
        const loads = harness.store.counts.load
        const saves = harness.store.counts.save
        const before = JSON.stringify(DBState.db.modules)
        const intents = [
            harness.service.assetDelete(M1, 'assets', [0]),
            harness.service.assetRename(M1, 'assets', 0, 'x'),
            harness.service.assetFolder(M1, { kind: 'create', name: 'F' }),
            harness.service.undo(M1),
        ]
        for (const result of intents) {
            expect(result).toEqual({ ok: false, reason: 'duplicate-module-id' })
        }
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(reads).toEqual([])
        // The refusal comes before the owner's lifecycle starts: no claim, load or save was made for it.
        expect(harness.claim.calls).toHaveLength(claims)
        expect(harness.store.counts.load).toBe(loads)
        expect(harness.store.counts.save).toBe(saves)
        expect(harness.landed).toEqual([])
        expect(h.marks).toBe(0)

        // Deleting one of the two slots lets the next write proceed.
        putModules(makeModule('M1'))
        await ready(M1)
        expect(harness.service.assetDelete(M1, 'assets', [0]).ok).toBe(true)
    })

    test('a stub that holds the id alone is refused as gone and is never read for a body key', async () => {
        harness.openModule = 'M1'
        const reads: string[] = []
        putModules(watchBodyKeys(stubModule('M1'), reads))
        await ready(M1)
        expect(harness.service.assetDelete(M1, 'assets', [0])).toEqual({ ok: false, reason: 'gone' })
        expect(reads).toEqual([])
    })

    test('a module step keeps no character hooks: no visit ack, no warm-up cancel needed, and its field sits on the module only', async () => {
        harness.openModule = 'M1'
        const noted: string[] = []
        harness.service.setAck('M1', { noteEdit: (chaId) => noted.push(chaId) })
        await ready(M1)
        expect(harness.service.assetDelete(M1, 'assets', [1]).ok).toBe(true)
        expect(noted).toEqual([])
        expect(h.marks).toBe(0)
        expect(retained(liveModule())).toEqual([['grin', 'assets/grin.png']])
        expect(Object.hasOwn(live(), ASSET_RETAINED_KEY)).toBe(false)
    })
})

// ---------------------------------------------------------------- what a module record cannot say

describe('a record keeps to the fields its owner has', () => {
    function recordWith(owner: OwnerKey, ...ops: Op[]): { ownerKey: OwnerKey; touchedAt: number; done: Step[]; undone: Step[]; deleted: []; restore: null } {
        const step: Step = { id: 's1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops }
        return { ownerKey: owner, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }
    }

    test('a module step that edits a field, a first message or a character list is refused, and nothing is written', async () => {
        harness.openModule = 'M1'
        const wrongs: Op[][] = [
            [{ op: 'textEdit', target: 'desc', offset: 0, from: 'M', to: 'X' }],
            [{ op: 'textEdit', target: 'alternateGreetings/0', offset: 0, from: 'g', to: 'x' }],
            [{ op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: [...SMILE], count: 1 }],
        ]
        for (const ops of wrongs) {
            harness = build()
            harness.openModule = 'M1'
            putModules(makeModule('M1'))
            seedOwner(harness.store.shared, recordWith(M1, ...ops), 'seed:m')
            await ready(M1)
            const before = snapshot('module')
            expect(harness.service.undo(M1)).toEqual({ ok: false, reason: 'precondition' })
            expect(snapshot('module')).toBe(before)
        }
    })

    test('a character step on the module list is refused the same way', async () => {
        seedOwner(harness.store.shared, recordWith(A, { op: 'assetRowRemove', array: 'assets', index: 0, tuple: [...SMILE], count: 1 }), 'seed:c')
        await ready(A)
        const before = snapshot('character')
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })
        expect(snapshot('character')).toBe(before)
    })
})

describe('a module slot never asks the greeting hash cache', () => {
    test('a module delete, undo and redo make no cache call, while a character first-message add does', async () => {
        const real = createElementHashCache()
        const calls: string[] = []
        const counted = { ...real, forList: ((...args: Parameters<typeof real.forList>) => (calls.push(args[1]), real.forList(...args))) as typeof real.forList }
        const clock = createFakeClock()
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => 'M1',
            elementHashCache: counted,
        })
        await service.whenReady(M1)
        expect(service.assetDelete(M1, 'assets', [1]).ok).toBe(true)
        expect(service.undo(M1).ok).toBe(true)
        expect(service.redo(M1).ok).toBe(true)
        expect(calls).toEqual([])

        await service.whenReady(A)
        expect(service.greetingAdd(A).ok).toBe(true)
        expect(calls.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------- gone files

describe('a row whose file is gone is left out of an undo or a redo and named', () => {
    async function readingHarness(): Promise<void> {
        harness = build(true)
        await ready(A)
    }

    test('the undo of a delete whose file is gone puts nothing back, drops the step and names the path', async () => {
        await readingHarness()
        harness.service.assetDelete(A, 'additionalAssets', [1])
        harness.gone.add('assets/grin.png')
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true, dropped: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'smile2'])
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('the redo of an insert whose file is gone leaves the row out as well', async () => {
        await readingHarness()
        const inserted = harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']])
        expect(inserted.ok).toBe(true)
        expect((await harness.service.replay(A, { kind: 'undo' })).ok).toBe(true)
        harness.gone.add('assets/fresh.png')
        expect(await harness.service.replay(A, { kind: 'redo' })).toMatchObject({ ok: true, goneRows: ['assets/fresh.png'], goneName: 'fresh' })
        expect(live().additionalAssets.some((row) => row[0] === 'fresh')).toBe(false)
    })

    test('a revert across a delete of a gone file lands nothing and names it', async () => {
        await readingHarness()
        const base = harness.service.assetRename(A, 'additionalAssets', 2, 'wave2')
        expect(base.ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        harness.service.assetDelete(A, 'additionalAssets', [1])
        harness.gone.add('assets/grin.png')
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toMatchObject({ ok: true, unchanged: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave2', 'smile2'])
    })

    test('a revert across a delete of a gone file, a re-insert and a delete of the re-inserted row lands nothing and names the gone path', async () => {
        await readingHarness()
        const base = harness.service.assetRename(A, 'additionalAssets', 2, 'wave2')
        expect(base.ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        harness.service.assetDelete(A, 'additionalAssets', [1])
        harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']])
        harness.service.assetDelete(A, 'additionalAssets', [live().additionalAssets.length - 1])
        harness.gone.add('assets/grin.png')
        const before = snapshot('character')
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toMatchObject({ ok: true, unchanged: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(snapshot('character')).toBe(before)
        expect(harness.service.view(A).done).toHaveLength(4)
    })

    test('a file that is not gone is put back with its row and the result names no gone row', async () => {
        await readingHarness()
        harness.service.assetDelete(A, 'additionalAssets', [1])
        const result = await harness.service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true })
        expect(result).not.toHaveProperty('goneRows')
        expect(result).not.toHaveProperty('goneName')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin', 'wave', 'smile2'])
    })
})
