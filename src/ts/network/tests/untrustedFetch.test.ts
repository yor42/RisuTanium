/**
 * The untrusted-caller wrappers: they are the only supplier of a native destination policy, they read
 * the toggle on every request, a failed read means off, and a native refusal reaches the caller as the
 * readable blocked text.
 *
 * MOCKED: `globalApi.svelte` (`fetchNative` and `globalFetch`) and the toggle store. The wrappers'
 * arguments are asserted; nothing here says anything about the native command.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    allow: vi.fn(async (): Promise<boolean> => false),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    fetchNative: h.fetchNative,
    globalFetch: h.globalFetch,
}))
vi.mock('src/ts/network/privateNetworkConsent', () => ({
    getAllowPrivate: h.allow,
}))

import { untrustedGlobalFetch, untrustedNativeFetch } from '../untrustedFetch'

const MARKER = 'NATIVE_DESTINATION_BLOCKED (private): 192.168.1.10'

beforeEach(() => {
    h.allow.mockReset()
    h.allow.mockResolvedValue(false)
    h.fetchNative.mockReset()
    h.fetchNative.mockResolvedValue(new Response('ok'))
    h.globalFetch.mockReset()
    h.globalFetch.mockResolvedValue({ ok: true, data: {}, headers: {}, status: 200 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the policy handed to the request layer', () => {
    test('T1 native: the third argument carries allowPrivate false by default', async () => {
        await untrustedNativeFetch('https://example.invalid/', { method: 'GET' })
        expect(h.fetchNative).toHaveBeenCalledWith('https://example.invalid/', { method: 'GET' }, { nativePolicy: { allowPrivate: false } })
    })

    test('T1 global: the third argument carries allowPrivate false by default', async () => {
        await untrustedGlobalFetch('https://example.invalid/', { method: 'GET' })
        expect(h.globalFetch).toHaveBeenCalledWith('https://example.invalid/', { method: 'GET' }, { nativePolicy: { allowPrivate: false } })
    })

    test('T5 the toggle on is passed as allowPrivate true', async () => {
        h.allow.mockResolvedValue(true)
        await untrustedNativeFetch('https://example.invalid/', { method: 'GET' })
        await untrustedGlobalFetch('https://example.invalid/', {})
        expect(h.fetchNative.mock.calls[0][2]).toEqual({ nativePolicy: { allowPrivate: true } })
        expect(h.globalFetch.mock.calls[0][2]).toEqual({ nativePolicy: { allowPrivate: true } })
    })

    test('T1b a policy smuggled in the options does not reach the internal argument', async () => {
        const smuggled = { method: 'GET', policy: null, nativePolicy: { allowPrivate: true }, untrusted: false } as unknown as Parameters<typeof untrustedNativeFetch>[1]
        await untrustedNativeFetch('https://example.invalid/', smuggled)
        expect(h.fetchNative.mock.calls[0][2]).toEqual({ nativePolicy: { allowPrivate: false } })
    })

    test('T9 a failed toggle read means allowPrivate false', async () => {
        h.allow.mockRejectedValue(new Error('store gone'))
        await untrustedNativeFetch('https://example.invalid/', { method: 'GET' })
        await untrustedGlobalFetch('https://example.invalid/', {})
        expect(h.fetchNative.mock.calls[0][2]).toEqual({ nativePolicy: { allowPrivate: false } })
        expect(h.globalFetch.mock.calls[0][2]).toEqual({ nativePolicy: { allowPrivate: false } })
    })

    test('T9 the toggle is read per request: flipping it between calls changes the second policy', async () => {
        h.allow.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        await untrustedNativeFetch('https://example.invalid/', { method: 'GET' })
        await untrustedNativeFetch('https://example.invalid/', { method: 'GET' })
        expect(h.fetchNative.mock.calls.map((call) => call[2])).toEqual([
            { nativePolicy: { allowPrivate: false } },
            { nativePolicy: { allowPrivate: true } },
        ])
    })
})

describe('the blocked text', () => {
    test('T8 a native refusal thrown by fetchNative becomes the blocked text naming the host', async () => {
        h.fetchNative.mockRejectedValue(new Error(MARKER))
        await expect(untrustedNativeFetch('https://192.168.1.10/', { method: 'GET' }))
            .rejects.toThrow(language.nativePrivateNetworkBlocked('192.168.1.10'))
    })

    test('T8 a native refusal returned by globalFetch becomes the blocked text naming the host', async () => {
        h.globalFetch.mockResolvedValue({ ok: false, data: `Error: ${MARKER}`, headers: {}, status: 400 })
        const result = await untrustedGlobalFetch('https://192.168.1.10/', {})
        expect(result).toEqual({ ok: false, data: language.nativePrivateNetworkBlocked('192.168.1.10'), headers: {}, status: 400 })
    })

    test('guard: the blocked text names the toggle and the host', () => {
        const text = language.nativePrivateNetworkBlocked('192.168.1.10')
        expect(text).toContain('192.168.1.10')
        expect(text).toContain(language.allowPrivateNetworkNative)
    })

    test('guard: any other failure passes through unchanged', async () => {
        const failure = new Error('connection refused')
        h.fetchNative.mockRejectedValue(failure)
        await expect(untrustedNativeFetch('https://example.invalid/', { method: 'GET' })).rejects.toBe(failure)

        const reply = { ok: false, data: 'upstream said no', headers: {}, status: 502 }
        h.globalFetch.mockResolvedValue(reply)
        expect(await untrustedGlobalFetch('https://example.invalid/', {})).toBe(reply)
    })
})
