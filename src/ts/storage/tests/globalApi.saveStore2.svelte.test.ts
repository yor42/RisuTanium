/**
 * `saveDb()` over an active store2 session: the real, unmocked `saveDb()` dispatches to the store2 loop, the real
 * change effects watch a reactive `DBState`, and the store is an in-memory store2 backend (see `store2SaveKit.ts`).
 * A page without a session runs the loop it always ran. A mocked success here is not evidence of native backend
 * behaviour.
 *
 * Labels: new behaviour (a property the store2 loop is built to have), guard (passes with or without the change),
 * mutant (a recorded temporary edit that turns the named test red).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb, mainFileMutations, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, createPeerDouble, peerCommit, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import type { ActiveStream } from 'src/ts/process/activeStreams'
import type { Database, character } from 'src/ts/storage/database.svelte'

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
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and an edit is noticed only by them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The kit gives each world a fresh module graph with its own copy of Svelte's runtime; the state and the effects
    // must share one runtime, so the factory runs inside the world's graph.
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
    /** The database the loop and the change effects read: a reactive proxy. */
    db: Entry
    stores: typeof import('src/ts/stores.svelte')
    flush(): void
}

interface PageOptions extends Partial<Store2StartOptions> {
    /** The database the page runs on, when it differs from the one the store was seeded from. */
    live?: Database
    /** Runs after the page is arranged and before the loop starts (the boot window is open only then). */
    beforeStart?: (page: Page) => Promise<void> | void
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

/** Starts the loop of a store2 session over a reactive `DBState`, as the application runs it. */
async function startPage(db: Database, options: PageOptions = {}): Promise<Page> {
    const { beforeStart, live, ...kitOptions } = options
    h.db = (live ?? db) as unknown as Entry
    const k = await startStore2({ db, ...kitOptions })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db, stores, flush: flushSync }
    await beforeStart?.(page)
    w.start()
    await sleepReal(150)
    return page
}

/** Runs `action` and waits for the pass it causes; answers the unit types the store gained. */
async function commitAfter(page: Page, action: () => void): Promise<string[]> {
    await settled(page.w)
    const mark = page.k.memory.snapshot()
    await nextCommit(page.w, () => {
        action()
        page.flush()
    })
    return page.k.writtenSince(mark)
}

const small = () => buildSmall(4)

describe('guard: a profile without a store2 session runs the loop it always ran', () => {
    test('no session is active in a world that boots a block profile, and a save commits into the block store', async () => {
        h.db = makeDb('base', ['alpha', 'beta'])
        const w = await worlds.startWorld()
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).toBeNull()
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'edited'
            w.marks.markCharacterForSave('alpha')
        })
        expect(rootWrites(w.store).length).toBeGreaterThan(0)
        expect(mainFileMutations(w.store)).toEqual([])
    })
})

describe('new behaviour: the seam dispatches to the store2 loop only with an active session', () => {
    test('a session is active, saves go to the store2 backend and nothing is written to the byte store', async () => {
        const page = await startPage(small())
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        await commitAfter(page, () => {
            characters(page.db)[2].personality = 'edited'
            page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        })
        expect(page.k.counted.writeCalls()).toBeGreaterThan(0)
        expect(page.w.store.ops.filter(op => op.kind === 'write' || op.kind === 'delete')).toEqual([])
        expect((await page.k.saved()).characters[2]).toMatchObject({ personality: 'edited' })
        // The commit is announced to the other tabs with the epoch of the commit key.
        expect(h.broadcasts).toHaveLength(1)
        expect(h.broadcasts[0]).toMatchObject({ epoch: (await page.k.commitKey()).epoch })
    })
})

describe('new behaviour: every mark path reaches the encoder (the edit is in the store afterwards)', () => {
    test('1. an effect: a field of the selected character (6b)', async () => {
        const page = await startPage(small())
        await settled(page.w)
        page.stores.selectedCharID.set(0)
        page.flush()
        await commitAfter(page, () => {
            characters(page.db)[0].personality = 'selected edit'
        })
        expect((await page.k.saved()).characters[0]).toMatchObject({ personality: 'selected edit' })
    })

    test('2. the identity tracker: a replaced element', async () => {
        const page = await startPage(small())
        await commitAfter(page, () => {
            const replaced = JSON.parse(JSON.stringify(characters(page.db)[1])) as Entry
            replaced.personality = 'replaced element'
            characters(page.db)[1] = replaced
        })
        expect((await page.k.saved()).characters[1]).toMatchObject({ personality: 'replaced element' })
    })

    test('3. markCharacterForSave: an in-place edit of a character that is not selected', async () => {
        const page = await startPage(small())
        await commitAfter(page, () => {
            characters(page.db)[2].personality = 'explicitly marked'
            page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        })
        expect((await page.k.saved()).characters[2]).toMatchObject({ personality: 'explicitly marked' })
    })

    test('4. the boot window: an import that wrote before it closed counts as unsaved work, and a pass runs for it', async () => {
        // A page's first-run effects ask for a pass of their own, so the boot window's answer shows only as one more
        // request than the same page makes without it.
        const plain = await startPage(small())
        const baseline = plain.w.api.getSaveMarkCount()
        worlds.parkAll()
        const page = await startPage(small(), {
            beforeStart: async () => {
                const { markBootWrite } = await import('src/ts/bootWindow')
                markBootWrite()
            },
        })
        expect(page.w.api.getSaveMarkCount()).toBe(baseline + 1)
    })
    test('5. the full-reload flag: every resident character is written', async () => {
        const page = await startPage(small())
        await commitAfter(page, () => {
            characters(page.db)[3].personality = 'whole-resident edit'
            page.w.api.requiresFullEncoderReload.state = true
            // A mark of an id no character holds only asks for a pass.
            page.w.marks.markCharacterForSave('no-such-character')
        })
        expect((await page.k.saved()).characters[3]).toMatchObject({ personality: 'whole-resident edit' })
        expect(page.w.api.requiresFullEncoderReload.state).toBe(false)
    })

    test('6. the live character check: a repair of the list sets the full-reload flag and the pass writes the repaired list', async () => {
        const page = await startPage(small())
        await settled(page.w)
        characters(page.db)[1].personality = 'edit beside a repair'
        ;(page.db.characters as unknown[]).push(null)
        page.flush()
        await until(async () => ((await page.k.saved()).characters[1] as unknown as Entry).personality === 'edit beside a repair', 'the repaired pass', 6000)
        expect((await page.k.saved()).characters).toHaveLength(4)
    })

    test('7. save now: a request ends the debounce and the pass runs at once', async () => {
        const page = await startPage(small())
        await settled(page.w)
        characters(page.db)[2].personality = 'requested now'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()
        // Well inside the 500 ms debounce.
        await until(async () => ((await page.k.saved()).characters[2] as unknown as Entry).personality === 'requested now', 'the immediate pass', 300)
    })
})

describe('new behaviour: the hide path saves the last edit', () => {
    test('an edit made before the page is hidden is saved at once, and the modules are carried', async () => {
        const page = await startPage(small())
        await settled(page.w)
        const { installSaveOnHide } = await import('src/ts/process/saveOnHide')
        const chaId = String(characters(page.db)[2].chaId)
        const streams: ActiveStream[] = [{ chaId, replyChatId: 'reply' }]
        const doc = { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'hidden' as DocumentVisibilityState }
        const handlers: EventListenerOrEventListenerObject[] = []
        const win = { addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => { handlers.push(handler) }, removeEventListener: vi.fn() }
        installSaveOnHide({
            doc,
            win,
            kinds: () => ['chat'],
            streams: () => streams,
            mark: page.w.marks.markCharacterForSave,
            saveNow: page.w.api.requestSaveNow,
        })
        const mark = page.k.memory.snapshot()
        // The reply streamed so far: an in-place edit of a character that is not selected, with no mark of its own.
        characters(page.db)[2].personality = 'last words'
        page.flush()
        ;(handlers[0] as EventListener)(new Event('pagehide'))
        // Well inside the 500 ms debounce.
        await until(async () => ((await page.k.saved()).characters[2] as unknown as Entry).personality === 'last words', 'the pass at hide', 300)
        // Guard: the pass carried the modules (no module effect flagged them), so only the character and its shard changed.
        expect(page.k.writtenSince(mark)).toEqual(['characterCore', 'manifest', 'shard'])
    })
})
describe('new behaviour: a no-change pass writes nothing', () => {
    test('a mark with no edit commits no unit and no commit key, and callbacks still fire', async () => {
        const page = await startPage(small())
        await settled(page.w)
        page.k.counted.reset()
        await nextCommit(page.w, () => page.w.marks.markCharacterForSave(characters(page.db)[1].chaId))
        expect(page.k.counted.writeCalls()).toBe(0)
        expect(h.broadcasts).toEqual([])
    })
})

describe('guard: dependency closure through the real loop, each field changes the expected units and nothing else', () => {
    const cases: Array<[string, (db: Entry) => void, string[]]> = [
        ['a preset (6a is not a config-only mapping)', db => { ((db.botPresets as Entry[])[1]).temperature = 999 }, ['manifest', 'preset']],
        ['pluginV2', db => { ((db.pluginV2 as Entry[])[0]).enabled = false }, ['manifest', 'plugin']],
        ['plugins', db => { ((db.plugins as Entry[])[1]).version = 9 }, ['manifest', 'plugin']],
        ['characterOrder', db => { (db.characterOrder as string[]).reverse() }, ['manifest', 'order']],
        ['statics', db => { db.statics = { messages: 99 } }, ['manifest', 'statics']],
        ['loadouts', db => { db.loadouts = [{ name: 'one' }] }, ['loadouts', 'manifest']],
        ['a plugin storage value', db => { ((db.pluginCustomStorage as Entry)['plugin-3'] as Entry).counter = 77 }, ['manifest', 'pluginStorageBucket', 'pluginStorageValue']],
        ['a config field', db => { db.username = 'Someone Else' }, ['configRoot', 'manifest']],
        ['a module (flagged by its effect)', db => { ((db.modules as Entry[])[1]).description = 'flagged edit' }, ['manifest', 'module', 'moduleIndex']],
    ]
    test.each(cases)('%s', async (_label, mutate, expected) => {
        const page = await startPage(small())
        const written = await commitAfter(page, () => mutate(page.db))
        expect(written).toEqual(expected)
    })

    const owned: Array<[string, (character: Entry) => void, string[]]> = [
        ['a character core field', character => { character.personality = 'new personality' }, ['characterCore', 'manifest', 'shard']],
        ['a lore entry', character => { ((character.globalLore as Entry[])[0]).content = 'new lore' }, ['lore', 'manifest', 'shard']],
        ['a script', character => { character.customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }] }, ['manifest', 'scripts', 'shard']],
        ['a chat message', character => { ((((character.chats as Entry[])[0]).message as Entry[])[0]).data = 'edited message' }, ['chatChunk', 'manifest', 'shard']],
        ['a chat core field', character => { (character.chats as Entry[])[0].note = 'a note' }, ['chatCore', 'manifest', 'shard']],
    ]
    test.each(owned)('a marked character: %s', async (_label, mutate, expected) => {
        const page = await startPage(small())
        const written = await commitAfter(page, () => {
            mutate(characters(page.db)[0])
            page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        })
        expect(written).toEqual(expected)
    })

    test('a stub\'s trashTime writes its shard and the manifest and encodes no character', async () => {
        const db = small()
        const live = JSON.parse(JSON.stringify(db)) as Database
        const source = JSON.parse(JSON.stringify(characters(live as unknown as Entry)[1])) as Entry
        characters(live as unknown as Entry)[1] = buildColdStub(source as unknown as character, 'unit-key', ['chat-a']) as unknown as Entry
        const page = await startPage(db, { live })
        const written = await commitAfter(page, () => {
            characters(page.db)[1].trashTime = 1234
            page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        })
        expect(written).toEqual(['manifest', 'shard'])
    })
})
describe('new behaviour: a stub that shares its id with a resident character', () => {
    async function sharedPage(loadStub: (chaId: string) => Promise<boolean>): Promise<Page> {
        const db = small()
        const live = JSON.parse(JSON.stringify(db)) as Database
        const full = JSON.parse(JSON.stringify(characters(live as unknown as Entry)[1])) as Entry
        const slots = characters(live as unknown as Entry)
        slots[1] = buildColdStub(full as unknown as character, 'unit-key', ['chat-a']) as unknown as Entry
        slots.push(JSON.parse(JSON.stringify(full)) as Entry)
        const holder: { page: Page | null } = { page: null }
        holder.page = await startPage(db, {
            live,
            loadStub: async (chaId) => {
                const loaded = await loadStub(chaId)
                if (loaded && holder.page !== null) {
                    characters(holder.page.db)[1] = JSON.parse(JSON.stringify(full)) as Entry
                }
                return loaded
            },
        })
        return holder.page
    }

    test('the stub is loaded and the retried pass saves', async () => {
        const loaded: string[] = []
        const page = await sharedPage(async (chaId) => { loaded.push(chaId); return true })
        await commitAfter(page, () => {
            characters(page.db)[0].personality = 'saved with the retry'
            page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        })
        expect(loaded.length).toBeGreaterThanOrEqual(1)
        expect((await page.k.saved()).characters[0]).toMatchObject({ personality: 'saved with the retry' })
    })

    test('a stub that stays unloaded blocks the save and the person is told through the save-failure path', async () => {
        const page = await sharedPage(async () => false)
        const { alertError, alertToast } = await import('src/ts/alert')
        characters(page.db)[0].personality = 'blocked edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        await until(() => vi.mocked(alertError).mock.calls.length >= 1, 'the error alert after the fifth failed pass', 8000)
        expect(vi.mocked(alertToast)).toHaveBeenCalledWith('Failed to save data, retrying…')
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain('held by more than one character')
        expect(page.k.counted.writeCalls()).toBe(0)
    })
})

describe('new behaviour: a peer\'s commit parks the page and the person decides', () => {
    function broadcastFromPeer(epoch: string | null) {
        h.channels.at(-1)!.onmessage?.({ data: epoch === null ? 'a peer tab' : { sessionID: 'a peer tab', epoch } })
    }

    test('with unsaved edits: Reload is first and the default, and Save mine is offered', async () => {
        const page = await startPage(small(), { peer: createPeerDouble('reload') })
        await settled(page.w)
        const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
        characters(page.db)[0].personality = 'my edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        broadcastFromPeer(key.epoch)
        await until(() => page.k.peer.asked.length >= 1, 'the prompt', 6000)
        expect(page.k.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] })
        await until(() => page.k.peer.reloads === 1, 'the reload', 4000)
        expect(page.k.counted.writeCalls()).toBe(0)
    })

    test('without unsaved edits: the page is told once and offered the reload action', async () => {
        const page = await startPage(small())
        await settled(page.w)
        const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
        broadcastFromPeer(key.epoch)
        await until(() => page.k.peer.clean.length >= 1, 'the notice', 6000)
        expect(page.k.peer.clean[0]).toMatchObject({ unsaved: false, offers: ['reload'] })
        expect(page.k.peer.asked).toEqual([])
    })

    test('on Node: Reload or export this tab first, never Save mine', async () => {
        const page = await startPage(small(), { kind: 'node' })
        await settled(page.w)
        const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
        characters(page.db)[0].personality = 'my edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        broadcastFromPeer(key.epoch)
        await until(() => page.k.peer.asked.length >= 1, 'the prompt', 6000)
        expect(page.k.peer.asked[0].offers).toEqual(['reload', 'export-first'])
    })
})
