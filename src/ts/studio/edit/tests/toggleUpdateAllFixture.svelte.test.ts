// @vitest-environment jsdom
// Compatibility guard (passes before and after the scan and splice speed-ups): update all over the S3d4 fixture shape
// finds the same uses, writes exactly the independently constructed texts and Undo all restores every byte. The
// expected texts come from the fixture constructor, never from the scanner.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: () => {} }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: () => {} }))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/moduleRefList', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    const { matchesModuleRef } = await import('src/ts/process/moduleRefs')
    return {
        moduleListOf: (ids: string[]) => {
            const wanted = new Set(ids)
            return ((DBState.db as unknown as Database).modules ?? []).filter((row) => matchesModuleRef(row, wanted))
        },
    }
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests } from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { ToggleTarget } from 'src/ts/studio/toggleBuilder.svelte'
import type { Rename } from 'src/ts/studio/toggleUpdateAll'
import { buildUpdatePlan, resetUpdateRunForTests, runUpdateAll, undoLastUpdate, type UpdateRunDeps } from 'src/ts/studio/toggleUpdateAllRun.svelte'
import { createUpdateDbPort, readUpdateReach } from 'src/ts/studio/edit/toggleUpdateAllDb'
import { buildS3d4Fixture, type FixtureCharacter, type FixtureModule, type S3d4Fixture } from './s3d4Fixture.test-helpers'

const CHARACTER: ToggleTarget = { kind: 'character', chaId: 'cha-1' }
const RENAMES: Rename[] = [{ from: 'mood', to: 'mood2' }]
const production: UpdateRunDeps = { port: createUpdateDbPort, markCount: () => h.marks }

let fixture: S3d4Fixture

const live = () => DBState.db.characters[0] as unknown as FixtureCharacter
const liveModules = () => DBState.db.modules as unknown as FixtureModule[]

// Every text the update may touch, in a fixed order, for byte comparison.
function allTexts(): string[] {
    const character = live()
    const out = [character.desc, character.firstMessage, ...character.alternateGreetings, ...character.globalLore.map((entry) => entry.content)]
    for (const module of liveModules()) {
        out.push(...module.lorebook.map((entry) => entry.content), ...module.regex.map((script) => script.out))
    }
    return out
}

function expectedTexts(): string[] {
    const { expected } = fixture
    const out = [expected.desc, expected.firstMessage, ...expected.alternateGreetings, ...expected.loreContents]
    for (const module of expected.modules) {
        out.push(...module.loreContents, ...module.regexOut)
    }
    return out
}

// A byte comparison that reports the first differing slot instead of printing megabytes.
function firstDifference(actual: readonly string[], wanted: readonly string[]): number {
    if (actual.length !== wanted.length) {
        return -2
    }
    return actual.findIndex((text, index) => text !== wanted[index])
}

beforeEach(async () => {
    h.marks = 0
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    fixture = buildS3d4Fixture()
    fixture.character.customModuleToggle = fixture.renamedToggleText
    DBState.db = {
        characters: [fixture.character], modules: fixture.modules as unknown as RisuModule[], enabledModules: fixture.modules.map((module) => module.id),
        botPresets: [], botPresetsId: 0, personas: [], plugins: [], loadouts: [], moduleIntergration: '', globalChatVariables: {},
    } as unknown as Database
    selIdState.selId = 0
    studioScreen.chaId = 'cha-1'
    studioScreen.open = true
    studioScreen.visitId = 'v1'
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(characterOwnerKey('cha-1'))
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
})

describe('update all over the S3d4 fixture shape', () => {
    test('A1 the plan finds the same uses, targets, listed rows, skipped source and reach', () => {
        const reach = readUpdateReach(CHARACTER, 'cha-1')
        expect(reach.owners).toHaveLength(21)
        expect(reach.owners.reduce((sum, owner) => sum + owner.targets.length, 0)).toBe(935)

        const plan = buildUpdatePlan(CHARACTER, 'cha-1', RENAMES, new Set())
        const { useCounts } = fixture
        expect(plan.count).toBe(useCounts.character + useCounts.modulesWithUses * useCounts.perModule)
        expect(plan.count).toBe(199)
        expect(plan.writes).toHaveLength(162)
        expect(new Set(plan.writes.map((write) => write.owner)).size).toBe(9)
        expect(plan.writes.filter((write) => write.owner === characterOwnerKey('cha-1')).reduce((sum, write) => sum + write.count, 0)).toBe(useCounts.character)
        for (let m = 0; m <= 7; m++) {
            expect(plan.writes.filter((write) => write.owner === moduleOwnerKey(`mod-${m}`)).reduce((sum, write) => sum + write.count, 0)).toBe(useCounts.perModule)
        }
        expect(plan.listed).toHaveLength(58)
        const reasons = new Map<string, number>()
        for (const row of plan.listed) {
            reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1)
        }
        expect(Object.fromEntries(reasons)).toEqual({ calcKey: 56, code: 1, dynamicName: 1 })
        expect(plan.skipped).toEqual([{ owner: moduleOwnerKey('mod-8'), key: 'mood', count: 12 }])
        expect(plan.blocked).toEqual([])
    })

    test('A2 update all writes exactly the constructed texts and Undo all restores every byte', () => {
        const before = allTexts()
        expect(firstDifference(before, expectedTexts())).not.toBe(-1)
        const signature = buildUpdatePlan(CHARACTER, 'cha-1', RENAMES, new Set()).signature
        const result = runUpdateAll({ target: CHARACTER, chaId: 'cha-1', renames: () => RENAMES, optIn: new Set(), shownSignature: signature }, production)
        expect(result).toMatchObject({ ok: true, count: 199 })
        expect(firstDifference(allTexts(), expectedTexts())).toBe(-1)
        // The readers the update keeps stay as constructed.
        expect(live().triggerscript[0].effect[0].code).toContain('"toggle_mood"')
        expect(live().firstMessage).toContain('{{? @toggle_mood(1) + 1}}')
        expect(liveModules()[1].lorebook[24].content).toContain('{{getglobalvar::toggle_{{getvar::x}}}}')

        const token = result.ok ? result.token : -1
        expect(undoLastUpdate(token, production)).toEqual({ ok: true })
        expect(firstDifference(allTexts(), before)).toBe(-1)
    })
})
