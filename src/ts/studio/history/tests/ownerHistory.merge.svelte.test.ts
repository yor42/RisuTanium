// @vitest-environment jsdom
// A merge step through the real history service: the first message and each touched alternate are one whole-value op
// each, so a merge that changed both lands both or stops whole (pairSplit); a partial undo reports the texts it left
// (`notRestored`); retention, persisted reload, revert and an old-shape step still behave. Models come from
// `buildMergePreview` over the live character (the real producer); the service, history model and setters are real
// over the memory store double; the page database and its save marks are plain objects.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { applyEditsTo, DEFAULT_SETTINGS, groupRow } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { buildMergePreview, type MergePreview } from 'src/ts/studio/assets/mergePreview'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { SurvivorDeps } from '../../edit/assetSetters'
import type { OwnerRecord, Step } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord, type ClaimDouble, type MemoryStudioStore } from './studioStoreDoubles'

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

type Row = [string, string, string]

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage?: string
    exampleMessage: string
    alternateGreetings: string[]
    globalLore: { key: string; content: string }[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: Row[]
    emotionImages: [string, string][]
    [ASSET_RETAINED_KEY]?: unknown
}

const SMILE: Row = ['smile', 'assets/smile.png', 'png']
const WAVE: Row = ['wave', 'assets/wave.png', 'png']
// The same file as `smile` under another name, so removing it leaves a survivor by path.
const GRIN: Row = ['grin', 'assets/smile.png', 'png']

const FIRST = 'Hi {{image::grin}} and {{image::grin}}'
const FIRST_MERGED = 'Hi {{image::smile}} and {{image::smile}}'
const ALT0 = 'a0 {{image::grin}} x {{image::grin}}'
const ALT0_MERGED = 'a0 {{image::smile}} x {{image::smile}}'
const ALT1 = 'g1 {{image::grin}}'
const ALT1_MERGED = 'g1 {{image::smile}}'
const LORE0 = 'lore {{image::grin}} again {{image::grin}}'
const LORE0_MERGED = 'lore {{image::smile}} again {{image::smile}}'
const LORE1 = 'two {{image::grin}}'
const LORE1_MERGED = 'two {{image::smile}}'

function makeCharacter(over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        exampleMessage: 'ex0',
        firstMessage: FIRST,
        alternateGreetings: [ALT0, ALT1],
        globalLore: [{ key: 'k', content: LORE0 }, { key: 'k2', content: LORE1 }],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        additionalAssets: [[...SMILE], [...WAVE], [...GRIN]],
        emotionImages: [],
        ...over,
    }
}

function putCharacter(character: LiveCharacter): void {
    DBState.db.characters = [character] as unknown as typeof DBState.db.characters
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]

const A = characterOwnerKey('A')

// A survivor check that finds one by path only: the removed row shares a path with the kept one.
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

// The merge model the preview builds from the live character, as the click-time rebuild does.
function modelOf(source: LiveCharacter = live(), keptName = 'smile', removedName = 'grin'): MergePreview {
    const group = groupDuplicates(source.additionalAssets.map((row, index) => groupRow(row[0], row[1], index)))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames' && [keptName, removedName].every((name) => candidate.rows.some((row) => row.name === name)))
    if (!group) {
        throw new Error('no candidate group')
    }
    return buildMergePreview({ kind: 'character', source }, 'asset', group, keptName, [], DEFAULT_SETTINGS)
}

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
}

let harness: Harness

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore(shared === undefined ? {} : { shared })
    const claim = createClaimDouble()
    return {
        clock,
        store,
        claim,
        service: createOwnerHistoryService({
            store,
            claim,
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => null,
        }),
    }
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacter(makeCharacter())
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const retained = (): string[] => retainedNamesOf(live()[ASSET_RETAINED_KEY])

function snapshot(): string {
    return JSON.stringify(DBState.db.characters)
}

async function mergeLanded(): Promise<void> {
    await harness.service.whenReady(A)
    expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
}

function expectMerged(): void {
    expect(live().firstMessage).toBe(FIRST_MERGED)
    expect(live().alternateGreetings).toEqual([ALT0_MERGED, ALT1_MERGED])
    expect(live().globalLore.map((entry) => entry.content)).toEqual([LORE0_MERGED, LORE1_MERGED])
    expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave'])
}

function expectOriginal(): void {
    expect(live().firstMessage).toBe(FIRST)
    expect(live().alternateGreetings).toEqual([ALT0, ALT1])
    expect(live().globalLore.map((entry) => entry.content)).toEqual([LORE0, LORE1])
    expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])
}

// ---------------------------------------------------------------- the op shape and the bound-step rule

describe('a merge that changed the first message and an alternate is a bound step', () => {
    test('R1: a change outside to an alternate the merge touched stops the undo whole, and nothing changes', async () => {
        await mergeLanded()
        live().alternateGreetings[1] = 'changed'
        const before = snapshot()
        const marks = h.marks

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'pairSplit' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).undone).toHaveLength(0)
        expect(retained()).toEqual(['assets/smile.png'])
    })

    test('R1b: a change outside to the first message stops the undo whole too, through replay', async () => {
        await mergeLanded()
        live().firstMessage = 'edited by hand'
        const before = snapshot()
        const marks = h.marks

        expect(await harness.service.replay(A, { kind: 'undo' })).toEqual({ ok: false, reason: 'pairSplit' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('T17c: a clean undo of a merge with two occurrences in one alternate and in the first message restores both and reports nothing left', async () => {
        await mergeLanded()
        const result = harness.service.undo(A)
        expect(result).toEqual({ ok: true })
        expectOriginal()
    })

    test('T17: a merge is one write; its undo restores rows, the file root and every text in one write, and redo merges again', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly)).toMatchObject({ ok: true })
        expect(h.marks).toBe(1)
        expectMerged()
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).done[0].label).toEqual({ kind: 'assetMerge', from: 'grin', to: 'smile' })
        expect(harness.service.view(A).done[0].ops.map((op) => op.op)).toEqual(['assetRowRemove', 'set', 'listSet', 'listSet', 'textEdit', 'textEdit', 'textEdit'])
        expect(retained()).toEqual(['assets/smile.png'])

        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(h.marks).toBe(2)
        expectOriginal()
        expect(retained()).toEqual(['assets/smile.png'])

        expect(harness.service.redo(A)).toEqual({ ok: true })
        expect(h.marks).toBe(3)
        expectMerged()
        expect(retained()).toEqual(['assets/smile.png'])
    })

    test('T-RT: the stored merge step holds the whole-value ops and, read by a second service, undoes in one write', async () => {
        await mergeLanded()
        const ops = harness.service.view(A).done[0].ops
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const stored = storedRecord(harness.store.shared, A)
        expect(stored?.record.done[0].ops).toEqual(ops)
        expect(stored?.record.done[0].ops.find((op) => op.op === 'set')).toEqual({
            op: 'set',
            path: 'firstMessage',
            before: { had: true, value: FIRST },
            after: { had: true, value: FIRST_MERGED },
        })

        const second = build(harness.store.shared)
        await second.service.whenReady(A)
        const marks = h.marks
        expect(second.service.undo(A)).toEqual({ ok: true })
        expect(h.marks).toBe(marks + 1)
        expectOriginal()
    })

    test('E8: a merge step stored with one textEdit per occurrence, first message and alternates included, still replays unbound as it did', async () => {
        putCharacter(makeCharacter({
            firstMessage: FIRST_MERGED,
            alternateGreetings: [ALT0_MERGED, ALT1_MERGED],
            additionalAssets: [[...SMILE], [...WAVE]],
        }))
        const step: Step = {
            id: 'old1',
            at: 1,
            label: { kind: 'assetMerge', from: 'grin', to: 'smile' },
            ops: [
                { op: 'assetRowRemove', array: 'additionalAssets', index: 2, tuple: [...GRIN], count: 1 },
                { op: 'textEdit', target: 'firstMessage', offset: 32, from: 'grin', to: 'smile' },
                { op: 'textEdit', target: 'firstMessage', offset: 12, from: 'grin', to: 'smile' },
                { op: 'textEdit', target: 'alternateGreetings/0', offset: 30, from: 'grin', to: 'smile' },
                { op: 'textEdit', target: 'alternateGreetings/0', offset: 12, from: 'grin', to: 'smile' },
                { op: 'textEdit', target: 'alternateGreetings/1', offset: 12, from: 'grin', to: 'smile' },
            ],
        }
        const record: OwnerRecord = { ownerKey: A, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }
        seedOwner(harness.store.shared, record, 'seed:1')
        await harness.service.whenReady(A)
        live().alternateGreetings[1] = 'changed outside'

        // Before the whole-value shape a change to one alternate left the rest to restore: no pairSplit.
        const result = harness.service.undo(A)
        expect(result).toMatchObject({ ok: true, skipped: 1 })
        expect(live().firstMessage).toBe(FIRST)
        expect(live().alternateGreetings).toEqual([ALT0, 'changed outside'])
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])
    })

    test('E8b: the same old-shape step names the alternate it left in notRestored', async () => {
        putCharacter(makeCharacter({ firstMessage: FIRST_MERGED, alternateGreetings: [ALT0_MERGED, ALT1_MERGED], additionalAssets: [[...SMILE], [...WAVE]] }))
        const step: Step = {
            id: 'old2',
            at: 1,
            label: { kind: 'assetMerge', from: 'grin', to: 'smile' },
            ops: [
                { op: 'assetRowRemove', array: 'additionalAssets', index: 2, tuple: [...GRIN], count: 1 },
                { op: 'textEdit', target: 'alternateGreetings/1', offset: 12, from: 'grin', to: 'smile' },
            ],
        }
        seedOwner(harness.store.shared, { ownerKey: A, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }, 'seed:1')
        await harness.service.whenReady(A)
        live().alternateGreetings[1] = 'changed outside'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['alternateGreetings/1'] })
    })
})

// ---------------------------------------------------------------- notRestored

describe('a partial undo of a merge names the texts it left', () => {
    test('T18: a lore entry edited outside is named, and one edited to exactly its restored text is not', async () => {
        await mergeLanded()
        live().globalLore[0].content = 'lore edited by hand'
        live().globalLore[1].content = LORE1

        const result = harness.service.undo(A)

        // `skipped` counts every op that did not apply (both occurrences in the first entry, the one in the second);
        // only a text that does not already hold the result is named, once however many occurrences failed.
        expect(result).toEqual({ ok: true, skipped: 3, notRestored: ['lore/0/content'] })
        expect(live().globalLore.map((entry) => entry.content)).toEqual(['lore edited by hand', LORE1])
        expect(live().firstMessage).toBe(FIRST)
        expect(live().alternateGreetings).toEqual([ALT0, ALT1])
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])

        // The list is a note of this replay only: nothing the store holds names it.
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect([...harness.store.shared.values()].some((value) => value.includes('notRestored'))).toBe(false)
        expect([...harness.store.shared.values()].some((value) => value.includes('"op":"set"'))).toBe(true)
    })

    test('T18b: a first-message-only merge undoes the rows and names the first message when it was edited outside', async () => {
        putCharacter(makeCharacter({ alternateGreetings: ['g0', 'g1'], globalLore: [] }))
        await mergeLanded()
        live().firstMessage = 'Hi there, rewritten'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['firstMessage'] })

        expect(live().firstMessage).toBe('Hi there, rewritten')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])
    })

    test('T18c: a merge that changed alternates but not the first message undoes partly, and names the alternate edited outside', async () => {
        putCharacter(makeCharacter({ firstMessage: 'Hi there' }))
        await mergeLanded()
        expect(harness.service.view(A).done[0].ops.some((op) => op.op === 'set')).toBe(false)
        live().alternateGreetings[1] = 'changed outside'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['alternateGreetings/1'] })

        expect(live().alternateGreetings).toEqual([ALT0, 'changed outside'])
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])
    })

    test('T18n: a step that is not a merge and was partly replayed has no notRestored in its notes', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        expect(harness.service.editField(A, 'exampleMessage', 'ex1').ok).toBe(true)
        expect(harness.service.restore(A, new Set()).ok).toBe(true)
        expect(harness.service.view(A).done.at(-1)?.label.kind).toBe('restorePoint')
        expect(harness.service.view(A).done.at(-1)?.ops.map((op) => op.op)).toEqual(['set', 'set'])
        live().desc = 'changed outside'

        const result = harness.service.undo(A)

        expect(result).toEqual({ ok: true, skipped: 1 })
        expect(live().exampleMessage).toBe('ex1')
    })
})

// ---------------------------------------------------------------- stale models and absent keys

describe('a merge model that no longer fits the live text is refused with nothing written', () => {
    async function expectRefused(model: MergePreview): Promise<void> {
        const before = snapshot()
        const marks = h.marks
        expect(harness.service.assetMerge(A, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(0)
    }

    test('E2: a first message edit that no longer sits on its text', async () => {
        await harness.service.whenReady(A)
        const model = modelOf()
        live().firstMessage = 'Yo {{image::wave}} and more words here {{image::wave}}'
        await expectRefused(model)
    })

    test('E2: an alternate edit that no longer sits on its text', async () => {
        await harness.service.whenReady(A)
        const model = modelOf()
        live().alternateGreetings[0] = 'z0 {{image::wave}} y {{image::wave}} and more'
        await expectRefused(model)
    })

    test('E2: an alternate entry that is gone', async () => {
        await harness.service.whenReady(A)
        const model = modelOf()
        live().alternateGreetings.length = 1
        await expectRefused(model)
    })

    test('R5b: a model with a first message edit, whose first message key was deleted before the click', async () => {
        await harness.service.whenReady(A)
        const model = modelOf()
        delete live().firstMessage
        await expectRefused(model)
    })

    test('E7: a module owner refuses a model that claims to be a character and holds first message and alternate edits', async () => {
        const M1 = moduleOwnerKey('M1')
        DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [[...SMILE], [...GRIN]] }] as unknown as typeof DBState.db.modules
        const moduleHarness = build()
        const service = createOwnerHistoryService({
            store: moduleHarness.store,
            claim: moduleHarness.claim,
            clock: moduleHarness.clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => 'M1',
        })
        await service.whenReady(M1)
        const model = modelOf()
        model.rowOps = [{ kind: 'assetRowRemove', array: 'assets', index: 1, tuple: [...GRIN], count: 1 }]
        model.array = 'assets'
        const before = JSON.stringify(DBState.db.modules)
        expect(service.assetMerge(M1, model, byPathOnly)).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(h.marks).toBe(0)
        expect(service.view(M1).done).toHaveLength(0)
    })
})

describe('a character without a first message key', () => {
    test('R5a: the merge emits no first message op, and the key stays absent after the merge, the undo and the redo', async () => {
        const character = makeCharacter()
        delete character.firstMessage
        putCharacter(character)
        await harness.service.whenReady(A)
        const model = modelOf()
        expect(model.textEdits.some((edit) => edit.target === 'firstMessage')).toBe(false)

        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)
        expect(harness.service.view(A).done[0].ops.some((op) => op.op === 'set')).toBe(false)
        expect(Object.hasOwn(live(), 'firstMessage')).toBe(false)
        expect(live().alternateGreetings).toEqual([ALT0_MERGED, ALT1_MERGED])

        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(Object.hasOwn(live(), 'firstMessage')).toBe(false)
        expect(live().alternateGreetings).toEqual([ALT0, ALT1])

        expect(harness.service.redo(A)).toEqual({ ok: true })
        expect(Object.hasOwn(live(), 'firstMessage')).toBe(false)
        expect(live().alternateGreetings).toEqual([ALT0_MERGED, ALT1_MERGED])
    })
})

// ---------------------------------------------------------------- every syntax of every target

describe('the applied step rewrites every syntax in every target exactly as planned', () => {
    test('T15: each text of the live character equals its original with the planned edits applied', async () => {
        const original = {
            desc: 'D {{image::grin}} <img src="grin"> {{raw::GRIN}} {{asset_prompt::grin}}',
            systemPrompt: 'sys {{path::grin}} and {{image::grin}}',
            backgroundHTML: '<img src=\'grin\'><div>{{bg::grin}}</div>',
            firstMessage: 'FM {{video-img::grin}}{{audio::grin}}',
            alternateGreetings: ['A0 {{image::grin}}', 'A1 <img alt="x" src="grin"> {{image::grin}}'],
            lore: 'L {{img::grin}} {{image::grin}}',
        }
        putCharacter({
            ...makeCharacter({ firstMessage: original.firstMessage, alternateGreetings: [...original.alternateGreetings], globalLore: [{ key: 'k', content: original.lore }], desc: original.desc }),
            systemPrompt: original.systemPrompt,
            backgroundHTML: original.backgroundHTML,
        } as LiveCharacter)
        await harness.service.whenReady(A)
        const model = modelOf()
        expect(new Set(model.textEdits.map((edit) => edit.target))).toEqual(new Set(['desc', 'systemPrompt', 'backgroundHTML', 'firstMessage', 'alternateGreetings/0', 'alternateGreetings/1', 'lore/0/content']))

        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)

        const after = live() as LiveCharacter & { systemPrompt: string; backgroundHTML: string }
        expect(after.desc).toBe(applyEditsTo(original.desc, 'desc', model.textEdits))
        expect(after.systemPrompt).toBe(applyEditsTo(original.systemPrompt, 'systemPrompt', model.textEdits))
        expect(after.backgroundHTML).toBe(applyEditsTo(original.backgroundHTML, 'backgroundHTML', model.textEdits))
        expect(after.firstMessage).toBe(applyEditsTo(original.firstMessage, 'firstMessage', model.textEdits))
        expect(after.alternateGreetings[0]).toBe(applyEditsTo(original.alternateGreetings[0], 'alternateGreetings/0', model.textEdits))
        expect(after.alternateGreetings[1]).toBe(applyEditsTo(original.alternateGreetings[1], 'alternateGreetings/1', model.textEdits))
        expect(after.globalLore[0].content).toBe(applyEditsTo(original.lore, 'lore/0/content', model.textEdits))
        // The edits changed something in every target, and nothing that names the kept name already was touched twice.
        expect(after.desc).not.toBe(original.desc)
        expect(after.firstMessage).toBe('FM {{video-img::smile}}{{audio::smile}}')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(live().desc).toBe(original.desc)
        expect(live().firstMessage).toBe(original.firstMessage)
        expect(live().alternateGreetings).toEqual(original.alternateGreetings)
    })
})

// ---------------------------------------------------------------- a revert across a merge step

describe('a revert across a merge step', () => {
    test('E12: a bound merge step that no longer fits is skipped whole and stays on the stack with its retention root; older steps revert', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.editField(A, 'exampleMessage', 'ex1').ok).toBe(true)
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
        live().alternateGreetings[1] = 'changed outside'

        const result = harness.service.revertTo(A, base)

        expect(result).toMatchObject({ ok: true, pairSkipped: 1 })
        expect(live().exampleMessage).toBe('ex0')
        expect(live().desc).toBe('d1')
        // The merge was skipped whole: its rows stay removed and its texts stay merged.
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave'])
        expect(live().firstMessage).toBe(FIRST_MERGED)
        expect(live().alternateGreetings[0]).toBe(ALT0_MERGED)
        const done = harness.service.view(A).done
        expect(done.some((step) => step.label.kind === 'assetMerge')).toBe(true)
        expect(retained()).toEqual(['assets/smile.png'])
    })
})

// ---------------------------------------------------------------- a row that cannot be put back stops the replay

describe('a merge replay whose row op cannot apply stops whole and writes nothing', () => {
    test('R-S1: an undo whose row insert is out of range after an outside delete is refused, with every text and the step as they were', async () => {
        await mergeLanded()
        live().additionalAssets.splice(1, 1)
        const before = snapshot()
        const marks = h.marks

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(live().firstMessage).toBe(FIRST_MERGED)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).undone).toHaveLength(0)
        expect(retained()).toEqual(['assets/smile.png'])
    })

    test('R-S1b: a redo whose row removal no longer meets its row is refused whole too', async () => {
        await mergeLanded()
        expect(harness.service.undo(A)).toEqual({ ok: true })
        live().additionalAssets.splice(0, 0, ['x', 'assets/x.png', 'png'])
        const before = snapshot()
        const marks = h.marks

        expect(harness.service.redo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(live().firstMessage).toBe(FIRST)
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(1)
    })

    test('R-S1c: a revert leaves such a merge step whole and still reverts the older steps', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.editField(A, 'exampleMessage', 'ex1').ok).toBe(true)
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
        live().additionalAssets.splice(1, 1)

        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })

        expect(live().exampleMessage).toBe('ex0')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])
        expect(live().firstMessage).toBe(FIRST_MERGED)
        expect(live().alternateGreetings).toEqual([ALT0_MERGED, ALT1_MERGED])
        expect(harness.service.view(A).done.some((step) => step.label.kind === 'assetMerge')).toBe(true)
        expect(retained()).toEqual(['assets/smile.png'])
    })

    test('R-S1d: a revert with nothing else to revert is refused when the merge step cannot be put back', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
        live().additionalAssets.splice(1, 1)
        const before = snapshot()

        expect(harness.service.revertTo(A, base)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(harness.service.view(A).done).toHaveLength(2)
    })
})

// ---------------------------------------------------------------- a text edit replays on the whole name only

describe('a merge text edit replays only where the reference names exactly the edit text', () => {
    // One lore entry that names `grin`, so the replay has a single place to restore.
    async function loreMerged(content = 'x {{image::grin}} y'): Promise<void> {
        putCharacter(makeCharacter({ alternateGreetings: [], globalLore: [{ key: 'k', content }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await mergeLanded()
        expect(live().globalLore[0].content).toBe(content.replaceAll('grin', 'smile'))
    }

    test('R-S2: a longer name typed over the kept name is not rewritten, and the place is listed', async () => {
        await loreMerged()
        live().globalLore[0].content = 'x {{image::smiley}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('x {{image::smiley}} y')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin'])
    })

    test('R-S2b: a place hand-restored to the removed name stays as it is, and is not listed because it already holds the result', async () => {
        const S2: Row = ['smile2', 'assets/smile.png', 'png']
        putCharacter(makeCharacter({ alternateGreetings: [], additionalAssets: [[...SMILE], [...WAVE], [...S2]], globalLore: [{ key: 'k', content: 'x {{image::smile2}} y' }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await harness.service.whenReady(A)
        expect(harness.service.assetMerge(A, modelOf(live(), 'smile', 'smile2'), byPathOnly).ok).toBe(true)
        expect(live().globalLore[0].content).toBe('x {{image::smile}} y')
        live().globalLore[0].content = 'x {{image::smile2}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1 })

        expect(live().globalLore[0].content).toBe('x {{image::smile2}} y')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'smile2'])
    })

    test('R-S2c: a place typed to a longer name than the removed one is not rewritten and is listed', async () => {
        const S2: Row = ['smile2', 'assets/smile.png', 'png']
        putCharacter(makeCharacter({ alternateGreetings: [], additionalAssets: [[...SMILE], [...WAVE], [...S2]], globalLore: [{ key: 'k', content: 'x {{image::smile2}} y' }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await harness.service.whenReady(A)
        expect(harness.service.assetMerge(A, modelOf(live(), 'smile', 'smile2'), byPathOnly).ok).toBe(true)
        live().globalLore[0].content = 'x {{image::smile22}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('x {{image::smile22}} y')
    })

    test('R-S2d: a redo does not rewrite a longer name typed over the removed name, and lists the place', async () => {
        await loreMerged()
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(live().globalLore[0].content).toBe('x {{image::grin}} y')
        live().globalLore[0].content = 'x {{image::grinch}} y'

        expect(harness.service.redo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('x {{image::grinch}} y')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave'])
    })

    test('R-S2e: a quoted src and an asset prompt end at their own terminators, so a clean undo still restores them', async () => {
        const original = 'a <img src="grin"> b <img src=\'grin\'> c {{asset_prompt::grin}}'
        putCharacter(makeCharacter({ alternateGreetings: [], globalLore: [{ key: 'k', content: original }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await mergeLanded()
        expect(live().globalLore[0].content).toBe('a <img src="smile"> b <img src=\'smile\'> c {{asset_prompt::smile}}')

        expect(harness.service.undo(A)).toEqual({ ok: true })

        expect(live().globalLore[0].content).toBe(original)
    })

    test('R-S2f: an apostrophe after the kept name inside a macro belongs to the name, so the place is left and listed', async () => {
        await loreMerged()
        live().globalLore[0].content = "x {{image::smile's alt}} y"

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe("x {{image::smile's alt}} y")
    })

    test('R-S2g: a double quote after the kept name inside a macro belongs to the name too', async () => {
        await loreMerged()
        live().globalLore[0].content = 'x {{image::smile"2}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('x {{image::smile"2}} y')
    })

    test('R-S2h: a redo does not rewrite a removed name that an apostrophe extends inside a macro', async () => {
        await loreMerged()
        expect(harness.service.undo(A)).toEqual({ ok: true })
        live().globalLore[0].content = "x {{image::grin's}} y"

        expect(harness.service.redo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe("x {{image::grin's}} y")
    })

    test('R-S2i: a name that follows an unterminated macro prefix is not the edit name, and the place is left and listed', async () => {
        await loreMerged('aaaaaaaaaaaa {{image::grin}} y')
        live().globalLore[0].content = '{{image::aaa {{image::smiley}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('{{image::aaa {{image::smiley}} y')
    })

    test('R-S2j: the same name inside a quoted src that the person kept still restores through the scanner path', async () => {
        await loreMerged('a <img src="grin"> b')

        expect(harness.service.undo(A)).toEqual({ ok: true })

        expect(live().globalLore[0].content).toBe('a <img src="grin"> b')
    })
})

// ---------------------------------------------------------------- a revert step that crossed a merge keeps the merge's rules

describe('a revert step that crossed a merge replays by what it holds, not by its label', () => {
    // A lore-only character whose merge sits above one desc step: `base` is that step.
    async function mergedAboveBase(): Promise<string> {
        putCharacter(makeCharacter({ alternateGreetings: [], globalLore: [{ key: 'k', content: 'x {{image::grin}} y' }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
        return base
    }

    test('R-S3: the revert step holds the merge ops under a revert label', async () => {
        const base = await mergedAboveBase()

        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })

        const top = harness.service.view(A).done.at(-1)
        expect(top?.label.kind).toBe('revert')
        expect(top?.ops.some((op) => op.op === 'assetRowInsert')).toBe(true)
        expect(top?.ops.some((op) => op.op === 'textEdit')).toBe(true)
    })

    test('R-S3b: an undo of the revert step does not rewrite a longer name typed outside over the reverted name, and lists the place', async () => {
        const base = await mergedAboveBase()
        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })
        expect(live().globalLore[0].content).toBe('x {{image::grin}} y')
        live().globalLore[0].content = 'x {{image::grinch}} y'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['lore/0/content'] })

        expect(live().globalLore[0].content).toBe('x {{image::grinch}} y')
    })

    test('R-S3c: a redo of the revert step refuses whole, writing nothing, when its row op no longer meets its rows', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.assetMerge(A, modelOf(), byPathOnly).ok).toBe(true)
        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expectMerged()
        live().additionalAssets.splice(1, 1)
        const before = snapshot()
        const marks = h.marks

        expect(harness.service.redo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(live().firstMessage).toBe(FIRST_MERGED)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])
        expect(harness.service.view(A).undone).toHaveLength(1)
        expect(harness.service.view(A).undone[0].label.kind).toBe('revert')
    })

    test('R-S3d: a revert across such a revert step leaves it whole when its row op cannot go back, and still reverts the newer step', async () => {
        const base = await mergedAboveBase()
        const merge = harness.service.view(A).done[1].id
        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })
        expect(harness.service.editField(A, 'exampleMessage', 'ex1').ok).toBe(true)
        live().additionalAssets.unshift(['x', 'assets/x.png', 'png'])

        expect(harness.service.revertTo(A, merge)).toMatchObject({ ok: true })

        expect(live().exampleMessage).toBe('ex0')
        // The revert step stayed whole: the name it put back stays and so does its row.
        expect(live().globalLore[0].content).toBe('x {{image::grin}} y')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['x', 'smile', 'wave', 'grin'])
    })

    test('R-S3e: a revert whose only step is such a revert step refuses when its row op cannot go back', async () => {
        const base = await mergedAboveBase()
        const merge = harness.service.view(A).done[1].id
        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })
        live().additionalAssets.unshift(['x', 'assets/x.png', 'png'])
        const before = snapshot()

        expect(harness.service.revertTo(A, merge)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(harness.service.view(A).done).toHaveLength(3)
    })

    test('R-S3f: a step of any label that holds a merge row op and a text edit is stopped whole by a row op that cannot replay', async () => {
        putCharacter(makeCharacter({
            alternateGreetings: [],
            globalLore: [{ key: 'k', content: 'x {{image::grin}} y' }],
            additionalAssets: [['x', 'assets/x.png', 'png'], [...SMILE], [...WAVE], [...GRIN]],
        }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        const step: Step = {
            id: 'rv1',
            at: 1,
            label: { kind: 'revert', toStepId: 'gone' },
            ops: [
                { op: 'textEdit', target: 'lore/0/content', offset: 11, from: 'smile', to: 'grin' },
                { op: 'assetRowInsert', array: 'additionalAssets', index: 2, tuple: [...GRIN], count: 0 },
            ],
        }
        seedOwner(harness.store.shared, { ownerKey: A, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }, 'seed:1')
        await harness.service.whenReady(A)
        const before = snapshot()

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(harness.service.view(A).done).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- rows and text in one step, whatever made it

describe('a step that holds an asset row op and a text op replays its rows whole or not at all', () => {
    // An ordinary rename and an unrelated desc edit, reverted as one revert step holding a row op and a text op.
    async function renamedAndEdited(): Promise<void> {
        await harness.service.whenReady(A)
        expect(harness.service.editField(A, 'exampleMessage', 'ex1').ok).toBe(true)
        const base = harness.service.view(A).done[0].id
        expect(harness.service.assetRename(A, 'additionalAssets', 1, 'wave2')).toMatchObject({ ok: true })
        expect(harness.service.editField(A, 'desc', 'd1').ok).toBe(true)
        expect(harness.service.revertTo(A, base)).toMatchObject({ ok: true })
        expect(live().desc).toBe('d0')
        expect(live().additionalAssets[1][0]).toBe('wave')
        const top = harness.service.view(A).done.at(-1)
        expect(top?.label.kind).toBe('revert')
        expect(top?.ops.map((op) => op.op).sort()).toEqual(['assetRowSet', 'set'])
    }

    test('R-S4: an undo of that revert step refuses whole when its row op cannot replay, and the text stays as it was', async () => {
        await renamedAndEdited()
        live().additionalAssets[1][0] = 'wave9'
        const before = snapshot()
        const marks = h.marks

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
        expect(h.marks).toBe(marks)
        expect(live().desc).toBe('d0')
        expect(harness.service.view(A).done.at(-1)?.label.kind).toBe('revert')
    })

    test('R-S4b: when the row op replays and the text op does not, the replay stays partial and lists the text', async () => {
        await renamedAndEdited()
        live().desc = 'changed outside'

        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1, notRestored: ['desc'] })

        expect(live().desc).toBe('changed outside')
        expect(live().additionalAssets[1][0]).toBe('wave2')
    })

    test('R-S4d: an alternate whole-value op counts as the text op, so a merge that changed only alternates refuses on a failed row op', async () => {
        putCharacter(makeCharacter({ firstMessage: 'Hi there', globalLore: [] }))
        await mergeLanded()
        expect(new Set(harness.service.view(A).done[0].ops.map((op) => op.op))).toEqual(new Set(['assetRowRemove', 'listSet']))
        live().additionalAssets.splice(1, 1)
        const before = snapshot()

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
    })

    test('R-S4e: a first message whole-value op counts as the text op, so a merge that changed only the first message refuses on a failed row op', async () => {
        putCharacter(makeCharacter({ alternateGreetings: ['g0', 'g1'], globalLore: [] }))
        await mergeLanded()
        expect(new Set(harness.service.view(A).done[0].ops.map((op) => op.op))).toEqual(new Set(['assetRowRemove', 'set']))
        live().additionalAssets.splice(1, 1)
        const before = snapshot()

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(snapshot()).toBe(before)
    })

    test('R-S4c: a step with a row op and no text op keeps its old behaviour, and a failed row op refuses as before', async () => {
        await harness.service.whenReady(A)
        expect(harness.service.assetRename(A, 'additionalAssets', 1, 'wave2')).toMatchObject({ ok: true })
        live().additionalAssets[1][0] = 'wave9'

        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })

        expect(live().additionalAssets[1][0]).toBe('wave9')
    })
})
