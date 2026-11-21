import { describe, expect, it } from 'vitest'
import type { botPreset, StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { keyStateOf, writeLegacyFromConnections } from '../binTranslate'
import { GLOBAL_ROWS } from '../slotTable'
import { migrateConnections } from '../migrate'

function producerPreset(url: string, key: string): botPreset {
    const db = {
        botPresets: [{ name: 'p' }], botPresetsId: 0, forceReplaceUrl: url, proxyKey: key, openAIKey: 'sk-preset',
    } as unknown as StoredDatabase
    upstreamSaveCurrentPreset(db)
    return db.botPresets[0]
}

/** Every in-scope legacy path holds a non-empty value. */
function fullLegacy(): StoredDatabase {
    return {
        openAIKey: 'sk-a\nsk-b', proxyKey: 'K-live', forceReplaceUrl: 'https://p.invalid/v1',
        claudeAPIKey: 'ant', openrouterKey: 'or', nanogptKey: 'ng', mistralKey: 'mi', cohereAPIKey: 'co',
        ollamaApiKey: 'ol', novellistAPI: 'nl', mancerHeader: 'ma', vertexPrivateKey: 'PEM',
        novelai: { token: 'nt', model: 'm' }, hordeConfig: { apiKey: 'hk', model: 'h', softPrompt: '' },
        google: { accessToken: 'gk', projectId: 'p' }, OaiCompAPIKeys: { deepseek: 'dk', deepinfra: 'di' },
        botPresets: [producerPreset('https://p.invalid/v1', 'K-stale'), producerPreset('https://q.invalid', 'Q')],
        customModels: [
            { id: 'ma', name: 'A', key: 'kA', url: 'https://a.invalid' },
            { id: 'mb', name: 'B', key: 'kB', url: 'https://b.invalid' },
        ],
    } as unknown as StoredDatabase
}

/** The reader of a database whose connections hold plain keys only. */
const plainKeys = { keyOf: (conn: { key: string }) => conn.key, late: () => [] as string[] }

async function translate(live: StoredDatabase): Promise<StoredDatabase> {
    const plain = structuredClone(live)
    const state = keyStateOf(plain)
    migrateConnections(state)
    writeLegacyFromConnections(state, plain, plainKeys)
    return plain
}

describe('migrate then translate', () => {
    it('restores every slot-table field, except a preset openAIKey which becomes empty', async () => {
        const live = fullLegacy()
        const original = structuredClone(live)
        migrateConnections(live)
        expect(live.openAIKey).toBe('')
        const out = await translate(live)
        for (const row of GLOBAL_ROWS) {
            expect(row.legacyGet(out), row.slot).toBe(row.legacyGet(original))
        }
        expect(out.OaiCompAPIKeys).toEqual(original.OaiCompAPIKeys)
        expect(out.forceReplaceUrl).toBe(original.forceReplaceUrl)
        expect(out.proxyKey).toBe(original.proxyKey)
        expect(out.customModels).toEqual(original.customModels)
        out.botPresets.forEach((preset, i) => {
            expect(preset.proxyKey).toBe(original.botPresets[i].proxyKey)
            expect(preset.forceReplaceUrl).toBe(original.botPresets[i].forceReplaceUrl)
            expect(preset.openAIKey).toBe('')
        })
    })

    it('leaves a preset without the three key fields without them, since upstream treats absent and empty differently', async () => {
        const live = { botPresets: [{ name: 'bare' }], botPresetsId: 0 } as unknown as StoredDatabase
        const out = await translate(live)
        const preset = out.botPresets[0]
        for (const field of ['forceReplaceUrl', 'proxyKey', 'openAIKey']) {
            expect(Object.hasOwn(preset, field), field).toBe(false)
        }
    })

    it('writes an empty openAIKey on a preset that held one, and a pair from its connection', async () => {
        const live = {
            connections: [{ id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: 'K1', url: 'https://u.invalid/v1' }],
            botPresets: [{ name: 'p', openAIKey: 'sk-preset', proxyConnectionId: 'conn-1' }],
        } as unknown as StoredDatabase
        const out = await translate(live)
        expect(out.botPresets[0]).toMatchObject({ openAIKey: '', proxyKey: 'K1', forceReplaceUrl: 'https://u.invalid/v1' })
    })

    it('keeps an own empty pair on a preset as an empty pair', async () => {
        const live = { botPresets: [{ name: 'p', proxyKey: '', forceReplaceUrl: '' }] } as unknown as StoredDatabase
        const out = await translate(live)
        expect(out.botPresets[0]).toMatchObject({ proxyKey: '', forceReplaceUrl: '' })
    })

    it('carries no store and no reference', async () => {
        const out = await translate(fullLegacy())
        expect(Object.hasOwn(out, 'connections')).toBe(false)
        expect(Object.hasOwn(out, 'proxyConnectionId')).toBe(false)
        expect(out.botPresets.some((p) => Object.hasOwn(p, 'proxyConnectionId'))).toBe(false)
        expect(out.customModels.some((m) => Object.hasOwn(m, 'connectionId'))).toBe(false)
    })

    it('translates an already-migrated database and lets a pending legacy value win', async () => {
        const live = {
            connections: [
                { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-old' },
                { id: 'conn-2', name: 'p', provider: 'reverse_proxy', key: 'PK', url: 'https://p.invalid' },
                { id: 'conn-3', name: 'c', provider: 'custom', key: 'ck', url: 'https://c.invalid' },
            ],
            proxyConnectionId: 'conn-2',
            openAIKey: 'sk-new',
            botPresets: [{ name: 'x', proxyConnectionId: 'conn-2' }],
            customModels: [{ id: 'ma', name: 'A', connectionId: 'conn-3' }, { id: 'mb', name: 'B' }],
            google: { accessToken: '', projectId: 'p' },
        } as unknown as StoredDatabase
        const out = await translate(live)
        expect(out.openAIKey).toBe('sk-new')
        expect(out.proxyKey).toBe('PK')
        expect(out.forceReplaceUrl).toBe('https://p.invalid')
        expect(out.botPresets[0]).toMatchObject({ proxyKey: 'PK', forceReplaceUrl: 'https://p.invalid' })
        expect(Object.hasOwn(out.botPresets[0], 'openAIKey')).toBe(false)
        expect(out.customModels[0]).toMatchObject({ key: 'ck', url: 'https://c.invalid' })
        expect(out.customModels[1]).toMatchObject({ key: '', url: '' })
    })

    it('does not mutate the live objects the export copy shares', async () => {
        const live = {
            connections: [{ id: 'conn-1', name: 'G', provider: 'google', key: 'g-key' }],
            google: { accessToken: '', projectId: 'p' },
            botPresets: [{ name: 'x', proxyKey: 'K', forceReplaceUrl: 'https://p.invalid', openAIKey: 'sk-p' }],
            customModels: [{ id: 'ma', name: 'A', key: 'k', url: 'https://c.invalid' }],
            OaiCompAPIKeys: { deepseek: 'dk' },
            openAIKey: 'sk-a',
        } as unknown as StoredDatabase
        const before = structuredClone(live)
        const plain = { ...live }
        const state = keyStateOf(plain)
        migrateConnections(state)
        writeLegacyFromConnections(state, plain, plainKeys)
        expect(live).toEqual(before)
        expect(plain.google.accessToken).toBe('g-key')
        expect(plain.botPresets).not.toBe(live.botPresets)
        expect(plain.customModels).not.toBe(live.customModels)
    })

    it('keeps the legacy values when the store is malformed', async () => {
        const live = { connections: 'garbage', openAIKey: 'sk-a', proxyKey: 'K', forceReplaceUrl: 'https://p.invalid' } as unknown as StoredDatabase
        const out = await translate(live)
        expect(out.openAIKey).toBe('sk-a')
        expect(out.proxyKey).toBe('K')
        expect(Object.hasOwn(out, 'connections')).toBe(false)
    })

    it('gives a custom model with no connection and no key fields string key and url', async () => {
        const live = { customModels: [{ id: 'ma', name: 'A' }], openAIKey: 'x' } as unknown as StoredDatabase
        const out = await translate(live)
        expect(out.customModels[0]).toMatchObject({ key: '', url: '' })
    })
})

describe('keyStateOf', () => {
    it('copies connections and nested containers instead of aliasing them', () => {
        const live = fullLegacy()
        live.connections = [{ id: 'conn-1', name: 'n', provider: 'openai', key: 'k' }]
        const state = keyStateOf(live)
        expect(state.connections![0]).not.toBe(live.connections[0])
        expect(state.google).not.toBe(live.google)
        expect(state.botPresets[0]).not.toBe(live.botPresets[0])
        expect(state.botPresets).toHaveLength(2)
    })
})
