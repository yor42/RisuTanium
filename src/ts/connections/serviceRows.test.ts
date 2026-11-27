/**
 * The 13 service rows of the slot table: their provider ids and labels (stored in `connections[].name`), the
 * V3 database that holds service keys beside chat connections (a boot or a restored settings archive reaches the
 * load hook the same way), and the reader text of their secret-field entries.
 */
import { afterEach, describe, expect, test } from 'vitest'
import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { GLOBAL_SLOT_PROVIDERS, providerLabel, SERVICE_SLOTS, type Connection } from './connections'
import { migrateConnectionsOnLoad, takeConnectionsMigrated } from './migrate'
import { GLOBAL_ROWS } from './slotTable'

afterEach(() => { takeConnectionsMigrated() })

const EXPECTED: Record<string, readonly [provider: string, label: string]> = {
    elevenLabKey: ['elevenlabs', 'ElevenLabs'],
    huggingfaceKey: ['huggingface', 'Hugging Face'],
    fishSpeechKey: ['fishspeech', 'Fish Audio'],
    NAIApiKey: ['novelai_media', 'NovelAI image and voice'],
    stabilityKey: ['stability', 'Stability AI'],
    falToken: ['fal', 'fal.ai'],
    'openaiCompatImage.key': ['openai_image', 'OpenAI-compatible image'],
    'wavespeedImage.key': ['wavespeed', 'WaveSpeed'],
    'deeplOptions.key': ['deepl', 'DeepL'],
    'deeplXOptions.token': ['deeplx', 'DeepLX'],
    supaMemoryKey: ['memory_openai', 'Memory (OpenAI)'],
    voyageApiKey: ['voyage', 'Voyage AI'],
    'hypaCustomSettings.key': ['embedding_custom', 'Custom embedding'],
}

describe('the provider ids and labels', () => {
    test('each service slot has its own persisted provider id and its label, never the bare id', () => {
        expect([...SERVICE_SLOTS].sort()).toEqual(Object.keys(EXPECTED).sort())
        for (const slot of SERVICE_SLOTS) {
            const [provider, label] = EXPECTED[slot]
            expect(GLOBAL_SLOT_PROVIDERS[slot], slot).toBe(provider)
            expect(providerLabel(GLOBAL_SLOT_PROVIDERS[slot]), slot).toBe(label)
            expect(label).not.toBe(provider)
        }
    })

    test('every global row has a distinct label, so two connections never share a default name', () => {
        const labels = GLOBAL_ROWS.map((row) => providerLabel(row.provider))
        expect(new Set(labels).size).toBe(labels.length)
    })
})

describe('the secret-field entries of the service slots', () => {
    test('read as legacy slots absorbed at load, except the stored-only hypaMemoryKey', () => {
        for (const row of GLOBAL_ROWS.filter((r) => (SERVICE_SLOTS as readonly string[]).includes(r.slot))) {
            const entry = SECRET_FIELDS.find((e) => e.scope === 'database' && e.field === row.secretEntry.field && ('sub' in e ? e.sub : undefined) === row.secretEntry.sub)
            expect(entry && 'reader' in entry ? entry.reader : undefined, row.slot).toBe('legacy slot, absorbed at load; written by .bin translation')
        }
        const hypa = SECRET_FIELDS.find((e) => e.scope === 'database' && e.field === 'hypaMemoryKey')
        expect(hypa && 'reader' in hypa ? hypa.reader : undefined).toBe('stored only; no request reader found')
    })

    test('the connection key entry names the service readers too, not only chat requests', () => {
        const entry = SECRET_FIELDS.find((e) => e.scope === 'database' && e.field === 'connections' && 'sub' in e && e.sub === '[].key')
        expect(entry && 'reader' in entry ? entry.reader : '').toContain('service')
    })
})

describe('a V3 database restored into this build', () => {
    // compatibility guard (passes before and after only for the chat part): a V3 settings archive or store holds chat
    // connections and, beside them, service keys in their legacy positions.
    test('keeps its chat connections byte-equal and appends the service connections, leaving the rest of each container', () => {
        const chat: Connection[] = [
            { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a', keyWrapped: undefined },
            { id: 'conn-2', name: 'Claude', provider: 'anthropic', key: '', keyWrapped: 'SYN-ENVELOPE' },
        ]
        const db = {
            connections: structuredClone(chat),
            elevenLabKey: 'SYN-el',
            deeplOptions: { key: 'SYN-dl', freeApi: false },
            wavespeedImage: { key: '', model: 'm', reference_image: 'r', loras: [] },
        } as unknown as StoredDatabase

        expect(migrateConnectionsOnLoad(db)).toBe('applied')

        expect(takeConnectionsMigrated()).toBe(true)
        expect(db.connections?.slice(0, 2)).toEqual(chat)
        expect((db.connections ?? []).slice(2).map((conn) => [conn.id, conn.provider, conn.key])).toEqual([
            ['conn-3', 'elevenlabs', 'SYN-el'],
            ['conn-4', 'deepl', 'SYN-dl'],
        ])
        expect(db.deeplOptions).toEqual({ key: '', freeApi: false })
        expect(db.wavespeedImage).toEqual({ key: '', model: 'm', reference_image: 'r', loras: [] })
        expect(migrateConnectionsOnLoad(db)).toBe('none')
    })
})
