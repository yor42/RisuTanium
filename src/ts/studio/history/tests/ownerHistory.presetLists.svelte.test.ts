// @vitest-environment jsdom
// The list value kinds of the preset advanced form through the real history service, the real history model and the
// real preset adapter over a real `$state` database and the real `changeToPreset`: each list operation is one whole-list
// step that undo puts back exactly, a recorded list never aliases the live array, stop strings off is a stored `null`, a
// list is never accepted on a text, number or stored-kind path, and the history focus never picks a list that did not
// change.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn() }))

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { presetValueAllowed } from 'src/ts/studio/edit/presetFields'
import { withSearchTool } from 'src/ts/studio/edit/presetLists'
import { presetAdapter, presetOwnerKey, readPresetField } from 'src/ts/studio/edit/presetTarget'
import { presetNamed, seedPresetDb } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { readOwnerFields } from 'src/ts/studio/ownerFields'
import { changedFieldTarget } from 'src/ts/studio/historyFocus'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { fieldValueEquals, parseOwnerRecord, SET_PATHS_BY_KIND, textPathsFor, valuePathsFor, type FieldValue, type SetPath } from '../historyModel'
import { typeofKind, valueMatchesKind } from '../fieldAccess'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey, type StoredOwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { PRESET_S4C_PATHS } from './presetPaths.test-helpers'

let service: OwnerHistoryService
let clock: FakeClock
let ids: string[]
let keys: OwnerKey[]

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>
const FALLBACKS = (): Record<string, string[]> => ({ memory: [], emotion: [], translate: [], otherAx: [], model: [] })

function build(): void {
    clock = createFakeClock(1000)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
}

// Preset 0 is active; the working copy holds every list the way a loaded profile does.
function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a'), presetNamed('B', 'b'), presetNamed('C', 'c')], 0, 'a')
    keys = ids.map((id) => presetOwnerKey(id))
    dbBag().bias = [['x', 1]]
    dbBag().modelTools = []
    dbBag().formatingOrder = ['main', 'description', 'chats']
    dbBag().fallbackModels = FALLBACKS()
}

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    seed()
    build()
})

afterEach(() => {
    resetStudioScreenForTests()
})

const step = (owner: OwnerKey, path: SetPath, value: string[] | [string, number][]) => {
    const result = service.editField(owner, path, value, { coalesceKey: null })
    service.closeOpenStep(owner)
    return result
}

describe('S4c-T1: every list operation of an inactive preset is one step and undo restores the exact previous list', () => {
    test('add, edit, move, remove and clear on fallbackModels.memory of a slot with no container', () => {
        delete slotBag(1).fallbackModels
        const memory = (): unknown => readPresetField(ids[1], 'presetFallbackMemory')
        expect(memory()).toEqual({ had: true, value: [] })
        const history: string[][] = [[]]
        const run = (next: string[]): void => {
            expect(step(keys[1], 'presetFallbackMemory', next)).toEqual({ ok: true })
            history.push(next)
            expect(memory()).toEqual({ had: true, value: next })
        }
        run([''])
        run(['m1'])
        run(['m1', 'm2'])
        run(['m2', 'm1'])
        run(['m1'])
        run([])
        expect(service.view(keys[1]).done).toHaveLength(6)
        expect(slotBag(1).fallbackModels).toEqual({ memory: [], emotion: [], translate: [], otherAx: [], model: [] })
        for (let index = history.length - 2; index >= 0; index--) {
            expect(service.undo(keys[1])).toEqual({ ok: true })
            expect(memory()).toEqual({ had: true, value: history[index] })
        }
        expect(service.redo(keys[1])).toEqual({ ok: true })
        expect(memory()).toEqual({ had: true, value: [''] })
        // The other four lists of the container are untouched.
        expect(slotBag(1).fallbackModels).toMatchObject({ emotion: [], translate: [], otherAx: [], model: [] })
    })

    test('an edit that leaves the list as it is is no step', () => {
        slotBag(1).fallbackModels = { ...FALLBACKS(), memory: ['a'] }
        expect(step(keys[1], 'presetFallbackMemory', ['a'])).toEqual({ ok: true, unchanged: true })
        expect(service.view(keys[1]).done).toHaveLength(0)
    })

    test('typing in one entry coalesces into one step under a key and a discrete operation joins nothing', () => {
        slotBag(1).fallbackModels = { ...FALLBACKS(), memory: ['a'] }
        service.editField(keys[1], 'presetFallbackMemory', ['ab'], { coalesceKey: 'presetFallbackMemory:0' })
        clock.tick(50)
        service.editField(keys[1], 'presetFallbackMemory', ['abc'], { coalesceKey: 'presetFallbackMemory:0' })
        expect(service.view(keys[1]).done).toHaveLength(1)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(readPresetField(ids[1], 'presetFallbackMemory')).toEqual({ had: true, value: ['a'] })
    })
})

describe('S4c-T2: the active preset keeps its lists through a save and a switch', () => {
    test('a fallback list edited on the working copy survives changeToPreset away and back', () => {
        expect(step(keys[0], 'presetFallbackModel', ['gpt4o', 'claude'])).toEqual({ ok: true })
        expect(dbBag().fallbackModels).toMatchObject({ model: ['gpt4o', 'claude'] })
        expect(slotBag(0).fallbackModels).toBeUndefined()
        changeToPreset(1)
        expect(dbBag().fallbackModels).toEqual(FALLBACKS())
        changeToPreset(0)
        expect(dbBag().fallbackModels).toMatchObject({ model: ['gpt4o', 'claude'] })
        expect(slotBag(0).fallbackModels).toMatchObject({ model: ['gpt4o', 'claude'] })
    })

    test('bias and format order edited on the working copy survive too', () => {
        expect(step(keys[0], 'presetBias', [['x', 1], ['y', -101]])).toEqual({ ok: true })
        expect(step(keys[0], 'presetFormatingOrder', ['description', 'main', 'chats'])).toEqual({ ok: true })
        changeToPreset(1)
        changeToPreset(0)
        expect(dbBag().bias).toEqual([['x', 1], ['y', -101]])
        expect(dbBag().formatingOrder).toEqual(['description', 'main', 'chats'])
    })
})

describe('S4c-T3 (F6): a recorded list never aliases a live array', () => {
    test('mutating the live bias after an edit leaves the step as recorded: undo is refused, and restoring the live value lets it put the old list back', () => {
        expect(step(keys[0], 'presetBias', [['x', 2]])).toEqual({ ok: true })
        const live = dbBag().bias as [string, number][]
        live[0][1] = 9
        expect(service.undo(keys[0])).toEqual({ ok: false, reason: 'precondition' })
        live[0][1] = 2
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(dbBag().bias).toEqual([['x', 1]])
    })

    test('mutating the array the edit replaced (one an inactive slot or a save may still share) never changes the recorded before', () => {
        const replaced = dbBag().bias as [string, number][]
        expect(step(keys[0], 'presetBias', [['x', 2]])).toEqual({ ok: true })
        expect(dbBag().bias).not.toBe(replaced)
        replaced[0][1] = 99
        replaced.push(['late', 1])
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(dbBag().bias).toEqual([['x', 1]])
    })

    test('a read is a fresh copy and a write stores a fresh copy', () => {
        const first = readPresetField(ids[0], 'presetBias')
        const second = readPresetField(ids[0], 'presetBias')
        expect(first).toEqual(second)
        expect(first.had && second.had && first.value !== second.value).toBe(true)
        const input: [string, number][] = [['z', 3]]
        expect(step(keys[0], 'presetBias', input)).toEqual({ ok: true })
        expect(dbBag().bias).not.toBe(input)
        input[0][1] = 8
        expect(dbBag().bias).toEqual([['z', 3]])
    })

    test('mutating a list the user passed after the edit never changes the recorded step', () => {
        const list = ['a']
        expect(step(keys[1], 'presetFallbackEmotion', list)).toEqual({ ok: true })
        list.push('b')
        expect(readPresetField(ids[1], 'presetFallbackEmotion')).toEqual({ had: true, value: ['a'] })
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(readPresetField(ids[1], 'presetFallbackEmotion')).toEqual({ had: true, value: [] })
    })
})

describe('S4c-T4: stop strings on and off', () => {
    test('off is a stored null on the working copy and on a slot; null and absent both read not set; on is an empty list', () => {
        expect(readPresetField(ids[0], 'presetLocalStopStrings')).toEqual({ had: false })
        expect(service.clearField(keys[0], 'presetLocalStopStrings')).toEqual({ ok: true, unchanged: true })
        expect(step(keys[0], 'presetLocalStopStrings', [])).toEqual({ ok: true })
        expect(dbBag().localStopStrings).toEqual([])
        expect(service.clearField(keys[0], 'presetLocalStopStrings')).toEqual({ ok: true })
        expect(dbBag().localStopStrings).toBeNull()
        expect(readPresetField(ids[0], 'presetLocalStopStrings')).toEqual({ had: false })
        expect(step(keys[1], 'presetLocalStopStrings', ['STOP'])).toEqual({ ok: true })
        expect(service.clearField(keys[1], 'presetLocalStopStrings')).toEqual({ ok: true })
        expect(slotBag(1).localStopStrings).toBeNull()
        expect(readPresetField(ids[1], 'presetLocalStopStrings')).toEqual({ had: false })
    })

    test('undo of the off step puts the list back and redo turns it off again', () => {
        step(keys[1], 'presetLocalStopStrings', ['A', 'B'])
        service.clearField(keys[1], 'presetLocalStopStrings')
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotBag(1).localStopStrings).toEqual(['A', 'B'])
        expect(service.redo(keys[1])).toEqual({ ok: true })
        expect(slotBag(1).localStopStrings).toBeNull()
    })

    test('a clear on a preset owner is refused on a path outside the preset kind row', () => {
        expect(service.clearField(keys[0], 'desc')).toEqual({ ok: false, reason: 'precondition' })
        expect(service.clearField(keys[0], 'bias')).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a clear on a character or module owner is refused on a path its row carries and writes nothing', async () => {
        ;(DBState.db.modules as unknown as Record<string, unknown>[]) = [{ id: 'M1', name: 'm', description: '', lowLevelAccess: false, customModuleToggle: 'T' }]
        ;(DBState.db.characters as unknown as Record<string, unknown>[]) = [{ chaId: 'c1', type: 'character', name: 'c', desc: 'D', chats: [{ id: 'chat1', name: 'x', message: [], note: '', localLore: [] }], chatPage: 0, firstMessage: '', alternateGreetings: [], customModuleToggle: 'T' }]
        selIdState.selId = 0
        studioScreen.chaId = 'c1'
        await service.whenReady(moduleOwnerKey('M1'))
        await service.whenReady(characterOwnerKey('c1'))
        const before = JSON.stringify(DBState.db)
        for (const owner of [characterOwnerKey('c1'), moduleOwnerKey('M1')]) {
            expect(service.clearField(owner, 'customModuleToggle'), `${owner} customModuleToggle`).toEqual({ ok: false, reason: 'precondition' })
            expect(service.clearField(owner, 'desc'), `${owner} desc`).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('a clear of a keeps list on the active copy is refused and nothing changes', () => {
        const before = JSON.stringify(DBState.db)
        expect(service.clearField(keys[0], 'presetFormatingOrder')).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})

describe('S4c-T5: model tools and format order keep what they do not own', () => {
    test('the search switch keeps an unknown stored entry in both directions', () => {
        slotBag(1).modelTools = ['search', 'x']
        expect(withSearchTool(['search', 'x'], false)).toEqual(['x'])
        expect(withSearchTool(['x'], true)).toEqual(['x', 'search'])
        expect(step(keys[1], 'presetModelTools', withSearchTool(['search', 'x'], false))).toEqual({ ok: true })
        expect(slotBag(1).modelTools).toEqual(['x'])
        expect(step(keys[1], 'presetModelTools', withSearchTool(['x'], true))).toEqual({ ok: true })
        expect(slotBag(1).modelTools).toEqual(['x', 'search'])
    })

    test('an absent model tools list reads as an empty one', () => {
        delete slotBag(1).modelTools
        expect(readPresetField(ids[1], 'presetModelTools')).toEqual({ had: true, value: [] })
    })

    test('port arm: the format order offers only the known items, and an unknown item already in the list may be moved', () => {
        expect(presetValueAllowed('presetFormatingOrder', ['main', 'foo'])).toBe(false)
        expect(presetValueAllowed('presetFormatingOrder', ['main', 'foo'], ['foo', 'main'])).toBe(true)
        expect(presetValueAllowed('presetFormatingOrder', ['main', 'chats'])).toBe(true)
        slotBag(1).formatingOrder = ['main', 'foo']
        expect(readPresetField(ids[1], 'presetFormatingOrder')).toEqual({ had: true, value: ['main', 'foo'] })
        expect(step(keys[1], 'presetFormatingOrder', ['foo', 'main'])).toEqual({ ok: true })
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotBag(1).formatingOrder).toEqual(['main', 'foo'])
    })

    test('port arm: a bias value outside -101..100 and a non-finite one are refused, a list on a text path is refused', () => {
        expect(presetValueAllowed('presetBias', [['a', -101]])).toBe(true)
        expect(presetValueAllowed('presetBias', [['a', 100]])).toBe(true)
        expect(presetValueAllowed('presetBias', [['a', 101]])).toBe(false)
        expect(presetValueAllowed('presetBias', [['a', Number.NaN]])).toBe(false)
        expect(presetValueAllowed('presetMainPrompt', ['x'])).toBe(false)
        expect(presetValueAllowed('presetTemperature', [1])).toBe(false)
    })
})

describe('S4c-T7: lists compare structurally', () => {
    const list = (value: string[] | [string, number][]): FieldValue => ({ had: true, value })
    test('equal lists are equal, a changed element or tuple member is not, and an unchanged edit is no step', () => {
        expect(fieldValueEquals(list(['a', 'b']), list(['a', 'b']))).toBe(true)
        expect(fieldValueEquals(list(['a', 'b']), list(['a', 'c']))).toBe(false)
        expect(fieldValueEquals(list(['a']), list(['a', 'b']))).toBe(false)
        expect(fieldValueEquals(list([['a', 1]]), list([['a', 1]]))).toBe(true)
        expect(fieldValueEquals(list([['a', 1]]), list([['a', 2]]))).toBe(false)
        expect(fieldValueEquals(list([['a', 1]]), list([['b', 1]]))).toBe(false)
        expect(step(keys[0], 'presetBias', [['x', 1]])).toEqual({ ok: true, unchanged: true })
        expect(service.view(keys[0]).done).toHaveLength(0)
    })
})

describe('S4c-T8: a list is accepted on no other path or kind', () => {
    test('a list on a text, bool or number path is refused by the service and the adapter, a number on a list path too', () => {
        const before = JSON.stringify(DBState.db)
        expect(service.editField(keys[0], 'presetMainPrompt', ['x'] as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetSendName', ['x'] as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetTemperature', ['x'] as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetModelTools', 5 as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetModelTools', 'search' as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetBias', [['a', Number.POSITIVE_INFINITY]])).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetBias', [['a', 1, 2]] as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(keys[0], 'presetFallbackModel', [1] as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editText(keys[0], 'presetModelTools', 'search')).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetModelTools', true)).toEqual({ ok: false, reason: 'precondition' })
        expect(presetAdapter.write(ids[0], [{ op: 'set', path: 'presetBias', value: { had: true, value: [['a', Number.NaN]] } }])).toBe(false)
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(service.view(keys[0]).done).toHaveLength(0)
    })

    test('a list path is not an op of any stored owner kind, and an editField of one under a module or character owner is refused', async () => {
        const module = moduleOwnerKey('M1')
        const character = characterOwnerKey('c1')
        ;(DBState.db.modules as unknown as Record<string, unknown>[]) = [{ id: 'M1', name: 'm', description: '', lowLevelAccess: false }]
        ;(DBState.db.characters as unknown as Record<string, unknown>[]) = [{ chaId: 'c1', type: 'character', name: 'c', desc: '', chats: [{ id: 'chat1', name: 'x', message: [], note: '', localLore: [] }], chatPage: 0, firstMessage: '', alternateGreetings: [] }]
        selIdState.selId = 0
        studioScreen.chaId = 'c1'
        await service.whenReady(module)
        await service.whenReady(character)
        const snapshot = JSON.stringify(DBState.db)
        for (const owner of [module, character]) {
            for (const path of PRESET_S4C_PATHS as readonly SetPath[]) {
                const value = path === 'presetBias' ? [['a', 1]] : ['a']
                expect(service.editField(owner, path, value as never), `${owner} ${path}`).toEqual({ ok: false, reason: 'precondition' })
                expect(service.clearField(owner, path), `${owner} ${path} clear`).toEqual({ ok: false, reason: 'precondition' })
            }
            expect(service.view(owner).done, owner).toHaveLength(0)
        }
        expect(JSON.stringify(DBState.db)).toBe(snapshot)
    })

    test('a stored record that holds a list on a text path, a list of non-strings or a non-finite bias value is refused whole', () => {
        const CHARACTER = characterOwnerKey('c1')
        const MODULE = moduleOwnerKey('m1')
        const read = (key: StoredOwnerKey, path: string, value: unknown) =>
            parseOwnerRecord({ ownerKey: key, touchedAt: 4, done: [{ id: 'p:1', at: 1, label: { kind: 'field', field: path }, ops: [{ op: 'set', path, before: { had: false }, after: { had: true, value } }] }], undone: [], deleted: [], restore: null }, key)
        for (const [path, value] of [['desc', ['x']], ['firstMessage', ['x']], ['hideChatIcon', ['x']], ['bias', [['a', null]]], ['bias', [['a', 1e999]]], ['bias', ['a']], ['bias', [['a', 1, 2]]]] as const) {
            expect(read(CHARACTER, path, value), `${path} ${JSON.stringify(value)}`).toBeNull()
        }
        // The two list kinds are the preset session kind's: a stored kind refuses its paths whatever the value.
        for (const path of PRESET_S4C_PATHS) {
            expect(read(CHARACTER, path, path === 'presetBias' ? [['a', 1]] : ['a']), path).toBeNull()
            expect(read(MODULE, path, path === 'presetBias' ? [['a', 1]] : ['a']), path).toBeNull()
        }
        // The character's own bias list keeps reading.
        expect(read(CHARACTER, 'bias', [['a', 1]])).not.toBeNull()
    })

    test('the kind helpers: a text list is strings only, a bias list rows only, neither is a text, bool or number value', () => {
        expect(valueMatchesKind('presetModelTools', ['a', ''])).toBe(true)
        expect(valueMatchesKind('presetModelTools', [])).toBe(true)
        expect(valueMatchesKind('presetModelTools', ['a', 1])).toBe(false)
        expect(valueMatchesKind('presetModelTools', 'a')).toBe(false)
        expect(valueMatchesKind('presetBias', [['a', 1]])).toBe(true)
        expect(valueMatchesKind('presetBias', [['a', Number.NaN]])).toBe(false)
        expect(valueMatchesKind('presetBias', ['a'])).toBe(false)
        expect(valueMatchesKind('presetMainPrompt', ['a'])).toBe(false)
        expect(valueMatchesKind('presetSendName', ['a'])).toBe(false)
        expect(valueMatchesKind('presetTemperature', ['a'])).toBe(false)
        expect(typeofKind('presetModelTools')).toBeNull()
        for (const path of PRESET_S4C_PATHS) {
            expect(textPathsFor('preset'), path).not.toContain(path)
            expect(valuePathsFor('preset'), path).not.toContain(path)
            expect(SET_PATHS_BY_KIND.preset, path).toContain(path)
            for (const kind of ['character', 'chat', 'module'] as const) expect(SET_PATHS_BY_KIND[kind], `${kind} ${path}`).not.toContain(path)
        }
    })
})
describe('S4c-T12: the history focus never names a list that did not change', () => {
    test('editing the bias of an inactive preset with model tools and fallback lists set, then undo, focuses the bias', () => {
        slotBag(1).modelTools = ['search']
        slotBag(1).fallbackModels = { ...FALLBACKS(), memory: ['m'], model: ['gpt4o'] }
        slotBag(1).formatingOrder = ['main', 'chats']
        slotBag(1).bias = [['t', 1]]
        expect(step(keys[1], 'presetBias', [['t', 2]])).toEqual({ ok: true })
        const before = readOwnerFields(keys[1])
        expect(before).not.toBeNull()
        expect(service.undo(keys[1])).toEqual({ ok: true })
        const after = readOwnerFields(keys[1])
        expect(after).not.toBeNull()
        if (before === null || after === null) throw new Error('unreachable')
        expect(changedFieldTarget(before, after)).toEqual({ kind: 'presetBias' })
        expect(changedFieldTarget(after, after)).toBeNull()
    })
})
