/**
 * The connection-key store over a fake vault whose envelopes follow the real v1 layout
 * (`[0x01][keyId 8][IV 12][ciphertext||tag]`, base64), so lengths are realistic; this code treats
 * an envelope as opaque. The fake replaces `src/ts/android/keyVault` only. The host is a plain fake
 * over a `$state` connection list. Keys are synthetic. A mocked vault is not evidence of native
 * Keystore behaviour.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../connections'
import {
    connectionHasKey, connectionKey, connectionKeyForUi, connectionKeyTemporarilyUnavailable,
    connectionNeedsReentry, setConnectionKey,
} from '../keyAccess'
import {
    beginVaultBoot, installVaultHost, KEEP_PLAIN_DEFER_MS, resetVaultStoreForTest, unwrapAllForBoot, vaultKnownPlaintexts,
    vaultLeaveFlush, VaultKeyUnavailableError, whenVaultReady, wrapPlainKeysAfterLoad,
    type VaultHost, type VaultPlatform,
} from '../keyVaultStore.svelte'

type Code = 'invalidated' | 'unreadable' | 'unavailable' | 'timeout' | 'other'

const fake = vi.hoisted(() => {
    const s = {
        wraps: [] as string[],
        unwraps: [] as string[],
        hold: false,
        held: [] as Array<() => void>,
        wrapCode: null as string | null,
        unwrapCodes: new Map<string, string>(),
        mismatch: false,
        fired: false,
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
        s, enc, dec,
        wrapKey: vi.fn(async (plain: string) => {
            s.wraps.push(plain)
            return gate(s.wrapCode ? { ok: false as const, code: s.wrapCode } : { ok: true as const, value: enc(plain) })
        }),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            const code = s.unwrapCodes.get(envelope)
            if (code) {
                return gate({ ok: false as const, code })
            }
            return gate({ ok: true as const, value: s.mismatch ? 'SYNTH-OTHER' : dec(envelope) })
        }),
        watchdogFired: () => s.fired,
    }
})

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function releaseHeld(): Promise<void> {
    fake.s.hold = false
    const run = fake.s.held.splice(0)
    for (const fn of run) {
        fn()
    }
    await tick()
}

const envelopeOf = (plain: string): string => fake.enc(plain)

let db: { connections: Connection[] }
let calls: { save: number, boot: number, keepPlain: number, wrapped: number, reentry: string[][] }

function mkConn(over: Partial<Connection> = {}): Connection {
    return { id: 'conn-1', name: 'Conn', provider: 'openai', key: '', ...over }
}

function install(platform: VaultPlatform, over: Partial<VaultHost> = {}): void {
    installVaultHost({
        platform,
        findConnection: (id) => db.connections.find((conn) => conn.id === id),
        listConnections: () => db.connections,
        requestSaveNow: () => { calls.save++ },
        markBootWrite: () => { calls.boot++ },
        isReadOnlyPage: () => false,
        notify: {
            keepPlain: () => { calls.keepPlain++ },
            wrapped: () => { calls.wrapped++ },
            reentry: (flagged) => { calls.reentry.push(flagged.map((item) => item.id)) },
        },
        messages: { keyUnavailable: () => 'unavailable-text' },
        ...over,
    })
}

function useDb(list: Connection[]): void {
    const state = $state({ connections: list })
    db = state
}

beforeEach(() => {
    resetVaultStoreForTest()
    fake.s.wraps.length = 0
    fake.s.unwraps.length = 0
    fake.s.held.length = 0
    fake.s.hold = false
    fake.s.wrapCode = null
    fake.s.unwrapCodes.clear()
    fake.s.mismatch = false
    fake.s.fired = false
    fake.s.n = 0
    calls = { save: 0, boot: 0, keepPlain: 0, wrapped: 0, reentry: [] }
    vi.clearAllMocks()
    useDb([mkConn()])
})

afterEach(() => {
    vi.useRealTimers()
})

describe('T10 write rule on the vault platform', () => {
    it('keeps the database untouched until the wrap is verified, then holds only the envelope', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD-KEY' })])
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        const done = setConnectionKey(conn, 'SYNTH-KEY-1234')
        await tick()
        expect(conn.key).toBe('SYNTH-OLD-KEY')
        expect(conn.keyWrapped).toBeUndefined()
        expect(connectionKeyForUi(conn)).toBe('SYNTH-KEY-1234')
        await releaseHeld()
        await releaseHeld()
        await done
        expect(conn.key).toBe('')
        expect(typeof conn.keyWrapped).toBe('string')
        expect(JSON.stringify(db)).not.toContain('SYNTH-KEY-1234')
        expect(connectionKeyForUi(conn)).toBe('SYNTH-KEY-1234')
        expect(await connectionKey(conn)).toBe('SYNTH-KEY-1234')
        expect(calls.boot).toBe(1)
    })

    it('T16 never wraps a reference and never calls the vault off the vault platform', async () => {
        install('vault')
        await setConnectionKey(db.connections[0], '${OPENAI_KEY}')
        expect(db.connections[0].key).toBe('${OPENAI_KEY}')
        expect(fake.s.wraps).toEqual([])
        resetVaultStoreForTest()
        install('none')
        await setConnectionKey(db.connections[0], 'SYNTH-KEY-1234')
        expect(db.connections[0]).toMatchObject({ key: 'SYNTH-KEY-1234' })
        expect(fake.s.wraps).toEqual([])
    })

    it('T11 a failed wrap or a mismatched verify writes the plain key once and notifies', async () => {
        vi.useFakeTimers()
        install('vault')
        fake.s.wrapCode = 'other'
        await setConnectionKey(db.connections[0], 'SYNTH-KEY-1234')
        expect(db.connections[0]).toMatchObject({ key: 'SYNTH-KEY-1234' })
        expect(db.connections[0].keyWrapped).toBeUndefined()
        await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS)
        expect(calls.keepPlain).toBe(1)
        fake.s.wrapCode = null
        fake.s.mismatch = true
        await setConnectionKey(db.connections[0], 'SYNTH-KEY-5678')
        expect(db.connections[0]).toMatchObject({ key: 'SYNTH-KEY-5678' })
        expect(db.connections[0].keyWrapped).toBeUndefined()
    })

    it('an empty value clears both fields synchronously', () => {
        useDb([mkConn({ key: '', keyWrapped: 'E1' })])
        install('vault')
        void setConnectionKey(db.connections[0], '')
        expect(db.connections[0].key).toBe('')
        expect(db.connections[0].keyWrapped).toBeUndefined()
    })
})

describe('T14 pending and coalescing', () => {
    it('serves the typed value everywhere in the same task, and the last of five writes wins with at most two wraps', async () => {
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        for (const value of ['SYNTH-A', 'SYNTH-B', 'SYNTH-C', 'SYNTH-D', 'SYNTH-E']) {
            void setConnectionKey(conn, value)
            expect(connectionKeyForUi(conn)).toBe(value)
            expect(connectionHasKey(conn)).toBe(true)
            expect(await connectionKey(conn)).toBe(value)
        }
        await tick()
        for (let i = 0; i < 6; i++) {
            await releaseHeld()
            fake.s.hold = i < 5
        }
        fake.s.hold = false
        await releaseHeld()
        await tick()
        expect(fake.s.wraps.length).toBeLessThanOrEqual(2)
        expect(fake.s.wraps.at(-1)).toBe('SYNTH-E')
        expect(await connectionKey(conn)).toBe('SYNTH-E')
        expect(conn.key).toBe('')
        expect(fake.dec(conn.keyWrapped as string)).toBe('SYNTH-E')
    })

    it('T18 the swap lands on the live object after the list is replaced, and not on an edited connection', async () => {
        install('vault')
        fake.s.hold = true
        void setConnectionKey(db.connections[0], 'SYNTH-KEY-1234')
        db.connections = db.connections.map((conn) => ({ ...conn }))
        await releaseHeld()
        await releaseHeld()
        expect(db.connections[0].key).toBe('')
        expect(typeof db.connections[0].keyWrapped).toBe('string')

        resetVaultStoreForTest()
        useDb([mkConn()])
        install('vault')
        fake.s.hold = true
        void setConnectionKey(db.connections[0], 'SYNTH-KEY-1234')
        db.connections[0].key = 'SYNTH-EDITED'
        await releaseHeld()
        await releaseHeld()
        expect(db.connections[0]).toMatchObject({ key: 'SYNTH-EDITED' })
        expect(db.connections[0].keyWrapped).toBeUndefined()
        expect(connectionKeyForUi(db.connections[0])).toBe('SYNTH-EDITED')
    })
})

describe('T34b hide fallback', () => {
    it('writes the typed key plain once, requests a save once, then the wrap replaces it', async () => {
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-KEY-1234')
        await tick()
        vaultLeaveFlush()
        expect(conn.key).toBe('SYNTH-KEY-1234')
        expect(calls.save).toBe(1)
        vaultLeaveFlush()
        expect(calls.save).toBe(1)
        expect(connectionKeyForUi(conn)).toBe('SYNTH-KEY-1234')
        await releaseHeld()
        await releaseHeld()
        expect(conn.key).toBe('')
        expect(typeof conn.keyWrapped).toBe('string')
    })

    it('writes nothing and requests no save for a pending entry whose connection was changed directly', async () => {
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-KEY-1234')
        await tick()
        conn.key = 'SYNTH-DIRECT-EDIT'
        vaultLeaveFlush()
        expect(conn.key).toBe('SYNTH-DIRECT-EDIT')
        expect(calls.save).toBe(0)
        await releaseHeld()
        await releaseHeld()
    })
})

describe('key states', () => {
    it('T12 permanent failures need re-entry and keep the envelope; transient ones count as present', async () => {
        const gone = envelopeOf('SYNTH-GONE')
        const bad = envelopeOf('SYNTH-BAD')
        const slow = envelopeOf('SYNTH-SLOW')
        useDb([
            mkConn({ id: 'a', keyWrapped: gone }),
            mkConn({ id: 'b', keyWrapped: bad }),
            mkConn({ id: 'c', keyWrapped: slow }),
        ])
        fake.s.unwrapCodes.set(gone, 'invalidated')
        fake.s.unwrapCodes.set(bad, 'unreadable')
        fake.s.unwrapCodes.set(slow, 'other')
        install('vault')
        await unwrapAllForBoot()
        const [a, b, c] = db.connections
        expect([connectionNeedsReentry(a), connectionHasKey(a), await connectionKey(a)]).toEqual([true, false, ''])
        expect([connectionNeedsReentry(b), connectionHasKey(b)]).toEqual([true, false])
        expect(connectionNeedsReentry(c)).toBe(false)
        expect(connectionHasKey(c)).toBe(true)
        expect(a.keyWrapped).toBe(gone)
        const before = fake.s.unwraps.length
        await expect(connectionKey(c)).rejects.toBeInstanceOf(VaultKeyUnavailableError)
        expect(fake.s.unwraps.length - before).toBe(2)
        fake.s.unwrapCodes.delete(slow)
        expect(await connectionKey(c)).toBe('SYNTH-SLOW')
    })

    it('one attempt only while the watchdog is stalled', async () => {
        const slow = envelopeOf('SYNTH-SLOW')
        useDb([mkConn({ keyWrapped: slow })])
        fake.s.unwrapCodes.set(slow, 'timeout')
        fake.s.fired = true
        install('vault')
        await expect(connectionKey(db.connections[0])).rejects.toThrow('unavailable-text')
        expect(fake.s.unwraps).toHaveLength(1)
    })

    it('T33 platforms without a vault flag every envelope and make no vault call', async () => {
        for (const platform of ['none', 'android-legacy'] as const) {
            resetVaultStoreForTest()
            fake.s.unwraps.length = 0
            useDb([mkConn({ keyWrapped: envelopeOf('SYNTH-FOREIGN') })])
            install(platform)
            const conn = db.connections[0]
            expect(connectionNeedsReentry(conn)).toBe(true)
            expect(connectionHasKey(conn)).toBe(false)
            expect(connectionKeyTemporarilyUnavailable(conn)).toBe(false)
            expect(await connectionKey(conn)).toBe('')
            await unwrapAllForBoot()
            expect(fake.s.unwraps).toEqual([])
        }
    })

    it('the temporarily-unavailable predicate: pending, readable, re-entry, transient and off-vault', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        const conn = db.connections[0]
        expect(connectionKeyTemporarilyUnavailable(conn)).toBe(true)
        expect(fake.s.unwraps).toEqual([])
        await unwrapAllForBoot()
        expect(connectionKeyTemporarilyUnavailable(conn)).toBe(false)
        expect(connectionKeyForUi(conn)).toBe('SYNTH-KEY-1234')

        const other = envelopeOf('SYNTH-OTHER-KEY')
        db.connections.push(mkConn({ id: 'p', keyWrapped: other }))
        fake.s.unwrapCodes.set(other, 'invalidated')
        await unwrapAllForBoot()
        expect(connectionKeyTemporarilyUnavailable(db.connections[1])).toBe(false)
        expect(connectionNeedsReentry(db.connections[1])).toBe(true)

        const slow = envelopeOf('SYNTH-SLOW')
        db.connections.push(mkConn({ id: 'q', keyWrapped: slow }))
        fake.s.unwrapCodes.set(slow, 'other')
        await unwrapAllForBoot()
        expect(connectionKeyTemporarilyUnavailable(db.connections[2])).toBe(true)

        fake.s.hold = true
        void setConnectionKey(db.connections[2], 'SYNTH-TYPED')
        expect(connectionKeyTemporarilyUnavailable(db.connections[2])).toBe(false)
        await releaseHeld()
        await releaseHeld()

        resetVaultStoreForTest()
        install('none')
        expect(connectionKeyTemporarilyUnavailable(db.connections[0])).toBe(false)
    })

    it('T30(a) re-entering one carrier of a flagged envelope leaves the other carrier flagged', async () => {
        const shared = envelopeOf('SYNTH-OLD')
        useDb([mkConn({ id: 'a', keyWrapped: shared }), mkConn({ id: 'b', keyWrapped: shared })])
        fake.s.unwrapCodes.set(shared, 'invalidated')
        install('vault')
        await unwrapAllForBoot()
        const [a, b] = db.connections
        expect(connectionNeedsReentry(a) && connectionNeedsReentry(b)).toBe(true)
        const posts = fake.s.unwraps.length
        await setConnectionKey(a, 'SYNTH-NEW-KEY')
        expect(a.keyWrapped).not.toBe(shared)
        expect(connectionNeedsReentry(a)).toBe(false)
        expect(connectionNeedsReentry(b)).toBe(true)
        expect(connectionHasKey(b)).toBe(false)
        expect(b.keyWrapped).toBe(shared)
        // the verify unwrap of the new envelope is the only post after the boot
        expect(fake.s.unwraps.length - posts).toBe(1)
    })

    it('T30(b) a both-set connection is wrapped with the plain key authoritative; a failure keeps the key and drops the envelope', async () => {
        useDb([mkConn({ id: 'a', key: 'SYNTH-KEY-1234', keyWrapped: 'STALE' }), mkConn({ id: 'b', key: 'SYNTH-KEY-5678', keyWrapped: 'STALE' })])
        install('vault')
        await wrapPlainKeysAfterLoad((line) => /^\$\{[A-Z_]+\}$/.test(line.trim()))
        expect(db.connections[0].key).toBe('')
        expect(fake.dec(db.connections[0].keyWrapped as string)).toBe('SYNTH-KEY-1234')

        resetVaultStoreForTest()
        useDb([mkConn({ key: 'SYNTH-KEY-1234', keyWrapped: 'STALE' })])
        install('vault')
        fake.s.wrapCode = 'other'
        await wrapPlainKeysAfterLoad(() => false)
        expect(db.connections[0]).toMatchObject({ key: 'SYNTH-KEY-1234' })
        expect(db.connections[0].keyWrapped).toBeUndefined()
        expect(calls.keepPlain).toBe(1)
    })

    it('T41 a read-only page wraps nothing but still fills readable', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ id: 'a', keyWrapped: envelope }), mkConn({ id: 'b', key: 'SYNTH-PLAIN-KEY' })])
        install('vault', { isReadOnlyPage: () => true })
        await unwrapAllForBoot()
        await wrapPlainKeysAfterLoad(() => false)
        expect(fake.s.wraps).toEqual([])
        expect(connectionKeyForUi(db.connections[0])).toBe('SYNTH-KEY-1234')
    })
})

describe('T13 boot budget and breaker', () => {
    it('resolves by the budget with replies held, and a late reply still fills the cache', async () => {
        vi.useFakeTimers()
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        fake.s.hold = true
        beginVaultBoot(() => unwrapAllForBoot(), 4000)
        let ready = false
        void whenVaultReady().then(() => { ready = true })
        await vi.advanceTimersByTimeAsync(3999)
        expect(ready).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        expect(ready).toBe(true)
        expect(connectionKeyForUi(db.connections[0])).toBe('')
        fake.s.hold = false
        fake.s.held.splice(0).forEach((fn) => fn())
        await vi.advanceTimersByTimeAsync(1)
        expect(connectionKeyForUi(db.connections[0])).toBe('SYNTH-KEY-1234')
    })

    it('a page that never boots has a resolved ready promise', async () => {
        vi.resetModules()
        const fresh = await import('../keyVaultStore.svelte')
        const outcome = await Promise.race([fresh.whenVaultReady().then(() => 'ready'), tick().then(() => 'hung')])
        expect(outcome).toBe('ready')
        await expect(whenVaultReady()).resolves.toBeUndefined()
    })

    it('the first timeout trips the breaker so migration posts nothing', async () => {
        const slow = envelopeOf('SYNTH-SLOW')
        useDb([mkConn({ id: 'a', keyWrapped: slow }), mkConn({ id: 'b', key: 'SYNTH-PLAIN-KEY' })])
        fake.s.unwrapCodes.set(slow, 'timeout')
        install('vault')
        await unwrapAllForBoot()
        await wrapPlainKeysAfterLoad(() => false)
        expect(fake.s.wraps).toEqual([])
        expect(calls.keepPlain).toBe(1)
        expect(db.connections[1].key).toBe('SYNTH-PLAIN-KEY')
    })

    it('connectionKey awaits an in-flight unwrap with one post', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        fake.s.hold = true
        const boot = unwrapAllForBoot()
        const read = connectionKey(db.connections[0])
        await tick()
        await releaseHeld()
        expect(await read).toBe('SYNTH-KEY-1234')
        await boot
        expect(fake.s.unwraps).toHaveLength(1)
    })
})

describe('reactivity (T36, T37, install bump)', () => {
    it('T36 a derived editor value reruns with the plain once a late unwrap fills readable, and a late invalidated never empties it', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        const seen: string[] = []
        const stop = $effect.root(() => {
            const value = $derived(connectionKeyForUi(db.connections[0]))
            $effect(() => { seen.push(value) })
        })
        flushSync()
        expect(seen).toEqual([''])
        await unwrapAllForBoot()
        flushSync()
        expect(seen).toEqual(['', 'SYNTH-KEY-1234'])
        stop()
    })

    it('T36(b) a late invalidated for an envelope that was never readable leaves the value empty', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        fake.s.unwrapCodes.set(envelope, 'invalidated')
        install('vault')
        const seen: string[] = []
        const stop = $effect.root(() => {
            const value = $derived(connectionKeyForUi(db.connections[0]))
            const needs = $derived(connectionNeedsReentry(db.connections[0]))
            $effect(() => { seen.push(value + '|' + needs) })
        })
        flushSync()
        await unwrapAllForBoot()
        flushSync()
        expect(seen).toEqual(['|false', '|true'])
        stop()
    })

    it('T13 a derived connectionHasKey reruns on a late invalidated', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        fake.s.unwrapCodes.set(envelope, 'invalidated')
        install('vault')
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            const has = $derived(connectionHasKey(db.connections[0]))
            $effect(() => { seen.push(has) })
        })
        flushSync()
        await unwrapAllForBoot()
        flushSync()
        expect(seen).toEqual([true, false])
        stop()
    })

    it('H6 a derived connectionHasKey computed before install reruns at install', () => {
        useDb([mkConn({ keyWrapped: envelopeOf('SYNTH-KEY-1234') })])
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            const has = $derived(connectionHasKey(db.connections[0]))
            $effect(() => { seen.push(has) })
        })
        flushSync()
        expect(seen).toEqual([false])
        install('vault')
        flushSync()
        expect(seen).toEqual([false, true])
        stop()
    })

    it('T37 the readers inside a derived start no vault call and write no state', () => {
        useDb([mkConn({ keyWrapped: envelopeOf('SYNTH-KEY-1234') })])
        install('vault')
        const stop = $effect.root(() => {
            const all = $derived([
                connectionKeyForUi(db.connections[0]), connectionHasKey(db.connections[0]),
                connectionNeedsReentry(db.connections[0]), connectionKeyTemporarilyUnavailable(db.connections[0]),
            ])
            $effect(() => { void all })
        })
        expect(() => flushSync()).not.toThrow()
        expect(fake.s.unwraps).toEqual([])
        expect(fake.s.wraps).toEqual([])
        stop()
    })
})

describe('redaction feed', () => {
    it('lists pending and readable plains', async () => {
        const envelope = envelopeOf('SYNTH-READABLE')
        useDb([mkConn({ id: 'a', keyWrapped: envelope }), mkConn({ id: 'b' })])
        install('vault')
        await unwrapAllForBoot()
        fake.s.hold = true
        void setConnectionKey(db.connections[1], 'SYNTH-TYPED-KEY')
        expect(vaultKnownPlaintexts().sort()).toEqual(['SYNTH-READABLE', 'SYNTH-TYPED-KEY'])
        await releaseHeld()
        await releaseHeld()
    })
})

describe('same-value write is a no-op (#495 D1)', () => {
    it('(a) a readable wrapped connection written with its own plain is not wrapped again', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        await unwrapAllForBoot()
        const conn = db.connections[0]
        const before = fake.s.wraps.length
        await setConnectionKey(conn, 'SYNTH-KEY-1234')
        await tick()
        expect(fake.s.wraps.length).toBe(before)
        expect(conn.keyWrapped).toBe(envelope)
        expect(conn.key).toBe('')
        expect(calls.boot).toBe(0)
        expect(calls.wrapped).toBe(0)
    })

    it('(b) the same plain written during a pending wrap wraps once and the swap still lands', async () => {
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        const first = setConnectionKey(conn, 'SYNTH-KEY-1234')
        const second = setConnectionKey(conn, 'SYNTH-KEY-1234')
        await tick()
        await releaseHeld()
        await releaseHeld()
        await first
        await second
        expect(fake.s.wraps).toEqual(['SYNTH-KEY-1234'])
        expect(conn.key).toBe('')
        expect(fake.dec(conn.keyWrapped as string)).toBe('SYNTH-KEY-1234')
    })

    it('(c) a plain-kept key on vault written with the same plain still wraps', async () => {
        useDb([mkConn({ key: 'SYNTH-KEY-1234' })])
        install('vault')
        const conn = db.connections[0]
        await setConnectionKey(conn, 'SYNTH-KEY-1234')
        expect(fake.s.wraps).toEqual(['SYNTH-KEY-1234'])
        expect(conn.key).toBe('')
        expect(typeof conn.keyWrapped).toBe('string')
    })

    it('(d) a different value still wraps again', async () => {
        const envelope = envelopeOf('SYNTH-KEY-1234')
        useDb([mkConn({ keyWrapped: envelope })])
        install('vault')
        await unwrapAllForBoot()
        const conn = db.connections[0]
        await setConnectionKey(conn, 'SYNTH-KEY-5678')
        expect(fake.s.wraps).toEqual(['SYNTH-KEY-5678'])
        expect(conn.keyWrapped).not.toBe(envelope)
        expect(fake.dec(conn.keyWrapped as string)).toBe('SYNTH-KEY-5678')
    })

    it('G10 guard: a pending entry whose precondition was broken from outside the store does not make a same-value write redundant', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD-PLAIN' })])
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-TYPED-NEW')
        await tick()
        // A database replace outside the vault store changes the connection under the pending entry, so the entry can no longer settle.
        conn.key = 'SYNTH-OTHER'
        void setConnectionKey(conn, 'SYNTH-TYPED-NEW')
        await releaseHeld()
        await tick()
        await tick()
        expect(conn.key).toBe('')
        expect(fake.dec(conn.keyWrapped as string)).toBe('SYNTH-TYPED-NEW')
        expect(connectionKeyForUi(conn)).toBe('SYNTH-TYPED-NEW')
    })
})

describe('boot step 3 never replaces a pending typed key (regression reproducers)', () => {
    const valueOf = (conn: Connection): string => (conn.key !== '' ? conn.key : (conn.keyWrapped ? fake.dec(conn.keyWrapped as string) : ''))

    it('G9d-ii: typed after the old wrap was posted, replies in order', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD' })])
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        const boot = wrapPlainKeysAfterLoad(() => false)
        await tick()
        const typed = setConnectionKey(conn, 'SYNTH-TYPED')
        await tick()
        await releaseHeld()
        await boot
        await typed
        await tick()

        expect(valueOf(conn)).toBe('SYNTH-TYPED')
    })

    it('G9d-fc: typed first, the old reply released first', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD' })])
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-TYPED')
        await tick()
        const boot = wrapPlainKeysAfterLoad(() => false)
        await tick()
        // The two length checks only guard the release by index: the typed wrap is first, the old wrap second.
        expect(fake.s.held.length).toBe(2)
        fake.s.held.splice(1, 1)[0]()
        await tick()
        expect(fake.s.held.length).toBe(2)
        fake.s.held.splice(1, 1)[0]()
        await tick()
        await boot
        await releaseHeld()
        await tick()
        await tick()

        expect(conn.key).toBe('')
        expect(valueOf(conn)).toBe('SYNTH-TYPED')
    })

    it('G9e: a both-set connection whose old wrap fails first keeps the typed key', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD', keyWrapped: envelopeOf('SYNTH-OLD') })])
        install('vault')
        fake.s.hold = true
        fake.s.wrapCode = 'other'
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-TYPED')
        await tick()
        const boot = wrapPlainKeysAfterLoad(() => false)
        await tick()
        fake.s.held.splice(1, 1)[0]()
        await tick()
        await boot
        await releaseHeld()
        await tick()
        await tick()

        expect(valueOf(conn)).toBe('SYNTH-TYPED')
    })

    it('G9d-i: typed first, replies in order (compatibility guard: passes before and after)', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD' })])
        install('vault')
        fake.s.hold = true
        const conn = db.connections[0]
        void setConnectionKey(conn, 'SYNTH-TYPED')
        await tick()
        const boot = wrapPlainKeysAfterLoad(() => false)
        await tick()
        await releaseHeld()
        await boot
        await releaseHeld()
        await tick()

        expect(conn.key).toBe('')
        expect(valueOf(conn)).toBe('SYNTH-TYPED')
    })

    it('G9d-ii-t: typed after the old wrap was posted and every wrap times out (compatibility guard: passes before and after)', async () => {
        useDb([mkConn({ key: 'SYNTH-OLD' })])
        install('vault')
        fake.s.hold = true
        fake.s.wrapCode = 'timeout'
        const conn = db.connections[0]
        const boot = wrapPlainKeysAfterLoad(() => false)
        await tick()
        const typed = setConnectionKey(conn, 'SYNTH-TYPED')
        await tick()
        await releaseHeld()
        await boot
        await typed
        await tick()

        expect(valueOf(conn)).toBe('SYNTH-TYPED')
    })
})

describe('keep-plain notice waits for typing to pause (#495 D4)', () => {
    it('(e) legacy host: keepPlain runs once, KEEP_PLAIN_DEFER_MS after the last write', async () => {
        vi.useFakeTimers()
        install('android-legacy')
        const conn = db.connections[0]
        for (const value of ['S', 'SY', 'SYN']) {
            await setConnectionKey(conn, value)
            await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS - 1)
        }
        expect(calls.keepPlain).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(calls.keepPlain).toBe(1)
        await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS * 2)
        expect(calls.keepPlain).toBe(1)
        expect(conn.key).toBe('SYN')
    })

    it('(f) vault host whose wrap fails: the notice is deferred the same way', async () => {
        vi.useFakeTimers()
        install('vault')
        fake.s.wrapCode = 'other'
        const conn = db.connections[0]
        await setConnectionKey(conn, 'SYNTH-KEY-1234')
        expect(conn.key).toBe('SYNTH-KEY-1234')
        expect(calls.keepPlain).toBe(0)
        await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS - 1)
        expect(calls.keepPlain).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(calls.keepPlain).toBe(1)
    })

    it('(g) a failure then a successful swap within the window never notifies', async () => {
        vi.useFakeTimers()
        install('vault')
        fake.s.wrapCode = 'other'
        const conn = db.connections[0]
        await setConnectionKey(conn, 'SYNTH-KEY-1234')
        fake.s.wrapCode = null
        await setConnectionKey(conn, 'SYNTH-KEY-5678')
        expect(typeof conn.keyWrapped).toBe('string')
        await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS * 2)
        expect(calls.keepPlain).toBe(0)
        expect(calls.wrapped).toBe(1)
    })

    it('(h) a pending notice runs at once on the leave flush and not again when the timer would fire', async () => {
        vi.useFakeTimers()
        install('android-legacy')
        await setConnectionKey(db.connections[0], 'SYNTH-KEY-1234')
        expect(calls.keepPlain).toBe(0)
        vaultLeaveFlush()
        expect(calls.keepPlain).toBe(1)
        await vi.advanceTimersByTimeAsync(KEEP_PLAIN_DEFER_MS * 2)
        expect(calls.keepPlain).toBe(1)
    })
})