import { afterEach, describe, expect, it } from 'vitest'
import type { Connection } from '../connections'
import { connectionKeyHint, maskKeyHint } from '../connectionHint'
import { installVaultHost, resetVaultStoreForTest, type VaultPlatform } from '../keyVaultStore.svelte'

const conn = (key: string, provider: Connection['provider'] = 'openai'): Connection =>
    ({ id: 'conn-1', name: 'n', provider, key })

function installPlatform(platform: VaultPlatform): void {
    installVaultHost({
        platform,
        findConnection: () => undefined,
        listConnections: () => [],
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => 'unavailable' },
    })
}

afterEach(resetVaultStoreForTest)

describe('connectionKeyHint vault states', () => {
    const wrapped: Connection = { id: 'conn-1', name: 'n', provider: 'openai', key: '', keyWrapped: 'SYNTH-ENVELOPE' }

    it('a wrapped key not readable yet is unavailable, never none', () => {
        installPlatform('vault')
        expect(connectionKeyHint(wrapped)).toEqual({ kind: 'unavailable' })
    })

    it('a wrapped key this page can never read is reentry, never none', () => {
        installPlatform('none')
        expect(connectionKeyHint(wrapped)).toEqual({ kind: 'reentry' })
    })

    it('neither state carries any part of the envelope', () => {
        installPlatform('vault')
        expect(JSON.stringify(connectionKeyHint(wrapped))).not.toContain('SYNTH')
    })

    it('a plain key keeps its masked hint on a vault platform', () => {
        installPlatform('vault')
        expect(connectionKeyHint(conn('sk-SYNTH-abcd'))).toEqual({ kind: 'masked', tail: 'abcd' })
    })
})

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
