import { describe, expect, test } from 'vitest'
import { checkWorkspaceText, decodeWorkspaceBytes, utf8ByteLength } from '../textGuard'

// T9: workspace files are text only (MC-3372); binary content is refused.

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe('decodeWorkspaceBytes', () => {
    test('valid UTF-8 decodes, multi-byte text included', () => {
        expect(decodeWorkspaceBytes(new TextEncoder().encode('hello\nworld'))).toEqual({ ok: true, text: 'hello\nworld' })
        expect(decodeWorkspaceBytes(new TextEncoder().encode('한글 😀'))).toEqual({ ok: true, text: '한글 😀' })
        expect(decodeWorkspaceBytes(new Uint8Array(0))).toEqual({ ok: true, text: '' })
    })

    test('a leading byte order mark is dropped', () => {
        expect(decodeWorkspaceBytes(bytes(0xEF, 0xBB, 0xBF, 0x68, 0x69))).toEqual({ ok: true, text: 'hi' })
    })

    test('invalid UTF-8 is binary', () => {
        expect(decodeWorkspaceBytes(bytes(0xFF, 0xFE, 0x00, 0x01))).toEqual({ ok: false, reason: 'binary' })
        expect(decodeWorkspaceBytes(bytes(0xC3, 0x28))).toEqual({ ok: false, reason: 'binary' })
        expect(decodeWorkspaceBytes(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toEqual({ ok: false, reason: 'binary' })
    })

    test('valid UTF-8 holding a NUL is binary', () => {
        expect(decodeWorkspaceBytes(bytes(0x61, 0x00, 0x62))).toEqual({ ok: false, reason: 'binary' })
    })
})

describe('checkWorkspaceText', () => {
    test('ordinary text passes; NUL and lone surrogates are refused', () => {
        expect(checkWorkspaceText('plain\ttext\r\n')).toEqual({ ok: true })
        expect(checkWorkspaceText('a\u0000b')).toEqual({ ok: false, reason: 'nul' })
        expect(checkWorkspaceText('a\ud800')).toEqual({ ok: false, reason: 'malformed-text' })
        expect(checkWorkspaceText('😀')).toEqual({ ok: true })
    })
})

describe('utf8ByteLength', () => {
    test('counts bytes, not characters', () => {
        expect(utf8ByteLength('abc')).toBe(3)
        expect(utf8ByteLength('가')).toBe(3)
        expect(utf8ByteLength('😀')).toBe(4)
    })
})
