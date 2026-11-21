// @vitest-environment happy-dom

/**
 * The page side of the Keystore vault against a fake channel. A passing test says nothing about the native
 * policy or a real Keystore. Envelopes here are base64 of the real v1 layout (version, 8-byte key id, 12-byte
 * IV, ciphertext and tag); the adapter treats them as opaque. Keys are synthetic strings.
 *
 * Every test loads fresh copies of the adapter and the channel module, so the watchdog state of one test never
 * reaches the next.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHostChannelFake } from './hostChannelFake'

function envelopeOf(plainLength: number): string {
    const bytes = new Uint8Array(1 + 8 + 12 + plainLength + 16)
    bytes[0] = 1
    bytes.fill(0xab, 1)
    return btoa(String.fromCharCode(...bytes))
}

async function load() {
    vi.resetModules()
    const fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    const vault = await import('./keyVault')
    const bridge = await import('./hostBridge')
    return { fake, vault, bridge }
}

const idOf = (fake: ReturnType<typeof createHostChannelFake>, method: string, n = 0) => fake.postedTo('keyVault', method)[n].id as number
const ok = (id: number, method: string, value: unknown) => JSON.stringify({ id, method: `keyVault.${method}`, vault: 'ok', value })
const err = (id: number, method: string, code: string) => JSON.stringify({ id, method: `keyVault.${method}`, vault: 'error', code })

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    delete window.__risuTaniumHost
})

describe('the calls and their replies', () => {
    test('wrap, unwrap and available post their method and arguments and read the matching reply', async () => {
        const { fake, vault } = await load()
        const envelope = envelopeOf(14)
        const wrapped = vault.wrapKey('SYNTH-KEY-1234')
        fake.deliver(ok(idOf(fake, 'wrap'), 'wrap', envelope))
        expect(await wrapped).toEqual({ ok: true, value: envelope })
        expect(fake.postedTo('keyVault', 'wrap')[0].args).toEqual(['SYNTH-KEY-1234'])

        const unwrapped = vault.unwrapKey(envelope)
        fake.deliver(ok(idOf(fake, 'unwrap'), 'unwrap', 'SYNTH-KEY-1234'))
        expect(await unwrapped).toEqual({ ok: true, value: 'SYNTH-KEY-1234' })
        expect(fake.postedTo('keyVault', 'unwrap')[0].args).toEqual([envelope])

        const available = vault.vaultAvailable()
        fake.deliver(ok(idOf(fake, 'available'), 'available', true))
        expect(await available).toEqual({ ok: true, value: true })
        expect(fake.postedTo('keyVault', 'available')[0].args).toEqual([])
    })

    test('an error reply gives its code; a code this page does not know, or a value of the wrong type, is other', async () => {
        const { fake, vault } = await load()
        for (const code of ['invalidated', 'unreadable', 'unavailable', 'other']) {
            const pending = vault.unwrapKey(envelopeOf(3))
            fake.deliver(err(idOf(fake, 'unwrap', fake.postedTo('keyVault', 'unwrap').length - 1), 'unwrap', code))
            expect(await pending).toEqual({ ok: false, code })
        }
        const unknown = vault.unwrapKey(envelopeOf(3))
        fake.deliver(err(idOf(fake, 'unwrap', 4), 'unwrap', 'martian'))
        expect(await unknown).toEqual({ ok: false, code: 'other' })

        const wrongType = vault.wrapKey('SYNTH-KEY-1234')
        fake.deliver(ok(idOf(fake, 'wrap'), 'wrap', 42))
        expect(await wrongType).toEqual({ ok: false, code: 'other' })

        const boolFromWrap = vault.vaultAvailable()
        fake.deliver(ok(idOf(fake, 'available'), 'available', 'yes'))
        expect(await boolFromWrap).toEqual({ ok: false, code: 'other' })
    })

    test('without a channel every call is unavailable; releasing the channel mid-call is unavailable too', async () => {
        vi.resetModules()
        delete window.__risuTaniumHost
        const absent = await import('./keyVault')
        expect(await absent.wrapKey('SYNTH-KEY-1234')).toEqual({ ok: false, code: 'unavailable' })
        expect(await absent.vaultAvailable()).toEqual({ ok: false, code: 'unavailable' })

        const { fake, vault, bridge } = await load()
        expect(bridge.hostChannelPresent()).toBe(true)
        const pending = vault.unwrapKey(envelopeOf(3))
        delete window.__risuTaniumHost
        bridge.connectHostBridge()
        expect(await pending).toEqual({ ok: false, code: 'unavailable' })
        expect(fake.postedTo('keyVault', 'unwrap')).toHaveLength(1)
        expect(bridge.hostChannelPresent()).toBe(false)
    })

    test('a message that cannot be sent is an other error, not a throw', async () => {
        const { fake, vault } = await load()
        fake.channel.postMessage.mockImplementationOnce(() => { throw new Error('host failed') })
        expect(await vault.wrapKey('SYNTH-KEY-1234')).toEqual({ ok: false, code: 'other' })
    })
})

describe('the no-progress watchdog', () => {
    test('twenty replies two seconds apart all succeed, because every reply re-arms the watchdog', async () => {
        const { fake, vault } = await load()
        const envelope = envelopeOf(10)
        const calls = Array.from({ length: 20 }, () => vault.unwrapKey(envelope))
        for (let index = 0; index < 20; index++) {
            await vi.advanceTimersByTimeAsync(2000)
            fake.deliver(ok(idOf(fake, 'unwrap', index), 'unwrap', `SYNTH-KEY-${index}`))
        }
        const results = await Promise.all(calls)
        expect(results.every((result) => result.ok)).toBe(true)
        expect(vault.watchdogFired()).toBe(false)
    })

    test('ten seconds of silence settles every pending call with timeout; watchdogFired holds until the next reply; a late reply settles nothing', async () => {
        const { fake, vault } = await load()
        const first = vault.unwrapKey(envelopeOf(10))
        const second = vault.wrapKey('SYNTH-KEY-1234')
        await vi.advanceTimersByTimeAsync(9999)
        expect(vault.watchdogFired()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await first).toEqual({ ok: false, code: 'timeout' })
        expect(await second).toEqual({ ok: false, code: 'timeout' })
        expect(vault.watchdogFired()).toBe(true)

        fake.deliver(ok(idOf(fake, 'unwrap'), 'unwrap', 'SYNTH-LATE'))
        expect(vault.watchdogFired()).toBe(true)

        const next = vault.vaultAvailable()
        fake.deliver(ok(idOf(fake, 'available'), 'available', true))
        expect(await next).toEqual({ ok: true, value: true })
        expect(vault.watchdogFired()).toBe(false)
    })

    test('the watchdog is not armed with nothing in flight', async () => {
        const { fake, vault } = await load()
        const done = vault.vaultAvailable()
        fake.deliver(ok(idOf(fake, 'available'), 'available', true))
        await done
        await vi.advanceTimersByTimeAsync(60_000)
        expect(vault.watchdogFired()).toBe(false)
    })
})
