/**
 * `src/ts/network/androidHttp.ts`: the route rule for an `http:` request on Android and the one cause message for a
 * direct fetch the release build's cleartext policy refuses.
 *
 * Invariants pinned here:
 *  - `decidePlainFetch` is the pre-existing plain-fetch rule with one exemption: on Android an `http:` request is never
 *    plain; every other input keeps the old answer;
 *  - the cause is named only for Android, an `http:` address and a `TypeError` that says "Failed to fetch"; an abort, a
 *    different error, https, a non-Android page and an unparsable address are never tagged.
 *
 * The operating-system plugin is a box mock, so a pass says nothing about native behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const box = vi.hoisted(() => ({ os: 'android' }))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (box.os === 'throw') {
            throw new Error('no operating-system plugin')
        }
        return box.os
    },
}))

import { language } from 'src/lang'
import { AndroidHttpBlockedError, androidHttpBlockedCause, decidePlainFetch, directFetch } from './androidHttp'

type PlainInput = Parameters<typeof decidePlainFetch>[0]

const base: PlainInput = {
    knownHost: false,
    isTauri: true,
    usePlainFetch: false,
    plainFetchForce: false,
    plainFetchDeforce: false,
    localNetworkRoute: false,
    android: false,
    protocol: 'https:',
}

const plainRule = (input: Partial<PlainInput>) => decidePlainFetch({ ...base, ...input })

beforeEach(() => {
    box.os = 'android'
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('U1 decidePlainFetch', () => {
    test.each([
        ['android http, the setting on', { android: true, protocol: 'http:', usePlainFetch: true }, false],
        ['android http, plainFetchForce on', { android: true, protocol: 'http:', plainFetchForce: true }, false],
        ['android http, both on', { android: true, protocol: 'http:', usePlainFetch: true, plainFetchForce: true }, false],
        ['android http, neither', { android: true, protocol: 'http:' }, false],
        ['android https, the setting on', { android: true, protocol: 'https:', usePlainFetch: true }, true],
        ['android https, plainFetchForce on', { android: true, protocol: 'https:', plainFetchForce: true }, true],
        ['android https, neither', { android: true, protocol: 'https:' }, false],
        ['desktop http, the setting on', { protocol: 'http:', usePlainFetch: true }, true],
        ['desktop http, plainFetchForce on', { protocol: 'http:', plainFetchForce: true }, true],
        ['desktop https, the setting on', { usePlainFetch: true }, true],
        ['desktop http, neither', { protocol: 'http:' }, false],
        ['android https, deforce', { android: true, usePlainFetch: true, plainFetchDeforce: true }, false],
        ['desktop, deforce', { usePlainFetch: true, plainFetchDeforce: true }, false],
        ['desktop, the local-network route', { usePlainFetch: true, localNetworkRoute: true }, false],
        ['web, a known local host', { isTauri: false, knownHost: true }, true],
        ['web, a known local host, deforce', { isTauri: false, knownHost: true, plainFetchDeforce: true }, false],
        ['tauri, a known local host alone', { knownHost: true }, false],
    ] as const)('%s', (_label, input, expected) => {
        expect(plainRule(input)).toBe(expected)
    })

    test('without Android it equals the existing rule for every input', () => {
        const flags = [false, true]
        for (const knownHost of flags) for (const isTauri of flags) for (const usePlainFetch of flags)
        for (const plainFetchForce of flags) for (const plainFetchDeforce of flags) for (const localNetworkRoute of flags)
        for (const protocol of ['http:', 'https:'] as const) {
            const existing = ((knownHost && !isTauri) || usePlainFetch || plainFetchForce) && !plainFetchDeforce && !localNetworkRoute
            expect(plainRule({ knownHost, isTauri, usePlainFetch, plainFetchForce, plainFetchDeforce, localNetworkRoute, protocol })).toBe(existing)
        }
    })

    test('on Android only the http scheme is exempt, whatever else is set', () => {
        const flags = [false, true]
        for (const knownHost of flags) for (const isTauri of flags) for (const usePlainFetch of flags)
        for (const plainFetchForce of flags) for (const plainFetchDeforce of flags) for (const localNetworkRoute of flags) {
            const rest = { knownHost, isTauri, usePlainFetch, plainFetchForce, plainFetchDeforce, localNetworkRoute, android: true }
            expect(plainRule({ ...rest, protocol: 'http:' })).toBe(false)
            expect(plainRule({ ...rest, protocol: 'https:' })).toBe(
                ((knownHost && !isTauri) || usePlainFetch || plainFetchForce) && !plainFetchDeforce && !localNetworkRoute)
        }
    })
})

describe('U2 androidHttpBlockedCause', () => {
    const failed = () => new TypeError('Failed to fetch')

    test('names the cause for Android, http and a TypeError that says Failed to fetch', () => {
        expect(androidHttpBlockedCause('http://voicevox.test/audio_query', failed(), true)).toBe(language.errors.androidHttpBlocked)
        expect(androidHttpBlockedCause('HTTP://voicevox.test/x', failed(), true)).toBe(language.errors.androidHttpBlocked)
        expect(androidHttpBlockedCause('http://voicevox.test/x', new TypeError('Load failed: Failed to fetch'), true)).toBe(language.errors.androidHttpBlocked)
    })

    test('reads the platform from the operating-system plugin when none is given', () => {
        box.os = 'android'
        expect(androidHttpBlockedCause('http://voicevox.test/x', failed())).toBe(language.errors.androidHttpBlocked)
        box.os = 'windows'
        expect(androidHttpBlockedCause('http://voicevox.test/x', failed())).toBeNull()
        box.os = 'throw'
        expect(androidHttpBlockedCause('http://voicevox.test/x', failed())).toBeNull()
    })

    test.each([
        ['https', 'https://voicevox.test/x', failed(), true],
        ['not Android', 'http://voicevox.test/x', failed(), false],
        ['an AbortError', 'http://voicevox.test/x', new DOMException('aborted', 'AbortError'), true],
        ['a different TypeError', 'http://voicevox.test/x', new TypeError('x is undefined'), true],
        ['an Error with the same words', 'http://voicevox.test/x', new Error('Failed to fetch'), true],
        ['a string rejection', 'http://voicevox.test/x', 'Failed to fetch', true],
        ['a relative address', '/dl/file', failed(), true],
        ['an unparsable address', 'http://', failed(), true],
    ])('names nothing for %s', (_label, url, error, android) => {
        expect(androidHttpBlockedCause(url, error, android)).toBeNull()
    })
})

describe('U2 directFetch', () => {
    test('returns the response of the global fetch unchanged, with its arguments', async () => {
        const response = new Response('ok')
        const fake = vi.fn(async () => response)
        vi.stubGlobal('fetch', fake)
        const init: RequestInit = { method: 'POST', body: 'x' }

        await expect(directFetch('http://voicevox.test/x', init)).resolves.toBe(response)

        expect(fake).toHaveBeenCalledWith('http://voicevox.test/x', init)
    })

    test('turns the refused fetch of an Android http address into AndroidHttpBlockedError', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

        const error = await directFetch('http://voicevox.test/x').catch((e: unknown) => e)

        expect(error).toBeInstanceOf(AndroidHttpBlockedError)
        expect((error as Error).message).toBe(language.errors.androidHttpBlocked)
    })

    test('rethrows an abort as the same object, so a stop is never reported as a cause', async () => {
        const abort = new DOMException('aborted', 'AbortError')
        vi.stubGlobal('fetch', vi.fn(async () => { throw abort }))

        const error = await directFetch('http://voicevox.test/x').catch((e: unknown) => e)

        expect(error).toBe(abort)
        expect(error).not.toBeInstanceOf(AndroidHttpBlockedError)
    })

    test.each([
        ['https', 'https://voicevox.test/x', 'android'],
        ['a non-Android page', 'http://voicevox.test/x', 'windows'],
    ])('rethrows the original TypeError for %s', async (_label, url, os) => {
        box.os = os
        const original = new TypeError('Failed to fetch')
        vi.stubGlobal('fetch', vi.fn(async () => { throw original }))

        const error = await directFetch(url).catch((e: unknown) => e)

        expect(error).toBe(original)
    })
})
