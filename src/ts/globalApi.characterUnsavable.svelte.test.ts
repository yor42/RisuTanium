// @vitest-environment jsdom
/**
 * `isCharacterUnsavable` mirrors the characters the store2 loop's latest pass reported as unsavable:
 * the real, unmocked `saveDb()` over an in-memory store2 backend (see `store2SaveKit.ts`). The legacy
 * loop never reports any. A mocked success here is not evidence of native backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'

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
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

async function startPage(): Promise<Page> {
    const db = buildSmall(4)
    h.db = db as unknown as Entry
    const k = await startStore2({ db })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    const { sleepReal } = await import('src/ts/storage/tests/saveLoopWorld')
    await sleepReal(150)
    return { w, k, db: h.db, flush: flushSync }
}

const unreadable = (): Entry => ({ toJSON() { throw new Error('toJSON fault') } })

describe('T-A8: isCharacterUnsavable follows the latest pass', () => {
    test('two unsavable characters, one fixed: only the other is reported; none after both are fixed', async () => {
        const page = await startPage()
        await settled(page.w)
        const first = characters(page.db)[1]
        const second = characters(page.db)[3]
        const firstId = String(first.chaId)
        const secondId = String(second.chaId)
        expect(page.w.api.isCharacterUnsavable(firstId)).toBe(false)

        await nextCommit(page.w, () => {
            first.personality = unreadable()
            second.personality = unreadable()
            page.w.marks.markCharacterForSave(firstId)
            page.w.marks.markCharacterForSave(secondId)
            page.flush()
        }, false)
        await until(() => page.w.api.isCharacterUnsavable(firstId) && page.w.api.isCharacterUnsavable(secondId), 'both reported', 6000)
        expect(page.w.api.isCharacterUnsavable(String(characters(page.db)[0].chaId))).toBe(false)

        // Only the first is fixed, and only the second is named by the latest pass.
        await nextCommit(page.w, () => {
            first.personality = 'fixed'
            page.w.marks.markCharacterForSave(firstId)
            page.flush()
        }, false)
        await until(() => !page.w.api.isCharacterUnsavable(firstId), 'the first to be dropped', 6000)
        expect(page.w.api.isCharacterUnsavable(secondId)).toBe(true)

        await nextCommit(page.w, () => {
            second.personality = 'fixed too'
            page.w.marks.markCharacterForSave(secondId)
            page.flush()
        }, false)
        await until(() => !page.w.api.isCharacterUnsavable(secondId), 'the second to be dropped', 6000)
    })

    // New-behaviour guard, not a pre-fix reproducer: the notice key does not exist on the pre-fix base. Its sensitivity to
    // the page hook is shown by mutants M17 (isSaveClean ignores the count), M17b (no toast) and M23 (front skips ignored).
    test('L7 guard (new rule): a preset list that cannot be saved is told once, keeps the page not clean, and is clean again after the fix', async () => {
        const page = await startPage()
        await settled(page.w)
        const presets = page.db.botPresets as Entry[]
        const { alertToast } = await import('src/ts/alert')
        const { language } = await import('src/lang')
        const notice = language.savePresetsHeldNotice('"Preset 1"')
        const toasts = (): number => vi.mocked(alertToast).mock.calls.filter(([shown]) => shown === notice).length
        expect(page.w.api.isSaveClean()).toBe(true)

        await nextCommit(page.w, () => {
            presets[1].temperature = unreadable()
            characters(page.db)[2].personality = 'edited next to the held preset list'
            page.w.marks.markCharacterForSave(String(characters(page.db)[2].chaId))
            page.flush()
        }, false)
        await until(() => toasts() >= 1, 'the notice', 6000)
        expect((await page.k.saved()).characters[2]).toMatchObject({ personality: 'edited next to the held preset list' })
        expect(page.w.api.isSaveClean()).toBe(false)
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)

        await nextCommit(page.w, () => {
            presets[1].temperature = 99
            characters(page.db)[3].personality = 'edited after the fix'
            page.w.marks.markCharacterForSave(String(characters(page.db)[3].chaId))
            page.flush()
        }, false)
        await until(() => page.w.api.isSaveClean(), 'a clean page after the fix', 6000)
        expect(toasts()).toBe(1)
        expect((await page.k.saved()).botPresets[1]).toMatchObject({ temperature: 99 })
    })

    test('a task preset list that cannot be saved gets the task preset notice, not the bot preset one', async () => {
        const page = await startPage()
        await settled(page.w)
        const { alertToast } = await import('src/ts/alert')
        const { language } = await import('src/lang')
        const notice = language.saveTaskPresetsHeldNotice('"Task A"')
        const botNotice = language.savePresetsHeldNotice('"Task A"')
        expect(notice).not.toBe(botNotice)
        const shown = (text: string): number => vi.mocked(alertToast).mock.calls.filter(([toast]) => toast === text).length

        await nextCommit(page.w, () => {
            page.db.taskPresets = [{ name: 'Task A', broken: unreadable() }]
            characters(page.db)[2].personality = 'edited next to the held task presets'
            page.w.marks.markCharacterForSave(String(characters(page.db)[2].chaId))
            page.flush()
        }, false)
        await until(() => shown(notice) >= 1, 'the task preset notice', 6000)
        expect(shown(botNotice)).toBe(0)
        expect(shown(notice)).toBe(1)
        expect(page.w.api.isSaveClean()).toBe(false)
    })

    test('the legacy loop never reports a character', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld()
        await nextCommit(w, () => {
            ;(h.db!.characters as Entry[])[0].name = 'edited'
            w.marks.markCharacterForSave('alpha')
        })
        expect(w.api.isCharacterUnsavable('alpha')).toBe(false)
        expect(w.api.isCharacterUnsavable('beta')).toBe(false)
    })
})
