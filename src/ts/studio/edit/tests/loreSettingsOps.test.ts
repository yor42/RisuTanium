// The lorebook settings builders through the real history service on the memory doubles (T23): seeding, the
// `loreExt` mirror in one step, the number clamp, coalescing and undo. The literal oracles are what classic's
// `LoreBookSetting.svelte` writes for the same actions.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../history/ownerHistory.svelte'
import { characterOwnerKey } from '../../history/ownerPhase'
import { createFakeClock, type FakeClock } from '../../history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../history/tests/studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter, type LiveCharacter } from '../../history/tests/objService.test-helpers'
import { buildLoreFlag, buildLoreNumber, buildUseGlobal, clampLoreNumber, type LoreFlag } from '../loreSettingsOps'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const GLOBAL = { scanDepth: 7, tokenBudget: 1234 }
let clock: FakeClock
let service: OwnerHistoryService

async function start(overrides: Partial<LiveCharacter> = {}): Promise<void> {
    putCharacter(makeCharacter(overrides))
    clock = createFakeClock()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const settings = (): Record<string, unknown> | undefined => liveCharacter().loreSettings as Record<string, unknown> | undefined
const ext = (): Record<string, unknown> | undefined => liveCharacter().loreExt as Record<string, unknown> | undefined
const steps = (): number => service.view(A).done.length
const SEEDED = { tokenBudget: 800, scanDepth: 5, recursiveScanning: false }

describe('T23a use global off seeds from the app values', () => {
    test('the seed is exactly the three keys with the db values, and the db is untouched', async () => {
        await start()
        expect(service.objEdit(A, buildUseGlobal(false, GLOBAL))).toEqual({ ok: true })
        expect(settings()).toEqual({ tokenBudget: 1234, scanDepth: 7, recursiveScanning: false })
        expect(Object.keys(settings() ?? {}).sort()).toEqual(['recursiveScanning', 'scanDepth', 'tokenBudget'])
        expect('loreExt' in liveCharacter()).toBe(false)
        expect(steps()).toBe(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect('loreSettings' in liveCharacter()).toBe(false)
    })

    test('a stale off while settings already exist, or a non-finite seed, writes nothing', async () => {
        await start({ loreSettings: { ...SEEDED } })
        expect(service.objEdit(A, buildUseGlobal(false, GLOBAL))).toEqual({ ok: false, reason: 'precondition' })
        await start()
        expect(service.objEdit(A, buildUseGlobal(false, { scanDepth: Number.NaN, tokenBudget: 1 }))).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
        expect(steps()).toBe(0)
    })
})

describe('T23b use global on removes the settings', () => {
    test('loreSettings is absent (not an empty object), loreExt stays, and undo restores the object', async () => {
        await start({ loreSettings: { ...SEEDED, fullWordAsciiBoundary: true }, loreExt: { risu_fullWordAsciiBoundary: true } })
        expect(service.objEdit(A, buildUseGlobal(true, GLOBAL))).toEqual({ ok: true })
        expect('loreSettings' in liveCharacter()).toBe(false)
        expect(ext()).toEqual({ risu_fullWordAsciiBoundary: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(settings()).toEqual({ ...SEEDED, fullWordAsciiBoundary: true })
    })

    test('on while already absent is unchanged', async () => {
        await start()
        expect(service.objEdit(A, buildUseGlobal(true, GLOBAL))).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(0)
    })
})

describe('T23c boundary flag on', () => {
    test.each([
        ['fullWordAsciiBoundary', 'risu_fullWordAsciiBoundary'],
        ['cjkWordStart', 'risu_cjkWordStart'],
    ] as const)('%s sets the flag and the loreExt mirror in ONE step; other loreExt keys stay; undo and redo restore both', async (flag, key) => {
        await start({ loreSettings: { ...SEEDED }, loreExt: { other: 1 } })
        expect(service.objEdit(A, buildLoreFlag(flag, true))).toEqual({ ok: true })
        expect(settings()?.[flag]).toBe(true)
        expect(ext()).toEqual({ other: 1, [key]: true })
        expect(steps()).toBe(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(settings()).toEqual(SEEDED)
        expect(ext()).toEqual({ other: 1 })
        expect(service.redo(A)).toEqual({ ok: true })
        expect(settings()?.[flag]).toBe(true)
        expect(ext()).toEqual({ other: 1, [key]: true })
    })

    test('loreExt is created when absent, and undo makes it absent again', async () => {
        await start({ loreSettings: { ...SEEDED } })
        expect(service.objEdit(A, buildLoreFlag('cjkWordStart', true))).toEqual({ ok: true })
        expect(ext()).toEqual({ risu_cjkWordStart: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect('loreExt' in liveCharacter()).toBe(false)
    })
})

describe('T23d flag off', () => {
    test('the loreExt key is deleted, not written false; other keys stay; the other boundary flag is independent', async () => {
        await start({
            loreSettings: { ...SEEDED, fullWordAsciiBoundary: true, cjkWordStart: true },
            loreExt: { risu_fullWordAsciiBoundary: true, risu_cjkWordStart: true, other: 1 },
        })
        expect(service.objEdit(A, buildLoreFlag('fullWordAsciiBoundary', false))).toEqual({ ok: true })
        expect(settings()?.fullWordAsciiBoundary).toBe(false)
        expect(ext()).toEqual({ risu_cjkWordStart: true, other: 1 })
        expect('risu_fullWordAsciiBoundary' in (ext() ?? {})).toBe(false)
        expect(settings()?.cjkWordStart).toBe(true)
    })

    test('with loreExt absent it stays absent, with no empty object created', async () => {
        await start({ loreSettings: { ...SEEDED, cjkWordStart: true } })
        expect(service.objEdit(A, buildLoreFlag('cjkWordStart', false))).toEqual({ ok: true })
        expect(settings()?.cjkWordStart).toBe(false)
        expect('loreExt' in liveCharacter()).toBe(false)
    })

    test('recursive scanning and full-word matching write only loreSettings', async () => {
        await start({ loreSettings: { ...SEEDED }, loreExt: { other: 1 } })
        expect(service.objEdit(A, buildLoreFlag('recursiveScanning', true))).toEqual({ ok: true })
        expect(service.objEdit(A, buildLoreFlag('fullWordMatching', true))).toEqual({ ok: true })
        expect(settings()).toEqual({ ...SEEDED, recursiveScanning: true, fullWordMatching: true })
        expect(ext()).toEqual({ other: 1 })
    })
})

describe('T23e coalescing', () => {
    test('number changes less than a second apart are one step and undo restores the value before the first', async () => {
        await start({ loreSettings: { ...SEEDED } })
        service.objEdit(A, buildLoreNumber('scanDepth', 8))
        clock.tick(300)
        service.objEdit(A, buildLoreNumber('scanDepth', 9))
        expect(steps()).toBe(1)
        expect(settings()?.scanDepth).toBe(9)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(settings()?.scanDepth).toBe(5)
    })

    test('more than a second apart makes two steps', async () => {
        await start({ loreSettings: { ...SEEDED } })
        service.objEdit(A, buildLoreNumber('scanDepth', 8))
        clock.tick(1500)
        service.objEdit(A, buildLoreNumber('scanDepth', 9))
        expect(steps()).toBe(2)
    })

    test('scan depth and token budget never merge, and a flag between never merges', async () => {
        await start({ loreSettings: { ...SEEDED } })
        service.objEdit(A, buildLoreNumber('scanDepth', 8))
        service.objEdit(A, buildLoreNumber('tokenBudget', 900))
        expect(steps()).toBe(2)
        service.objEdit(A, buildLoreNumber('tokenBudget', 901))
        expect(steps()).toBe(2)
        service.objEdit(A, buildLoreFlag('recursiveScanning', true))
        service.objEdit(A, buildLoreNumber('tokenBudget', 902))
        expect(steps()).toBe(4)
    })

    test('a single-op flag toggled on, off, on within a second is three steps and undo walks each back', async () => {
        await start({ loreSettings: { ...SEEDED } })
        service.objEdit(A, buildLoreFlag('recursiveScanning', true))
        service.objEdit(A, buildLoreFlag('recursiveScanning', false))
        service.objEdit(A, buildLoreFlag('recursiveScanning', true))
        expect(steps()).toBe(3)
        service.undo(A)
        expect(settings()?.recursiveScanning).toBe(false)
        service.undo(A)
        expect(settings()?.recursiveScanning).toBe(true)
        service.undo(A)
        expect(settings()?.recursiveScanning).toBe(false)
    })
})

describe('T23f clamp and round', () => {
    test.each([
        ['scanDepth', 99, 20],
        ['scanDepth', -5, 0],
        ['tokenBudget', 5000, 4096],
        ['tokenBudget', 7.6, 8],
        ['scanDepth', 4.4, 4],
    ] as const)('%s %d becomes %d', (field, raw, expected) => {
        expect(clampLoreNumber(field, raw)).toBe(expected)
    })

    test('a non-finite value has nothing to write: no step, no mark', async () => {
        expect(clampLoreNumber('scanDepth', Number.NaN)).toBeNull()
        expect(clampLoreNumber('scanDepth', null)).toBeNull()
        await start({ loreSettings: { ...SEEDED } })
        expect(service.objEdit(A, buildLoreNumber('scanDepth', Number.NaN))).toEqual({ ok: true, unchanged: true })
        expect(service.objEdit(A, buildLoreNumber('scanDepth', null))).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(0)
        expect(steps()).toBe(0)
    })

    test('an out-of-range write lands clamped on the live character', async () => {
        await start({ loreSettings: { ...SEEDED } })
        service.objEdit(A, buildLoreNumber('scanDepth', 99))
        expect(settings()?.scanDepth).toBe(20)
    })
})

describe('T23g unknown keys and refusals', () => {
    test.each(['recursiveScanning', 'fullWordAsciiBoundary', 'cjkWordStart'] as LoreFlag[])('unknown loreSettings and loreExt keys survive the %s builder', async (flag) => {
        await start({ loreSettings: { ...SEEDED, futureKey: 'k' }, loreExt: { risu_other: { a: 1 } } })
        service.objEdit(A, buildLoreFlag(flag, true))
        expect(settings()?.futureKey).toBe('k')
        expect(ext()?.risu_other).toEqual({ a: 1 })
    })

    test('the number builder keeps unknown keys', async () => {
        await start({ loreSettings: { ...SEEDED, futureKey: 'k' } })
        service.objEdit(A, buildLoreNumber('tokenBudget', 100))
        expect(settings()).toEqual({ ...SEEDED, futureKey: 'k', tokenBudget: 100 })
    })

    test('flag and number refuse when loreSettings is absent, and write nothing', async () => {
        await start()
        expect(service.objEdit(A, buildLoreFlag('recursiveScanning', true))).toEqual({ ok: false, reason: 'precondition' })
        expect(service.objEdit(A, buildLoreFlag('cjkWordStart', true))).toEqual({ ok: false, reason: 'precondition' })
        expect(service.objEdit(A, buildLoreNumber('scanDepth', 3))).toEqual({ ok: false, reason: 'precondition' })
        expect('loreSettings' in liveCharacter()).toBe(false)
        expect('loreExt' in liveCharacter()).toBe(false)
        expect(h.marks).toBe(0)
    })

    test('a boundary flag refuses whole when loreExt is not an object', async () => {
        await start({ loreSettings: { ...SEEDED }, loreExt: 'broken' as unknown as object })
        expect(service.objEdit(A, buildLoreFlag('cjkWordStart', true))).toEqual({ ok: false, reason: 'precondition' })
        expect(settings()).toEqual(SEEDED)
        expect(h.marks).toBe(0)
    })
})
