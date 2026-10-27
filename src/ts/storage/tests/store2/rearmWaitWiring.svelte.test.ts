/**
 * The page's store2 loop port wires `rearmWait` by transport, once, when the port is built (`saveDbStore2`). Runs the real
 * loop over the in-memory kit with every loop sleep parked (a frozen page delivers no timer): after a failed pass the loop
 * sits in its back-off, and a save request either ends that back-off (Android transport) or leaves it to its timer
 * (every other transport). The operating-system plugin is a box. Mocked store; not native WebView evidence.
 * Labels: wiring guard (passes on the base for the non-Android case, fails on it for the Android case).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Hooks, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

const osBox = vi.hoisted(() => ({ os: 'android' as string }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

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
    osBox.os = 'android'
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

/** Fails the commit write of the pass that takes the snapshot, while `on`. */
function failingCommit() {
    const fault = {
        on: false,
        hits: 0,
        hooks: {
            before: async (name: string) => {
                if (name === 'commitOrdinary' && fault.on) {
                    fault.hits += 1
                    throw new Error('the commit write failed')
                }
            },
        } satisfies Hooks,
    }
    return fault
}

async function startPage(db: Database, hooks: Hooks): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, hooks })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db }
}

async function savedPersonality(k: Store2Kit, index: number): Promise<unknown> {
    return ((await k.saved()).characters[index] as unknown as Entry).personality
}

/** The page is idle, every sleep is parked, and one failed pass has put the loop into its back-off. */
async function pageInBackOff(): Promise<{ w: World, k: Store2Kit, db: Entry, fault: ReturnType<typeof failingCommit> }> {
    const fault = failingCommit()
    const page = await startPage(buildSmall(4), fault.hooks)
    await settled(page.w)
    h.parked.add(page.w.id)
    await sleepReal(200)
    fault.on = true
    characters(page.db)[2].personality = 'first edit'
    page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
    page.w.api.requestSaveNow()
    await until(() => fault.hits >= 1, 'the failed pass')
    await sleepReal(200)
    fault.on = false
    return { ...page, fault }
}

describe('the page port ends a back-off on a save request only on the Android transport', () => {
    test('on the Android transport one save request ends the back-off and the next pass commits', async () => {
        osBox.os = 'android'
        const page = await pageInBackOff()

        characters(page.db)[2].personality = 'second edit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()

        await until(async () => (await savedPersonality(page.k, 2)) === 'second edit', 'the pass after the back-off', 3000)
    })

    // Guard: passes before and after the change; the timed sleep of every other transport is kept.
    test.each(['other', 'windows', 'linux', 'macos'])('guard: on the %s transport a save request leaves the back-off to its timer', async (os) => {
        osBox.os = os
        const page = await pageInBackOff()

        characters(page.db)[2].personality = 'second edit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()
        await sleepReal(600)

        expect(await savedPersonality(page.k, 2)).not.toBe('second edit')
    })
})
