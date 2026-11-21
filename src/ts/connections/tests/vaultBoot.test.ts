/**
 * The REAL `vaultBoot.ts` driven end to end: real `keyVaultStore`, real `vaultNotifier`, real
 * `storedConnections`, real `language` texts. Only the outermost edges are replaced: the Android vault
 * adapter (a fake whose envelopes follow the v1 layout, opaque to this code), the host channel and
 * transport probes, the alert sink, the page-storage mode, the boot-write mark, the save request, the
 * leave-flush registration and the database accessor. Keys are synthetic. A mocked vault is not
 * evidence of native Keystore behaviour.
 *
 * Regression reproducer for a boot that threw a swallowed ReferenceError (a missing import), so the
 * host was never installed: every test here goes through the real `vaultBoot` and observes the
 * installed host through the public readers, so a throw before or at install fails them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import type { Connection } from '../connections'
import { connectionKeyForUi } from '../keyAccess'
import {
    resetVaultStoreForTest, vaultPlatform, whenVaultReady,
} from '../keyVaultStore.svelte'
import { VAULT_BOOT_BUDGET_MS, vaultBoot } from '../vaultBoot'

const fake = vi.hoisted(() => {
    const s = {
        wraps: [] as string[],
        unwraps: [] as string[],
        hold: false,
        held: [] as Array<() => void>,
        wrapCode: null as string | null,
        unwrapCodes: new Map<string, string>(),
        n: 0,
    }
    const enc = (plain: string): string => {
        s.n += 1
        const body = Buffer.concat([
            Buffer.from([1]), Buffer.alloc(8, s.n), Buffer.alloc(12, 7), Buffer.from(plain, 'utf8'), Buffer.alloc(16, 9),
        ])
        return body.toString('base64')
    }
    const dec = (envelope: string): string => {
        const body = Buffer.from(envelope, 'base64')
        return body.subarray(21, body.length - 16).toString('utf8')
    }
    const gate = <T,>(value: T): Promise<T> => (s.hold ? new Promise<T>((resolve) => { s.held.push(() => resolve(value)) }) : Promise.resolve(value))
    return {
        s, enc,
        wrapKey: vi.fn(async (plain: string) => {
            s.wraps.push(plain)
            return gate(s.wrapCode ? { ok: false as const, code: s.wrapCode } : { ok: true as const, value: enc(plain) })
        }),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            const code = s.unwrapCodes.get(envelope)
            return gate(code ? { ok: false as const, code } : { ok: true as const, value: dec(envelope) })
        }),
    }
})

const edges = vi.hoisted(() => ({
    android: true,
    channel: true,
    readOnly: false,
    connections: [] as unknown[],
    dbThrows: false,
    leaveFlushThrows: false,
    notices: [] as string[],
    bootWrites: 0,
    registered: 0,
}))

const staging = vi.hoisted(() => ({
    data: new Map<string, unknown>(),
    removed: [] as string[],
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            ready: async () => {},
            keys: async () => [...staging.data.keys()],
            getItem: async (key: string) => (staging.data.has(key) ? staging.data.get(key) : null),
            setItem: async (key: string, value: unknown) => { staging.data.set(key, value); return value },
            removeItem: async (key: string) => { staging.removed.push(key); staging.data.delete(key) },
            clear: async () => { staging.data.clear() },
        }),
    },
}))

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: () => false,
}))

vi.mock('src/ts/android/hostBridge', () => ({
    hostChannelPresent: () => edges.channel,
}))

vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => edges.android,
}))

vi.mock('src/ts/alertPrompts', () => ({
    queueNotice: (message: string) => { edges.notices.push(message) },
}))

vi.mock('src/ts/bootWindow', () => ({
    markBootWrite: () => { edges.bootWrites++ },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    requestSaveNow: vi.fn(),
}))

vi.mock('src/ts/process/saveOnHide', () => ({
    registerLeaveFlush: () => {
        edges.registered++
        if (edges.leaveFlushThrows) {
            throw new Error('register boom')
        }
        return () => {}
    },
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => {
        if (edges.dbThrows) {
            throw new Error('database boom')
        }
        return { connections: edges.connections }
    },
}))

vi.mock('src/ts/storage/pageStorageMode', () => ({
    getPageStorageMode: () => ({ kind: edges.readOnly ? 'read-only' : 'writable' }),
}))

function mkConn(over: Partial<Connection> = {}): Connection {
    return { id: 'conn-1', name: 'Conn', provider: 'openai', key: '', ...over }
}

function setConnections(list: Connection[]): void {
    edges.connections = list
}

async function releaseHeld(): Promise<void> {
    fake.s.hold = false
    for (const fn of fake.s.held.splice(0)) {
        fn()
    }
    await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
    vi.useFakeTimers()
    resetVaultStoreForTest()
    fake.s.wraps.length = 0
    fake.s.unwraps.length = 0
    fake.s.held.length = 0
    fake.s.hold = false
    fake.s.wrapCode = null
    fake.s.unwrapCodes.clear()
    fake.wrapKey.mockClear()
    fake.unwrapKey.mockClear()
    edges.android = true
    edges.channel = true
    edges.readOnly = false
    edges.connections = []
    edges.dbThrows = false
    edges.leaveFlushThrows = false
    edges.notices.length = 0
    edges.bootWrites = 0
    edges.registered = 0
    staging.data.clear()
    staging.removed.length = 0
    localStorage.clear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('vaultBoot on Android with the channel', () => {
    it('installs the host, reads a wrapped key, and step 3 wraps a plain non-reference key', async () => {
        const wrappedA = fake.enc('SYNTH-READ-A')
        const connA = mkConn({ id: 'conn-a', name: 'A', keyWrapped: wrappedA })
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        const connRef = mkConn({ id: 'conn-r', name: 'R', key: '${SYNTH_REF}' })
        setConnections([connA, connB, connRef])

        const handle = vaultBoot()
        expect(vaultPlatform()).toBe('vault')
        expect(edges.registered).toBe(1)

        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        expect(connectionKeyForUi(connA)).toBe('SYNTH-READ-A')
        expect(fake.s.unwraps).toEqual([wrappedA])
        expect(fake.s.wraps).toEqual([])
        expect(edges.bootWrites).toBe(0)

        await handle.afterLoad()

        expect(fake.s.wraps).toEqual(['SYNTH-PLAIN-B'])
        expect(connB.key).toBe('')
        expect(typeof connB.keyWrapped).toBe('string')
        expect(connectionKeyForUi(connB)).toBe('SYNTH-PLAIN-B')
        expect(connRef.key).toBe('${SYNTH_REF}')
        expect(connRef.keyWrapped).toBeUndefined()
        expect(edges.bootWrites).toBe(1)
        expect(edges.notices).toEqual([])
    })

    it('T41 a read-only page makes 0 wraps in step 3 but steps 1-2 still fill readable', async () => {
        edges.readOnly = true
        const wrappedA = fake.enc('SYNTH-READ-A')
        const connA = mkConn({ id: 'conn-a', name: 'A', keyWrapped: wrappedA })
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        setConnections([connA, connB])

        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle.afterLoad()

        expect(connectionKeyForUi(connA)).toBe('SYNTH-READ-A')
        expect(fake.s.wraps).toEqual([])
        expect(connB.key).toBe('SYNTH-PLAIN-B')
        expect(connB.keyWrapped).toBeUndefined()
        expect(edges.bootWrites).toBe(0)
    })
})

describe('vaultBoot step 1: the staged keys of a .rtb restore', () => {
    function seed(): { wCarrier: Connection, pCarrier: Connection, wNew: string } {
        const envW = fake.enc('SYNTH-OLD-W')
        const envP = fake.enc('SYNTH-OLD-P')
        const wNew = fake.enc('SYNTH-STAGED-W')
        const wCarrier = mkConn({ id: 'conn-w', name: 'W', keyWrapped: envW })
        const pCarrier = mkConn({ id: 'conn-p', name: 'P', keyWrapped: envP })
        setConnections([wCarrier, pCarrier])
        staging.data.set(envW, { id: 'conn-w', w: wNew })
        staging.data.set(envP, { id: 'conn-p', p: 'SYNTH-STAGED-P' })
        return { wCarrier, pCarrier, wNew }
    }

    it('applies a {w} record and a {p} record before step 2 unwraps, so only the new envelope is posted', async () => {
        const { wCarrier, pCarrier, wNew } = seed()

        vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()

        expect(wCarrier.keyWrapped).toBe(wNew)
        expect(fake.s.unwraps).toEqual([wNew])
        expect(connectionKeyForUi(wCarrier)).toBe('SYNTH-STAGED-W')
        expect(connectionKeyForUi(pCarrier)).toBe('SYNTH-STAGED-P')
    })

    it('a read-only page applies nothing from the staging store', async () => {
        edges.readOnly = true
        const { wCarrier, pCarrier } = seed()
        const before = wCarrier.keyWrapped

        vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()

        expect(wCarrier.keyWrapped).toBe(before)
        expect(connectionKeyForUi(pCarrier)).toBe('SYNTH-OLD-P')
        expect(staging.removed).toEqual([])
        expect(edges.bootWrites).toBe(0)
    })
})

describe('vaultBoot on the other platforms', () => {
    it('none: no vault call, no throw, keys untouched', async () => {
        edges.android = false
        edges.channel = false
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        setConnections([connB])

        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await expect(handle.afterLoad()).resolves.toBeUndefined()

        expect(vaultPlatform()).toBe('none')
        expect(fake.wrapKey).not.toHaveBeenCalled()
        expect(fake.unwrapKey).not.toHaveBeenCalled()
        expect(connB.key).toBe('SYNTH-PLAIN-B')
        expect(connB.keyWrapped).toBeUndefined()
        expect(edges.notices).toEqual([])
    })

    it('android-legacy: the keep-plain notice shows for a plain key and nothing is posted', async () => {
        edges.channel = false
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        setConnections([connB])

        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle.afterLoad()

        expect(vaultPlatform()).toBe('android-legacy')
        expect(fake.wrapKey).not.toHaveBeenCalled()
        expect(fake.unwrapKey).not.toHaveBeenCalled()
        expect(connB.key).toBe('SYNTH-PLAIN-B')
        expect(edges.notices).toEqual([language.vaultKeepPlainNotice])
    })
})

describe('vaultBoot budget and breaker', () => {
    it('an unwrap that never answers lets whenVaultReady resolve at the budget; a late answer still fills readable', async () => {
        const wrappedA = fake.enc('SYNTH-LATE-A')
        const connA = mkConn({ id: 'conn-a', name: 'A', keyWrapped: wrappedA })
        setConnections([connA])
        fake.s.hold = true

        vaultBoot()
        let ready = false
        void whenVaultReady().then(() => { ready = true })

        await vi.advanceTimersByTimeAsync(VAULT_BOOT_BUDGET_MS - 1)
        expect(ready).toBe(false)
        expect(connectionKeyForUi(connA)).toBe('')

        await vi.advanceTimersByTimeAsync(1)
        expect(ready).toBe(true)
        expect(connectionKeyForUi(connA)).toBe('')

        await releaseHeld()
        expect(connectionKeyForUi(connA)).toBe('SYNTH-LATE-A')
    })

    it('a step 2 timeout trips the breaker: step 3 posts nothing and gives the keep-plain notice', async () => {
        const wrappedA = fake.enc('SYNTH-A')
        fake.s.unwrapCodes.set(wrappedA, 'timeout')
        const connA = mkConn({ id: 'conn-a', name: 'A', keyWrapped: wrappedA })
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        setConnections([connA, connB])

        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle.afterLoad()

        expect(fake.s.wraps).toEqual([])
        expect(connB.key).toBe('SYNTH-PLAIN-B')
        expect(edges.notices).toEqual([language.vaultKeepPlainNotice])
    })

    it('a step 3 wrap timeout stops the later plain keys from being posted', async () => {
        fake.s.wrapCode = 'timeout'
        const connB = mkConn({ id: 'conn-b', name: 'B', key: 'SYNTH-PLAIN-B' })
        const connC = mkConn({ id: 'conn-c', name: 'C', key: 'SYNTH-PLAIN-C' })
        setConnections([connB, connC])

        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle.afterLoad()

        expect(fake.s.wraps).toEqual(['SYNTH-PLAIN-B'])
        expect(connB.key).toBe('SYNTH-PLAIN-B')
        expect(connC.key).toBe('SYNTH-PLAIN-C')
        expect(edges.notices).toEqual([language.vaultKeepPlainNotice])
    })
})

describe('vaultBoot needs-re-entry notice cadence (MC-3077) through the real notifier', () => {
    async function bootOnce(list: Connection[]): Promise<void> {
        resetVaultStoreForTest()
        setConnections(list)
        const handle = vaultBoot()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle.afterLoad()
    }

    it('shows once for a flagged set, not again for the same set, again after the set changes', async () => {
        const envA = fake.enc('SYNTH-A')
        const envB = fake.enc('SYNTH-B')
        fake.s.unwrapCodes.set(envA, 'invalidated')
        fake.s.unwrapCodes.set(envB, 'unreadable')
        const mk = (withB: boolean) => [
            mkConn({ id: 'conn-a', name: 'Alpha', keyWrapped: envA }),
            ...(withB ? [mkConn({ id: 'conn-b', name: 'Beta', keyWrapped: envB })] : []),
        ]

        await bootOnce(mk(false))
        expect(edges.notices).toEqual([language.vaultNeedsReentryNotice('Alpha')])

        await bootOnce(mk(false))
        expect(edges.notices).toHaveLength(1)

        await bootOnce(mk(true))
        expect(edges.notices).toEqual([
            language.vaultNeedsReentryNotice('Alpha'),
            language.vaultNeedsReentryNotice('Alpha, Beta'),
        ])
    })
})

describe('vaultBoot never throws into its caller', () => {
    it('a throwing database lookup does not escape vaultBoot, whenVaultReady or afterLoad, and the host is installed', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        edges.dbThrows = true

        let handle: ReturnType<typeof vaultBoot> | undefined
        expect(() => { handle = vaultBoot() }).not.toThrow()
        expect(vaultPlatform()).toBe('vault')

        await vi.advanceTimersByTimeAsync(0)
        await expect(whenVaultReady()).resolves.toBeUndefined()
        await expect(handle?.afterLoad()).resolves.toBeUndefined()
        expect(errors).toHaveBeenCalled()
    })

    it('a throwing leave-flush registration does not stop the boot and the host stays installed', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        edges.leaveFlushThrows = true
        const wrappedA = fake.enc('SYNTH-READ-A')
        const connA = mkConn({ id: 'conn-a', name: 'A', keyWrapped: wrappedA })
        setConnections([connA])

        let handle: ReturnType<typeof vaultBoot> | undefined
        expect(() => { handle = vaultBoot() }).not.toThrow()
        await vi.advanceTimersByTimeAsync(0)
        await whenVaultReady()
        await handle?.afterLoad()

        expect(vaultPlatform()).toBe('vault')
        expect(connectionKeyForUi(connA)).toBe('SYNTH-READ-A')
        expect(errors).toHaveBeenCalled()
    })
})
