// @vitest-environment jsdom
/**
 * `characterCommitVerdict` over the real, unmocked `saveDb()` loop and encoder on an in-memory store2 backend (the world
 * of `globalApi.characterUnsavable.svelte.test.ts`): what the commit that fires a next-commit callback did with one
 * character. T8 (guard, new rule; the verdict is a new API): the five rows plus the waiter that listens to them. Mutants
 * M12 (`saved` ignores characters), M13 (`skipped` reported as `absent`), M38 (`gone` as `absent`), M43 (the waiter
 * requests on every absent or skipped commit). A mocked success here is not evidence of native backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { createCharacterSavedWaiter } from 'src/ts/nativeReply/characterSaved'
import { stubFromEntry } from 'src/ts/storage/store2/codec'

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
type Verdict = 'saved' | 'skipped' | 'gone' | 'absent'

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

const characters = (db: Entry): Entry[] => db.characters as Entry[]
const unreadable = (): Entry => ({ toJSON() { throw new Error('toJSON fault') } })

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
    await sleepReal(150)
    return { w, k, db: h.db, flush: flushSync }
}

/** Puts the resident character back to the cold stub of the entry the page's acknowledged encoding holds for it. */
function putBackToStub(page: Page, chaId: string): void {
    for (const shard of page.k.context.encoder.acknowledged().objects?.shards ?? []) {
        for (const entry of shard.entries) {
            if (entry.chaId === chaId) {
                const index = characters(page.db).findIndex((slot) => slot.chaId === chaId)
                characters(page.db)[index] = stubFromEntry(entry) as Entry
                return
            }
        }
    }
    throw new Error(`The acknowledged encoding holds no entry for ${chaId}.`)
}

/** Runs `action`, and reports the verdicts the commit it causes gives the named characters, read inside that commit's callback. */
async function verdictsAfter(page: Page, ids: string[], action: () => void): Promise<Verdict[]> {
    let seen: Verdict[] = []
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no save commit within 30 s')), 30000)
        page.w.api.afterNextSaveCommit(() => {
            clearTimeout(timer)
            seen = ids.map((id) => page.w.api.characterCommitVerdict(id))
            resolve()
        })
        action()
    })
    return seen
}

describe('characterCommitVerdict', () => {
    test('a character the pass encoded is saved, and one it did not name is absent', async () => {
        const page = await startPage()
        await settled(page.w)
        const edited = String(characters(page.db)[1].chaId)
        const other = String(characters(page.db)[2].chaId)
        const seen = await verdictsAfter(page, [edited, other], () => {
            characters(page.db)[1].personality = 'edited'
            page.w.marks.markCharacterForSave(edited)
            page.flush()
        })
        expect(seen).toEqual(['saved', 'absent'])
    })

    test('a character that cannot be read keeps its saved copy: skipped', async () => {
        const page = await startPage()
        await settled(page.w)
        const id = String(characters(page.db)[1].chaId)
        const seen = await verdictsAfter(page, [id], () => {
            characters(page.db)[1].personality = unreadable()
            page.w.marks.markCharacterForSave(id)
            page.flush()
        })
        expect(seen).toEqual(['skipped'])
    })

    test('a never-saved character that cannot be read is skipped, not gone', async () => {
        const page = await startPage()
        await settled(page.w)
        const fresh = JSON.parse(JSON.stringify(characters(page.db)[0])) as Entry
        fresh.chaId = 'never-saved-character'
        fresh.name = 'Never saved'
        fresh.personality = unreadable()
        const seen = await verdictsAfter(page, ['never-saved-character'], () => {
            characters(page.db).push(fresh)
            page.w.marks.markCharacterForSave('never-saved-character')
            page.flush()
        })
        expect(seen).toEqual(['skipped'])
    })

    test('a character deleted before the pass is gone', async () => {
        const page = await startPage()
        await settled(page.w)
        const doomed = String(characters(page.db)[3].chaId)
        const kept = String(characters(page.db)[1].chaId)
        const seen = await verdictsAfter(page, [doomed, kept], () => {
            characters(page.db).splice(3, 1)
            characters(page.db)[1].personality = 'edited after the delete'
            page.w.marks.markCharacterForSave(kept)
            page.flush()
        })
        expect(seen).toEqual(['gone', 'saved'])
    })

    test('the waiter on a skipped character requests no pass, however long it waits, and consumes after the fix', async () => {
        const page = await startPage()
        await settled(page.w)
        const id = String(characters(page.db)[1].chaId)
        let requests = 0
        let consumed = 0
        const waiter = createCharacterSavedWaiter({
            committedMarkCount: page.w.api.getCommittedSaveMarkCount,
            markCount: page.w.api.getSaveMarkCount,
            verdict: page.w.api.characterCommitVerdict,
            afterNextCommit: page.w.api.afterNextSaveCommit,
            markCharacter: page.w.marks.markCharacterForSave,
            requestSaveNow: () => { requests += 1; page.w.api.requestSaveNow() },
        })

        characters(page.db)[1].personality = unreadable()
        page.w.marks.markCharacterForSave(id)
        page.flush()
        waiter.watch('k', id, page.w.api.getSaveMarkCount(), () => { consumed += 1 })
        await until(() => page.w.api.isCharacterUnsavable(id), 'the character to be reported unsavable', 6000)
        // One external save of another character, then a stretch of idle-net ticks: the waiter must stay silent.
        characters(page.db)[2].personality = 'another edit'
        page.w.marks.markCharacterForSave(String(characters(page.db)[2].chaId))
        page.flush()
        await sleepReal(1500)
        expect(requests).toBe(0)
        expect(consumed).toBe(0)

        characters(page.db)[1].personality = 'fixed'
        page.w.marks.markCharacterForSave(id)
        page.flush()
        await until(() => consumed === 1, 'the fixed character to be consumed', 6000)
        expect(requests).toBe(0)
    })

    test('a stub slot that is marked and covered is absent', async () => {
        const page = await startPage()
        await settled(page.w)
        const target = characters(page.db)[1]
        const id = String(target.chaId)
        const seen = await verdictsAfter(page, [id], () => {
            putBackToStub(page, id)
            page.w.marks.markCharacterForSave(id)
            page.flush()
        })
        expect(seen).toEqual(['absent'])
    })

    test('the waiter on a stub slot asks for exactly one pass and then only listens', async () => {
        const page = await startPage()
        await settled(page.w)
        const target = characters(page.db)[1]
        const id = String(target.chaId)
        // The slot becomes a stub standing for the saved unit: a later pass carries it and names nothing.
        putBackToStub(page, id)
        let requests = 0
        let consumed = 0
        const waiter = createCharacterSavedWaiter({
            committedMarkCount: page.w.api.getCommittedSaveMarkCount,
            markCount: page.w.api.getSaveMarkCount,
            verdict: page.w.api.characterCommitVerdict,
            afterNextCommit: page.w.api.afterNextSaveCommit,
            markCharacter: page.w.marks.markCharacterForSave,
            requestSaveNow: () => { requests += 1; page.w.api.requestSaveNow() },
        })
        page.w.marks.markCharacterForSave(id)
        page.flush()
        waiter.watch('k', id, page.w.api.getSaveMarkCount(), () => { consumed += 1 })
        await until(() => requests >= 1, 'the one self-request', 8000)
        await sleepReal(1500)
        expect(requests).toBe(1)
        expect(consumed).toBe(0)
    })
})
