/**
 * Environment-variable references: syntax, platform dispatch, result checks,
 * cache, tripwire and redaction. The Tauri command and the Node route are
 * mocks; a pass here says nothing about the native command or the real
 * server route.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return platform.isTauri },
    get isNodeServer() { return platform.isNodeServer },
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

vi.mock('src/ts/storage/nodeStorage', () => ({
    getNodeServerProxyAuth: vi.fn(async () => 'AUTH-HEADER'),
}))

import { invoke } from '@tauri-apps/api/core'
import {
    assertNoSecretRef,
    blankSecretRef,
    isSecretRef,
    redactResolved,
    resetSecretRefState,
    resolveSecret,
    secretRefName,
    SecretRefError,
} from 'src/ts/secretRef'

const invokeMock = vi.mocked(invoke)
const KEY_VALUE = 'sk-live-0123456789abcdef'

function nodeResponse(value: unknown, status = 200) {
    return new Response(JSON.stringify({ value }), { status })
}

beforeEach(() => {
    platform.isTauri = false
    platform.isNodeServer = false
    resetSecretRefState()
    invokeMock.mockReset()
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('reference syntax', () => {
    test('a whole uppercase ${NAME} is a reference, with surrounding whitespace ignored', () => {
        expect(isSecretRef('${RISU_OPENAI_KEY}')).toBe(true)
        expect(isSecretRef('  ${RISU_OPENAI_KEY}\n')).toBe(true)
        expect(secretRefName(' ${_A1} ')).toBe('_A1')
    })

    test('lowercase, partial, nested and empty forms are not references', () => {
        for (const value of ['${risu_key}', '${Risu_Key}', 'sk-${RISU_KEY}', '${RISU_KEY}x', '$RISU_KEY', '${}', '${1ABC}', '${A B}', '', 'plain-key']) {
            expect(isSecretRef(value), value).toBe(false)
            expect(secretRefName(value), value).toBeNull()
        }
        expect(isSecretRef(undefined)).toBe(false)
        expect(isSecretRef(42)).toBe(false)
    })

    test('blankSecretRef blanks a whole reference and returns anything else unchanged', () => {
        expect(blankSecretRef('${RISU_X_KEY}')).toBe('')
        expect(blankSecretRef(' ${RISU_X_KEY} ')).toBe('')
        expect(blankSecretRef('sk-plain')).toBe('sk-plain')
        expect(blankSecretRef('${lower}')).toBe('${lower}')
        expect(blankSecretRef(undefined)).toBeUndefined()
    })
})

describe('resolveSecret dispatch', () => {
    test('a value that is not a reference is returned byte-identical without any lookup', async () => {
        platform.isTauri = true
        for (const value of ['sk-plain', ' padded key ', '${lower}', '']) {
            expect(await resolveSecret(value)).toBe(value)
        }
        expect(invokeMock).not.toHaveBeenCalled()
    })

    test('Tauri reads the variable through read_env_secret', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(KEY_VALUE)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe(KEY_VALUE)
        expect(invokeMock).toHaveBeenCalledWith('read_env_secret', { name: 'RISU_A_KEY' })
    })

    test('the Node server is asked over POST /api/env-secret with the proxy auth header', async () => {
        platform.isNodeServer = true
        const fetchMock = vi.fn(async () => nodeResponse(KEY_VALUE))
        vi.stubGlobal('fetch', fetchMock)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe(KEY_VALUE)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('/api/env-secret')
        expect(init.method).toBe('POST')
        expect((init.headers as Record<string, string>)['risu-auth']).toBe('AUTH-HEADER')
        expect(JSON.parse(init.body as string)).toEqual({ name: 'RISU_A_KEY' })
    })

    test('a platform with no server environment throws an unsupported error naming the variable', async () => {
        const error = await resolveSecret('${RISU_A_KEY}').catch((e) => e)
        expect(error).toBeInstanceOf(SecretRefError)
        expect(error.kind).toBe('unsupported')
        expect(error.variable).toBe('RISU_A_KEY')
        expect(error.message).toContain('RISU_A_KEY')
    })

    test('an unreachable or refusing Node server gives the unavailable error', async () => {
        platform.isNodeServer = true
        vi.stubGlobal('fetch', vi.fn(async () => nodeResponse(null, 404)))
        const refused = await resolveSecret('${RISU_A_KEY}').catch((e) => e)
        expect(refused).toBeInstanceOf(SecretRefError)
        expect(refused.kind).toBe('unavailable')

        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
        const unreachable = await resolveSecret('${RISU_B_KEY}').catch((e) => e)
        expect(unreachable).toBeInstanceOf(SecretRefError)
        expect(unreachable.kind).toBe('unavailable')
    })
})

describe('resolved value checks', () => {
    test('the result is trimmed', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(`  ${KEY_VALUE}\n`)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe(KEY_VALUE)
    })

    test.each([
        ['empty', ''],
        ['blank', '   '],
        ['CR inside', 'abc\rdef'],
        ['LF inside', 'abc\ndef'],
        ['CRLF inside', 'abc\r\ndef'],
        ['not a string', null],
    ])('%s is rejected as unavailable', async (_label, raw) => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(raw)
        const error = await resolveSecret('${RISU_A_KEY}').catch((e) => e)
        expect(error).toBeInstanceOf(SecretRefError)
        expect(error.kind).toBe('unavailable')
    })

    test('the error carries the variable name and never the value', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(`${KEY_VALUE}\nsecond-line`)
        const error = await resolveSecret('${RISU_A_KEY}').catch((e) => e)
        expect(error.message).not.toContain(KEY_VALUE)
        expect(JSON.stringify({ message: error.message, variable: error.variable })).not.toContain(KEY_VALUE)
        expect(error.variable).toBe('RISU_A_KEY')
    })
})

describe('cache and in-flight sharing', () => {
    test('a second resolution within the TTL does not look again, and one after it does', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(KEY_VALUE)
        await resolveSecret('${RISU_A_KEY}')
        await resolveSecret('${RISU_A_KEY}')
        expect(invokeMock).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(4 * 60 * 1000)
        await resolveSecret('${RISU_A_KEY}')
        expect(invokeMock).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(2 * 60 * 1000)
        await resolveSecret('${RISU_A_KEY}')
        expect(invokeMock).toHaveBeenCalledTimes(2)
    })

    test('concurrent resolutions of one name share one lookup', async () => {
        platform.isTauri = true
        let release: (value: string) => void = () => {}
        invokeMock.mockImplementation(() => new Promise<string>((resolve) => { release = resolve }))
        const first = resolveSecret('${RISU_A_KEY}')
        const second = resolveSecret(' ${RISU_A_KEY} ')
        release(KEY_VALUE)
        expect(await first).toBe(KEY_VALUE)
        expect(await second).toBe(KEY_VALUE)
        expect(invokeMock).toHaveBeenCalledTimes(1)
    })

    test('different names are looked up separately', async () => {
        platform.isTauri = true
        invokeMock.mockImplementation(async (_cmd, args) => `value-of-${(args as { name: string }).name}`)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe('value-of-RISU_A_KEY')
        expect(await resolveSecret('${RISU_B_KEY}')).toBe('value-of-RISU_B_KEY')
        expect(invokeMock).toHaveBeenCalledTimes(2)
    })

    test('a failure is not cached: the next call looks again and can succeed', async () => {
        platform.isTauri = true
        invokeMock.mockRejectedValueOnce(new Error('not set'))
        await expect(resolveSecret('${RISU_A_KEY}')).rejects.toBeInstanceOf(SecretRefError)
        invokeMock.mockResolvedValueOnce(KEY_VALUE)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe(KEY_VALUE)
        expect(invokeMock).toHaveBeenCalledTimes(2)
    })

    test('concurrent callers of a failing lookup all fail, and the failure is not kept', async () => {
        platform.isTauri = true
        invokeMock.mockRejectedValueOnce(new Error('not set'))
        const results = await Promise.allSettled([resolveSecret('${RISU_A_KEY}'), resolveSecret('${RISU_A_KEY}')])
        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
        invokeMock.mockResolvedValueOnce(KEY_VALUE)
        expect(await resolveSecret('${RISU_A_KEY}')).toBe(KEY_VALUE)
    })
})

describe('tripwire', () => {
    test('a plain object header whose value is a whole reference throws naming the variable', () => {
        const trip = () => assertNoSecretRef({ Authorization: '${RISU_A_KEY}' }, 'https://api.example.invalid/v1')
        expect(trip).toThrow(SecretRefError)
        expect(trip).toThrow('RISU_A_KEY')
    })

    test.each(['Bearer ${RISU_A_KEY}', 'bearer ${RISU_A_KEY}', 'DeepL-Auth-Key ${RISU_A_KEY}', 'Key ${RISU_A_KEY}', 'Token ${RISU_A_KEY}', '  ${RISU_A_KEY}  '])(
        'the header value %j trips',
        (value) => {
            expect(() => assertNoSecretRef({ Authorization: value }, 'https://x.invalid/')).toThrow(SecretRefError)
        },
    )

    test('Headers instances and array pairs are inspected too', () => {
        expect(() => assertNoSecretRef(new Headers({ 'x-api-key': '${RISU_A_KEY}' }), 'https://x.invalid/')).toThrow(SecretRefError)
        expect(() => assertNoSecretRef([['x-api-key', '${RISU_A_KEY}']], 'https://x.invalid/')).toThrow(SecretRefError)
    })

    test('a URL query value that is a reference trips, encoded or not', () => {
        expect(() => assertNoSecretRef({}, 'https://x.invalid/v1/models?key=${RISU_A_KEY}')).toThrow(SecretRefError)
        expect(() => assertNoSecretRef({}, 'https://x.invalid/v1/models?key=%24%7BRISU_A_KEY%7D')).toThrow(SecretRefError)
    })

    test('guard: plain keys, lowercase look-alikes and a reference inside a longer value pass', () => {
        expect(() => assertNoSecretRef({ Authorization: 'Bearer sk-plain', 'x-note': 'uses ${RISU_A_KEY} somewhere', 'x-low': '${risu_a_key}' }, 'https://x.invalid/?key=sk-plain&q=${RISU_A_KEY}x')).not.toThrow()
        expect(() => assertNoSecretRef(undefined, 'not a url')).not.toThrow()
        expect(() => assertNoSecretRef(undefined, undefined)).not.toThrow()
    })

    test('it never reads the environment', () => {
        platform.isTauri = true
        try { assertNoSecretRef({ a: '${RISU_A_KEY}' }) } catch { /* expected */ }
        expect(invokeMock).not.toHaveBeenCalled()
    })
})

describe('redaction', () => {
    test('a resolved value is replaced by its reference, also inside JSON and URL text', async () => {
        platform.isTauri = true
        const tricky = 'sk-"quoted"\\path-0123456789'
        invokeMock.mockResolvedValue(tricky)
        await resolveSecret('${RISU_T_KEY}')

        expect(redactResolved(`token=${tricky}`)).toBe('token=${RISU_T_KEY}')
        const jsonHeaders = JSON.stringify({ Authorization: `Bearer ${tricky}` })
        expect(jsonHeaders).not.toContain('${RISU_T_KEY}')
        expect(redactResolved(jsonHeaders)).toBe(JSON.stringify({ Authorization: 'Bearer ${RISU_T_KEY}' }))
        expect(redactResolved(`https://x.invalid/?key=${encodeURIComponent(tricky)}`)).toBe('https://x.invalid/?key=${RISU_T_KEY}')
        expect(redactResolved(JSON.stringify(jsonHeaders))).not.toContain('0123456789')
    })

    test('a value inside a JSON-encoded header object is redacted', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(KEY_VALUE)
        await resolveSecret('${RISU_A_KEY}')
        const text = JSON.stringify({ 'risu-header': JSON.stringify({ 'x-api-key': KEY_VALUE }) })
        expect(redactResolved(text)).not.toContain(KEY_VALUE)
        expect(redactResolved(text)).toContain('${RISU_A_KEY}')
    })

    test('text without resolved values is returned unchanged', async () => {
        expect(redactResolved('nothing to hide')).toBe('nothing to hide')
        platform.isTauri = true
        invokeMock.mockResolvedValue(KEY_VALUE)
        await resolveSecret('${RISU_A_KEY}')
        expect(redactResolved('nothing to hide')).toBe('nothing to hide')
    })

    test('a resolved value shorter than eight characters is not redacted', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue('short')
        await resolveSecret('${RISU_S_KEY}')
        expect(redactResolved('a short value')).toBe('a short value')
    })

    test('redaction outlives the cache TTL', async () => {
        platform.isTauri = true
        invokeMock.mockResolvedValue(KEY_VALUE)
        await resolveSecret('${RISU_A_KEY}')
        vi.advanceTimersByTime(10 * 60 * 1000)
        expect(redactResolved(`k=${KEY_VALUE}`)).toBe('k=${RISU_A_KEY}')
    })
})
