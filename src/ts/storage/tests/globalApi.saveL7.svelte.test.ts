/**
 * L7 mechanism reproducers: an edit that raised no save mark is invisible to `dirtySinceLastSave`, so a parked tab
 * offered the clean prompt and Reload discarded it. The unmarked edit is synthetic (an in-place write to a character
 * that is not selected, with no `markCharacterForSave`); no field producer is known. Mocked success here is not
 * evidence of native backend behaviour.
 *
 * Labels: reproducer (fails on the base for the defect itself), guard (passes with or without the change), new
 * behaviour (exercises the Reload request, which the base does not have, so it cannot run there).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, createPeerDouble, peerCommit, type Hooks, type PeerDouble, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { PARK_CHECK_MAX_MS } from 'src/ts/storage/store2/saveLoop'
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
}

interface PageOptions extends Partial<Store2StartOptions> {
    beforeStart?: (page: Page) => Promise<void> | void
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

/**
 * The world's `sleep` shortens every wait to a few milliseconds, which would make the loop's 20 s judgement deadline
 * elapse during a slow check and answer dirty. The deadline sleep keeps its length; every other wait is unchanged.
 */
async function honourCheckDeadline(): Promise<void> {
    const util = await import('src/ts/util')
    const sleep = vi.mocked(util.sleep)
    const shortened = sleep.getMockImplementation()
    sleep.mockImplementation((ms: number) => ms === PARK_CHECK_MAX_MS
        ? new Promise<void>((resolve) => setTimeout(resolve, ms))
        : (shortened ?? ((): Promise<void> => Promise.resolve()))(ms))
}

async function startPage(db: Database, options: PageOptions = {}): Promise<Page> {
    const { beforeStart, ...kitOptions } = options
    h.db = db as unknown as Entry
    const k = await startStore2({ db, ...kitOptions })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    await honourCheckDeadline()
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db }
    await beforeStart?.(page)
    w.start()
    await sleepReal(150)
    return page
}

const small = () => buildSmall(4)

function broadcastFromPeer(epoch: string) {
    h.channels.at(-1)!.onmessage?.({ data: { sessionID: 'a peer tab', epoch } })
}

/** The person has not answered the unsaved question: a question asked stays open. */
function unanswered(peer: PeerDouble): void {
    peer.hold = new Promise<void>(() => { })
}

/** An in-place write the marks never see: the character is not selected and `markCharacterForSave` is not called. */
function unmarkedEdit(page: Page): void {
    characters(page.db)[0].personality = 'an edit no mark saw'
    expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)
}

async function peerSaves(page: Page): Promise<void> {
    const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
    broadcastFromPeer(key.epoch)
}

/** What the person ends with after Reload is pressed on whichever prompt the loop showed: nothing reloaded, the unsaved question asked. */
async function expectNotLost(page: Page, press = true): Promise<void> {
    const peer = page.k.peer
    await until(() => peer.clean.length + peer.asked.length >= 1, 'a prompt', 8000)
    if (press && peer.clean.length >= 1) {
        await peer.pressReload()
    }
    await sleepReal(400)
    expect(peer.reloads).toBe(0)
    expect(peer.asked[0]).toMatchObject({ unsaved: true })
}

describe('reproducer (mechanism, synthetic unmarked edit): an edit no mark saw is not lost to Reload on a parked tab', () => {
    test('(a) a net tick found the edit dirty and parked on the peer commit before it landed', async () => {
        let kit: Store2Kit | null = null
        let dirtySeen = false
        let peered = false
        const hooks: Hooks = {
            before: async (name) => {
                if (name === 'readCommit' && dirtySeen && !peered && kit !== null) {
                    peered = true
                    await peerCommit(kit, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
                }
            },
        }
        const idleNet = { intervalMs: 100, moduleIntervalMs: 1_000_000_000, backstopMs: 0 }
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), {
            idleNet,
            peer,
            hooks,
            beforeStart: (started) => {
                kit = started.k
                const encoder = started.k.encoder
                const real = encoder.verdictOf.bind(encoder)
                encoder.verdictOf = (slot) => {
                    const verdict = real(slot)
                    if (verdict === 'dirty') {
                        dirtySeen = true
                    }
                    return verdict
                }
            },
        })
        await settled(page.w)
        unmarkedEdit(page)
        await expectNotLost(page, false)
        expect(peered).toBe(true)
    })

    test('(b) the edit was made before the park and the net had not reached it', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        unmarkedEdit(page)
        await peerSaves(page)
        await expectNotLost(page)
    })

    test('(c) the edit was made while the clean prompt was already up', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerSaves(page)
        await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
        unmarkedEdit(page)
        await expectNotLost(page)
    })
})

describe('guard: a parked tab with nothing unsaved still gets the clean prompt and Reload reloads', () => {
    for (const kind of ['tauri', 'node'] as const) {
        test(`${kind}: no question, no automatic export, the page is not dirtied by the check`, async () => {
            const peer = createPeerDouble('reload')
            const page = await startPage(small(), { kind, idleNet: { intervalMs: 1_000_000_000 }, peer })
            await settled(page.w)
            await peerSaves(page)
            await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
            await peer.pressReload()
            await sleepReal(400)
            expect(peer.reloads).toBe(1)
            expect(peer.asked).toEqual([])
            expect(peer.autoExports).toEqual([])
            expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)
        })
    }
})

describe('new behaviour: a mark that arrives while the Reload check runs is not reloaded away', () => {
    test('a marked edit after its slot was verdicted clean asks the unsaved question and reloads nothing', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        let pressing = false
        let edited = false
        const page = await startPage(small(), {
            idleNet: { intervalMs: 1_000_000_000 },
            peer,
            beforeStart: (started) => {
                const encoder = started.k.encoder
                const real = encoder.verdictOf.bind(encoder)
                encoder.verdictOf = (slot) => {
                    const verdict = real(slot)
                    if (pressing && !edited) {
                        edited = true
                        const target = slot as unknown as Entry
                        target.personality = 'a reply that settled during the check'
                        started.w.marks.markCharacterForSave(String(target.chaId))
                    }
                    return verdict
                }
            },
        })
        await settled(page.w)
        await peerSaves(page)
        await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
        pressing = true
        // The loop's own answer: a mark that arrived while the residents were judged outranks the clean verdict.
        expect(await peer.requests[0]()).toBe('dirty')
        await sleepReal(400)
        expect(edited).toBe(true)
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        expect(peer.reloads).toBe(0)
        expect(peer.asked[0]).toMatchObject({ unsaved: true })
    })

    test('a mark that lands after the loop answered clean, before the press reads the page again, reloads nothing (PeerDouble press; peerUi.test pins the real re-read)', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerSaves(page)
        await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
        const real = peer.requests[0]
        let answered: string | null = null
        peer.requests[0] = async () => {
            const verdict = await real()
            answered = verdict
            const target = characters(page.db)[1]
            target.personality = 'a reply that settled after the answer'
            page.w.marks.markCharacterForSave(String(target.chaId))
            return verdict
        }
        await peer.pressReload()
        await sleepReal(400)
        expect(answered).toBe('clean')
        expect(peer.reloads).toBe(0)
        expect(peer.asked[0]).toMatchObject({ unsaved: true })
    })
})
