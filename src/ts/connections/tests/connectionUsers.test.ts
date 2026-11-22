import { describe, expect, it } from 'vitest'
import type { botPreset, Database, StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { storedConnections } from '../connections'
import { isOrphan, connectionUsers } from '../connectionUsers'
import { migrateConnections } from '../migrate'
import { setSlotKey } from '../slotEditor'

function producerPreset(url: string, key: string, name: string, id: string): botPreset {
    const db = {
        botPresets: [{ name }], botPresetsId: 0, forceReplaceUrl: url, proxyKey: key, openAIKey: '',
    } as unknown as StoredDatabase
    upstreamSaveCurrentPreset(db)
    return { ...db.botPresets[0], id }
}

function migratedDb(): Database {
    const db = {
        openAIKey: '', proxyKey: 'sk-test-PPPP1234', forceReplaceUrl: 'https://p.invalid/v1', claudeAPIKey: '',
        openrouterKey: '', nanogptKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', novellistAPI: '',
        mancerHeader: '', vertexPrivateKey: '',
        novelai: { token: '', model: 'm' }, hordeConfig: { apiKey: '', model: 'h', softPrompt: '' },
        google: { accessToken: '', projectId: 'p' }, OaiCompAPIKeys: {}, botPresetsId: 0,
        botPresets: [
            producerPreset('https://p.invalid/v1', 'sk-test-PPPP1234', 'one', 'p1'),
            producerPreset('https://p.invalid/v1', 'sk-test-PPPP1234', 'two', 'p2'),
        ],
        customModels: [{ id: 'ma', name: 'Model A', key: 'sk-test-CCCC5678', url: 'https://c.invalid' }, { id: 'mb', name: 'B' }],
    } as unknown as StoredDatabase
    expect(migrateConnections(db)).toBe('applied')
    return db as unknown as Database
}

describe('connectionUsers', () => {
    it('T12: a proxy lists the presets that name it and whether it is the working proxy', () => {
        const db = migratedDb()
        const proxy = storedConnections(db).find((c) => c.provider === 'reverse_proxy')!
        expect(connectionUsers(db, proxy)).toEqual({
            kind: 'presets',
            presets: [{ id: 'p1', name: 'one' }, { id: 'p2', name: 'two' }],
            working: db.proxyConnectionId === proxy.id,
        })
    })

    it('T12: a custom connection lists the models that name it', () => {
        const db = migratedDb()
        const custom = storedConnections(db).find((c) => c.provider === 'custom')!
        expect(connectionUsers(db, custom)).toEqual({ kind: 'models', models: [{ id: 'ma', name: 'Model A' }] })
    })

    it('T12: a second connection of one provider is shadowed, the first is the provider', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'openAIKey', 'sk-test-AAAA1234')
        db.connections = [...storedConnections(db), { id: 'conn-90', name: 'OpenAI 2', provider: 'openai', key: '' }]
        const [first, second] = storedConnections(db).filter((c) => c.provider === 'openai')
        expect(connectionUsers(db, first)).toEqual({ kind: 'provider' })
        expect(connectionUsers(db, second)).toEqual({ kind: 'shadowed' })
        expect(isOrphan(connectionUsers(db, first))).toBe(false)
    })

    it('T12: orphan means an empty list and not working', () => {
        const db = migratedDb()
        const proxy = storedConnections(db).find((c) => c.provider === 'reverse_proxy')!
        expect(isOrphan(connectionUsers(db, proxy))).toBe(false)
        for (const preset of db.botPresets) {
            preset.proxyConnectionId = ''
        }
        expect(isOrphan(connectionUsers(db, proxy))).toBe(false)
        db.proxyConnectionId = ''
        expect(isOrphan(connectionUsers(db, proxy))).toBe(true)
        const bare = { id: 'conn-91', name: 'x', provider: 'custom' as const, key: '' }
        expect(isOrphan(connectionUsers(db, bare))).toBe(true)
    })
})
