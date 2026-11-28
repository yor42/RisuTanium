// @vitest-environment jsdom
// The mixed-revert refusal follows the lists that hold an obj op in the range: a merge text edit under `regex/` next
// to a lore `objSet` plans and applies, and next to a regex `objSet` the whole range is refused with the regex key.
// Real service, real history model and real setters over the memory store double.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { MergePreview } from 'src/ts/studio/assets/mergePreview'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { build, fieldEdit, liveCharacter, makeCharacter, putCharacter, rows, textEdit } from './objService.test-helpers'

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

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }
const SMILE = ['smile', 'assets/smile.png', 'png']

let service: OwnerHistoryService

interface LiveRegexCharacter {
    customscript: { comment: string; in: string; out: string; type: string }[]
}

const regexText = (): string => (liveCharacter() as unknown as LiveRegexCharacter).customscript[0].out

// A merge of one text edit under the regex prefix: no row is removed.
function regexTextMerge(): MergePreview {
    return {
        ownerKind: 'character',
        kind: 'asset',
        keptName: 'smile',
        removedNames: ['smile2'],
        array: 'additionalAssets',
        rowOps: [],
        keptRows: [[...SMILE]],
        missingRows: [],
        folderOps: [],
        textEdits: [{ target: 'regex/0/out', offset: 13, from: 'smile2', to: 'smile' }],
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

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({
        ...makeCharacter({ globalLore: rows(2) }),
        additionalAssets: [[...SMILE], ['smile2', 'assets/smile.png', 'png']],
        customscript: [{ comment: 'c0', in: 'a', out: 'see {{image::smile2}}', type: 'editoutput' }],
    })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
})

afterEach(() => {
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function openRange(): string {
    expect(service.editField(A, 'desc', 'anchor').ok).toBe(true)
    return service.view(A).done[0].id
}

describe('M-MIX: the mixed-revert refusal names only lists that hold an obj op in the range', () => {
    test('a lore objSet and a merge text edit under regex/ revert in one go', () => {
        const anchor = openRange()
        expect(service.objEdit(A, textEdit(0, 'comment', 'lore edit')).ok).toBe(true)
        expect(service.assetMerge(A, regexTextMerge(), byPathOnly).ok).toBe(true)
        expect(regexText()).toBe('see {{image::smile}}')
        expect(service.revertTo(A, anchor)).toEqual({ ok: true })
        expect(regexText()).toBe('see {{image::smile2}}')
        expect((liveCharacter().globalLore as { comment: string }[])[0].comment).toBe('Row 0')
    })

    test('a regex objSet and the same merge text edit refuse the range with the regex mixed key and write nothing', () => {
        const anchor = openRange()
        expect(service.objEdit(A, build(
            [{ op: 'objSet', list: 'regex', index: 0, field: 'comment', after: { had: true, value: 'renamed' } }],
            { kind: 'obj', list: 'regex', action: 'edit', name: 'c0', field: 'comment' },
        )).ok).toBe(true)
        expect(service.assetMerge(A, regexTextMerge(), byPathOnly).ok).toBe(true)
        const before = JSON.stringify(liveCharacter())
        expect(service.revertTo(A, anchor)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'regex', kind: 'mixed' } })
        expect(JSON.stringify(liveCharacter())).toBe(before)
    })

    test('a lore objSet and a merge text edit under lore/ is still refused with the lore mixed key', () => {
        const anchor = openRange()
        expect(service.objEdit(A, fieldEdit(0, 'content', { had: true, value: 'see {{image::smile2}}' })).ok).toBe(true)
        const merge = regexTextMerge()
        merge.textEdits = [{ target: 'lore/0/content', offset: 13, from: 'smile2', to: 'smile' }]
        expect(service.assetMerge(A, merge, byPathOnly).ok).toBe(true)
        expect(service.revertTo(A, anchor)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'mixed' } })
    })
})
