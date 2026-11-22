/**
 * T24: no deleted key comes back through the `.bin` path after delete and Undo. Compatibility
 * guard: it passes before and after the V2 page, and it fails if a restore ever carries a plain key
 * into the stored connections that `writeLegacyFromConnections` translates. Wrapped envelopes are
 * covered by the editor and undo snapshot tests, not here.
 * Synthetic keys only.
 */
import { describe, expect, it } from 'vitest'
import type { botPreset, Database, StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { keyStateOf, writeLegacyFromConnections } from '../binTranslate'
import { migrateConnections } from '../migrate'
import { storedConnections } from '../connections'
import { deleteConnection, restoreConnection } from '../connectionEditor'

/** The reader of a database whose connections hold plain keys only. */
const plainKeys = { keyOf: (conn: { key: string }) => conn.key, late: () => [] as string[] }

function producerPreset(url: string, key: string, name: string, id: string): botPreset {
    const db = { botPresets: [{ name }], botPresetsId: 0, forceReplaceUrl: url, proxyKey: key, openAIKey: '' } as unknown as StoredDatabase
    upstreamSaveCurrentPreset(db)
    return { ...db.botPresets[0], id }
}

function legacy(): StoredDatabase {
    return {
        openAIKey: 'sk-SYNTH-OOOO1111', proxyKey: 'sk-SYNTH-PPPP2222', forceReplaceUrl: 'https://p.invalid/v1', claudeAPIKey: '',
        openrouterKey: '', nanogptKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', novellistAPI: '',
        mancerHeader: '', vertexPrivateKey: '',
        novelai: { token: '', model: 'm' }, hordeConfig: { apiKey: '', model: 'h', softPrompt: '' },
        google: { accessToken: '', projectId: 'p' }, OaiCompAPIKeys: {}, botPresetsId: 0,
        botPresets: [producerPreset('https://p.invalid/v1', 'sk-SYNTH-PPPP2222', 'one', 'p1')],
        customModels: [{ id: 'ma', name: 'Model A', key: 'sk-SYNTH-CCCC3333', url: 'https://c.invalid' }],
    } as unknown as StoredDatabase
}

describe('T24 .bin after delete and Undo', () => {
    it('no deleted key reaches the store or the translated legacy fields', () => {
        const db = legacy()
        expect(migrateConnections(db)).toBe('applied')
        const live = db as unknown as Database
        const removed = storedConnections(live).map((conn) => deleteConnection(live, conn.id)!)
        expect(storedConnections(live)).toEqual([])
        for (const record of removed.reverse()) expect(restoreConnection(live, record)).toBe('restored')
        expect(storedConnections(live)).toHaveLength(3)
        expect(JSON.stringify(db)).not.toContain('sk-SYNTH')

        const plain = structuredClone(db)
        const state = keyStateOf(plain)
        migrateConnections(state)
        writeLegacyFromConnections(state, plain, plainKeys)
        expect(JSON.stringify(plain)).not.toContain('sk-SYNTH')
        expect(plain.openAIKey).toBe('')
        expect(plain.proxyKey).toBe('')
    })
})
