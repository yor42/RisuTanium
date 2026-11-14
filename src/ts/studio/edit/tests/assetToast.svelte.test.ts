// @vitest-environment jsdom
// The Undo toast of an asset step against the real toast host on a fake clock and the real history service: Undo
// undoes only its own step and only while that step is on top, the toast ends when another step lands, and the entry
// that runs its own Undo shows the outcome instead of ending under it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../history/ownerHistory.svelte'
import { characterOwnerKey } from '../../history/ownerPhase'
import { createFakeClock } from '../../history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../history/tests/studioStoreDoubles'
import { createStudioToasts, resetStudioToastsForTests, retireAssetToasts, type StudioToasts } from '../studioToasts'

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
// A key reads back as its own name, and the one text with a name in it as a call.
vi.mock('src/lang', () => {
    const table: Record<string, unknown> = {
        studioAssetFileGone: (name: string) => `studioAssetFileGone(${name})`,
        studioAssetFileUnchecked: (name: string) => `studioAssetFileUnchecked(${name})`,
    }
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : key) }) }
})

interface FakeToastClock extends ToastClock {
    advance(ms: number): void
}

function fakeToastClock(): FakeToastClock {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number; run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => {
                timers.delete(key)
            }
        },
        advance(ms) {
            time += ms
            for (const [key, timer] of [...timers]) {
                if (timer.at <= time) {
                    timers.delete(key)
                    timer.run()
                }
            }
        },
    }
}

const A = characterOwnerKey('A')

interface Fixture {
    service: OwnerHistoryService
    toasts: StudioToasts
    host: ToastHost
    replay: ReturnType<typeof vi.fn>
    gone: Set<string>
}

let fixture: Fixture

function setup(hostFor: (real: ToastHost) => ToastHost = (real) => real): Fixture {
    const real = createToastHost({ clock: fakeToastClock() })
    const host = hostFor(real)
    const gone = new Set<string>()
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
        openAssetFileReader: async () => ({ concurrency: 1, stateOf: async (path) => (gone.has(path) ? 'gone' : 'present') }),
    })
    const replay = vi.fn(service.replay)
    const toasts = createStudioToasts({ service: () => ({ restoreDeleted: service.restoreDeleted, view: service.view, replay }), host })
    return { service, toasts, host: real, replay, gone }
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [
        {
            chaId: 'A',
            desc: 'd0',
            alternateGreetings: ['g0'],
            chats: [{ id: 'c1', note: '' }],
            chatPage: 0,
            additionalAssets: [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png']],
            emotionImages: [],
        },
    ] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    fixture = setup()
    await fixture.service.whenReady(A)
})

afterEach(() => {
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const live = (): { additionalAssets: string[][]; desc: string } => DBState.db.characters[0] as unknown as { additionalAssets: string[][]; desc: string }

// Deletes the `grin` row and posts the toast the setter's caller posts for the landed step.
function deleteGrinWithToast(on: Fixture = fixture): string {
    const result = on.service.assetDelete(A, 'additionalAssets', [1])
    if (result.ok === false || result.stepId === undefined) {
        throw new Error('the delete did not land')
    }
    on.toasts.postAssetAction(A, result.stepId, 'Deleted grin')
    return result.stepId
}

describe('the asset Undo toast', () => {
    test('Undo restores the row through the service once, and the same entry then shows the outcome', async () => {
        deleteGrinWithToast()
        expect(fixture.host.visible).toHaveLength(1)
        const id = fixture.host.visible[0].id

        await fixture.host.activate(id)

        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin'])
        expect(fixture.replay).toHaveBeenCalledTimes(1)
        expect(fixture.host.visible).toHaveLength(1)
        expect(fixture.host.visible[0].id).toBe(id)
        expect(fixture.host.visible[0].text).toBe('studioAssetUndone')
        expect(fixture.host.visible[0].actionLabel).toBeUndefined()
    })

    test('another step landing ends the toast, so its Undo can no longer undo the wrong step', () => {
        deleteGrinWithToast()
        expect(fixture.host.visible).toHaveLength(1)
        expect(fixture.service.editField(A, 'desc', 'changed').ok).toBe(true)
        expect(fixture.host.visible).toHaveLength(0)
    })

    test('a toast that is still offered while another step is on top refuses, applies no undo and closes', async () => {
        // A host that ignores dismissal stands for a toast the host kept: only the run check is under test.
        fixture = setup((real) => ({ ...real, dismissUndo: () => {} }))
        await fixture.service.whenReady(A)
        deleteGrinWithToast()
        expect(fixture.service.editField(A, 'desc', 'changed').ok).toBe(true)
        expect(fixture.host.visible).toHaveLength(1)

        await fixture.host.activate(fixture.host.visible[0].id)

        expect(live().desc).toBe('changed')
        expect(live().additionalAssets).toHaveLength(1)
        expect(fixture.host.visible).toHaveLength(0)
    })

    test('Ctrl+Z ends the toast, and a Redo posts no new one', async () => {
        deleteGrinWithToast()
        expect((await fixture.service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(fixture.host.visible).toHaveLength(0)
        expect(fixture.service.redo(A).ok).toBe(true)
        expect(fixture.host.visible).toHaveLength(0)
    })

    test('a bulk delete is one step and one toast', () => {
        const result = fixture.service.assetDelete(A, 'additionalAssets', [0, 1])
        expect(result).toMatchObject({ ok: true })
        if (result.ok && result.stepId !== undefined) {
            fixture.toasts.postAssetAction(A, result.stepId, 'Deleted 2')
        }
        expect(fixture.service.view(A).done).toHaveLength(1)
        expect(fixture.host.visible).toHaveLength(1)
    })

    test('an Undo whose file is gone names the row and puts nothing back', async () => {
        deleteGrinWithToast()
        fixture.gone.add('assets/grin.png')
        await fixture.host.activate(fixture.host.visible[0].id)
        expect(fixture.host.visible[0].text).toBe('studioAssetFileGone(grin)')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])
    })

    test('a toast of another owner is left alone when a step lands on this one', () => {
        deleteGrinWithToast()
        fixture.toasts.retireAssetToasts(characterOwnerKey('B'), null)
        expect(fixture.host.visible).toHaveLength(1)
        fixture.toasts.retireAssetToasts(A, fixture.service.view(A).done.at(-1)?.id ?? null)
        expect(fixture.host.visible).toHaveLength(1)
        fixture.toasts.retireAssetToasts(A, null)
        expect(fixture.host.visible).toHaveLength(0)
    })

    test('with no service built, Undo reports that history is loading and the toast stays honest', async () => {
        const real = createToastHost({ clock: fakeToastClock() })
        const toasts = createStudioToasts({ service: () => null, host: real })
        toasts.postAssetAction(A, 's1', 'Deleted grin')
        await real.activate(real.visible[0].id)
        expect(real.visible[0].text).toBe('studioRefusalLoading')
    })
})
