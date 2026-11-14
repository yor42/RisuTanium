// @vitest-environment jsdom
// A PC proxy measurement, not a device result: what the undo of one 300-row delete costs end to end in `replay`, which
// asks the state of 300 files before it puts the rows back. The browser store runs on fake-indexeddb (one read at a
// time), the Node store as a double that answers from a first piece (eight at a time). The phone run is owed. The
// bound is the replay's own budget, so a run that cannot finish inside it fails; the numbers are printed for the record.
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, REPLAY_BUDGET_MS, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { openAssetFileReader } from './assetFileState'

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
const path = (index: number): string => `assets/file${index}.png`

// The instance upstream's own code creates, which the browser store adapter reads.
const upstream = localforage.createInstance({ name: 'risuai' })

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
            additionalAssets: Array.from({ length: ROWS }, (_, i) => [`name${i}`, path(i), 'png']),
            emotionImages: [],
        },
    ] as unknown as typeof DBState.db.characters
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

type Subject = { additionalAssets: string[][] }

async function undoOfBulkDelete(service: OwnerHistoryService): Promise<number> {
    await service.whenReady(A)
    expect(service.assetDelete(A, 'additionalAssets', Array.from({ length: ROWS }, (_, i) => i)).ok).toBe(true)
    expect((DBState.db.characters[0] as unknown as Subject).additionalAssets).toHaveLength(0)
    const started = performance.now()
    const result = await service.replay(A, { kind: 'undo' })
    const elapsed = performance.now() - started
    expect(result).toMatchObject({ ok: true })
    expect((DBState.db.characters[0] as unknown as Subject).additionalAssets).toHaveLength(ROWS)
    return elapsed
}

describe('the undo of a 300-row delete asks 300 files (PC proxy; the phone run is owed)', () => {
    test('on the browser store, one read at a time over fake-indexeddb', async () => {
        await upstream.clear()
        for (let i = 0; i < ROWS; i++) {
            await upstream.setItem(path(i), new Uint8Array([1]))
        }
        const store = createIndexedDbStore()
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openAssetFileReader: () =>
                openAssetFileReader({
                    getStore: async () => store,
                    sourceOf: async () => ({ kind: 'web', pieces: { open: async function* () {}, node: false }, store }),
                    statSize: async () => 0,
                    confirmedAbsent: async () => false,
                    openFirstPiece: async () => null,
                }),
        })
        const elapsed = await undoOfBulkDelete(service)
        process.stdout.write(`replay proxy: undo of a 300-row delete, browser store on fake-indexeddb, took ${elapsed.toFixed(1)} ms on this host (budget ${REPLAY_BUDGET_MS} ms; ${elapsed > 4000 ? 'OVER 4 s' : 'under 4 s'})\n`)
        expect(elapsed).toBeLessThan(REPLAY_BUDGET_MS)
    })

    test('on the Node store, eight at a time over a first-piece double', async () => {
        const store = createIndexedDbStore()
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openAssetFileReader: () =>
                openAssetFileReader({
                    getStore: async () => store,
                    sourceOf: async () => ({ kind: 'node', pieces: { open: async function* () {}, node: true }, store }),
                    statSize: async () => 0,
                    confirmedAbsent: async () => false,
                    // A first piece that takes a few turns of the event loop, as a request to the server would.
                    openFirstPiece: async () => {
                        async function* oneByte(): AsyncGenerator<{ bytes: Uint8Array; total: number }, void, undefined> {
                            await new Promise<void>((resolve) => setTimeout(resolve, 1))
                            yield { bytes: new Uint8Array(1), total: 1 }
                        }
                        const pieces = oneByte()
                        return { pieces, first: await pieces.next() }
                    },
                }),
        })
        const elapsed = await undoOfBulkDelete(service)
        process.stdout.write(`replay proxy: undo of a 300-row delete, Node store double with 1 ms per file, took ${elapsed.toFixed(1)} ms on this host (budget ${REPLAY_BUDGET_MS} ms; ${elapsed > 4000 ? 'OVER 4 s' : 'under 4 s'})\n`)
        expect(elapsed).toBeLessThan(REPLAY_BUDGET_MS)
    })
})
