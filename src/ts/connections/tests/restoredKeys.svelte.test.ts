/**
 * The staging of connection keys a `.rtb` restore brings (T24) and its boot-time apply (T25). The restore side runs the
 * real `applySideAction` over fake stores; the boot side runs the real `applyRestoredKeys` over a fake staging store and
 * the real connection-key store with a fake vault (`src/ts/android/keyVault`, envelopes in the real v1 layout). A fake
 * store or vault is not evidence of IndexedDB or the native Keystore. Keys are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../connections'
import { connectionHasKey, connectionKeyForUi, connectionNeedsReentry } from '../keyAccess'
import {
    beginVaultBoot, installVaultHost, resetVaultStoreForTest, unwrapAllForBoot, whenVaultReady, wrapPlainKeysAfterLoad,
    writeConnectionKey, type VaultHost, type VaultPlatform,
} from '../keyVaultStore.svelte'
import { applyRestoredKeys } from '../restoredKeys'
import { applySideAction, type SideBackends, type SideBodyReader } from 'src/ts/drive/rtb/sideStores'
import { encodeSideLine } from 'src/ts/drive/rtb/sideLines'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { RESTORED_KEYS_STORE, type ForageStoreConfig } from 'src/ts/drive/rtb/sideStoreConfig'
import type { SideAction } from 'src/ts/drive/rtb/sideDecision'

const fake = vi.hoisted(() => {
    const s = {
        wrapFails: false,
        wrapCode: null as string | null,
        hold: false,
        held: [] as Array<{ kind: 'wrap' | 'unwrap', arg: string, run: () => void }>,
        unwraps: [] as string[],
        // Envelopes whose unwrap fails with the given code, as another device's key would.
        unwrapCodes: new Map<string, string>(),
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
    // While `hold` is set a call is parked until a test releases it, so the order of the replies is the test's choice.
    const gate = <T,>(kind: 'wrap' | 'unwrap', arg: string, value: () => T): Promise<T> => (s.hold
        ? new Promise<T>((resolve) => { s.held.push({ kind, arg, run: () => resolve(value()) }) })
        : Promise.resolve(value()))
    return {
        s, enc, dec,
        wrapKey: vi.fn(async (plain: string) => {
            const code = s.wrapFails ? 'other' : s.wrapCode
            return gate('wrap', plain, () => code ? { ok: false as const, code } : { ok: true as const, value: enc(plain) })
        }),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            const code = s.unwrapCodes.get(envelope)
            return gate('unwrap', envelope, () => (code ? { ok: false as const, code } : { ok: true as const, value: dec(envelope) }))
        }),
        watchdogFired: () => false,
    }
})

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

class FakeForage {
    data = new Map<string, unknown>()
    clearCalls = 0
    removed: string[] = []
    async ready(): Promise<void> { }
    async keys(): Promise<string[]> { return [...this.data.keys()] }
    async getItem(key: string): Promise<unknown> { return this.data.has(key) ? this.data.get(key) : null }
    async setItem(key: string, value: unknown): Promise<unknown> { this.data.set(key, value); return value }
    async removeItem(key: string): Promise<void> { this.removed.push(key); this.data.delete(key) }
    async clear(): Promise<void> { this.clearCalls++; this.data.clear() }
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function sectionText(records: ReadonlyArray<readonly [string, unknown]>): string {
    return records.map(([key, value]) => decoder.decode(encodeSideLine(key, value, RTB_SIDE_TAGS))).join('')
}

function readerOf(text: string): SideBodyReader {
    const bytes = encoder.encode(text)
    return async (sink) => {
        await sink(bytes)
        return { ok: true }
    }
}

const KEY_ACTION: SideAction = {
    kind: 'restore', id: 'side.connection-keys',
    row: { id: 'side.connection-keys', v: 1, required: false, prefix: 's/connection-keys/', entries: 1, bytes: 0, meta: null },
}

let staging: FakeForage
let configs: ForageStoreConfig[]

function backends(stageWrap?: SideBackends['stageWrap']): SideBackends {
    return {
        forage: (config) => {
            configs.push(config)
            return staging as unknown as LocalForage
        },
        local: () => { throw new Error('no localStorage section is part of this test') },
        stageWrap,
    }
}

const ENV_OLD = 'SYNTH-ENV-FROM-ANOTHER-DEVICE'

describe('T24: a restore stages the section lines keyed by their envelope', () => {
    beforeEach(() => {
        staging = new FakeForage()
        configs = []
    })

    it('on a platform with a working vault the record holds this device\'s envelope', async () => {
        const result = await applySideAction(KEY_ACTION, readerOf(sectionText([['conn-1', { e: ENV_OLD, p: 'SYNTH-PLAIN' }]])), backends(async (plain) => `WRAPPED(${plain})`))

        expect(result).toMatchObject({ status: 'ok', written: 1 })
        expect(staging.data.get(ENV_OLD)).toEqual({ id: 'conn-1', w: 'WRAPPED(SYNTH-PLAIN)' })
        expect(configs.every((config) => config === RESTORED_KEYS_STORE)).toBe(true)
    })

    it('with no working vault, or a failing wrap, the record holds the plain', async () => {
        const text = sectionText([['conn-1', { e: ENV_OLD, p: 'SYNTH-PLAIN' }]])

        await applySideAction(KEY_ACTION, readerOf(text), backends(undefined))
        expect(staging.data.get(ENV_OLD)).toEqual({ id: 'conn-1', p: 'SYNTH-PLAIN' })

        staging.data.clear()
        await applySideAction(KEY_ACTION, readerOf(text), backends(async () => null))
        expect(staging.data.get(ENV_OLD)).toEqual({ id: 'conn-1', p: 'SYNTH-PLAIN' })
    })

    it('an absent row clears the staging store', async () => {
        staging.data.set('E-LEFTOVER', { id: 'conn-9', p: 'SYNTH-STALE' })

        const result = await applySideAction({ kind: 'clear', id: 'side.connection-keys', status: 'absent' }, null, backends())

        expect(result).toEqual({ id: 'side.connection-keys', status: 'absent' })
        expect(staging.data.size).toBe(0)
    })

    it.each([
        ['no envelope', { p: 'SYNTH-PLAIN' }],
        ['an empty envelope', { e: '', p: 'SYNTH-PLAIN' }],
        ['a non-string envelope', { e: 7, p: 'SYNTH-PLAIN' }],
        ['a non-string plain', { e: ENV_OLD, p: 3 }],
        ['no object', 'SYNTH-PLAIN'],
    ])('a line with %s is malformed and the store is untouched', async (_label, value) => {
        staging.data.set('E-KEEP', { id: 'conn-9', p: 'SYNTH-KEEP' })

        const result = await applySideAction(KEY_ACTION, readerOf(sectionText([['conn-0', { e: 'E-GOOD', p: 'SYNTH-GOOD' }], ['conn-1', value]])), backends())

        expect(result).toMatchObject({ id: 'side.connection-keys', status: 'malformed' })
        expect([...staging.data.keys()]).toEqual(['E-KEEP'])
        expect(staging.clearCalls).toBe(0)
    })

    it('an omitted or conflicting section is left alone', async () => {
        staging.data.set('E-KEEP', { id: 'conn-9', p: 'SYNTH-KEEP' })

        const result = await applySideAction({ kind: 'leave', id: 'side.connection-keys', status: 'omitted', reason: 'unreadable' }, null, backends())

        expect(result).toMatchObject({ status: 'omitted' })
        expect([...staging.data.keys()]).toEqual(['E-KEEP'])
    })
})

describe('T25: the boot applies the staged records without losing an edit', () => {
    let list: Connection[]
    let calls: { boot: number, keepPlain: number }

    function install(platform: VaultPlatform): void {
        const host: VaultHost = {
            platform,
            findConnection: (id) => list.find((conn) => conn.id === id),
            listConnections: () => list,
            requestSaveNow: () => { },
            markBootWrite: () => { calls.boot++ },
            isReadOnlyPage: () => false,
            notify: { keepPlain: () => { calls.keepPlain++ }, wrapped: () => { }, reentry: () => { } },
            messages: { keyUnavailable: () => 'unavailable-text' },
        }
        installVaultHost(host)
    }

    function carrier(id: string, over: Partial<Connection> = {}): Connection {
        return { id, name: id, provider: 'openai', key: '', keyWrapped: ENV_OLD, ...over }
    }

    beforeEach(() => {
        staging = new FakeForage()
        resetVaultStoreForTest()
        fake.s.wrapFails = false
        fake.s.unwraps.length = 0
        fake.s.n = 0
        fake.wrapKey.mockClear()
        fake.unwrapKey.mockClear()
        calls ={ boot: 0, keepPlain: 0 }
        list = [carrier('conn-1')]
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('{w} sets the carrier\'s envelope to this device\'s, keeps the record and marks the boot write', async () => {
        install('vault')
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list[0]).toMatchObject({ key: '', keyWrapped: 'W-NEW' })
        expect(staging.data.has(ENV_OLD)).toBe(true)
        expect(calls.boot).toBe(1)
    })

    it('a crash before the save applies again on the next boot: the same result from the unchanged stored database', async () => {
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })
        install('vault')
        await applyRestoredKeys(staging as unknown as LocalForage)
        expect(list[0].keyWrapped).toBe('W-NEW')

        resetVaultStoreForTest()
        list = [carrier('conn-1')]
        install('vault')
        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list[0]).toMatchObject({ key: '', keyWrapped: 'W-NEW' })
    })

    it('an edit changes the envelope, so the next boot applies nothing and drops the record', async () => {
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })
        list = [carrier('conn-1', { keyWrapped: 'SYNTH-ENV-TYPED-LATER' })]
        install('vault')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list[0]).toMatchObject({ key: '', keyWrapped: 'SYNTH-ENV-TYPED-LATER' })
        expect(staging.removed).toEqual([ENV_OLD])
        expect(calls.boot).toBe(0)
    })

    it('a record is dropped only when no carrier holds its envelope', async () => {
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })
        staging.data.set('E-ORPHAN', { id: 'conn-7', p: 'SYNTH-ORPHAN' })
        install('vault')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(staging.removed).toEqual(['E-ORPHAN'])
        expect(staging.data.has(ENV_OLD)).toBe(true)
    })

    it('a record that is not one of the two shapes is dropped', async () => {
        staging.data.set(ENV_OLD, { id: 'conn-1', x: 1 })
        install('vault')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(staging.removed).toEqual([ENV_OLD])
        expect(list[0].keyWrapped).toBe(ENV_OLD)
    })

    it('every carrier of one envelope is applied', async () => {
        list = [carrier('conn-1'), carrier('conn-2')]
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })
        install('vault')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list.map((conn) => conn.keyWrapped)).toEqual(['W-NEW', 'W-NEW'])
    })

    it('a connection with a plain key typed since is left as it is', async () => {
        list = [carrier('conn-1', { key: 'SYNTH-TYPED' })]
        staging.data.set(ENV_OLD, { id: 'conn-1', w: 'W-NEW' })
        install('vault')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list[0]).toMatchObject({ key: 'SYNTH-TYPED', keyWrapped: ENV_OLD })
        expect(staging.data.has(ENV_OLD)).toBe(true)
    })

    it('{p} on vault is readable at once, the database is untouched until the wrap after load, then holds the envelope only', async () => {
        install('vault')
        staging.data.set(ENV_OLD, { id: 'conn-1', p: 'SYNTH-PLAIN' })

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(connectionKeyForUi(list[0])).toBe('SYNTH-PLAIN')
        expect(connectionHasKey(list[0])).toBe(true)
        expect(list[0]).toMatchObject({ key: '', keyWrapped: ENV_OLD })
        expect(fake.wrapKey).not.toHaveBeenCalled()

        await wrapPlainKeysAfterLoad(() => false)

        expect(list[0].key).toBe('')
        expect(list[0].keyWrapped).not.toBe(ENV_OLD)
        expect(typeof list[0].keyWrapped).toBe('string')
        expect(fake.dec(list[0].keyWrapped as string)).toBe('SYNTH-PLAIN')
        expect(connectionKeyForUi(list[0])).toBe('SYNTH-PLAIN')
        expect(calls.boot).toBe(1)
    })

    it('{p} on vault whose wrap fails ends as a plain key with no envelope and the keep-plain notice', async () => {
        install('vault')
        staging.data.set(ENV_OLD, { id: 'conn-1', p: 'SYNTH-PLAIN' })
        fake.s.wrapFails = true
        await applyRestoredKeys(staging as unknown as LocalForage)

        await wrapPlainKeysAfterLoad(() => false)

        expect(list[0].key).toBe('SYNTH-PLAIN')
        expect(Object.hasOwn(list[0], 'keyWrapped')).toBe(false)
        expect(calls.keepPlain).toBe(1)
    })

    it('{p} on vault is not swapped when the connection changed during the wrap', async () => {
        install('vault')
        staging.data.set(ENV_OLD, { id: 'conn-1', p: 'SYNTH-PLAIN' })
        await applyRestoredKeys(staging as unknown as LocalForage)
        fake.wrapKey.mockImplementationOnce(async (plain: string) => {
            list[0].keyWrapped = 'SYNTH-ENV-EDITED'
            return { ok: true as const, value: fake.enc(plain) }
        })

        await wrapPlainKeysAfterLoad(() => false)

        expect(list[0]).toMatchObject({ key: '', keyWrapped: 'SYNTH-ENV-EDITED' })
    })

    it.each(['none', 'android-legacy'] as const)('{p} on %s becomes a plain key with no envelope and no vault call', async (platform) => {
        install(platform)
        staging.data.set(ENV_OLD, { id: 'conn-1', p: 'SYNTH-PLAIN' })

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(list[0].key).toBe('SYNTH-PLAIN')
        expect(Object.hasOwn(list[0], 'keyWrapped')).toBe(false)
        expect(fake.wrapKey).not.toHaveBeenCalled()
        expect(fake.unwrapKey).not.toHaveBeenCalled()
    })

    it('a desktop carrier with no record needs re-entry and keeps its envelope', async () => {
        install('none')

        await applyRestoredKeys(staging as unknown as LocalForage)

        expect(connectionNeedsReentry(list[0])).toBe(true)
        expect(list[0]).toMatchObject({ key: '', keyWrapped: ENV_OLD })
    })

    it('the boot budget covers a hung staging read', async () => {
        vi.useFakeTimers()
        install('vault')
        const hung = { keys: () => new Promise<string[]>(() => { }) } as unknown as LocalForage
        let unwrapped = false
        beginVaultBoot(async () => {
            await applyRestoredKeys(hung)
            await unwrapAllForBoot()
            unwrapped = true
        }, 4000)

        let ready = false
        void whenVaultReady().then(() => { ready = true })
        await vi.advanceTimersByTimeAsync(3999)
        expect(ready).toBe(false)
        await vi.advanceTimersByTimeAsync(1)

        expect(ready).toBe(true)
        expect(unwrapped).toBe(false)
    })
})

describe('a pending typed key is never replaced by a staged record at boot (regression reproducers)', () => {
    let list: Connection[]
    const OWN_ENV = 'SYNTH-OWN-ENV'

    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

    /** Releases the held call whose argument is, or decodes to, `plain`, then lets the chain run. */
    async function releaseFor(plain: string): Promise<void> {
        const at = fake.s.held.findIndex((item) => (item.kind === 'wrap' ? item.arg : fake.dec(item.arg)) === plain)
        if (at < 0) {
            throw new Error(`no held call for ${plain}: ${JSON.stringify(fake.s.held.map((item) => `${item.kind}:${item.arg}`))}`)
        }
        fake.s.held.splice(at, 1)[0].run()
        await tick()
        await tick()
    }

    /** Stops holding and releases everything still held, in posting order. */
    async function releaseAll(): Promise<void> {
        fake.s.hold = false
        for (let round = 0; round < 6; round++) {
            for (const item of fake.s.held.splice(0)) {
                item.run()
            }
            await tick()
        }
    }

    function valueOf(conn: Connection): string {
        return conn.key !== '' ? conn.key : (conn.keyWrapped ? fake.dec(conn.keyWrapped as string) : '')
    }

    function install(): void {
        installVaultHost({
            platform: 'vault',
            findConnection: (id) => list.find((conn) => conn.id === id),
            listConnections: () => list,
            requestSaveNow: () => { },
            markBootWrite: () => { },
            isReadOnlyPage: () => false,
            notify: { keepPlain: () => { }, wrapped: () => { }, reentry: () => { } },
            messages: { keyUnavailable: () => 'unavailable-text' },
        })
    }

    beforeEach(() => {
        staging = new FakeForage()
        resetVaultStoreForTest()
        fake.s.wrapFails = false
        fake.s.wrapCode = null
        fake.s.hold = true
        fake.s.held = []
        fake.s.unwraps.length = 0
        fake.s.n = 0
        fake.wrapKey.mockClear()
        fake.unwrapKey.mockClear()
        list = [{ id: 'c4', name: 'c4', provider: 'openai', key: '', keyWrapped: OWN_ENV } as Connection]
    })

    afterEach(async () => {
        await releaseAll()
        fake.s.hold = false
    })

    it('G9a-ii: typed after the staged wrap was posted, replies in order', async () => {
        install()
        staging.data.set(OWN_ENV, { id: 'c4', p: 'SYNTH-OLD' })
        await applyRestoredKeys(staging as unknown as LocalForage)
        const afterLoad = wrapPlainKeysAfterLoad(() => false)
        await tick()
        const typed = writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        await tick()
        await releaseAll()
        await afterLoad
        await typed

        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
        expect(staging.data.has(OWN_ENV)).toBe(true)
    })

    it('G9a-fc: typed before the staged wrap was posted, the staged reply released first', async () => {
        install()
        staging.data.set(OWN_ENV, { id: 'c4', p: 'SYNTH-OLD' })
        await applyRestoredKeys(staging as unknown as LocalForage)
        const typed = writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        await tick()
        const afterLoad = wrapPlainKeysAfterLoad(() => false)
        await tick()
        // Releasing by argument is deliberate: the staged wrap and its verify answer before the typed key's own.
        await releaseFor('SYNTH-OLD')
        await releaseFor('SYNTH-OLD')
        await releaseAll()
        await afterLoad
        await typed

        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
    })

    it('G9a-i: typed first, every reply in order (compatibility guard: passes before and after)', async () => {
        install()
        staging.data.set(OWN_ENV, { id: 'c4', p: 'SYNTH-OLD' })
        await applyRestoredKeys(staging as unknown as LocalForage)
        const typed = writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        await tick()
        const afterLoad = wrapPlainKeysAfterLoad(() => false)
        await tick()
        await releaseAll()
        await afterLoad
        await typed

        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
    })

    it('G9b: the staged wrap times out, the typed key still wins and a healthy next boot drops the record', async () => {
        install()
        staging.data.set(OWN_ENV, { id: 'c4', p: 'SYNTH-OLD' })
        await applyRestoredKeys(staging as unknown as LocalForage)
        fake.s.wrapCode = 'timeout'
        const afterLoad = wrapPlainKeysAfterLoad(() => false)
        await tick()
        const typed = writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        await tick()
        await releaseAll()
        await afterLoad
        await typed

        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
        expect(staging.data.has(OWN_ENV)).toBe(true)

        resetVaultStoreForTest()
        fake.s.wrapCode = null
        install()
        await applyRestoredKeys(staging as unknown as LocalForage)
        expect(staging.data.has(OWN_ENV)).toBe(false)
        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
    })

    it('G9c: a late step 1 {w} record does not replace a pending typed key', async () => {
        install()
        const typed = writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        await tick()
        fake.s.hold = false
        staging.data.set(OWN_ENV, { id: 'c4', w: fake.enc('SYNTH-OLD') })
        fake.s.hold = true
        await applyRestoredKeys(staging as unknown as LocalForage)
        await releaseAll()
        await typed

        expect(valueOf(list[0])).toBe('SYNTH-TYPED')
        expect(staging.data.has(OWN_ENV)).toBe(true)
    })
})

describe('a restore that never commits leaves records that only write the carrier\'s own value (R-3 guards)', () => {
    let list: Connection[]
    let boots: number

    const P1 = 'SYNTH-P1'
    const P2 = 'SYNTH-P2'
    const C2_PLAIN = 'SYNTH-C2-PLAIN'

    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

    function install(platform: VaultPlatform): void {
        installVaultHost({
            platform,
            findConnection: (id) => list.find((conn) => conn.id === id),
            listConnections: () => list,
            requestSaveNow: () => { },
            markBootWrite: () => { boots++ },
            isReadOnlyPage: () => false,
            notify: { keepPlain: () => { }, wrapped: () => { }, reentry: () => { } },
            messages: { keyUnavailable: () => 'unavailable-text' },
        })
    }

    /** One restore whose staging ran and whose commit never landed: the file's lines become records, as `installRtbRestore` stages them. */
    async function stageFile(lines: ReadonlyArray<readonly [string, string, string]>, platform: VaultPlatform): Promise<void> {
        const text = sectionText(lines.map(([id, envelope, plain]) => [id, { e: envelope, p: plain }] as const))
        const stageWrap = platform === 'vault' ? async (plain: string) => fake.enc(plain) : undefined
        const result = await applySideAction(KEY_ACTION, readerOf(text), backends(stageWrap))
        expect(result).toMatchObject({ status: 'ok' })
    }

    /** The boot order of `vaultBoot` and the after-load wrap. */
    async function boot(platform: VaultPlatform): Promise<void> {
        resetVaultStoreForTest()
        install(platform)
        await applyRestoredKeys(staging as unknown as LocalForage)
        await unwrapAllForBoot()
        await wrapPlainKeysAfterLoad(() => false)
        await tick()
    }

    const snapshot = (): Connection[] => JSON.parse(JSON.stringify(list)) as Connection[]

    beforeEach(() => {
        staging = new FakeForage()
        configs = []
        resetVaultStoreForTest()
        fake.s.wrapFails = false
        fake.s.wrapCode = null
        fake.s.hold = false
        fake.s.held = []
        fake.s.unwraps.length = 0
        fake.s.unwrapCodes.clear()
        fake.s.n = 0
        fake.wrapKey.mockClear()
        fake.unwrapKey.mockClear()
        boots = 0
    })

    it('G4b: staging adds the file\'s records over the existing ones and removes none (guard of a new rule)', async () => {
        staging.data.set('SYNTH-ENV-R0', { id: 'x', p: 'SYNTH-R0' })

        await stageFile([['c1', 'SYNTH-ENV-1', P1], ['c9', 'SYNTH-ENV-9', P2]], 'none')

        expect([...staging.data.keys()].sort()).toEqual(['SYNTH-ENV-1', 'SYNTH-ENV-9', 'SYNTH-ENV-R0'])
        expect(staging.clearCalls).toBe(0)
    })

    it('G4b-2: restores that never commit never build up, and each boot drops only the records nothing carries (guard of a new rule)', async () => {
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: 'SYNTH-ENV-1' } as Connection]
        staging.data.set('SYNTH-ENV-R0', { id: 'x', p: 'SYNTH-R0' })

        await stageFile([['c1', 'SYNTH-ENV-1', P1], ['c9', 'SYNTH-ENV-9', P2]], 'none')
        await stageFile([['c1', 'SYNTH-ENV-1', P1], ['c9', 'SYNTH-ENV-9', P2]], 'none')
        expect([...staging.data.keys()].sort()).toEqual(['SYNTH-ENV-1', 'SYNTH-ENV-9', 'SYNTH-ENV-R0'])
        await stageFile([['c2', 'SYNTH-ENV-2', P2]], 'none')
        expect([...staging.data.keys()].sort()).toEqual(['SYNTH-ENV-1', 'SYNTH-ENV-2', 'SYNTH-ENV-9', 'SYNTH-ENV-R0'])

        await boot('none')
        expect([...staging.data.keys()]).toEqual(['SYNTH-ENV-1'])
        expect(list[0].key).toBe(P1)

        await boot('none')
        expect(staging.data.size).toBe(0)
        expect(list[0].key).toBe(P1)
    })

    it.each(['vault', 'none'] as const)('G4c-1 (%s): another device\'s records with no carrier here are dropped and change nothing', async (platform) => {
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: fake.enc('SYNTH-OWN') } as Connection]
        const before = snapshot()

        await stageFile([['a1', 'SYNTH-ENV-A1', P1], ['a2', 'SYNTH-ENV-A2', P2]], platform)
        await boot(platform)

        expect(staging.data.size).toBe(0)
        expect(list).toEqual(before)
        expect(boots).toBe(0)
    })

    it('G4c-2 (vault): a connection that still holds the source device\'s envelope reads the file\'s key after the next boot', async () => {
        const foreign = fake.enc(P1)
        fake.s.unwrapCodes.set(foreign, 'unreadable')
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: foreign } as Connection]
        await boot('vault')
        expect(connectionNeedsReentry(list[0])).toBe(true)
        boots = 0

        await stageFile([['c1', foreign, P1]], 'vault')
        await boot('vault')

        expect(connectionKeyForUi(list[0])).toBe(P1)
        expect(connectionNeedsReentry(list[0])).toBe(false)
        expect(boots).toBeGreaterThan(0)
    })

    it('G4c-2 (none): a flagged connection holding the source device\'s envelope reads the file\'s key after the next boot', async () => {
        const foreign = fake.enc(P1)
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: foreign } as Connection]
        install('none')
        expect(connectionNeedsReentry(list[0])).toBe(true)

        await stageFile([['c1', foreign, P1]], 'none')
        await boot('none')

        expect(connectionKeyForUi(list[0])).toBe(P1)
        expect(connectionNeedsReentry(list[0])).toBe(false)
        expect(boots).toBeGreaterThan(0)
    })

    it.each(['vault', 'none', 'android-legacy'] as const)('G4d (%s): the profile\'s own connections keep their keys after a restore that never committed', async (platform) => {
        const e1 = fake.enc(P1)
        const e2 = fake.enc('SYNTH-C2-OLD-ENVELOPE-PLAIN')
        const e3 = fake.enc('SYNTH-C3')
        list = [
            { id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: e1 } as Connection,
            { id: 'c2', name: 'c2', provider: 'openai', key: C2_PLAIN, keyWrapped: e2 } as Connection,
            { id: 'c3', name: 'c3', provider: 'openai', key: '', keyWrapped: e3 } as Connection,
        ]
        const c2Before = { ...list[1] }
        const c3Before = { ...list[2] }

        await stageFile([['c1', e1, P1], ['c2', e2, P2]], platform)
        await boot(platform)

        expect(connectionKeyForUi(list[0])).toBe(P1)
        expect(connectionKeyForUi(list[1])).toBe(C2_PLAIN)
        if (platform === 'vault') {
            // The after-load wrap re-wraps a plain key on a both-set connection by design: the plain key is authoritative.
            expect(list[1].key).toBe('')
        } else {
            expect(list[1]).toEqual(c2Before)
        }
        if (platform === 'android-legacy') {
            expect(staging.data.has(e2)).toBe(true)
        }
        expect(list[2]).toEqual(c3Before)
    })

    it('G4d-2 (vault): a key typed after the restore settles to a new envelope, so the next boot drops the record without a write', async () => {
        const e1 = fake.enc(P1)
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: e1 } as Connection]
        await stageFile([['c1', e1, P1]], 'vault')
        install('vault')
        await writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        const settled = snapshot()
        expect(settled[0].keyWrapped).not.toBe(e1)
        boots = 0

        await boot('vault')

        expect(list).toEqual(settled)
        expect(staging.data.size).toBe(0)
        expect(boots).toBe(0)
    })

    it('G4d-2 (android-legacy): a typed key is plain with no envelope, so the next boot drops the record', async () => {
        const e1 = fake.enc(P1)
        list = [{ id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: e1 } as Connection]
        await stageFile([['c1', e1, P1]], 'android-legacy')
        install('android-legacy')
        await writeConnectionKey(list[0], 'SYNTH-TYPED', false)
        expect(list[0].key).toBe('SYNTH-TYPED')
        expect(Object.hasOwn(list[0], 'keyWrapped')).toBe(false)

        await boot('android-legacy')

        expect(list[0].key).toBe('SYNTH-TYPED')
        expect(staging.data.size).toBe(0)
    })

    it('G4d-3 (vault): a tripped breaker keeps the record and leaves the connection alone until a healthy boot applies it once', async () => {
        const e1 = fake.enc(P1)
        const eD = fake.enc('SYNTH-D')
        list = [
            { id: 'c1', name: 'c1', provider: 'openai', key: '', keyWrapped: e1 } as Connection,
            { id: 'd', name: 'd', provider: 'openai', key: '', keyWrapped: eD } as Connection,
        ]
        const c1Before = { ...list[0] }
        // A `{p}` record, as after a fail-fast staging; the unread envelope of d makes step 2 time out and trip the breaker.
        staging.data.set(e1, { id: 'c1', p: P1 })
        fake.s.unwrapCodes.set(eD, 'timeout')

        await boot('vault')
        expect(list[0]).toEqual(c1Before)
        expect(staging.data.has(e1)).toBe(true)

        fake.s.unwrapCodes.clear()
        await boot('vault')
        expect(list[0].keyWrapped).not.toBe(e1)
        expect(connectionKeyForUi(list[0])).toBe(P1)
        expect(staging.data.has(e1)).toBe(true)

        await boot('vault')
        expect(staging.data.has(e1)).toBe(false)
        expect(connectionKeyForUi(list[0])).toBe(P1)
    })
})

describe('the staging stops asking the vault after the first failed wrap of one run (G8, G8b)', () => {
    const text = (): string => sectionText([
        ['c1', { e: 'SYNTH-ENV-1', p: 'SYNTH-P1' }],
        ['c2', { e: 'SYNTH-ENV-2', p: 'SYNTH-P2' }],
        ['c3', { e: 'SYNTH-ENV-3', p: 'SYNTH-P3' }],
    ])

    beforeEach(() => {
        staging = new FakeForage()
        configs = []
    })

    it('G8: after the first null the rest are staged as plain without a vault call (guard of a new rule)', async () => {
        const wrap = vi.fn(async (): Promise<string | null> => null)

        const result = await applySideAction(KEY_ACTION, readerOf(text()), backends(wrap))

        expect(result).toMatchObject({ status: 'ok', written: 3 })
        expect(wrap).toHaveBeenCalledTimes(1)
        expect([...staging.data.values()]).toEqual([
            { id: 'c1', p: 'SYNTH-P1' }, { id: 'c2', p: 'SYNTH-P2' }, { id: 'c3', p: 'SYNTH-P3' },
        ])
    })

    it('G8b: the next run starts fresh and its first line asks the vault again (guard of a new rule)', async () => {
        await applySideAction(KEY_ACTION, readerOf(text()), backends(async () => null))
        const wrap = vi.fn(async (plain: string): Promise<string | null> => `WRAPPED(${plain})`)

        await applySideAction(KEY_ACTION, readerOf(text()), backends(wrap))

        expect(wrap).toHaveBeenCalledTimes(3)
        expect(staging.data.get('SYNTH-ENV-1')).toEqual({ id: 'c1', w: 'WRAPPED(SYNTH-P1)' })
    })
})