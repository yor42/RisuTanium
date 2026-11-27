// @vitest-environment jsdom
// The portrait intents of the history service with the real model and the real writer, over a live character that is a
// `$state` proxy as in the application: add / replace with the picture's text notes inside the step, make main, remove,
// the durable undo of a removal after a reload, the removal refusals by phase, the mid-await owner guard, the replay file
// probe and the revert of a gone file. B-T1 .. B-T8 and B-T10 of the S3b plan.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, type ClaimDouble } from './studioStoreDoubles'
import { createControlStudioStore, type ControlStudioStore } from './studioStoreControlDouble'

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

const hash = (letter: string): string => `assets/${letter.repeat(64)}.png`
const M = hash('m')
const N = hash('n')
const P = hash('p')
const Q = hash('q')
const ROW_P = { type: 'icon', name: 'iconx', uri: P, ext: 'png' }
const ROW_Q = { type: 'x-risu-asset', name: 'second', uri: Q, ext: 'png' }
const demoted = (uri: string) => ({ type: 'icon', name: 'iconx', uri, ext: 'png' })
const FOLDER_DOC = { v: 1, note: 'a persisted folder document' }
const UNRELATED = { keep: ['me'] }

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex: number }[]
    chatPage: number
    image?: string
    ccAssets?: { type: string; uri: string; name: string; ext: string }[]
    extentions?: Record<string, unknown> | string
    coldstorage?: string
    [ASSET_RETAINED_KEY]?: unknown
}

function makeCharacter(over: Partial<LiveCharacter> = {}): LiveCharacter {
    const character = $state<LiveCharacter>({
        chaId: 'A',
        desc: 'd0',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        image: M,
        ccAssets: [{ ...ROW_P }],
        extentions: { [ASSET_FOLDER_KEY]: structuredClone(FOLDER_DOC), unrelated: structuredClone(UNRELATED) },
        ...over,
    })
    return character
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]
// The character as plain data, without the retained field: that field follows every asset write by design and has its own tests.
const plain = (): LiveCharacter => {
    const snapshot = $state.snapshot(live()) as LiveCharacter
    delete snapshot[ASSET_RETAINED_KEY]
    return snapshot
}
const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Session {
    clock: FakeClock
    store: ControlStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    asked: string[]
    answers: Map<string, 'present' | 'gone' | 'unknown'>
}

function open(shared?: Map<string, string>, withReader = false, claim: ClaimDouble = createClaimDouble()): Session {
    const clock = createFakeClock()
    const store = createControlStudioStore({ shared })
    const asked: string[] = []
    const answers = new Map<string, 'present' | 'gone' | 'unknown'>()
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        ...(withReader
            ? {
                  openAssetFileReader: async () => ({
                      concurrency: 1,
                      stateOf: async (path: string) => {
                          asked.push(path)
                          return answers.get(path) ?? 'present'
                      },
                  }),
              }
            : {}),
    })
    return { clock, store, claim, service, asked, answers }
}

let session: Session

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter()] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    session = open()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const ready = async (on: Session = session): Promise<void> => on.service.whenReady(A)
const settle = (): Promise<void> => drainMicrotasks()
const done = (on: Session = session) => on.service.view(A).done

function expectOk(result: StudioResult): void {
    if (result.ok === false) throw new Error(`refused: ${result.reason}`)
}

describe('B-T1: an add copies the picture\'s notes inside its step and changes nothing else', () => {
    test('the main becomes the new file, the old main joins the alternates, the notes join the exif map, the folder document and the other keys stay', async () => {
        await ready()
        const result = session.service.portraitAdd(A, N, { Title: 't', Comment: 'c' })
        expect(result).toMatchObject({ ok: true, pngChunks: 2 })
        const now = plain()
        expect(now.image).toBe(N)
        expect(now.ccAssets).toEqual([ROW_P, demoted(M)])
        expect(now.extentions).toEqual({ [ASSET_FOLDER_KEY]: FOLDER_DOC, unrelated: UNRELATED, pngExif: { Title: 't', Comment: 'c' } })
        expect(done()).toHaveLength(1)
        expect(done()[0].label).toEqual({ kind: 'portraitAdd' })
        expect(h.marks).toBeGreaterThan(0)
    })

    test('the ops of the step are plain data: they survive a structured clone although the live character is a state proxy', async () => {
        DBState.db.characters = [makeCharacter({ extentions: { pngExif: { Title: 'old' } } })] as unknown as typeof DBState.db.characters
        await ready()
        expectOk(session.service.portraitAdd(A, N, { Title: 't' }))
        const ops = done()[0].ops
        expect(() => structuredClone(ops)).not.toThrow()
        expect(JSON.parse(JSON.stringify(ops))).toEqual(ops)
    })

    test('the notes are assigned over an existing map key by key, not in place of it', async () => {
        DBState.db.characters = [makeCharacter({ extentions: { pngExif: { Title: 'old', Author: 'kept' }, unrelated: UNRELATED } })] as unknown as typeof DBState.db.characters
        await ready()
        expectOk(session.service.portraitAdd(A, N, { Title: 'new', Comment: 'c' }))
        expect((plain().extentions as Record<string, unknown>).pngExif).toEqual({ Title: 'new', Author: 'kept', Comment: 'c' })
    })

    test('an add with no notes writes no exif pair and reports none', async () => {
        await ready()
        const result = session.service.portraitAdd(A, N, {})
        expect(result.ok && result.pngChunks).toBeFalsy()
        expect(JSON.stringify(done()[0].ops)).not.toContain('pngExif')
        expect('pngExif' in (plain().extentions as Record<string, unknown>)).toBe(false)
    })

    test('an add over an empty main creates no alternates row and leaves an absent list absent', async () => {
        DBState.db.characters = [makeCharacter({ image: '', ccAssets: undefined })] as unknown as typeof DBState.db.characters
        delete (live() as { ccAssets?: unknown }).ccAssets
        await ready()
        expectOk(session.service.portraitAdd(A, N, {}))
        expect(plain().image).toBe(N)
        expect('ccAssets' in plain()).toBe(false)
    })

    test('a map or an extentions that is not a plain object is never written into: the add lands without the notes', async () => {
        for (const extentions of ['not an object', { pngExif: 'not a map' }]) {
            DBState.db.characters = [makeCharacter({ extentions: extentions as LiveCharacter['extentions'] })] as unknown as typeof DBState.db.characters
            const on = open()
            await on.service.whenReady(A)
            const before = plain()
            const result = on.service.portraitAdd(A, N, { Title: 't' })
            expectOk(result)
            expect(result.ok && result.pngChunks).toBeFalsy()
            expect(plain().extentions).toEqual(before.extentions)
            expect(plain().image).toBe(N)
        }
    })
})

describe('B-T2: undo and redo of an add', () => {
    test('undo gives back image, alternates and the folder document and other keys exactly, and redo lands the add again', async () => {
        await ready()
        const before = plain()
        expectOk(session.service.portraitAdd(A, N, { Title: 't' }))
        const added = plain()
        expectOk(session.service.undo(A))
        expect(plain()).toEqual(before)
        expectOk(session.service.redo(A))
        expect(plain()).toEqual(added)
    })

    test('undo restores an existing exif map and removes a map the add created', async () => {
        DBState.db.characters = [makeCharacter({ extentions: { pngExif: { Title: 'old' } } })] as unknown as typeof DBState.db.characters
        await ready()
        expectOk(session.service.portraitAdd(A, N, { Title: 'new' }))
        expectOk(session.service.undo(A))
        expect((plain().extentions as Record<string, unknown>).pngExif).toEqual({ Title: 'old' })

        DBState.db.characters = [makeCharacter()] as unknown as typeof DBState.db.characters
        const second = open()
        await second.service.whenReady(A)
        expectOk(second.service.portraitAdd(A, N, { Title: 'new' }))
        expectOk(second.service.undo(A))
        expect('pngExif' in (plain().extentions as Record<string, unknown>)).toBe(false)
    })

    test('undo of an add to a character with no alternates list removes the list again instead of leaving an empty one', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: undefined })] as unknown as typeof DBState.db.characters
        delete (live() as { ccAssets?: unknown }).ccAssets
        await ready()
        expectOk(session.service.portraitAdd(A, N, {}))
        expect(plain().ccAssets).toEqual([demoted(M)])
        expectOk(session.service.undo(A))
        expect('ccAssets' in plain()).toBe(false)
        expect(plain().image).toBe(M)
    })

    test('undo refuses when the exif map was replaced by a non-object after the add', async () => {
        await ready()
        expectOk(session.service.portraitAdd(A, N, { Title: 't' }))
        live().extentions = 'replaced'
        expect(session.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })
        expect(plain().image).toBe(N)
        expect(done()).toHaveLength(1)
    })
})

describe('B-T3: make main swaps as the classic panel does', () => {
    const files = (value: LiveCharacter): string[] => [value.image ?? '', ...(value.ccAssets ?? []).map((row) => row.uri)].sort()

    test('the alternate becomes main, the old main is appended as an alternate, and undo and redo keep every file named exactly once', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [{ ...ROW_P }, { ...ROW_Q }] })] as unknown as typeof DBState.db.characters
        await ready()
        const before = plain()
        expectOk(session.service.portraitMakeMain(A, 1))
        const swapped = plain()
        expect(swapped.image).toBe(Q)
        expect(swapped.ccAssets).toEqual([ROW_P, demoted(M)])
        expect(files(swapped)).toEqual(files(before))
        expect(done()[0].label).toEqual({ kind: 'portraitMain' })
        expectOk(session.service.undo(A))
        expect(plain()).toEqual(before)
        expectOk(session.service.redo(A))
        expect(plain()).toEqual(swapped)
        expect(files(plain())).toEqual(files(before))
    })

    test('an index that names no alternate is refused and writes nothing', async () => {
        await ready()
        const before = plain()
        expect(session.service.portraitMakeMain(A, 5)).toEqual({ ok: false, reason: 'precondition' })
        expect(plain()).toEqual(before)
        expect(done()).toHaveLength(0)
    })
})

describe('B-T4: removing the main photo promotes the first alternate; removing an alternate takes only that one', () => {
    test('with alternates the first one becomes main and leaves the list; undo puts both back', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [{ ...ROW_P }, { ...ROW_Q }] })] as unknown as typeof DBState.db.characters
        await ready()
        const before = plain()
        expectOk(session.service.portraitRemove(A, 'main'))
        expect(plain().image).toBe(P)
        expect(plain().ccAssets).toEqual([ROW_Q])
        expect(done()[0].label).toEqual({ kind: 'portraitRemove' })
        expectOk(session.service.undo(A))
        expect(plain()).toEqual(before)
    })

    test('without alternates the main is emptied and the list stays as it was', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: undefined })] as unknown as typeof DBState.db.characters
        delete (live() as { ccAssets?: unknown }).ccAssets
        await ready()
        expectOk(session.service.portraitRemove(A, 'main'))
        expect(plain().image).toBe('')
        expect('ccAssets' in plain()).toBe(false)
    })

    test('an alternate is removed by its stored index', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [{ ...ROW_P }, { ...ROW_Q }] })] as unknown as typeof DBState.db.characters
        await ready()
        expectOk(session.service.portraitRemove(A, 1))
        expect(plain().ccAssets).toEqual([ROW_P])
        expect(plain().image).toBe(M)
        expect(session.service.portraitRemove(A, 4)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('an unreadable portrait is never edited: a non-string image refuses every intent', async () => {
        DBState.db.characters = [makeCharacter({ image: 5 as unknown as string })] as unknown as typeof DBState.db.characters
        await ready()
        expect(session.service.portraitAdd(A, N, {})).toEqual({ ok: false, reason: 'precondition' })
        expect(session.service.portraitRemove(A, 'main')).toEqual({ ok: false, reason: 'precondition' })
        expect(session.service.portraitMakeMain(A, 0)).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('B-T5: a removal is durable across a reload', () => {
    test('the removed file stays named in the retained field, and after a reload Undo asks for it, finds it and brings the portrait back', async () => {
        await ready()
        const before = plain()
        expectOk(session.service.portraitRemove(A, 'main'))
        await settle()
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toContain(M)

        const reloaded = open(session.store.shared, true)
        await ready(reloaded)
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toContain(M)
        const undone = await reloaded.service.replay(A, { kind: 'undo' })
        expectOk(undone)
        expect(reloaded.asked).toContain(M)
        expect(plain().image).toBe(M)
        expect(plain().ccAssets).toEqual(before.ccAssets)
    })

    test('an add names the new file in the retained field too, so its Redo after a reload finds it', async () => {
        await ready()
        expectOk(session.service.portraitAdd(A, N, {}))
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toContain(N)
    })
})

describe('B-T6: removals are refused where history cannot persist; an add is not', () => {
    test('another tab holds the history: a removal is refused with the other-tab copy and changes nothing, while an add lands', async () => {
        const claim = createClaimDouble()
        claim.forced = 'held'
        const other = open(undefined, false, claim)
        await other.service.whenReady(A)
        const before = plain()
        const marks = h.marks
        expect(other.service.portraitRemove(A, 'main')).toEqual({ ok: false, reason: 'asset-other-tab-character' })
        expect(plain()).toEqual(before)
        expect(h.marks).toBe(marks)
        expect(other.service.view(A).done).toHaveLength(0)
        expectOk(other.service.portraitAdd(A, N, {}))
        expect(plain().image).toBe(N)
    })

    test('a store that refuses saves: the removal is refused with the no-undo copy', async () => {
        await ready()
        session.store.fallback = 'unwritable'
        expectOk(session.service.portraitAdd(A, N, {}))
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.service.view(A).banner).toBe('unwritable')
        const before = plain()
        expect(session.service.portraitRemove(A, 'main')).toEqual({ ok: false, reason: 'asset-no-undo' })
        expect(plain()).toEqual(before)
    })

    test('an unreadable retained field refuses the removal and nothing changes', async () => {
        live()[ASSET_RETAINED_KEY] = 'not pairs'
        await ready()
        const before = plain()
        expect(session.service.portraitRemove(A, 'main')).toEqual({ ok: false, reason: 'asset-no-undo' })
        expect(plain()).toEqual(before)
        expect(done()).toHaveLength(0)
    })

    test('a swap names every file it had, so it needs no working undo and lands in the other-tab phase', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [{ ...ROW_P }, { ...ROW_Q }] })] as unknown as typeof DBState.db.characters
        const claim = createClaimDouble()
        claim.forced = 'held'
        const other = open(undefined, false, claim)
        await other.service.whenReady(A)
        expectOk(other.service.portraitMakeMain(A, 0))
        expect(plain().image).toBe(P)
    })
})

describe('B-T7: the owner is checked again when the write is made', () => {
    test('a character archived, removed or deselected after the picture was stored is refused: nothing is written and no step is recorded', async () => {
        await ready()
        const before = plain()
        live().coldstorage = 'unit-A'
        expect(session.service.portraitAdd(A, N, { Title: 't' })).toEqual({ ok: false, reason: 'gone' })
        delete live().coldstorage

        // A removed character leaves nothing selected at the open selection.
        const kept = DBState.db.characters
        DBState.db.characters = [] as unknown as typeof DBState.db.characters
        expect(session.service.portraitAdd(A, N, { Title: 't' })).toEqual({ ok: false, reason: 'not-selected' })
        DBState.db.characters = kept

        studioScreen.chaId = 'B'
        expect(session.service.portraitAdd(A, N, { Title: 't' })).toEqual({ ok: false, reason: 'not-selected' })
        studioScreen.chaId = 'A'

        expect(plain()).toEqual(before)
        expect(done()).toHaveLength(0)
    })
})

describe('B-T8: a replay probes the files it would put back', () => {
    test('a synchronous undo that would put a file back has no answer for it and refuses', async () => {
        const reading = open(undefined, true)
        await reading.service.whenReady(A)
        expectOk(reading.service.portraitRemove(A, 'main'))
        const before = plain()
        expect(reading.service.undo(A)).toMatchObject({ ok: false, reason: 'asset-file-unchecked' })
        expect(plain()).toEqual(before)
    })

    test('an undo asks for the put-back path; a file read as present lands the step', async () => {
        const reading = open(undefined, true)
        await reading.service.whenReady(A)
        expectOk(reading.service.portraitRemove(A, 'main'))
        expectOk(await reading.service.replay(A, { kind: 'undo' }))
        expect(reading.asked).toEqual([M])
        expect(plain().image).toBe(M)
    })

    test('a file read as gone drops the step, leaves the portrait as it is and names the file as a portrait file', async () => {
        const reading = open(undefined, true)
        await reading.service.whenReady(A)
        expectOk(reading.service.portraitRemove(A, 'main'))
        const before = plain()
        reading.answers.set(M, 'gone')
        const result = await reading.service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true, dropped: true, goneRows: [M], goneKind: 'portrait' })
        expect(plain()).toEqual(before)
        expect(reading.service.view(A).done).toHaveLength(0)
    })

    test('a file whose state is unknown refuses the undo and keeps the step', async () => {
        const reading = open(undefined, true)
        await reading.service.whenReady(A)
        expectOk(reading.service.portraitRemove(A, 'main'))
        reading.answers.set(M, 'unknown')
        expect(await reading.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: false, reason: 'asset-file-unchecked' })
        expect(reading.service.view(A).done).toHaveLength(1)
    })

    test('B-T8 (c): a revert whose only work is to put back a gone alternate answers unchanged, naming the file as a portrait file', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [{ ...ROW_P }, { ...ROW_Q }] })] as unknown as typeof DBState.db.characters
        const reading = open(undefined, true)
        await reading.service.whenReady(A)
        expectOk(reading.service.editText(A, 'desc', 'd1', 'single'))
        const base = reading.service.view(A).done[0].id
        expectOk(reading.service.portraitRemove(A, 1))
        reading.answers.set(Q, 'gone')
        const before = plain()
        const result = await reading.service.replay(A, { kind: 'revert', stepId: base })
        expect(result).toMatchObject({ ok: true, unchanged: true, goneRows: [Q], goneKind: 'portrait' })
        expect(plain()).toEqual(before)
    })
})

describe('B-T10: the whole-value precondition and the already-in-place move, on the live character', () => {
    test('(a) a classic-side edit of the alternates refuses the undo and keeps the step', async () => {
        await ready()
        expectOk(session.service.portraitAdd(A, N, {}))
        live().ccAssets?.push({ type: 'icon', name: 'classic', uri: Q, ext: 'png' })
        expect(session.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })
        expect(done()).toHaveLength(1)
    })

    test('(b) a portrait already put back by hand moves the step instead of writing', async () => {
        await ready()
        expectOk(session.service.portraitAdd(A, N, {}))
        live().image = M
        live().ccAssets = [{ ...ROW_P }]
        const result = session.service.undo(A)
        expect(result).toMatchObject({ ok: true, already: 'undo' })
        expect(session.service.view(A).undone).toHaveLength(1)
    })

    test('(b2) the portrait is back but the exif map still holds the add: refused, not moved', async () => {
        await ready()
        expectOk(session.service.portraitAdd(A, N, { Title: 't' }))
        live().image = M
        live().ccAssets = [{ ...ROW_P }]
        const result = session.service.undo(A)
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(done()).toHaveLength(1)
        expect((plain().extentions as Record<string, unknown>).pngExif).toEqual({ Title: 't' })
    })

    test('(d) a revert across add and remove-main that ends on the starting portrait still restores the earlier exif map', async () => {
        DBState.db.characters = [makeCharacter({ ccAssets: [], extentions: { pngExif: { Title: 'E0' } } })] as unknown as typeof DBState.db.characters
        await ready()
        expectOk(session.service.editText(A, 'desc', 'd1', 'single'))
        const base = done()[0].id
        expectOk(session.service.portraitAdd(A, N, { Comment: 'E1' }))
        expectOk(session.service.portraitRemove(A, 'main'))
        expect(plain().image).toBe(M)
        expect(plain().ccAssets).toEqual([])
        expect((plain().extentions as Record<string, unknown>).pngExif).toEqual({ Title: 'E0', Comment: 'E1' })
        const result = session.service.revertTo(A, base)
        expect(result.ok && result.unchanged).toBeFalsy()
        expectOk(result)
        expect((plain().extentions as Record<string, unknown>).pngExif).toEqual({ Title: 'E0' })
        expect(plain().image).toBe(M)
        expect(plain().ccAssets).toEqual([])
    })
})
