import { describe, expect, it } from 'vitest'
import type { Connection } from '../connections'
import { connectionKeyHint, maskKeyHint } from '../connectionHint'

const conn = (key: string, provider: Connection['provider'] = 'openai'): Connection =>
    ({ id: 'conn-1', name: 'n', provider, key })

describe('connectionKeyHint', () => {
    it('T1: a long key shows only its last four characters', () => {
        const hint = connectionKeyHint(conn('sk-SYNTH-abcd'))
        expect(hint).toEqual({ kind: 'masked', tail: 'abcd' })
        expect(JSON.stringify(hint)).not.toContain('sk-SYNTH')
    })

    it('T2: short keys show no tail', () => {
        expect(maskKeyHint('sk-1234', 'openai')).toEqual({ kind: 'masked', tail: '' })
        expect(maskKeyHint('12345678', 'openai')).toEqual({ kind: 'masked', tail: '5678' })
    })

    it('E2: surrounding whitespace does not count toward the under-8 rule', () => {
        expect(maskKeyHint('   abcde', 'openai')).toEqual({ kind: 'masked', tail: '' })
        expect(maskKeyHint('  12345678  ', 'openai')).toEqual({ kind: 'masked', tail: '5678' })
    })

    it('T2: a rotation list counts its lines and masks the first', () => {
        expect(maskKeyHint('sk-test-AAAA1111\r\n\nsk-test-BBBB2222', 'openai'))
            .toEqual({ kind: 'masked', tail: '1111', count: 2 })
    })

    it('T2: a whole ${NAME} reference is shown, a leading reference keeps the count', () => {
        expect(maskKeyHint(' ${MY_KEY} ', 'openai')).toEqual({ kind: 'ref', text: '${MY_KEY}' })
        expect(maskKeyHint('${MY_KEY}\nsk-test-AAAA1111', 'openai')).toEqual({ kind: 'ref', text: '${MY_KEY}', count: 2 })
    })

    it('T2: a vertex PEM never shows a tail or counts its lines', () => {
        const pem = '-----BEGIN PRIVATE KEY-----\nSYNTHBODY\n-----END PRIVATE KEY-----'
        const hint = maskKeyHint(pem, 'vertex')
        expect(hint).toEqual({ kind: 'masked', tail: '', count: 1 })
        expect(JSON.stringify(hint)).not.toContain('---')
    })

    it('T2: blank is none for every provider, vertex included', () => {
        for (const provider of ['openai', 'vertex'] as const) {
            expect(maskKeyHint('', provider)).toEqual({ kind: 'none' })
            expect(maskKeyHint(' \n ', provider)).toEqual({ kind: 'none' })
        }
    })
})
