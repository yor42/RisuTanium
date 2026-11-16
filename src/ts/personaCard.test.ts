/**
 * The persona chunk body: what the exporter writes and what the importer accepts. Guards for new
 * behaviour; the byte-identity case pins that a complete persona without the flag serialises as the
 * original exporter did.
 */
import { Buffer } from 'buffer'
import { describe, expect, test } from 'vitest'
import { buildPersonaCard, hasEmptyExportField, parsePersonaCard } from './personaCard'

function b64(text: string): string {
    return Buffer.from(text).toString('base64')
}

describe('buildPersonaCard', () => {
    test('K1: a complete persona without the flag is byte-identical to the original card', () => {
        const card = buildPersonaCard({ name: 'Ann', personaPrompt: 'P', note: 'N' })
        expect(JSON.stringify(card)).toBe(JSON.stringify({ name: 'Ann', personaPrompt: 'P', note: 'N' }))
    })

    test('K2: empty name and personaPrompt are left out, note is kept, the flag only when true', () => {
        expect(JSON.stringify(buildPersonaCard({ name: '', personaPrompt: '', note: '' }))).toBe('{"note":""}')
        expect(JSON.stringify(buildPersonaCard({ name: 'A', personaPrompt: 'P', note: 'N', largePortrait: true }))).toBe(
            '{"name":"A","personaPrompt":"P","note":"N","largePortrait":true}')
        expect(JSON.stringify(buildPersonaCard({ name: 'A', personaPrompt: 'P', note: 'N', largePortrait: false }))).not.toContain('largePortrait')
    })
})

describe('parsePersonaCard', () => {
    test('K3: missing strings become empty, note only when a string, the flag only when literally true', () => {
        expect(parsePersonaCard(b64('{}'))).toEqual({ name: '', personaPrompt: '' })
        expect(parsePersonaCard(b64('{"name":"A","note":5}'))).toEqual({ name: 'A', personaPrompt: '' })
        expect(parsePersonaCard(b64('{"name":"A","personaPrompt":"P","note":"N","largePortrait":true}'))).toEqual({
            name: 'A', personaPrompt: 'P', note: 'N', largePortrait: true,
        })
        expect(parsePersonaCard(b64('{"name":"A","largePortrait":"true"}'))?.largePortrait).toBeUndefined()
        expect(parsePersonaCard(b64('{"name":"A","largePortrait":1}'))?.largePortrait).toBeUndefined()
    })

    test('K4: a payload that is not a JSON object gives null', () => {
        expect(parsePersonaCard(b64('[1,2]'))).toBeNull()
        expect(parsePersonaCard(b64('"text"'))).toBeNull()
        expect(parsePersonaCard(b64('null'))).toBeNull()
        expect(parsePersonaCard(b64('not json'))).toBeNull()
        expect(parsePersonaCard('')).toBeNull()
    })
})

describe('hasEmptyExportField', () => {
    test('is true when the name or the description is empty', () => {
        expect(hasEmptyExportField({ name: '', personaPrompt: 'P' })).toBe(true)
        expect(hasEmptyExportField({ name: 'A', personaPrompt: '' })).toBe(true)
        expect(hasEmptyExportField({ name: 'A', personaPrompt: 'P' })).toBe(false)
    })
})
