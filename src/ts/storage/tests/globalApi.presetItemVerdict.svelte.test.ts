/**
 * `isItemUnsavable` and the production preset ack subject against the real store2 loop (Tauri kind, in-memory backend):
 * read inside the next-commit callback, they speak for the commit that fired the callback. A bot preset the loop cannot
 * encode holds the whole preset list, reported as `presets:presets`; a working setting it cannot encode is reported as
 * `settings:<key>`. Mocked store; not native WebView evidence.
 *
 * Labels: new-rule guards over the real loop (the export is missing before the change); each row except G1 (a baseline
 * guard that passes under every mutant) fails under a named mutant of `globalApi.svelte.ts` or the verdict.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
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
type Verdict = 'saved' | 'unsavable' | 'blocked'

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
    vi.restoreAllMocks()
})

const presetsOf = (db: Entry): Entry[] => db.botPresets as Entry[]
// A value JSON cannot store, and one that a reactive proxy can hold.
const unstorable = (): bigint => 10n

interface Page {
    w: World
    k: Store2Kit
    db: Entry
}

/** Starts the loop over a live database that `arrange` has changed before the loop's first pass. */
async function startPage(seed: Database, arrange: (live: Entry) => void = () => {}): Promise<Page> {
    const live = JSON.parse(JSON.stringify(seed)) as Entry
    const k = await startStore2({ db: seed })
    arrange(live)
    h.db = live
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    await settled(w)
    return { w, k, db: h.db }
}

/** Marks the preset list, asks for a save now, and reads `read` inside the callback of the commit that follows. */
async function afterCommit<T>(page: Page, read: () => T): Promise<T> {
    const result = new Promise<T>((resolve) => {
        page.w.api.afterNextSaveCommit(() => { resolve(read()) })
    })
    page.w.marks.markDbWrite({ kind: 'setting', key: 'botPresets' })
    page.w.api.requestSaveNow()
    return result
}

const carried = (page: Page) => page.w.api.isItemUnsavable('presets', 'presets')

// Built in the world's own module graph, so its `isItemUnsavable` is the loop's; imported before the commit so the verdict is read synchronously inside the callback.
async function verdictOf(): Promise<(id: string) => Verdict> {
    const { productionPresetAckSubject } = await import('src/ts/studio/edit/saveAck.svelte')
    const subject = productionPresetAckSubject()
    if (subject.kind !== 'preset') {
        throw new Error('The production subject is not a preset subject.')
    }
    return (id) => subject.verdict(id)
}

// A seed whose presets carry the ids the product mints at load.
function seedOf(): Database {
    const seed = buildSmall(2)
    presetsOf(seed as unknown as Entry).forEach((preset, index) => { preset.id = `preset-${index}` })
    return seed
}

describe('isItemUnsavable inside the next-commit callback', () => {
    test('G1 a clean commit reports no carried preset list', async () => {
        const page = await startPage(seedOf())
        presetsOf(page.db)[0].name = 'renamed'
        expect(await afterCommit(page, () => carried(page))).toBe(false)
    })

    test('G2 a preset holding a value JSON cannot store reports the carried list, and the production subject says blocked', async () => {
        const page = await startPage(seedOf())
        presetsOf(page.db)[1].temperature = unstorable()
        const verdict = await verdictOf()
        const seen = await afterCommit(page, () => ({ carried: carried(page), verdict: verdict('preset-0') }))
        expect(seen).toEqual({ carried: true, verdict: 'blocked' })
    })

    test('G3 once the preset is repaired, the next commit reports it cleared and the subject says saved', async () => {
        const page = await startPage(seedOf())
        presetsOf(page.db)[1].temperature = unstorable()
        expect(await afterCommit(page, () => carried(page))).toBe(true)
        presetsOf(page.db)[1].temperature = 99
        const verdict = await verdictOf()
        const seen = await afterCommit(page, () => ({ carried: carried(page), verdict: verdict('preset-0') }))
        expect(seen).toEqual({ carried: false, verdict: 'saved' })
    })

    test('G4b a preset deleted before a clean commit is blocked, and a live one is saved', async () => {
        const page = await startPage(seedOf())
        const verdict = await verdictOf()
        expect(await afterCommit(page, () => verdict('preset-1'))).toBe('saved')
        presetsOf(page.db).splice(1, 1)
        expect(await afterCommit(page, () => verdict('preset-1'))).toBe('blocked')
    })

    test('G4b a preset whose id another preset also holds is blocked', async () => {
        const page = await startPage(seedOf(), (live) => { presetsOf(live)[1].id = 'preset-0' })
        const verdict = await verdictOf()
        expect(await afterCommit(page, () => verdict('preset-0'))).toBe('blocked')
    })

    test('G5b a faulty preset list stays reported when a second item joins and the item set changes', async () => {
        const page = await startPage(seedOf())
        presetsOf(page.db)[1].temperature = unstorable()
        expect(await afterCommit(page, () => carried(page))).toBe(true)
        // The set changes with `presets:presets` standing in `current` but not in `newly`.
        page.db.mainPrompt = unstorable()
        const seen = await afterCommit(page, () => ({ carried: carried(page), setting: page.w.api.isItemUnsavable('settings', 'mainPrompt') }))
        expect(seen).toEqual({ carried: true, setting: true })
    })

    test('G7 a refused working setting is reported as a settings item, so the preset verdict is unsavable', async () => {
        const page = await startPage(seedOf())
        page.db.customPromptTemplateToggle = unstorable()
        const verdict = await verdictOf()
        const seen = await afterCommit(page, () => ({ setting: page.w.api.isItemUnsavable('settings', 'customPromptTemplateToggle'), verdict: verdict('preset-0') }))
        expect(seen).toEqual({ setting: true, verdict: 'unsavable' })
    })

    test('G6 a notice that throws does not leave the key set stale: the callback still sees the carried list, now and at the next commit', async () => {
        const page = await startPage(seedOf())
        const alert = await import('src/ts/alert')
        let throwToast = false
        vi.mocked(alert.alertToast).mockImplementation(() => {
            if (throwToast) {
                throw new Error('toast')
            }
        })
        throwToast = true
        presetsOf(page.db)[1].temperature = unstorable()
        expect(await afterCommit(page, () => carried(page))).toBe(true)
        expect(vi.mocked(alert.alertToast)).toHaveBeenCalled()
        expect(await afterCommit(page, () => carried(page))).toBe(true)
        throwToast = false
    })
})
