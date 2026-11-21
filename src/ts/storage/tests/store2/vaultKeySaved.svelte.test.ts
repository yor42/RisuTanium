/**
 * A connection key typed on the vault platform, over the real save loop, the real change effects and the real
 * save-on-hide wiring on an active store2 session whose store is an in-memory backend. What this pins:
 * - T19a: after the verified wrap, the written config unit holds the envelope and no plaintext;
 * - T34a: a save requested before the wrap reply writes the previous value, never the typed key;
 * - T34b: a hide before the reply saves the key plain (nothing else unsaved), a repeat hide asks for no second save,
 *   and the reply's swap is then written as the envelope only.
 * The vault is a fake and the store an in-memory backend, so a pass says nothing about native Keystore behaviour.
 * Keys are synthetic.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import type { Database, StoredDatabase } from 'src/ts/storage/database.svelte'
import type { Connection } from 'src/ts/connections/connections'

vi.setConfig({ testTimeout: 40_000 })

const vault = vi.hoisted(() => ({
    hold: false,
    held: [] as Array<() => void>,
}))

vi.mock('src/ts/android/keyVault', () => {
    const answer = <T,>(value: T): Promise<T> => (vault.hold
        ? new Promise<T>((resolve) => { vault.held.push(() => resolve(value)) })
        : Promise.resolve(value))
    return {
        wrapKey: vi.fn((plain: string) => answer({ ok: true as const, value: Buffer.from('ENV:' + Buffer.from(plain).toString('hex')).toString('base64') })),
        unwrapKey: vi.fn((envelope: string) => answer({
            ok: true as const,
            value: Buffer.from(Buffer.from(envelope, 'base64').toString().slice(4), 'hex').toString(),
        })),
        watchdogFired: () => false,
    }
})

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
    vault.hold = false
    vault.held.length = 0
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/process/modules', () => ({
        moduleUpdate: vi.fn(async () => {}),
        refreshModules: vi.fn(),
        bumpModuleGui: vi.fn(),
    }))
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
    conn: Connection
    saveRequests: () => number
    stopHide: () => void
}

const OLD_KEY = 'SYNTH-OLD-KEY-0001'
const TYPED_KEY = 'SYNTH-TYPED-KEY-0002'

function profile(): Database {
    const db = buildSmall(2)
    ;(db as unknown as Record<string, unknown>).connections = [
        { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: OLD_KEY },
    ]
    return db
}

async function startPage(): Promise<Page> {
    const db = profile()
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    await settled(w)
    const store = await import('src/ts/connections/keyVaultStore.svelte')
    const { registerLeaveFlush, startSaveOnHide } = await import('src/ts/process/saveOnHide')
    const list = () => (h.db as unknown as StoredDatabase).connections as unknown as Connection[]
    let saveRequests = 0
    store.installVaultHost({
        platform: 'vault',
        findConnection: (id) => list().find((conn) => conn.id === id),
        listConnections: list,
        requestSaveNow: () => { saveRequests++; w.api.requestSaveNow() },
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => 'unavailable' },
    })
    registerLeaveFlush(store.vaultLeaveFlush)
    const stopHide = startSaveOnHide()
    return { w, k, conn: list()[0], saveRequests: () => saveRequests, stopHide }
}

async function savedConnections(page: Page): Promise<string> {
    const saved = await page.k.saved() as unknown as StoredDatabase
    return JSON.stringify(saved.connections)
}

async function releaseVault(): Promise<void> {
    vault.hold = false
    for (const fn of vault.held.splice(0)) {
        fn()
    }
    await sleepReal(20)
}

describe('a connection key typed on the vault platform, over the real save loop', () => {
    test('T19a: the written config unit holds the envelope and no plaintext after the verified wrap', async () => {
        const page = await startPage()
        try {
            const { setConnectionKey } = await import('src/ts/connections/keyAccess')
            await setConnectionKey(page.conn, TYPED_KEY)
            await sleepReal(900)
            await settled(page.w)
            const written = await savedConnections(page)
            expect(written).not.toContain(TYPED_KEY)
            expect(written).not.toContain(OLD_KEY)
            expect(written).toContain('keyWrapped')
        } finally {
            page.stopHide()
        }
    })

    test('T34a: a save requested before the wrap reply writes the previous value, never the typed key', async () => {
        const page = await startPage()
        try {
            const { setConnectionKey } = await import('src/ts/connections/keyAccess')
            vault.hold = true
            void setConnectionKey(page.conn, TYPED_KEY)
            page.w.api.requestSaveNow()
            await sleepReal(300)
            await settled(page.w)
            const written = await savedConnections(page)
            expect(written).not.toContain(TYPED_KEY)
            expect(written).toContain(OLD_KEY)
            await releaseVault()
            await releaseVault()
        } finally {
            page.stopHide()
        }
    })

    test('T34b: a hide before the reply saves the key plain once, and the swap is then written as the envelope only', async () => {
        const page = await startPage()
        try {
            const { setConnectionKey } = await import('src/ts/connections/keyAccess')
            vault.hold = true
            void setConnectionKey(page.conn, TYPED_KEY)
            await sleepReal(10)
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
            document.dispatchEvent(new Event('visibilitychange'))
            document.dispatchEvent(new Event('visibilitychange'))
            await sleepReal(300)
            await settled(page.w)
            expect(page.saveRequests()).toBe(1)
            expect(await savedConnections(page)).toContain(TYPED_KEY)
            delete (document as { visibilityState?: unknown }).visibilityState
            await releaseVault()
            await releaseVault()
            await sleepReal(900)
            await settled(page.w)
            const written = await savedConnections(page)
            expect(written).not.toContain(TYPED_KEY)
            expect(written).toContain('keyWrapped')
        } finally {
            delete (document as { visibilityState?: unknown }).visibilityState
            page.stopHide()
        }
    })
})
