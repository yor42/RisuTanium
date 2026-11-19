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

import { changeToPreset, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, runSpyOf, signal, takenBy } from './ffFixtures'

/**
 * Preset meta (id, folder, slot) through the fast-forward: the page's own `changeToPreset` and the fast-forward's
 * production `saveInto` rebuild the entry they leave the same way, so two clean switches over presets that carry meta
 * still resolve as keep. A replay that dropped the meta would differ from the page's save and park every concurrent switch.
 */

beforeEach(() => {
    ffSetup()
    setFastForwardHostForTest(null)
})

afterEach(() => {
    ffTeardown()
})

function chainSwitch(db: Database, to: number): void {
    const held = DBState.db
    DBState.db = db
    try {
        changeToPreset(to, true)
    } finally {
        DBState.db = held
    }
}

const META = [
    { id: 'meta-0', folderId: 'F1', slot: 1 },
    { id: 'meta-1', folderId: 'F2', slot: 2 },
    { id: 'meta-2', slot: 3 },
]

async function world() {
    const base = await ffWorld()
    await base.page.commitEdit((db) => {
        Reflect.set(db, 'NAIsettings', {})
        META.forEach((meta, index) => Object.assign(db.botPresets[index], meta))
    })
    const b = await bootB(base.memory)
    return { ...base, b, loop: runLoopWorld(b.context, b.db) }
}

function markPresetDirty(loop: ReturnType<typeof runLoopWorld>): void {
    loop.tracker.botPreset = true
    loop.state.dirty = true
    loop.state.due = true
}

/**
 * Resolves when the loop reports its first save. The wait is driven by the loop's own `saved` report rather than a
 * polling deadline, so a loaded machine only makes it later; a save that never comes fails at the test timeout.
 */
function firstSave(loop: ReturnType<typeof runLoopWorld>): Promise<void> {
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

describe('A4 two clean preset switches over presets that carry meta', () => {
    test('the last saved switch stays, nothing asks, and every entry keeps its id, folder and slot', async () => {
        const { memory, page, b, loop } = await world()
        const run = runSpyOf(b)
        expect(b.db.botPresets[1]).toMatchObject(META[1])
        const saved = firstSave(loop)
        chainSwitch(b.db, 2)
        markPresetDirty(loop)
        await page.commitEdit((db) => { chainSwitch(db, 1) })
        signal(loop)
        await saved
        // The page's save over the peer's switch leaves its encoding on the store's current manifest, so the check must
        // hold on its first look: a zero budget makes it a plain assertion with no polling deadline.
        await takenBy(b, memory, 0)
        expect(await run.mock.results[0].value).toEqual({ kind: 'applied' })
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(b.db.botPresetsId).toBe(2)
        const next = await page.freeze()
        META.forEach((meta, index) => {
            expect(next.db.botPresets[index]).toMatchObject(meta)
            expect(b.db.botPresets[index]).toMatchObject(meta)
        })
        expect(loop.crashed).toEqual([])
    })
})
