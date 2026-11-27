// @vitest-environment jsdom
// The records of the Studio SC-1 paths. T9: the real service writes steps on the character's 배경 HTML (over a stored
// non-string) and CharacterJS (over an absent key), then a merge step on the 배경 HTML; the record equals the committed
// fixture, reads back through the strict parser and every step undoes. T4: a stored merge step on `backgroundHTML` written
// before the router change replays to the same landed text. The fixture is rewritten only with RISU_WRITE_SC1_RECORDS=1.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { DEFAULT_SETTINGS, groupRow } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { buildMergePreview, type MergePreview } from 'src/ts/studio/assets/mergePreview'
import type { CharacterTargetFields } from 'src/ts/studio/assets/referenceTargets'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { applyCharacterWrites, createLiveReader } from '../../edit/studioSetters'
import { assetStepWrites, emptyRecord, parseOwnerRecord, planReplay, planRevert, type Op, type Step } from '../historyModel'
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

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sc1Records.json')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const A = characterOwnerKey('A')
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

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

function character(): ReturnType<typeof makeCharacter> {
    return {
        ...makeCharacter(),
        name: 'Alice',
        type: 'character',
        backgroundHTML: 7,
        additionalAssets: [['smile', 'assets/smile.png', 'png'], ['wave', 'assets/wave.png', 'png'], ['grin', 'assets/smile.png', 'png']],
        emotionImages: [],
        globalLore: [],
    } as unknown as ReturnType<typeof makeCharacter>
}

async function session(): Promise<{ service: OwnerHistoryService; clock: ReturnType<typeof createFakeClock> }> {
    putCharacter(character())
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

function mergeModel(): MergePreview {
    const source = liveCharacter() as unknown as CharacterTargetFields
    const rows = (liveCharacter() as unknown as { additionalAssets: string[][] }).additionalAssets
    const group = groupDuplicates(rows.map((row, index) => groupRow(row[0], row[1], index)))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames' && ['smile', 'grin'].every((name) => candidate.rows.some((row) => row.name === name)))
    if (!group) {
        throw new Error('no candidate group')
    }
    return buildMergePreview({ kind: 'character', source }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
}

// One step per new shape through the real service: the 배경 HTML over a stored number, CharacterJS over an absent key, then
// a merge on the 배경 HTML.
async function produce(): Promise<{ record: unknown; steps: number }> {
    const { service, clock } = await session()
    const lap = (): void => clock.tick(60_000)
    const run = (result: { ok: boolean }): void => {
        if (!result.ok) throw new Error(`step refused: ${JSON.stringify(result)}`)
        lap()
    }
    run(service.editText(A, 'backgroundHTML', 'h1 {{bg::grin}}', 'single'))
    run(service.editText(A, 'virtualscript', 'code', 'single'))
    run(service.assetMerge(A, mergeModel(), byPathOnly))
    const view = service.view(A)
    return { record: JSON.parse(JSON.stringify({ ownerKey: A, touchedAt: clock.now(), done: view.done, undone: view.undone, deleted: view.deleted, restore: view.restore })), steps: view.done.length }
}

describe('T9: the records the SC-1 writer produces (the writer needs the SC-1 rows; the fixture is parsed by the current strict parser)', () => {
    test('they equal the committed fixture and read back through the strict parser', async () => {
        if (process.env.RISU_WRITE_SC1_RECORDS === '1') {
            writeFileSync(FIXTURE, JSON.stringify((await produce()).record, null, 2) + '\n')
        }
        const committed = JSON.parse(readFileSync(FIXTURE, 'utf8'))
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(committed)), A)).toEqual(committed)
        expect((await produce()).record).toEqual(committed)
        const text = JSON.stringify(committed)
        for (const path of ['backgroundHTML', 'virtualscript']) {
            expect(text, path).toContain(`"path":"${path}"`)
        }
        expect(text).toContain('"had":"foreign"')
        expect(Object.keys(committed.restore.fields)).toContain('backgroundHTML')
    })

    test('every step of the session undoes, and the character is back as it began', async () => {
        const { service, clock } = await session()
        const began = structuredClone(liveCharacter()) as unknown as Record<string, unknown>
        const results = [
            service.editText(A, 'backgroundHTML', 'h1 {{bg::grin}}', 'single'),
            service.editText(A, 'virtualscript', 'code', 'single'),
            service.assetMerge(A, mergeModel(), byPathOnly),
        ]
        for (const result of results) {
            expect(result.ok).toBe(true)
            clock.tick(60_000)
        }
        for (let left = results.length; left > 0; left--) {
            expect(service.undo(A).ok).toBe(true)
        }
        // The merge's undo leaves the retained-file marker for the removed row; every other key is back as it began.
        const now = liveCharacter() as unknown as Record<string, unknown>
        delete now[ASSET_RETAINED_KEY]
        expect(now).toEqual(began)
    })
})

describe('T4: a stored merge step on backgroundHTML keeps landing the same text (compatibility guard; passes before and after the router change)', () => {
    const merge = (offset: number, from: string, to: string): Op => ({ op: 'textEdit', target: 'backgroundHTML', offset, from, to })
    const step = (ops: Op[]): Step => ({ id: 'p:1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops })
    const live = (html: string) => ({ chaId: 'A', desc: '', firstMessage: '', alternateGreetings: [], chats: [], chatPage: 0, backgroundHTML: html }) as never
    const html = (character: unknown): string => (character as { backgroundHTML: string }).backgroundHTML

    test('the merge lands the spliced text, undo gives back the text before, and redo lands it again', () => {
        const character = live('{{bg::smile2}} tail')
        const ops = [merge(6, 'smile2', 'smile')]
        const writes = assetStepWrites(ops, createLiveReader({ character, chat: null }))
        applyCharacterWrites(character, writes ?? [], null)
        expect(html(character)).toBe('{{bg::smile}} tail')
        const undone = planReplay({ ...emptyRecord(A, 0), done: [step(ops)] }, 'undo', createLiveReader({ character, chat: null }))
        if (undone.ok === false) throw new Error(`undo refused: ${undone.reason}`)
        applyCharacterWrites(character, undone.writes, null)
        expect(html(character)).toBe('{{bg::smile2}} tail')
        const redone = planReplay({ ...emptyRecord(A, 0), undone: [step(ops)] }, 'redo', createLiveReader({ character, chat: null }))
        if (redone.ok === false) throw new Error(`redo refused: ${redone.reason}`)
        applyCharacterWrites(character, redone.writes, null)
        expect(html(character)).toBe('{{bg::smile}} tail')
    })

    test('a revert across a form edit and the merge reaches the first text', () => {
        const desc: Step = { id: 'p:0', at: 0, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'd1' } }] }
        const edit: Step = { id: 'p:1', at: 1, label: { kind: 'field', field: 'backgroundHTML' }, ops: [{ op: 'set', path: 'backgroundHTML', before: { had: true, value: 'a' }, after: { had: true, value: '{{bg::smile2}} tail' } }] }
        const merged: Step = { id: 'p:2', at: 2, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops: [merge(6, 'smile2', 'smile')] }
        const character = live('{{bg::smile}} tail')
        const plan = planRevert({ ...emptyRecord(A, 0), done: [desc, edit, merged] }, 'p:0', createLiveReader({ character, chat: null }))
        if (plan.ok === false) throw new Error(`revert refused: ${plan.reason}`)
        applyCharacterWrites(character, plan.writes, null)
        expect(html(character)).toBe('a')
    })
})
