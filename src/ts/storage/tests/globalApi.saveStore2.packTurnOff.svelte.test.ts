/**
 * TA-15: the theme pack turn-off of the boot banner through the real store2 save loop. `turnOffThemePack()` deletes the
 * active id and restores the scheme, then marks a boot write. A tap before the loop starts (the boot window is open) must
 * be saved by the first pass even though the change effects' first run takes the deletion into its baseline, and a tap after
 * the loop is live is saved by the next pass. After either, the committed profile holds no `activeThemePack`, no snapshot
 * and the restored scheme.
 *
 * Same world as `globalApi.saveStore2.themePacks.svelte.test.ts`: the real, unmocked `saveDb()` over a reactive `DBState`
 * that carries the write hook, an in-memory store2 backend. A mocked success here is not evidence of native backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The turn-off restores the scheme through the real colour module.
    vi.doUnmock('src/ts/gui/colorscheme')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        // No explicit write hook: the deletion must be saved by the boot-write mark alone, which is what this file proves.
        const DBState = proxy({ db: {} as Entry })
        const selectedCharID = writable(-1)
        return {
            DBState,
            selectedCharID,
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(null),
            frozenSaveKeysStore: writable([]),
            CustomCSSStore: writable(''),
            SafeModeStore: writable(false),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        writeColdStorageUnit: async () => 'written',
        readColdStorageItem: async () => ({ status: 'missing' }),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doUnmock('src/ts/storage/svelteStatePatch')
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
}

const USER = { bgcolor: '#101820', darkbg: '#0a1016', borderc: '#445566', selected: '#223344', draculared: '#ff5555', textcolor: '#e0e8f0', textcolor2: '#a0a8b0', darkBorderc: '#334455', darkbutton: '#203040', type: 'dark' }
const PACK_COPY = { ...USER, bgcolor: '#ff00ff', textcolor: '#ff00ff' }

/** A profile whose active pack paints its scheme over the user's own: the state a pack turn-on leaves. */
function packProfile(): Database {
    return {
        ...buildSmall(2),
        activeThemePack: 'builtin:banana-cocoa',
        colorScheme: structuredClone(PACK_COPY),
        colorSchemeName: 'theme-pack',
        themePackSchemeSnapshot: { name: 'custom', scheme: structuredClone(USER) },
        customColorScheme: structuredClone(USER),
    } as unknown as Database
}

/**
 * Starts the loop over `packProfile()`. `beforeStart` runs after the page is arranged and before the loop starts, which is
 * the boot window; the turn-off is called there for the early tap.
 */
async function startPage(beforeStart?: () => void | Promise<void>): Promise<Page> {
    const db = packProfile()
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    await beforeStart?.()
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db, flush: flushSync }
}

async function tap(): Promise<void> {
    const { turnOffThemePack } = await import('src/ts/themePack/turnOff')
    turnOffThemePack()
}

async function savedProfile(page: Page): Promise<Entry> {
    return (await page.k.saved()) as unknown as Entry
}

describe('TA-15: the turn-off is saved whether the tap lands before or after the save loop starts', () => {
    test('the seeded profile holds the pack and its scheme', async () => {
        const page = await startPage()
        await settled(page.w)
        const saved = await savedProfile(page)
        expect(saved.activeThemePack).toBe('builtin:banana-cocoa')
        expect(saved.colorSchemeName).toBe('theme-pack')
    })

    test('a tap before saveDb() starts: the memory has no pack at once, and the first pass saves the deletion and the restored scheme', async () => {
        const page = await startPage(async () => {
            await tap()
            const stores = await import('src/ts/stores.svelte')
            expect((stores.DBState.db as unknown as Entry).activeThemePack).toBeUndefined()
        })
        await settled(page.w)
        expect(Object.hasOwn(page.db, 'activeThemePack')).toBe(false)
        const saved = await savedProfile(page)
        expect(Object.hasOwn(saved, 'activeThemePack')).toBe(false)
        expect(saved.colorSchemeName).toBe('custom')
        expect(saved.colorScheme).toEqual(USER)
        expect(Object.hasOwn(saved, 'themePackSchemeSnapshot')).toBe(false)
    })

    test('a tap before saveDb() starts counts as unsaved work and asks for one more pass than the same page without a tap', async () => {
        // The first-run effects ask for a pass of their own, so the boot window's answer shows only as one more request.
        const plain = await startPage()
        const baseline = plain.w.api.getSaveMarkCount()
        worlds.parkAll()
        const page = await startPage(tap)
        expect(page.w.api.getSaveMarkCount()).toBe(baseline + 1)
    })
    test('a tap after the loop is live is saved by the next pass', async () => {
        const page = await startPage()
        await settled(page.w)
        await nextCommit(page.w, async () => {
            await tap()
            page.flush()
        })
        await settled(page.w)
        const saved = await savedProfile(page)
        expect(Object.hasOwn(saved, 'activeThemePack')).toBe(false)
        expect(saved.colorSchemeName).toBe('custom')
        expect(Object.hasOwn(saved, 'themePackSchemeSnapshot')).toBe(false)
    })
})
