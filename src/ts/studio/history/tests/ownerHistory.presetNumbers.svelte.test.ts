// @vitest-environment jsdom
// The number value kind of the preset advanced form through the real history service, the real history model and the
// real preset adapter over a real `$state` database and the real `changeToPreset`: a number edit lands on the copy that
// is live now, text edits never reach a number path, replay and restore put numbers and the optional keys back, a drag
// is one coalesced step, and a number is never accepted on a stored owner kind's path.
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
import { presetAdapter, presetOwnerKey, readPresetField } from 'src/ts/studio/edit/presetTarget'
import { presetNamed, seedPresetDb } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { PRESET_S4B_NUMBER_PATHS } from './presetPaths.test-helpers'
import type { SetPath } from '../historyModel'

let service: OwnerHistoryService
let clock: FakeClock
let ids: string[]
let keys: OwnerKey[]

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>

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

function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a'), presetNamed('B', 'b'), presetNamed('C', 'c')], 0, 'a')
    keys = ids.map((id) => presetOwnerKey(id))
    dbBag().temperature = 77
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

describe('S4b-T3: the number path takes numbers only', () => {
    test('editText of a string is refused precondition, editValue of the number lands, editValue of a string is refused', () => {
        const before = JSON.stringify(DBState.db)
        expect(service.editText(keys[0], 'presetTemperature', '80', 'single')).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetTemperature', '80' as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetTemperature', Number.NaN)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetTemperature', Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(service.editValue(keys[0], 'presetTemperature', 80)).toEqual({ ok: true })
        expect(dbBag().temperature).toBe(80)
        expect(service.view(keys[0]).done).toHaveLength(1)
    })

    test('a bool or a number on a text path and a text on a bool path stay refused', () => {
        expect(service.editValue(keys[0], 'presetMainPrompt', 5)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetSendName', 5)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[0], 'presetTemperature', true)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a preset temperature edit asks no risky-flag confirmation', () => {
        expect(service.editValue(keys[1], 'presetTemperature', 90)).toEqual({ ok: true })
        expect(service.editValue(keys[0], 'presetTemperature', 91)).toEqual({ ok: true })
    })

    test('a number path of the preset is not an op of any stored owner kind', async () => {
        const module = moduleOwnerKey('M1')
        const character = characterOwnerKey('c1')
        ;(DBState.db.modules as unknown as Record<string, unknown>[]) = [{ id: 'M1', name: 'm', description: '', lowLevelAccess: false }]
        ;(DBState.db.characters as unknown as Record<string, unknown>[]) = [{ chaId: 'c1', type: 'character', name: 'c', desc: '', chats: [{ id: 'chat1', name: 'x', message: [], note: '', localLore: [] }], chatPage: 0, firstMessage: '', alternateGreetings: [] }]
        selIdState.selId = 0
        studioScreen.chaId = 'c1'
        await service.whenReady(module)
        await service.whenReady(character)
        const snapshot = JSON.stringify(DBState.db)
        const paths: SetPath[] = ['moduleLowLevelAccess', 'moduleHideIcon', 'lowLevelAccess', 'hideChatIcon', 'utilityBot', 'escapeOutput', ...(PRESET_S4B_NUMBER_PATHS as readonly SetPath[])]
        for (const owner of [module, character]) {
            for (const path of paths) {
                expect(service.editValue(owner, path, 1), `${owner} ${path}`).toEqual({ ok: false, reason: 'precondition' })
                expect(service.editValue(owner, path, 0), `${owner} ${path} zero`).toEqual({ ok: false, reason: 'precondition' })
            }
            expect(service.view(owner).done, owner).toHaveLength(0)
        }
        expect(JSON.stringify(DBState.db)).toBe(snapshot)
    })
})

describe('S4b-T4: a number lands on the copy that is live now', () => {
    test('an inactive temperature edit sets the slot, leaves the working value, and a switch applies it; disable writes -1000', () => {
        slotBag(1).temperature = 50
        expect(service.editValue(keys[1], 'presetTemperature', 90)).toEqual({ ok: true })
        expect(slotBag(1).temperature).toBe(90)
        expect(dbBag().temperature).toBe(77)
        expect(service.editValue(keys[1], 'presetTemperature', -1000)).toEqual({ ok: true })
        expect(slotBag(1).temperature).toBe(-1000)
        changeToPreset(1)
        expect(dbBag().temperature).toBe(-1000)
    })

    test('the form port accepts the off sentinel only on a disableable path and keeps ranges and options', () => {
        expect(presetValueAllowed('presetTemperature', -1000)).toBe(true)
        expect(presetValueAllowed('presetTemperature', 201)).toBe(false)
        expect(presetValueAllowed('presetMaxContext', -1000)).toBe(false)
        expect(presetValueAllowed('presetMaxResponse', 2049)).toBe(false)
        expect(presetValueAllowed('presetThinkingTokens', -1)).toBe(true)
        expect(presetValueAllowed('presetReasonEffort', 3)).toBe(true)
        expect(presetValueAllowed('presetReasonEffort', 7)).toBe(false)
        expect(presetValueAllowed('presetVerbosity', 1.5)).toBe(false)
        expect(presetValueAllowed('presetMaxThoughtTagDepth', 2.5)).toBe(false)
        expect(presetValueAllowed('presetMaxThoughtTagDepth', -1)).toBe(true)
        expect(presetValueAllowed('presetThinkingType', 'adaptive')).toBe(true)
        expect(presetValueAllowed('presetThinkingType', 'other')).toBe(false)
        expect(presetValueAllowed('presetTemperature', '80')).toBe(false)
    })

    test('an edit that sets the value the copy already holds is no step', () => {
        expect(service.editValue(keys[0], 'presetTemperature', 77)).toEqual({ ok: true, unchanged: true })
        expect(service.view(keys[0]).done).toHaveLength(0)
    })
})

describe('S4b-T5: the reasoning effort alias', () => {
    test('active writes the working reasoningEffort, inactive writes the slot reasonEffort, and an absent slot reads 0', () => {
        expect(service.editValue(keys[0], 'presetReasonEffort', 2)).toEqual({ ok: true })
        expect(dbBag().reasoningEffort).toBe(2)
        expect(dbBag().reasonEffort).toBeUndefined()
        expect(slotBag(0).reasonEffort).toBeUndefined()
        expect(service.editValue(keys[1], 'presetReasonEffort', 3)).toEqual({ ok: true })
        expect(slotBag(1).reasonEffort).toBe(3)
        expect(dbBag().reasoningEffort).toBe(2)
        delete slotBag(2).reasonEffort
        expect(readPresetField(ids[2], 'presetReasonEffort')).toEqual({ had: true, value: 0 })
    })
})

describe('S4b-T10: a drag is one step', () => {
    test('ten writes within the window are one step and undo restores the start value; a discrete edit joins nothing', () => {
        for (let step = 1; step <= 10; step++) {
            expect(service.editValue(keys[0], 'presetTemperature', 77 + step, { coalesce: true })).toEqual({ ok: true })
            clock.tick(50)
        }
        expect(dbBag().temperature).toBe(87)
        expect(service.view(keys[0]).done).toHaveLength(1)
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(dbBag().temperature).toBe(77)
        expect(service.redo(keys[0])).toEqual({ ok: true })
        expect(dbBag().temperature).toBe(87)
        clock.tick(5000)
        expect(service.editValue(keys[0], 'presetTopK', 5)).toEqual({ ok: true })
        expect(service.editValue(keys[0], 'presetTopK', 6)).toEqual({ ok: true })
        expect(service.view(keys[0]).done).toHaveLength(3)
    })
})

describe('S4b-T13 (allow arm): the optional keys come back as they were', () => {
    test('an inactive min_p edit made then undone after the switch deletes the working key', () => {
        expect(service.editValue(keys[1], 'presetMinP', 0.5)).toEqual({ ok: true })
        expect(slotBag(1).min_p).toBe(0.5)
        changeToPreset(1)
        expect(dbBag().min_p).toBe(0.5)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(Object.hasOwn(DBState.db, 'min_p')).toBe(false)
    })

    test('a keeps field edited while inactive is refused after the switch (temperature keeps the working value)', () => {
        delete slotBag(1).temperature
        expect(service.editValue(keys[1], 'presetTemperature', 90)).toEqual({ ok: true })
        changeToPreset(1)
        expect(dbBag().temperature).toBe(90)
        expect(service.undo(keys[1])).toEqual({ ok: false, reason: 'precondition' })
        expect(dbBag().temperature).toBe(90)
    })

    test('the thinking token budget goes back to null, the value save and setPreset produce, not to a missing key', () => {
        delete slotBag(1).thinkingTokens
        expect(service.editValue(keys[1], 'presetThinkingTokens', 2000)).toEqual({ ok: true })
        expect(slotBag(1).thinkingTokens).toBe(2000)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotBag(1).thinkingTokens).toBeNull()
        expect(readPresetField(ids[1], 'presetThinkingTokens')).toEqual({ had: false })
    })
})

describe('S4b-T7/T8: the auxiliary models container', () => {
    test('a write onto the working copy with no seperateModels creates the container from the seed with the key set', () => {
        delete dbBag().seperateModels
        expect(service.editText(keys[0], 'presetAuxMemory', 'mem', 'single')).toEqual({ ok: true })
        expect(dbBag().seperateModels).toEqual({ memory: 'mem', emotion: '', translate: '', otherAx: '' })
    })

    test('an inactive slot with no container reads empty models and a write creates the seed container', () => {
        delete slotBag(1).seperateModels
        expect(readPresetField(ids[1], 'presetAuxEmotion')).toEqual({ had: true, value: '' })
        expect(service.editText(keys[1], 'presetAuxEmotion', 'emo', 'single')).toEqual({ ok: true })
        expect(slotBag(1).seperateModels).toEqual({ memory: '', emotion: 'emo', translate: '', otherAx: '' })
    })

    test('save and overwrite arm: with the global switch on, switching to the preset and away stores null over the edit', () => {
        dbBag().doNotChangeSeperateModels = true
        expect(service.editText(keys[1], 'presetAuxMemory', 'edited', 'single')).toEqual({ ok: true })
        expect((slotBag(1).seperateModels as Record<string, string>).memory).toBe('edited')
        changeToPreset(1)
        changeToPreset(2)
        expect(slotBag(1).seperateModels).toBeNull()
    })
})

describe('S4b-T9: the adapter writes only the field it is given', () => {
    test('a model edit changes only aiModel on the working copy and on a slot', () => {
        const snapshot = (): string => JSON.stringify(DBState.db)
        for (const [key, holder] of [[keys[0], () => dbBag()], [keys[1], () => slotBag(1)]] as const) {
            const before = JSON.parse(snapshot()) as Record<string, unknown>
            expect(service.editText(key, 'presetAiModel', 'claude-opus-4-8', 'single')).toEqual({ ok: true })
            expect(holder().aiModel).toBe('claude-opus-4-8')
            const after = JSON.parse(snapshot()) as Record<string, unknown>
            const changed = (a: unknown, b: unknown, path: string, out: string[]): void => {
                if (JSON.stringify(a) === JSON.stringify(b)) return
                if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
                    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
                        changed((a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name], `${path}.${name}`, out)
                    }
                    return
                }
                out.push(path)
            }
            const out: string[] = []
            changed(before, after, '', out)
            expect(out.length, out.join(',')).toBe(1)
            expect(out[0]).toMatch(/\.aiModel$/)
        }
    })

    test('a batch of a text and a number op is applied whole or not at all', () => {
        const before = JSON.stringify(DBState.db)
        expect(presetAdapter.write(ids[1], [
            { op: 'set', path: 'presetTemperature', value: { had: true, value: 12 } },
            { op: 'set', path: 'presetTopK', value: { had: true, value: 'x' as unknown as number } },
        ])).toBe(false)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})
