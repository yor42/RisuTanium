// @vitest-environment jsdom
// The records of the Studio S3a paths. A-T12: the real service writes steps on the ten new paths (the name, the Display
// form's paths, the mode switch and the four `newGenData` keys); the record equals the committed fixture, reads back
// through the strict parser and every step undoes. A-T10 and A-T11: a merge step on `newGenData/<key>` replays to the same
// landed text as before the router change, and the restore point learns the merged text. The file is rewritten only with
// RISU_WRITE_S3A_RECORDS=1.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { applyCharacterWrites, createLiveReader } from '../../edit/studioSetters'
import { assetStepWrites, deriveRestoreWrites, emptyRecord, parseOwnerRecord, planReplay, planRevert, textBeforeOf, textWriteFor, type Op, type Step } from '../historyModel'
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

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 's3aRecords.json')
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

function character(): ReturnType<typeof makeCharacter> {
    return { ...makeCharacter(), name: 'Alice', viewScreen: 'none', image: 'img.png', type: 'character' } as unknown as ReturnType<typeof makeCharacter>
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

// One step per new shape through the real service: the rename, each Display path and the mode switches.
async function produce(): Promise<{ record: unknown; steps: number }> {
    const { service, clock } = await session()
    const lap = (): void => clock.tick(60_000)
    const run = (result: ReturnType<OwnerHistoryService['editField']>): void => {
        if (!result.ok) throw new Error(`step refused: ${JSON.stringify(result)}`)
        lap()
    }
    run(service.editText(A, 'name', 'Alicia', 'single'))
    run(service.editField(A, 'largePortrait', true))
    run(service.screenMode(A, { viewScreen: 'emotion' }))
    run(service.screenMode(A, { inlay: true }))
    run(service.editText(A, 'newGenData.emotionInstructions', 'my own wording', 'single'))
    run(service.screenMode(A, { viewScreen: 'imggen' }))
    run(service.editText(A, 'newGenData.prompt', 'a prompt', 'single'))
    run(service.editField(A, 'prebuiltAssetCommand', true))
    run(service.editText(A, 'prebuiltAssetStyle', 'dynamic', 'single'))
    const view = service.view(A)
    return { record: JSON.parse(JSON.stringify({ ownerKey: A, touchedAt: clock.now(), done: view.done, undone: view.undone, deleted: view.deleted, restore: view.restore })), steps: view.done.length }
}

describe('A-T12: the records the S3a writer produces (the writer needs the S3a paths; the fixture is parsed by the current strict parser)', () => {
    test('they equal the committed fixture and read back through the strict parser', async () => {
        const produced = await produce()
        if (process.env.RISU_WRITE_S3A_RECORDS === '1') {
            writeFileSync(FIXTURE, JSON.stringify(produced.record, null, 2) + '\n')
        }
        const committed = JSON.parse(readFileSync(FIXTURE, 'utf8'))
        expect(produced.record).toEqual(committed)
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(committed)), A)).toEqual(committed)
        const text = JSON.stringify(committed)
        for (const path of ['name', 'largePortrait', 'viewScreen', 'inlayViewScreen', 'newGenData.prompt', 'newGenData.emotionInstructions', 'prebuiltAssetCommand', 'prebuiltAssetStyle']) {
            expect(text, path).toContain(`"path":"${path}"`)
        }
    })

    test('every step of the session undoes, and the character is back as it began', async () => {
        const { service, clock } = await session()
        const began = structuredClone(liveCharacter()) as unknown as Record<string, unknown>
        const steps: ReturnType<OwnerHistoryService['editField']>[] = [
            service.editText(A, 'name', 'Alicia', 'single'),
            service.screenMode(A, { viewScreen: 'emotion' }),
            service.editText(A, 'newGenData.emotionInstructions', 'mine', 'single'),
            service.editField(A, 'largePortrait', true),
            service.editField(A, 'prebuiltAssetCommand', true),
            service.editText(A, 'prebuiltAssetStyle', 'dynamic', 'single'),
        ]
        for (const step of steps) {
            expect(step.ok).toBe(true)
            clock.tick(60_000)
        }
        for (let left = steps.length; left > 0; left--) {
            expect(service.undo(A).ok).toBe(true)
        }
        const now = liveCharacter() as unknown as Record<string, unknown>
        const gen = now.newGenData as Record<string, string> | undefined
        expect(gen === undefined || Object.values(gen).every((value) => value === '')).toBe(true)
        delete now.newGenData
        expect(now).toEqual(began)
    })
})

describe('A-T10: a merge step on newGenData/prompt keeps landing the same text (compatibility guard)', () => {
    const merge = (offset: number, from: string, to: string): Op => ({ op: 'textEdit', target: 'newGenData/prompt', offset, from, to })
    const step = (ops: Op[]): Step => ({ id: 'p:1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops })
    const live = (prompt: string) => ({ chaId: 'A', desc: '', firstMessage: '', alternateGreetings: [], chats: [], chatPage: 0, newGenData: { prompt, negative: '', instructions: '', emotionInstructions: '' } }) as never

    test('the merge lands the spliced text, undo gives back the text before, and redo lands it again', () => {
        const character = live('{{image::smile2}} tail')
        const ops = [merge(9, 'smile2', 'smile')]
        const writes = assetStepWrites(ops, createLiveReader({ character, chat: null }))
        applyCharacterWrites(character, writes ?? [], null)
        expect((character as { newGenData: { prompt: string } }).newGenData.prompt).toBe('{{image::smile}} tail')
        const record = { ...emptyRecord(A, 0), done: [step(ops)] }
        const undone = planReplay(record, 'undo', createLiveReader({ character, chat: null }))
        if (undone.ok === false) throw new Error(`undo refused: ${undone.reason}`)
        applyCharacterWrites(character, undone.writes, null)
        expect((character as { newGenData: { prompt: string } }).newGenData.prompt).toBe('{{image::smile2}} tail')
        const redone = planReplay({ ...emptyRecord(A, 0), undone: [step(ops)] }, 'redo', createLiveReader({ character, chat: null }))
        if (redone.ok === false) throw new Error(`redo refused: ${redone.reason}`)
        applyCharacterWrites(character, redone.writes, null)
        expect((character as { newGenData: { prompt: string } }).newGenData.prompt).toBe('{{image::smile}} tail')
    })

    test('a revert across a form edit and the merge reaches the first text through the net set', () => {
        const desc: Step = { id: 'p:0', at: 0, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'd1' } }] }
        const edit: Step = { id: 'p:1', at: 1, label: { kind: 'field', field: 'newGenData.prompt' }, ops: [{ op: 'set', path: 'newGenData.prompt', before: { had: true, value: 'a' }, after: { had: true, value: '{{image::smile2}} tail' } }] }
        const merged: Step = { id: 'p:2', at: 2, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops: [merge(9, 'smile2', 'smile')] }
        const character = live('{{image::smile}} tail')
        const plan = planRevert({ ...emptyRecord(A, 0), done: [desc, edit, merged] }, 'p:0', createLiveReader({ character, chat: null }))
        if (plan.ok === false) throw new Error(`revert refused: ${plan.reason}`)
        applyCharacterWrites(character, plan.writes, null)
        expect((character as { newGenData: { prompt: string } }).newGenData.prompt).toBe('a')
        expect(plan.ops.some((op) => op.op === 'textEdit')).toBe(false)
    })

    test('the router decides the write: a newGenData target is a set, another nested text stays a textSet', () => {
        expect(textWriteFor('newGenData/prompt', 'v')).toEqual({ op: 'set', path: 'newGenData.prompt', value: { had: true, value: 'v' } })
        expect(textWriteFor('backgroundHTML', 'v')).toEqual({ op: 'textSet', target: 'backgroundHTML', value: 'v' })
    })
})

describe('A-T11: the restore point learns a merged newGenData text (regression reproducer)', () => {
    test('a merge textEdit gives a restore write for the field carrying the merged text', () => {
        const ops: Op[] = [{ op: 'textEdit', target: 'newGenData/prompt', offset: 9, from: 'smile2', to: 'smile' }]
        const character = { newGenData: { prompt: '{{image::smile2}} tail', negative: '', instructions: '', emotionInstructions: '' } } as never
        const before = textBeforeOf((path) => createLiveReader({ character, chat: null }).field(path))
        expect(before['newGenData.prompt']).toBe('{{image::smile2}} tail')
        const writes = deriveRestoreWrites(ops, null, { 'newGenData.prompt': '{{image::smile2}} tail' })
        expect(writes).toEqual([{ path: 'newGenData.prompt', before: { had: true, value: '{{image::smile2}} tail' }, after: { had: true, value: '{{image::smile}} tail' } }])
    })
})
