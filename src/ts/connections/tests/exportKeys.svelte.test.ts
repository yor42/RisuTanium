/**
 * The export key snapshot and the reader a writer uses after it opened: the snapshot reads wrapped keys once, before the
 * writer, classifying each envelope as read, never readable here (`unreadable`) or not readable right now
 * (`unavailableNow`); the reader is synchronous, keyed by envelope and makes no vault call. The vault is a fake over
 * `src/ts/android/keyVault` with envelopes in the real v1 layout (opaque to this code). Keys are synthetic. A mocked
 * vault is not evidence of native Keystore behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../connections'
import { cloneConnection } from '../connections'
import { setConnectionKey } from '../keyAccess'
import {
    exportKeyReader, exportKeySnapshot, installVaultHost, resetVaultStoreForTest, unwrapAllForBoot,
    type ExportKeySnapshot, type VaultHost, type VaultPlatform,
} from '../keyVaultStore.svelte'

const fake = vi.hoisted(() => {
    const s = {
        unwraps: [] as string[],
        hold: false,
        held: [] as Array<() => void>,
        codes: new Map<string, string>(),
        firstOnly: new Map<string, string>(),
        fired: false,
        n: 0,
    }
    const enc = (plain: string): string => {
        s.n += 1
        return Buffer.concat([
            Buffer.from([1]), Buffer.alloc(8, s.n), Buffer.alloc(12, 7), Buffer.from(plain, 'utf8'), Buffer.alloc(16, 9),
        ]).toString('base64')
    }
    const dec = (envelope: string): string => {
        const body = Buffer.from(envelope, 'base64')
        return body.subarray(21, body.length - 16).toString('utf8')
    }
    const gate = <T,>(value: T): Promise<T> => (s.hold ? new Promise<T>((resolve) => { s.held.push(() => resolve(value)) }) : Promise.resolve(value))
    return {
        s, enc, dec,
        wrapKey: vi.fn(async (plain: string) => gate({ ok: true as const, value: enc(plain) })),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            const first = s.firstOnly.get(envelope)
            if (first !== undefined) {
                s.firstOnly.delete(envelope)
                return { ok: false as const, code: first }
            }
            const code = s.codes.get(envelope)
            return code ? { ok: false as const, code } : gate({ ok: true as const, value: dec(envelope) })
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

let list: Connection[]

function conn(id: string, name: string, over: Partial<Connection> = {}): Connection {
    return { id, name, provider: 'openai', key: '', ...over }
}

/** An envelope of the fake vault for `plain`, as a boot of an earlier session would have stored it. */
const envelopeOf = (plain: string): string => fake.enc(plain)

function install(platform: VaultPlatform): void {
    const host: VaultHost = {
        platform,
        findConnection: (id) => list.find((item) => item.id === id),
        listConnections: () => list,
        requestSaveNow: () => { },
        markBootWrite: () => { },
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => { }, wrapped: () => { }, reentry: () => { } },
        messages: { keyUnavailable: () => 'unavailable-text' },
    }
    installVaultHost(host)
}

beforeEach(() => {
    resetVaultStoreForTest()
    fake.s.unwraps.length = 0
    fake.s.hold = false
    fake.s.held.length = 0
    fake.s.codes.clear()
    fake.s.firstOnly.clear()
    fake.s.fired = false
    fake.s.n = 0
    list = []
    vi.clearAllMocks()
})

afterEach(() => {
    vi.useRealTimers()
})

function emptySnapshot(over: Partial<ExportKeySnapshot> = {}): ExportKeySnapshot {
    return { values: new Map(), unreadable: new Set(), unavailableNow: new Set(), unreadableNames: [], unavailableNames: [], ...over }
}

describe('exportKeySnapshot', () => {
    it('unwraps each distinct envelope once and reads the plains into values', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 }), conn('conn-2', 'B', { keyWrapped: e1 }), conn('conn-3', 'C', { key: 'SYNTH-PLAIN' })]
        install('vault')

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.values.get(e1)).toBe('SYNTH-1')
        expect(fake.s.unwraps).toEqual([e1])
        expect(snapshot.unreadableNames).toEqual([])
        expect(snapshot.unavailableNames).toEqual([])
    })

    // T28: MC-3111 retry
    it('retries a transient failure once: a success is not named', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        fake.s.firstOnly.set(e1, 'timeout')

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.values.get(e1)).toBe('SYNTH-1')
        expect(fake.s.unwraps).toEqual([e1, e1])
        expect(snapshot.unavailableNames).toEqual([])
    })

    it('names a key still failing after the retry as not readable right now, and tries it twice only', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        fake.s.codes.set(e1, 'timeout')

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.unavailableNow.has(e1)).toBe(true)
        expect(snapshot.unavailableNames).toEqual(['A'])
        expect(snapshot.unreadableNames).toEqual([])
        expect(fake.s.unwraps).toEqual([e1, e1])
    })

    it('does not retry while the watchdog is stalled', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        fake.s.codes.set(e1, 'timeout')
        fake.s.fired = true

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.unavailableNames).toEqual(['A'])
        expect(fake.s.unwraps).toEqual([e1])
    })

    it('a permanent failure is unreadable after one attempt', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        fake.s.codes.set(e1, 'invalidated')

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.unreadable.has(e1)).toBe(true)
        expect(snapshot.unreadableNames).toEqual(['A'])
        expect(fake.s.unwraps).toEqual([e1])
    })

    it('on a platform without a vault every wrapped carrier is unreadable and no vault call is made', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('none')

        const snapshot = await exportKeySnapshot(list)

        expect(snapshot.unreadableNames).toEqual(['A'])
        expect(fake.s.unwraps).toEqual([])
    })

    it('waits for a held wrap, so the typed key is read from its swap and not lost', async () => {
        list = [conn('conn-1', 'A')]
        install('vault')
        fake.s.hold = true
        void setConnectionKey(list[0], 'SYNTH-TYPED')
        await tick()

        let done = false
        const pendingSnapshot = exportKeySnapshot(list).then((snapshot) => {
            done = true
            return snapshot
        })
        await tick()
        expect(done).toBe(false)

        fake.s.hold = false
        for (const release of fake.s.held.splice(0)) {
            release()
        }
        await tick()
        for (const release of fake.s.held.splice(0)) {
            release()
        }
        const snapshot = await pendingSnapshot

        expect(list[0].key).toBe('')
        expect(typeof list[0].keyWrapped).toBe('string')
        expect(exportKeyReader(snapshot).keyOf(list[0])).toBe('SYNTH-TYPED')
        expect(snapshot.unreadableNames).toEqual([])
        expect(snapshot.unavailableNames).toEqual([])
    })

    it('does not unwrap a carrier whose plain is already readable', async () => {
        const e1 = envelopeOf('SYNTH-1')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        await unwrapAllForBoot()
        fake.s.unwraps.length = 0

        const snapshot = await exportKeySnapshot(list)

        expect(fake.s.unwraps).toEqual([])
        expect(exportKeyReader(snapshot).keyOf(list[0])).toBe('SYNTH-1')
    })
})

describe('exportKeyReader', () => {
    it('serves the snapshot first, then the readable cache, by envelope even for a projection copy', async () => {
        const e1 = envelopeOf('SYNTH-1')
        const e2 = envelopeOf('SYNTH-2')
        list = [conn('conn-1', 'A', { keyWrapped: e1 })]
        install('vault')
        await unwrapAllForBoot()
        const reader = exportKeyReader(emptySnapshot({ values: new Map([[e2, 'SYNTH-2']]) }))

        expect(reader.keyOf(cloneConnection(list[0]))).toBe('SYNTH-1')
        expect(reader.keyOf(conn('conn-9', 'Z', { keyWrapped: e2 }))).toBe('SYNTH-2')
        expect(reader.late()).toEqual([])
    })

    it('T38(c) a carrier in no source is empty and named once as late', () => {
        const reader = exportKeyReader(emptySnapshot())
        const carrier = conn('conn-1', 'A', { keyWrapped: 'SYNTH-ENV-UNKNOWN' })

        expect(reader.keyOf(carrier)).toBe('')
        expect(reader.keyOf(cloneConnection(carrier))).toBe('')

        expect(reader.late()).toEqual(['A'])
    })

    it('T38(e) an empty key with no envelope is empty and silent', () => {
        const reader = exportKeyReader(emptySnapshot())

        expect(reader.keyOf(conn('conn-1', 'A'))).toBe('')
        expect(reader.keyOf(conn('conn-2', 'B', { keyWrapped: '' }))).toBe('')

        expect(reader.late()).toEqual([])
    })

    it('T38(f) an envelope the snapshot already classified is not named again', () => {
        const reader = exportKeyReader(emptySnapshot({ unreadable: new Set(['E-U']), unavailableNow: new Set(['E-N']) }))

        expect(reader.keyOf(conn('conn-1', 'A', { keyWrapped: 'E-U' }))).toBe('')
        expect(reader.keyOf(conn('conn-2', 'B', { keyWrapped: 'E-N' }))).toBe('')

        expect(reader.late()).toEqual([])
    })

    it('T38(g) a connection read many times is named once, in the order first seen', () => {
        const reader = exportKeyReader(emptySnapshot())
        const a = conn('conn-1', 'A', { keyWrapped: 'E1' })
        const b = conn('conn-2', 'B', { keyWrapped: 'E2' })

        for (const item of [a, b, a, a, b]) {
            reader.keyOf(item)
        }

        expect(reader.late()).toEqual(['A', 'B'])
    })

    it('a non-empty plain key wins over a stale envelope and is never recorded late', () => {
        const reader = exportKeyReader(emptySnapshot())

        expect(reader.keyOf(conn('conn-1', 'A', { key: 'SYNTH-PLAIN', keyWrapped: 'E1' }))).toBe('SYNTH-PLAIN')

        expect(reader.late()).toEqual([])
    })

    it('never makes a vault call', async () => {
        list = [conn('conn-1', 'A', { keyWrapped: envelopeOf('SYNTH-1') })]
        install('vault')
        fake.s.unwraps.length = 0

        const reader = exportKeyReader(emptySnapshot())
        reader.keyOf(list[0])

        expect(fake.s.unwraps).toEqual([])
        expect(fake.unwrapKey).not.toHaveBeenCalled()
    })

    it('does not read a pending typed key: an export reflects the database', async () => {
        list = [conn('conn-1', 'A', { keyWrapped: envelopeOf('SYNTH-OLD') })]
        install('vault')
        fake.s.hold = true
        void setConnectionKey(list[0], 'SYNTH-TYPED')
        await tick()
        const reader = exportKeyReader(emptySnapshot())

        expect(reader.keyOf(list[0])).toBe('')
        expect(reader.late()).toEqual(['A'])
    })
})
