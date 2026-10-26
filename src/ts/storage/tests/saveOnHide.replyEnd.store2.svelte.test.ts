/**
 * The reply-end flush against the real store2 save loop (Tauri kind, in-memory backend), with every
 * loop sleep parked: it models a hidden page whose timers stopped. The debounce in the scheduler is a
 * raw `setTimeout`, not the loop's `sleep` dependency, so it still fires here; what stays parked is
 * the loop wait it would have to wake. Mocked store; not native WebView evidence.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Hooks, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
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
    Reflect.deleteProperty(document, 'visibilityState')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

async function startPage(db: Database, hooks?: Hooks): Promise<{ w: World, k: Store2Kit, db: Entry }> {
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

describe('reply-end flush with the loop sleeps parked (store2, tauri kind)', () => {
    // Compatibility guard: passes before and after the change. It documents the defect the flush answers.
    test('guard: a plain mark is not saved while the loop sleeps are parked, even after the raw debounce fires', async () => {
        const page = await startPage(buildSmall(4))
        await settled(page.w)
        h.parked.add(page.w.id)
        await sleepReal(200)
        characters(page.db)[2].personality = 'marked only'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        await sleepReal(1500)

        expect(await savedPersonality(page.k, 2)).not.toBe('marked only')
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
    })

    // Integration check of the new helper against the real loop. It imports the helper, so it cannot run before the change: not a pre-fix reproducer.
    test('a hidden reply end commits the reply although every loop sleep is parked', async () => {
        const page = await startPage(buildSmall(4))
        await settled(page.w)
        h.parked.add(page.w.id)
        await sleepReal(200)
        setVisibility('hidden')
        const { flushPageReplyEndWhenHidden } = await import('src/ts/process/saveOnHide')
        // The edit is made without any mark of its own: the flush must add the origin's mark.
        characters(page.db)[2].personality = 'final reply'
        flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })

        await until(async () => (await savedPersonality(page.k, 2)) === 'final reply', 'the requested pass with parked sleeps', 3000)
    })

    // Compatibility guard: passes before and after the change. A visible page keeps its debounce.
    test('guard: a visible reply end requests nothing', async () => {
        const page = await startPage(buildSmall(4))
        await settled(page.w)
        h.parked.add(page.w.id)
        await sleepReal(200)
        setVisibility('visible')
        const { flushPageReplyEndWhenHidden } = await import('src/ts/process/saveOnHide')
        characters(page.db)[2].personality = 'visible edit'
        flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
        await sleepReal(1500)

        expect(await savedPersonality(page.k, 2)).not.toBe('visible edit')
    })
})

/** Holds every commit write until `open()`; a pass that took its snapshot stalls before it commits. */
function commitGate() {
    let open: () => void = () => {}
    let closed: Promise<void> = Promise.resolve()
    const gate = {
        entered: 0,
        close() {
            closed = new Promise<void>((resolve) => { open = resolve })
        },
        open() {
            open()
        },
        hooks: {
            before: async (name: string) => {
                if (name === 'commitOrdinary' || name === 'putUnit' || name === 'casCommit') {
                    gate.entered += 1
                    await closed
                }
            },
        } satisfies Hooks,
    }
    return gate
}

describe('the save token against the real store2 loop with its commit held', () => {
    async function startHeldPage() {
        const gate = commitGate()
        const page = await startPage(buildSmall(4), gate.hooks)
        await settled(page.w)
        h.parked.add(page.w.id)
        await sleepReal(200)
        setVisibility('hidden')
        const inFlight = await import('src/ts/process/inFlightWork')
        const onHide = await import('src/ts/process/saveOnHide')
        const guard = await import('src/ts/process/hiddenReplySaveGuard')
        // A running page holds the empty string, not null, and a store calls a new subscriber at once.
        const stores = await import('src/ts/stores.svelte')
        stores.savingStoppedReason.set('')
        gate.entered = 0
        return { gate, page, inFlight, onHide, guard }
    }

    test('the token is held while the pass is uncommitted and released by the commit that covers the reply', async () => {
        const { gate, page, inFlight, onHide, guard } = await startHeldPage()
        try {
            gate.close()
            characters(page.db)[2].personality = 'final reply'
            onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
            await until(() => gate.entered > 0, 'the pass to stall at its commit')
            await sleepReal(300)

            expect(inFlight.inFlightKinds()).toEqual(['save'])

            gate.open()
            await until(() => inFlight.inFlightKinds().length === 0, 'the covering commit to release the token', 5000)
            expect(await savedPersonality(page.k, 2)).toBe('final reply')
        } finally {
            gate.open()
            guard.resetHiddenReplySaveGuardForTest()
        }
    })

    // Distinguishes mark-count coverage from the dirty flag: an unrelated edit after the snapshot
    // keeps the flag true, and a frozen page never runs the debounce that would clear it.
    test('an unrelated mark made after the snapshot does not pin the token', async () => {
        const { gate, page, inFlight, onHide, guard } = await startHeldPage()
        try {
            gate.close()
            characters(page.db)[2].personality = 'final reply'
            onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
            await until(() => gate.entered > 0, 'the pass to stall at its commit')
            characters(page.db)[1].personality = 'unrelated edit'
            page.w.marks.markCharacterForSave(characters(page.db)[1].chaId)
            expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)

            gate.open()
            await until(() => inFlight.inFlightKinds().length === 0, 'the covering commit to release the token', 5000)

            expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        } finally {
            gate.open()
            guard.resetHiddenReplySaveGuardForTest()
        }
    })

    // Distinguishes the snapshot's mark count from the live mark count: a pass whose snapshot predates
    // the reply's marks commits without covering them.
    test('a commit whose snapshot predates the reply keeps the token until the next pass lands', async () => {
        const { gate, page, inFlight, onHide, guard } = await startHeldPage()
        try {
            gate.close()
            characters(page.db)[1].personality = 'earlier edit'
            page.w.marks.markCharacterForSave(characters(page.db)[1].chaId)
            page.w.api.requestSaveNow()
            await until(() => gate.entered > 0 && !page.w.api.hasUnsavedSaveMarks(), 'the first pass to take its snapshot and stall')
            characters(page.db)[2].personality = 'final reply'
            onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
            expect(inFlight.inFlightKinds()).toEqual(['save'])

            let kindsAtFirstCommit: string[] | null = null
            page.w.api.afterNextSaveCommit(() => { kindsAtFirstCommit = inFlight.inFlightKinds() })
            gate.open()
            await until(() => kindsAtFirstCommit !== null, 'the first commit', 5000)

            expect(kindsAtFirstCommit).toEqual(['save'])
            await until(() => inFlight.inFlightKinds().length === 0, 'the covering commit to release the token', 5000)
            expect(await savedPersonality(page.k, 2)).toBe('final reply')
        } finally {
            gate.open()
            guard.resetHiddenReplySaveGuardForTest()
        }
    })

    test('saving stopped releases the token, and a stopped save holds none', async () => {
        const { gate, page, inFlight, onHide, guard } = await startHeldPage()
        try {
            gate.close()
            characters(page.db)[2].personality = 'final reply'
            onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
            await until(() => gate.entered > 0, 'the pass to stall at its commit')
            expect(inFlight.inFlightKinds()).toEqual(['save'])
            const stores = await import('src/ts/stores.svelte')

            stores.savingStoppedReason.set('too large')
            expect(inFlight.inFlightKinds()).toEqual([])

            onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
            expect(inFlight.inFlightKinds()).toEqual([])
        } finally {
            gate.open()
            guard.resetHiddenReplySaveGuardForTest()
        }
    })
})
