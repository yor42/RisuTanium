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
    type VaultHost, type VaultPlatform,
} from '../keyVaultStore.svelte'
import { applyRestoredKeys } from '../restoredKeys'
import { applySideAction, type SideBackends, type SideBodyReader } from 'src/ts/drive/rtb/sideStores'
import { encodeSideLine } from 'src/ts/drive/rtb/sideLines'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { RESTORED_KEYS_STORE, type ForageStoreConfig } from 'src/ts/drive/rtb/sideStoreConfig'
import type { SideAction } from 'src/ts/drive/rtb/sideDecision'

const fake = vi.hoisted(() => {
    const s = { wrapFails: false, unwraps: [] as string[], n: 0 }
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
    return {
        s, enc, dec,
        wrapKey: vi.fn(async (plain: string) => s.wrapFails ? { ok: false as const, code: 'other' } : { ok: true as const, value: enc(plain) }),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            return { ok: true as const, value: dec(envelope) }
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
