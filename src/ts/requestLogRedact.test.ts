/**
 * The pure rules of the request-log redactor (diagnostics of a new module: they
 * establish the seam's behaviour, with no claim about a pre-fix base), except the
 * U9 form tests, which reproduce a defect where a configured value switched off
 * the form rule. The paths
 * that feed the log are asserted in `globalApi.requestLogRedact.svelte.test.ts`.
 */
import { describe, expect, test } from 'vitest'
import { compileKnownSecrets, isRedactedValue, redactLogField, redactionToken, REVEAL_MIN_LENGTH } from 'src/ts/requestLogRedact'

const K1 = 'sk-test-SYNTHETIC0000abcd'
const KQ = 'sk-test-SYN"TH\\ETIC/0+0=0:abcd'
const jsonOnce = (text: string) => JSON.stringify(text).slice(1, -1)

describe('redactionToken', () => {
    test('U1 a value under 16 code points shows no tail; 16 and longer show the last four', () => {
        expect(REVEAL_MIN_LENGTH).toBe(16)
        expect(redactionToken('a'.repeat(15))).toBe('[redacted]')
        expect(redactionToken('a'.repeat(15) + 'b')).toBe('[redacted …aaab]')
        expect(redactionToken(K1)).toBe('[redacted …abcd]')
        expect(redactionToken('')).toBe('[redacted]')
    })

    test('U1 lengths and the tail count code points, so a surrogate pair is never split', () => {
        const emoji = 'sk-test-SYNTHETIC000ab\u{1F600}'
        expect(Array.from(emoji)).toHaveLength(23)
        expect(redactionToken(emoji)).toBe('[redacted …0ab\u{1F600}]')
        expect(redactionToken('a'.repeat(14) + '\u{1F600}')).toBe('[redacted]')
        expect(redactionToken('a'.repeat(15) + '\u{1F600}')).toBe('[redacted …aaa\u{1F600}]')
    })
})

describe('isRedactedValue', () => {
    test('U2 labels and redaction tokens are recognised on the decoded value; look-alikes are not', () => {
        expect(isRedactedValue('${RISU_X_KEY}')).toBe(true)
        expect(isRedactedValue('${A}:token')).toBe(true)
        expect(isRedactedValue('[redacted]')).toBe(true)
        expect(isRedactedValue('[redacted …abcd]')).toBe(true)
        expect(isRedactedValue('[redacted …a"\\]]')).toBe(true)
        expect(isRedactedValue('[redacted …abc]')).toBe(false)
        expect(isRedactedValue('pre-[redacted …abcd]')).toBe(false)
        expect(isRedactedValue('Bearer ${A}')).toBe(false)
        expect(isRedactedValue('sk-plain-key')).toBe(false)
    })
})

describe('idempotency', () => {
    const header = JSON.stringify({
        Authorization: `Bearer ${K1}`,
        'x-api-key': 'pre-[redacted …efgh]',
        'x-goog-api-key': '${A}:token',
        Cookie: 'sid=short',
        Accept: 'text/plain',
    }, null, 2)
    const body = JSON.stringify({ api_key: K1, access_token: '${A}:token', password: 'short', note: 'hi' }, null, 2)
    const url = `https://u:${K1}@h.invalid/p?key=${K1}&alt=sse&token=short`
    const form = `grant_type=refresh_token&refresh_token=${encodeURIComponent(K1)}&client_secret=pre-%5Bredacted%20%E2%80%A6efgh%5D`

    test('U2 applying a field rule twice equals applying it once', () => {
        for (const [field, text] of [['header', header], ['body', body], ['response', body], ['url', url], ['body', form]] as const) {
            const once = redactLogField(field, text)
            expect(once, field).not.toContain(K1)
            expect(redactLogField(field, once), field).toBe(once)
        }
    })

    test('U2 labels are kept and a partly redacted value is re-tokenised once, then stable', () => {
        const out = redactLogField('header', header)
        const parsed = JSON.parse(out)
        expect(parsed.Authorization).toBe('Bearer [redacted …abcd]')
        expect(parsed['x-goog-api-key']).toBe('${A}:token')
        expect(parsed['x-api-key']).toBe('[redacted …fgh]]')
        expect(parsed.Cookie).toBe('[redacted]')
        expect(parsed.Accept).toBe('text/plain')
        expect(redactLogField('header', JSON.stringify({ Authorization: 'Bearer ${RISU_X_KEY}' }))).toBe('{"Authorization":"Bearer ${RISU_X_KEY}"}')
        expect(redactLogField('url', 'https://h.invalid/p?key=${RISU_X_KEY}')).toBe('https://h.invalid/p?key=${RISU_X_KEY}')
    })
})

describe('name rules', () => {
    const secret = 'SYNTHETICsecretvalue0000'

    test('U3 credential names match with any case and an optional - or _ between word parts', () => {
        const body = JSON.stringify({ apiKey: secret, 'api-key': secret, API_KEY: secret, 'Client-Secret': secret, set_cookie: secret })
        const out = JSON.parse(redactLogField('body', body)) as Record<string, string>
        expect(Object.values(out)).toEqual(Array(5).fill('[redacted …0000]'))
    })

    test('U3 look-alike JSON names are kept byte-identical', () => {
        const body = JSON.stringify({
            max_tokens: 100, tokens: 5, token_count: 3, key: secret, prompt_cache_key: secret,
            thoughtSignature: secret, signature: secret, user_password_hint: secret, secretary: secret,
            x_api_key_label: secret, cookie_consent: secret, code: secret, token: secret, auth: secret,
        })
        expect(redactLogField('body', body)).toBe(body)
        expect(redactLogField('response', body)).toBe(body)
    })

    test('U3 bare key, token, auth, code and signature are credentials in a URL query and in a form body only', () => {
        const names = ['key', 'token', 'auth', 'code', 'sig', 'signature', 'assertion']
        for (const name of names) {
            expect(redactLogField('url', `https://h.invalid/p?a=1&${name}=${secret}&b=2`), name).toBe(`https://h.invalid/p?a=1&${name}=[redacted%20%E2%80%A60000]&b=2`)
            expect(redactLogField('body', `a=1&${name}=${secret}&b=2`), name).toBe(`a=1&${name}=[redacted%20%E2%80%A60000]&b=2`)
        }
        expect(redactLogField('url', `https://h.invalid/p?monkey=${secret}&keyboard=${secret}`)).toBe(`https://h.invalid/p?monkey=${secret}&keyboard=${secret}`)
    })

    test('U3 a registration access token is redacted in JSON and in a form', () => {
        expect(JSON.parse(redactLogField('response', JSON.stringify({ registration_access_token: secret, client_id: 'c' })))).toEqual({
            registration_access_token: '[redacted …0000]',
            client_id: 'c',
        })
        expect(redactLogField('body', `registration_access_token=${secret}`)).toBe('registration_access_token=[redacted%20%E2%80%A60000]')
    })

    test('U3 header names are matched by substring; the scheme is kept; other headers are untouched', () => {
        const headers = JSON.stringify({
            'Idempotency-Key': secret, 'X-Amz-Security-Token': secret, Authorization: `Digest ${secret}`,
            'Content-Type': 'application/json', 'X-Request-Id': secret,
        })
        const parsed = JSON.parse(redactLogField('header', headers)) as Record<string, string>
        expect(parsed['Idempotency-Key']).toBe('[redacted …0000]')
        expect(parsed['X-Amz-Security-Token']).toBe('[redacted …0000]')
        expect(parsed.Authorization).toBe('Digest [redacted …0000]')
        expect(parsed['Content-Type']).toBe('application/json')
        expect(parsed['X-Request-Id']).toBe(secret)
    })

    test('U3 a header value that holds an escaped quote is redacted whole', () => {
        const value = '{"k":"SYNTHETICinner000000wxyz"}'
        const text = JSON.stringify({ 'x-api-key': value, Accept: 'a' }, null, 2)
        const out = redactLogField('header', text)
        expect(out).not.toContain('SYNTHETICinner')
        expect(JSON.parse(out)).toEqual({ 'x-api-key': redactionToken(value), Accept: 'a' })
    })

    test('U3 a short value shows no tail', () => {
        expect(redactLogField('body', '{"password":"short"}')).toBe('{"password":"[redacted]"}')
    })

    test('U3 non-string values and empty strings are not redacted', () => {
        const body = '{"api_key":12,"password":"","secret":null,"cookie":{"a":1}}'
        expect(redactLogField('body', body)).toBe(body)
    })

    test('U3 text outside a redacted value is byte-identical', () => {
        const text = `{\n  "a": 1,\n  "api_key": "${K1}",\n  "b": "x\\ny"\n}\n`
        expect(redactLogField('body', text)).toBe(text.replace(K1, '[redacted …abcd]'))
    })

    test('U3 a credential in a URL fragment after the query is redacted', () => {
        expect(redactLogField('url', 'https://h.invalid/p?a=1#access_token=SYNTHETICsecretvalue0000'))
            .toBe('https://h.invalid/p?a=1#access_token=[redacted%20%E2%80%A60000]')
    })
})

describe('configured values', () => {
    test('U4a a raw value is replaced by its token', () => {
        const known = compileKnownSecrets([KQ])
        expect(known.apply(`before ${KQ} after`)).toBe('before [redacted …abcd] after')
    })

    test('U4b the JSON-escaped form is replaced and the JSON stays valid', () => {
        const known = compileKnownSecrets([KQ])
        const text = JSON.stringify({ v: KQ })
        expect(text).toContain(jsonOnce(KQ))
        const out = known.apply(text)
        expect(out).not.toContain(jsonOnce(KQ))
        expect(JSON.parse(out)).toEqual({ v: '[redacted …abcd]' })
    })

    test('U4c the twice-escaped form (JSON inside a JSON string) is replaced and both layers stay valid', () => {
        const known = compileKnownSecrets([KQ])
        const text = JSON.stringify({ h: JSON.stringify({ v: KQ }) })
        const twice = jsonOnce(jsonOnce(KQ))
        expect(text).toContain(twice)
        const out = known.apply(text)
        expect(out).not.toContain(twice)
        const inner = JSON.parse((JSON.parse(out) as { h: string }).h) as { v: string }
        expect(inner.v).toBe('[redacted …abcd]')
    })

    test('U4d the percent-encoded form is replaced and the URL still parses', () => {
        const known = compileKnownSecrets([KQ])
        const uri = encodeURIComponent(KQ)
        const url = `https://x.invalid/p/${uri}`
        expect(url).not.toContain(KQ)
        const out = known.apply(url)
        expect(out).not.toContain(uri)
        expect(out).toBe('https://x.invalid/p/[redacted%20%E2%80%A6abcd]')
        expect(new URL(out).origin).toBe('https://x.invalid')
    })

    test('U4e a value whose tail holds a quote, a backslash and a bracket yields a token that is escaped like its variant', () => {
        const value = 'sk-test-SYNTHETIC0000"\\]'
        const known = compileKnownSecrets([value])
        const token = redactionToken(value)
        expect(token).toBe('[redacted …0"\\]]')
        const out = known.apply(JSON.stringify({ v: value }))
        expect(JSON.parse(out)).toEqual({ v: token })
        expect(redactLogField('body', out, known)).toBe(out)
    })

    test('U4 a value under 16 code points, a ${NAME} reference and an empty set are ignored', () => {
        const text = 'short-key-value and ${RISU_X_KEY}'
        expect(compileKnownSecrets(['short-key-value', '${RISU_X_KEY}', '']).apply(text)).toBe(text)
        expect(compileKnownSecrets([]).apply(text)).toBe(text)
    })

    test('U4 the longest of overlapping values wins', () => {
        const known = compileKnownSecrets([K1, `${K1}-extended-tail`])
        expect(known.apply(`a ${K1}-extended-tail b`)).toBe('a [redacted …tail] b')
    })
})

describe('form bodies that contain a configured value', () => {
    // Only unreserved characters, so its raw and percent-encoded forms are the same text.
    const stored = 'SYNTHrefresh0000abcdEFGH'

    test('U9 a configured value found raw does not switch off the name rules for the rest of the body', () => {
        const known = compileKnownSecrets([stored])
        const refresh = `grant_type=refresh_token&refresh_token=${stored}&client_id=cid&client_secret=shortsecret`
        const out = redactLogField('body', refresh, known)
        expect(out).not.toContain(stored)
        expect(out).not.toContain('shortsecret')
        expect(out).toBe('grant_type=refresh_token&refresh_token=[redacted …EFGH]&client_id=cid&client_secret=[redacted]')
        expect(redactLogField('body', out, known)).toBe(out)
    })

    test('U9 a code exchange that sends a stored client secret still redacts the code and the verifier', () => {
        const known = compileKnownSecrets([stored])
        const exchange = `grant_type=authorization_code&code=SYNTHcode00000mnop&code_verifier=SYNTHverifier000qrst&client_secret=${stored}`
        const out = redactLogField('body', exchange, known)
        expect(out).not.toContain('SYNTHcode00000mnop')
        expect(out).not.toContain('SYNTHverifier000qrst')
        expect(out).not.toContain(stored)
        expect(out).toContain('grant_type=authorization_code&')
    })
})

describe('malformed and large input', () => {
    test('U5 an unterminated pathological field neither throws nor runs away', () => {
        const hostile = '"api_key": "' + '\\"'.repeat(1_000_000)
        const started = Date.now()
        expect(() => redactLogField('body', hostile)).not.toThrow()
        expect(() => redactLogField('header', hostile)).not.toThrow()
        expect(Date.now() - started).toBeLessThan(4000)
    })

    test('U5 a 4 MB body is processed in one pass', () => {
        const body = JSON.stringify({ messages: [{ content: 'x'.repeat(4_000_000) }], api_key: K1 })
        const out = redactLogField('body', body, compileKnownSecrets([K1]))
        expect(out).not.toContain(K1)
        expect(out.length).toBeGreaterThan(4_000_000)
    })

    test('U7a a percent-decode failure redacts that value from its raw text and leaves the rest', () => {
        expect(redactLogField('url', 'https://generativelanguage.example.invalid/v1?key=%E0%A4%ASYNTHETIC0000000wxyz&alt=sse'))
            .toBe('https://generativelanguage.example.invalid/v1?key=[redacted%20%E2%80%A6wxyz]&alt=sse')
        expect(redactLogField('url', 'https://u:%E0%A4SYNTHETICpass00@h.invalid/'))
            .toBe('https://u:[redacted%20%E2%80%A6ss00]@h.invalid/')
    })

    test('U7b a JSON-string decode failure redacts that value from its raw text and leaves the rest', () => {
        expect(redactLogField('body', 'x "api_key": "\\xSYNTHETIC0000000wxyz" rest')).toBe('x "api_key": "[redacted …wxyz]" rest')
    })
})

describe('URL userinfo', () => {
    const password = 'SYNTHETICpass0000wxyz'

    test('U8 the password is always redacted and a short username stays', () => {
        const out = redactLogField('url', `https://comfyuser:${password}@comfy.example.invalid/prompt`)
        expect(out).toBe('https://comfyuser:[redacted%20%E2%80%A6wxyz]@comfy.example.invalid/prompt')
        expect(new URL(out).origin).toBe('https://comfy.example.invalid')
        expect(redactLogField('url', 'https://admin:pw@h.invalid/')).toBe('https://admin:[redacted]@h.invalid/')
    })

    test('U8 a username of 16 code points or longer is redacted, with or without a password', () => {
        expect(redactLogField('url', `https://SYNTHETICuser000long:${password}@h.invalid/`))
            .toBe('https://[redacted%20%E2%80%A6long]:[redacted%20%E2%80%A6wxyz]@h.invalid/')
        expect(redactLogField('url', 'https://SYNTHETICuser000long@h.invalid/')).toBe('https://[redacted%20%E2%80%A6long]@h.invalid/')
        expect(redactLogField('url', 'https://short@h.invalid/')).toBe('https://short@h.invalid/')
    })

    test('U8 every form WHATWG parses with credentials is redacted', () => {
        for (const url of [
            `HTTPS://u:${password}@h.invalid/x`,
            `https:u:${password}@h.invalid/x`,
            `https:\\\\u:${password}@h.invalid/x`,
            ` https://u:${password}@h.invalid/x`,
            `https:/u:${password}@h.invalid/x`,
        ]) {
            expect(new URL(url).password, url).not.toBe('')
            const out = redactLogField('url', url)
            expect(out, url).not.toContain(password)
            expect(redactLogField('url', out), url).toBe(out)
        }
    })

    test('U8 reserved characters of a redacted tail are percent-encoded, so the origin and the result are stable', () => {
        const url = 'https://user:abcdefghijkl%2F%40%3A%23@h.invalid/p'
        const out = redactLogField('url', url)
        expect(out).toBe('https://user:[redacted%20%E2%80%A6%2F%40%3A%23]@h.invalid/p')
        expect(new URL(out).origin).toBe('https://h.invalid')
        expect(redactLogField('url', out)).toBe(out)
    })

    test('U8 an @ in the path is not userinfo, and a relative URL is left to the query rule', () => {
        expect(redactLogField('url', 'https://api.example.invalid/@cf/meta/model')).toBe('https://api.example.invalid/@cf/meta/model')
        expect(redactLogField('url', `/v1/models?key=${K1}`)).toBe('/v1/models?key=[redacted%20%E2%80%A6abcd]')
    })
})
