// A Studio module slot write counts a save mark synchronously: the write hook reports the `modules` key of the
// database, `markDbWrite` sets `tracker.modules` and schedules a save, all before the writing call returns. The module
// commit signal (`moduleCommitVerdict`) relies on this: a mark counted late would let a covering commit be read as
// older than the edit. Real `$state` root, the real write hook and save marks; no change effects are registered, so
// only the hook can produce the mark.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [], modules: [] } as unknown as Database })
    return {
        DBState: state,
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { writeLiveModule } from 'src/ts/studio/edit/studioSetters'

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

function moduleOf(id: string, name: string): RisuModule {
    return { id, name, description: '' } as RisuModule
}

let tracker: toSaveType
let scheduled: number

beforeEach(() => {
    DBState.db = { botPresetsId: 0, botPresets: [], modules: [moduleOf('M1', 'one'), moduleOf('M2', 'two')], loadouts: [], plugins: [], pluginCustomStorage: {}, characters: [] } as unknown as Database
    tracker = makeTracker()
    scheduled = 0
    installCharacterSaveMarks({ tracker, schedule: () => { scheduled += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
})

describe('a Studio module slot write', () => {
    test('T0: counts a save mark and sets tracker.modules before the write returns', () => {
        expect(scheduled).toBe(0)
        expect(tracker.modules).toBe(false)

        const written = writeLiveModule('M1', (live) => ({ ...live, name: 'renamed' }))

        expect(written).toBe(true)
        expect((DBState.db.modules[0] as RisuModule).name).toBe('renamed')
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.modules).toBe(true)
    })
})
