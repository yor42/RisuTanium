// @vitest-environment jsdom
// The history service on a character's `emotionImages`, the calls the emotion-image list makes: one delete step with
// the file retained and the emotion cache cleared once, a bulk delete by stored index, the refusals before any write, a
// verbatim rename that touches no folder, Remove extras, and a merge that rewrites only emotion references. The
// service, history model and setters are real over the memory store double. Compatibility guards: the service is
// unchanged by the list that calls it, so these pass before and after it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { DEFAULT_SETTINGS, groupRow, hashPath } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { buildMergePreview } from 'src/ts/studio/assets/mergePreview'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0, cleared: [] as string[] }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: (chaId: string) => { h.cleared.push(chaId) },
    }
})

type Row = [string, ...string[]]

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    chats: { id: string, note: string, fmIndex?: number }[]
    chatPage: number
    customscript?: { in: string, out: string, type: string }[]
    additionalAssets: Row[]
    emotionImages: Row[]
    extentions?: Record<string, unknown>
    [ASSET_RETAINED_KEY]?: unknown
}

const A = characterOwnerKey('A')
const pA = hashPath('a', 'png')
const pB = hashPath('b', 'png')
const pC = hashPath('c', 'png')
const pD = hashPath('d', 'png')
const ASSETS = (): Row[] => [['a0', hashPath('x', 'png'), 'png'], ['a1', hashPath('y', 'png'), 'png']]
// A survivor check that finds one by path only: the rows these tests remove share a path with a row that stays.
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

function makeCharacter(emotionImages: Row[], over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        firstMessage: 'hello',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        additionalAssets: ASSETS(),
        emotionImages,
        ...over,
    }
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]
const emotions = (): string[][] => JSON.parse(JSON.stringify(live().emotionImages))
const assetsOf = (): string[][] => JSON.parse(JSON.stringify(live().additionalAssets))

function put(emotionImages: Row[], over: Partial<LiveCharacter> = {}): void {
    DBState.db.characters = [makeCharacter(emotionImages, over)] as unknown as typeof DBState.db.characters
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let service: OwnerHistoryService
let claim: ClaimDouble

async function start(configure?: (claimDouble: ClaimDouble) => void): Promise<void> {
    claim = createClaimDouble()
    configure?.(claim)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
    })
    await service.whenReady(A)
}

beforeEach(() => {
    h.marks = 0
    h.cleared.length = 0
    tracker.character.length = 0
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

describe('S1: a single delete', () => {
    test('is one step with the path retained, the cache cleared once, and an undo and redo that put the row back and take it out', async () => {
        put([['happy', pA], ['sad', pB], ['hat', pC]])
        await start()
        expect(service.assetDelete(A, 'emotionImages', [1]).ok).toBe(true)
        expect(emotions()).toEqual([['happy', pA], ['hat', pC]])
        expect(service.view(A).done).toHaveLength(1)
        expect(service.view(A).done[0].label).toEqual({ kind: 'assetDelete', count: 1, name: 'sad' })
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual([pB])
        expect(h.cleared).toEqual(['A'])
        expect(assetsOf()).toEqual(ASSETS())
        expect(service.undo(A)).toEqual({ ok: true })
        expect(emotions()).toEqual([['happy', pA], ['sad', pB], ['hat', pC]])
        expect(service.redo(A)).toEqual({ ok: true })
        expect(emotions()).toEqual([['happy', pA], ['hat', pC]])
    })
})

describe('S2: a bulk delete', () => {
    test('by stored indexes in any order, with a repeated tuple, is one step whose undo restores the order', async () => {
        put([['happy', pA], ['sad', pB], ['hat', pC], ['happy', pA]])
        await start()
        expect(service.assetDelete(A, 'emotionImages', [3, 0, 1]).ok).toBe(true)
        expect(emotions()).toEqual([['hat', pC]])
        expect(service.view(A).done).toHaveLength(1)
        expect(service.view(A).done[0].label).toEqual({ kind: 'assetDelete', count: 3, name: null })
        expect(assetsOf()).toEqual(ASSETS())
        expect(service.undo(A)).toEqual({ ok: true })
        expect(emotions()).toEqual([['happy', pA], ['sad', pB], ['hat', pC], ['happy', pA]])
    })
})

describe('S3: a refusal', () => {
    test.each([
        ['another tab holds the character', (claimDouble: ClaimDouble) => { claimDouble.forced = 'held' }, 'asset-other-tab-character'],
        ['history cannot be kept', (claimDouble: ClaimDouble) => { claimDouble.unsupported = true }, 'asset-no-undo'],
    ])('while %s refuses a delete before any write', async (_label, configure, reason) => {
        put([['happy', pA], ['sad', pB]])
        await start(configure)
        const marks = h.marks
        expect(service.assetDelete(A, 'emotionImages', [0])).toEqual({ ok: false, reason })
        expect(emotions()).toEqual([['happy', pA], ['sad', pB]])
        expect(service.view(A).done).toHaveLength(0)
        expect(h.marks).toBe(marks)
        expect(h.cleared).toEqual([])
        expect(live()[ASSET_RETAINED_KEY]).toBeUndefined()
    })
})

describe('S4: a rename', () => {
    test('is one row set with no folder operation and no text edit, and keeps the typed string verbatim', async () => {
        put([['happy', pA], ['sad', pB]])
        await start()
        expect(service.assetRename(A, 'emotionImages', 1, ' sad ').ok).toBe(true)
        expect(emotions()).toEqual([['happy', pA], [' sad ', pB]])
        const ops = service.view(A).done[0].ops.map((op) => op.op)
        expect(ops.filter((op) => op === 'assetRowSet')).toHaveLength(1)
        expect(ops.some((op) => op.startsWith('assetFolder'))).toBe(false)
        expect(ops).not.toContain('textEdit')
        expect(live().extentions).toBeUndefined()
    })

    test('to an empty name is refused and changes nothing', async () => {
        put([['happy', pA], ['sad', pB]])
        await start()
        const result = service.assetRename(A, 'emotionImages', 1, '')
        expect(result.ok).toBe(false)
        expect(emotions()).toEqual([['happy', pA], ['sad', pB]])
        expect(service.view(A).done).toHaveLength(0)
    })
})

describe('S5: Remove extras', () => {
    test('removes exactly the named stored row and keeps the other rows over the file', async () => {
        put([['smile', pA], ['calm', pA], ['smile', pA]])
        await start()
        expect(service.assetRemoveExtras(A, 'emotionImages', 'smile', [2], byPathOnly).ok).toBe(true)
        expect(emotions()).toEqual([['smile', pA], ['calm', pA]])
        expect(service.view(A).done).toHaveLength(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(emotions()).toEqual([['smile', pA], ['calm', pA], ['smile', pA]])
    })
})

describe('a merge of emotion rows', () => {
    const FIRST = 'Hi {{emotion::Happy}} and {{image::Happy}} {{emotion::other}}'
    const SCRIPT = (out: string) => [{ in: 'x', out, type: 'editdisplay' }]

    function modelOf(names: [string, string], keptName: string) {
        const source = live()
        const group = groupDuplicates(source.emotionImages.map((row, index) => groupRow(row[0], row[1], index)))
            .find((candidate) => candidate.cls === 'sameFileDifferentNames' && names.every((name) => candidate.rows.some((row) => row.name === name)))
        if (!group) throw new Error('no candidate group')
        return buildMergePreview({ kind: 'character', source }, 'emotion', group, keptName, [], DEFAULT_SETTINGS)
    }

    test('S6: of names that differ in case only rewrites the emotion references, leaves the image macro, and undoes whole', async () => {
        put([['Happy', pA], ['happy', pA], ['other', pD]], { firstMessage: FIRST, customscript: SCRIPT('@@emo Happy') })
        await start()
        expect(service.assetMerge(A, modelOf(['Happy', 'happy'], 'happy'), byPathOnly).ok).toBe(true)
        expect(emotions()).toEqual([['happy', pA], ['other', pD]])
        // The macro reads a name in any case, so it needs no rewrite; the script's `@@emo` reads it exactly.
        expect(live().customscript?.[0].out).toBe('@@emo happy')
        expect(live().firstMessage).toBe(FIRST)
        expect(assetsOf()).toEqual(ASSETS())
        expect(service.view(A).done).toHaveLength(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(live().customscript?.[0].out).toBe('@@emo Happy')
        expect(emotions()).toEqual([['Happy', pA], ['happy', pA], ['other', pD]])
    })

    test('S7: of names that differ in the extension only rewrites the emotion references too', async () => {
        put([['happy', pA], ['happy.png', pA]], { firstMessage: 'Hi {{emotion::happy.png}} and {{image::happy.png}}', customscript: SCRIPT('@@emo happy.png') })
        await start()
        expect(service.assetMerge(A, modelOf(['happy', 'happy.png'], 'happy'), byPathOnly).ok).toBe(true)
        expect(emotions()).toEqual([['happy', pA]])
        expect(live().firstMessage).toBe('Hi {{emotion::happy}} and {{image::happy.png}}')
        expect(live().customscript?.[0].out).toBe('@@emo happy')
        expect(service.undo(A)).toEqual({ ok: true })
        expect(emotions()).toEqual([['happy', pA], ['happy.png', pA]])
    })
})
