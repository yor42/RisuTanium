// @vitest-environment jsdom
// The character's 배경 HTML and CharacterJS through the real history service (Studio SC-1). T2: an edit over an absent key
// lands and its undo deletes the key. T3: a merge step on the 배경 HTML feeds the restore point whichever order it ran in.
// T5: a stored non-string comes back on undo. T17: the CharacterJS row keeps a foreign value and writes back a fresh plain
// copy, at the service and at the writer.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { DEFAULT_SETTINGS, groupRow } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { buildMergePreview, type MergePreview } from 'src/ts/studio/assets/mergePreview'
import type { CharacterTargetFields } from 'src/ts/studio/assets/referenceTargets'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { applyCharacterWrites, createLiveReader } from '../../edit/studioSetters'
import { planRestorePoint } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter } from './objService.test-helpers'

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

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const A = characterOwnerKey('A')

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

async function session(over: Record<string, unknown> = {}): Promise<{ service: OwnerHistoryService; clock: ReturnType<typeof createFakeClock> }> {
    putCharacter({ ...makeCharacter(), name: 'Alice', type: 'character', ...over })
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

const stored = (): Record<string, unknown> => liveCharacter() as unknown as Record<string, unknown>

describe('T2: an edit over an absent 배경 HTML lands, and its undo deletes the key', () => {
    test('the first edit creates the key and undo removes it', async () => {
        const { service } = await session()
        expect('backgroundHTML' in stored()).toBe(false)
        const result = service.editText(A, 'backgroundHTML', 'x', 'typing')
        expect(result).toEqual({ ok: true })
        expect(stored().backgroundHTML).toBe('x')
        expect(service.undo(A)).toMatchObject({ ok: true })
        expect('backgroundHTML' in stored()).toBe(false)
        expect(service.redo(A)).toMatchObject({ ok: true })
        expect(stored().backgroundHTML).toBe('x')
    })
})

describe('T17: the CharacterJS row keeps a foreign value and writes back a fresh plain copy', () => {
    test('(a) edit then undo over a foreign object writes back a deep-equal copy that is not the record\'s object', async () => {
        const foreign = { a: 1, nested: { b: 2 } }
        const { service } = await session({ virtualscript: structuredClone(foreign) })
        expect(service.editText(A, 'virtualscript', 'code', 'single')).toEqual({ ok: true })
        expect(stored().virtualscript).toBe('code')
        expect(service.undo(A)).toMatchObject({ ok: true })
        const recorded = (service.view(A).undone[0].ops[0] as unknown as { before: { value: { nested: unknown } } }).before.value
        expect(stored().virtualscript).toEqual(foreign)
        expect(stored().virtualscript).not.toBe(recorded)
        expect((stored().virtualscript as { nested: unknown }).nested).not.toBe(recorded.nested)
    })

    test('(a) an edit over an absent CharacterJS lands and undo deletes the key', async () => {
        const { service } = await session()
        expect(service.editText(A, 'virtualscript', 'code', 'single')).toEqual({ ok: true })
        expect(stored().virtualscript).toBe('code')
        expect(service.undo(A)).toMatchObject({ ok: true })
        expect('virtualscript' in stored()).toBe(false)
    })

    test('(b) the character writer assigns a fresh plain copy of a foreign value, never the record\'s own object', () => {
        const obj = { a: 1, nested: { b: 2 } }
        const live = { chaId: 'A', virtualscript: 'old' } as unknown as Parameters<typeof applyCharacterWrites>[0]
        applyCharacterWrites(live, [{ op: 'set', path: 'virtualscript', value: { had: 'foreign', value: obj } }], null)
        const written = (live as unknown as { virtualscript: { nested: unknown } }).virtualscript
        expect(written).toEqual(obj)
        expect(written).not.toBe(obj)
        expect(written.nested).not.toBe(obj.nested)
    })
})

describe('T3: a merge on the 배경 HTML feeds the restore point whichever order it ran in', () => {
    const SMILE = ['smile', 'assets/smile.png', 'png']
    const WAVE = ['wave', 'assets/wave.png', 'png']
    // The same file as `smile` under another name, so the merge folds it into `smile`.
    const GRIN = ['grin', 'assets/smile.png', 'png']
    const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

    async function mergeSession(html: string): Promise<OwnerHistoryService> {
        const { service } = await session({
            backgroundHTML: html,
            firstMessage: 'Hi',
            exampleMessage: '',
            alternateGreetings: [],
            globalLore: [],
            additionalAssets: [[...SMILE], [...WAVE], [...GRIN]],
            emotionImages: [],
        })
        return service
    }

    function mergeModel(): MergePreview {
        const source = liveCharacter() as unknown as CharacterTargetFields
        const group = groupDuplicates((stored().additionalAssets as string[][]).map((row, index) => groupRow(row[0], row[1], index)))
            .find((candidate) => candidate.cls === 'sameFileDifferentNames' && ['smile', 'grin'].every((name) => candidate.rows.some((row) => row.name === name)))
        if (!group) {
            throw new Error('no candidate group')
        }
        return buildMergePreview({ kind: 'character', source }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
    }

    test('(a) edit then merge: the restore point holds the visit-start text as before and the live text as last, and restoring brings the visit-start text back', async () => {
        const service = await mergeSession('h0')
        expect(service.editText(A, 'backgroundHTML', 'h1 {{bg::grin}}', 'typing')).toEqual({ ok: true })
        expect(service.assetMerge(A, mergeModel(), byPathOnly).ok).toBe(true)
        expect(stored().backgroundHTML).toBe('h1 {{bg::smile}}')
        const field = service.view(A).restore?.fields.backgroundHTML
        expect(field?.before).toEqual({ had: true, value: 'h0' })
        expect(field?.last).toEqual({ had: true, value: 'h1 {{bg::smile}}' })
        const plan = planRestorePoint(service.view(A).restore, createLiveReader({ character: liveCharacter() as never, chat: null }), new Set())
        if (plan.ok === false) {
            throw new Error(`restore refused: ${plan.reason}`)
        }
        expect(plan.changedElsewhere).toEqual([])
        expect(service.restore(A, new Set()).ok).toBe(true)
        expect(stored().backgroundHTML).toBe('h0')
    })

    test('(b) merge then edit: the restore point holds the pre-merge text as before', async () => {
        const service = await mergeSession('h0 {{bg::grin}}')
        // A merge adds to a restore point the visit has already opened; a form edit opens it.
        expect(service.editText(A, 'desc', 'd1', 'typing')).toEqual({ ok: true })
        expect(service.assetMerge(A, mergeModel(), byPathOnly).ok).toBe(true)
        expect(stored().backgroundHTML).toBe('h0 {{bg::smile}}')
        expect(service.editText(A, 'backgroundHTML', 'h2', 'typing')).toEqual({ ok: true })
        const field = service.view(A).restore?.fields.backgroundHTML
        expect(field?.before).toEqual({ had: true, value: 'h0 {{bg::grin}}' })
        expect(field?.last).toEqual({ had: true, value: 'h2' })
    })
})

describe('T5: a stored non-string 배경 HTML comes back on undo', () => {
    test('the first edit writes a string and undo writes the number back', async () => {
        const { service } = await session({ backgroundHTML: 7 })
        expect(service.editText(A, 'backgroundHTML', 'h', 'typing')).toEqual({ ok: true })
        expect(stored().backgroundHTML).toBe('h')
        expect(service.undo(A)).toMatchObject({ ok: true })
        expect(typeof stored().backgroundHTML).toBe('number')
        expect(stored().backgroundHTML).toBe(7)
    })
})
