// @vitest-environment jsdom
// A PC proxy measurement, not a device result: what one bulk delete of 300 rows costs in the history service, which
// plans the removal, recomputes the retained paths over the whole history and lands one owner write. The bound is
// loose on purpose, so a slow host does not fail it; the number is printed for the record.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
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
const ROWS = 300
const BOUND_MS = 2000

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    DBState.db.characters = [
        {
            chaId: 'A',
            desc: '',
            alternateGreetings: [],
            chats: [{ id: 'c1', note: '' }],
            chatPage: 0,
            additionalAssets: Array.from({ length: ROWS }, (_, i) => [`name${i}`, `assets/file${i}.png`, 'png']),
            emotionImages: [],
        },
    ] as unknown as typeof DBState.db.characters
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

type Subject = { additionalAssets: string[][]; [ASSET_RETAINED_KEY]?: unknown }

describe('a 300-row bulk delete (PC proxy; the device run is owed)', () => {
    test('one landed write retains every removed path and costs well under the bound', async () => {
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        await service.whenReady(A)
        // The history already holds 100 steps that each name a path, as a long session leaves it.
        for (let i = 0; i < 100; i++) {
            expect(service.assetRename(A, 'additionalAssets', 299 - i, `renamed${i}`).ok).toBe(true)
        }

        const started = performance.now()
        const result = service.assetDelete(A, 'additionalAssets', Array.from({ length: ROWS }, (_, i) => i))
        const elapsed = performance.now() - started

        expect(result).toMatchObject({ ok: true })
        const subject = DBState.db.characters[0] as unknown as Subject
        expect(subject.additionalAssets).toHaveLength(0)
        expect(retainedNamesOf(subject[ASSET_RETAINED_KEY])).toHaveLength(ROWS)
        process.stdout.write(`T77b proxy: 300-row bulk delete with recompute over ${service.view(A).done.length} steps took ${elapsed.toFixed(1)} ms on this host\n`)
        expect(elapsed).toBeLessThan(BOUND_MS)
    })
})
