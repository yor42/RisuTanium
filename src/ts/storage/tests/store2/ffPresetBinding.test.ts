// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { presetFromWorkingSettings, setPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, runSpyOf, signal, takenBy, type LoopWorld } from './ffFixtures'

/**
 * The preset record's selection change decided over the page's real `setPreset` and `presetFromWorkingSettings`: the
 * fast-forward is given no stub host, so the host loads the page's modules and binds its preset operations to the
 * database's own functions. Both pages switched presets from the same base, each saving the working fields into the slot
 * it left, so the lists agree and the last saved switch stays: the page keeps its own selection and takes nothing back.
 * A binding that does not reproduce `setPreset` leaves the page's switch unrecognised, and the page parks.
 */

beforeEach(() => {
    ffSetup()
    setFastForwardHostForTest(null)
})

afterEach(() => {
    ffTeardown()
})

/** The page's own preset switch, as the preset picker does it: save the working fields into the slot left, then enter the new one. */
function switchPreset(db: Database, to: number): void {
    const from = db.botPresetsId
    const left = db.botPresets[from]
    db.botPresets[from] = presetFromWorkingSettings(db, left.name, left.image ?? '')
    setPreset(db, db.botPresets[to] as botPreset)
    db.botPresetsId = to
}

/**
 * Resolves when the loop reports its first save. The wait is driven by the loop's own `saved` report rather than a
 * polling deadline, so a loaded machine only makes it later; a save that never comes fails at the test timeout.
 */
function firstSave(loop: LoopWorld): Promise<void> {
    return new Promise<void>((resolve) => {
        let saved = loop.state.saved
        Object.defineProperty(loop.state, 'saved', {
            configurable: true,
            enumerable: true,
            get: () => saved,
            set: (value: number) => {
                saved = value
                if (saved >= 1) {
                    resolve()
                }
            },
        })
        if (saved >= 1) {
            resolve()
        }
    })
}

describe('the preset record over the real database functions', () => {
    test('P1 two pages that each switched presets from one base agree, and the page keeps its own selection with no park', async () => {
        const { memory, page } = await ffWorld()
        await page.commitEdit((db) => { Reflect.set(db, 'NAIsettings', {}) })
        const b = await bootB(memory)
        const world = runLoopWorld(b.context, b.db)
        const run = runSpyOf(b)
        const saved = firstSave(world)
        switchPreset(b.db, 2)
        world.tracker.botPreset = true
        world.state.dirty = true
        world.state.due = true
        await page.commitEdit((db) => { switchPreset(db, 1) })
        signal(world)
        await saved
        // The page's save over the peer's switch leaves its encoding on the store's current manifest, so the check must
        // hold on its first look: a zero budget makes it a plain assertion with no polling deadline.
        await takenBy(b, memory, 0)
        expect(run).toHaveBeenCalled()
        expect(await run.mock.results[0].value).toEqual({ kind: 'applied' })
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(b.db.botPresetsId).toBe(2)
        const read = await page.freeze()
        expect(read.db.botPresetsId).toBe(2)
        expect(world.crashed).toEqual([])
    })
})
