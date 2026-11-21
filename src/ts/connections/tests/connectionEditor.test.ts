import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { botPreset, Database, StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

const h = vi.hoisted(() => ({ reject: 0 }))

vi.mock('../keyAccess', async (importOriginal) => {
    const real = await importOriginal<typeof import('../keyAccess')>()
    return {
        ...real,
        setConnectionKey: (conn: import('../connections').Connection, plain: string) => {
            if (h.reject > 0) {
                h.reject--
                return Promise.reject(new Error('vault down'))
            }
            return real.setConnectionKey(conn, plain)
        },
    }
})

import { slotConnection, storedConnections, type Connection } from '../connections'
import {
    addConnection, clearKey, deleteConnection, keyEffectsOf, needsKey, renameConnection, replaceKey,
    restoreConnection, useProxyForCurrent, type RemovedConnection,
} from '../connectionEditor'
import { migrateConnections } from '../migrate'
import { setSlotKey } from '../slotEditor'

function producerPreset(url: string, key: string, name: string, id: string): botPreset {
    const db = {
        botPresets: [{ name }], botPresetsId: 0, forceReplaceUrl: url, proxyKey: key, openAIKey: '',
    } as unknown as StoredDatabase
    upstreamSaveCurrentPreset(db)
    return { ...db.botPresets[0], id }
}

/** A database the real migration produced from legacy fields: one proxy used by two presets, one custom model. */
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
        customModels: [{ id: 'ma', name: 'Model A', key: 'sk-test-CCCC5678', url: 'https://c.invalid' }],
        nanogptRequestModel: 'm', nanogptRequestModelName: 'mn', nanogptProvider: 'np',
        nanogptSubscriptionState: 'on', nanogptUseSubscriptionEndpoint: true,
        vertexAccessToken: 'tok', vertexAccessTokenExpires: 99,
    } as unknown as StoredDatabase
    expect(migrateConnections(db)).toBe('applied')
    return db as unknown as Database
}

const proxyOf = (db: Database): Connection => storedConnections(db).find((c) => c.provider === 'reverse_proxy')!
const customOf = (db: Database): Connection => storedConnections(db).find((c) => c.provider === 'custom')!

beforeEach(() => {
    h.reject = 0
    needsKey.clear()
})

describe('addConnection', () => {
    it('T5: refuses a provider that is present, a blank key, a blank name and a malformed store', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'openAIKey', 'sk-test-AAAA1234')
        const before = storedConnections(db).length
        expect(await addConnection(db, { provider: 'openai', name: 'x', key: 'sk-test-ZZZZ0000' }))
            .toEqual({ ok: false, reason: 'taken' })
        expect(await addConnection(db, { provider: 'custom', name: 'x', key: 'sk-test-ZZZZ0000' }))
            .toEqual({ ok: false, reason: 'taken' })
        expect(await addConnection(db, { provider: 'anthropic', name: 'x', key: '  ' }))
            .toEqual({ ok: false, reason: 'blank' })
        expect(await addConnection(db, { provider: 'reverse_proxy', name: 'x', key: '', url: ' ' }))
            .toEqual({ ok: false, reason: 'blank' })
        expect(await addConnection(db, { provider: 'anthropic', name: '  ', key: 'sk-test-ZZZZ0000' }))
            .toEqual({ ok: false, reason: 'name' })
        expect(storedConnections(db)).toHaveLength(before)
        const bad = { connections: 'nope' } as unknown as Database
        expect(await addConnection(bad, { provider: 'anthropic', name: 'x', key: 'sk-test-ZZZZ0000' }))
            .toEqual({ ok: false, reason: 'malformed' })
        expect(bad.connections as unknown).toBe('nope')
    })

    it('T5: keeps the typed name verbatim, even when another connection has it, and cuts at 60', async () => {
        const db = { customModels: [] } as unknown as Database
        const a = await addConnection(db, { provider: 'reverse_proxy', name: 'OpenAI', key: 'sk-test-AAAA1234', url: 'https://a.invalid' })
        const b = await addConnection(db, { provider: 'reverse_proxy', name: 'OpenAI', key: 'sk-test-BBBB1234', url: 'https://b.invalid' })
        expect(a.ok && b.ok).toBe(true)
        expect(storedConnections(db).map((c) => c.name)).toEqual(['OpenAI', 'OpenAI'])
        const long = await addConnection(db, { provider: 'openai', name: ' ' + 'n'.repeat(70), key: 'sk-test-CCCC1234' })
        expect(long.ok).toBe(true)
        expect(storedConnections(db)[2].name).toBe('n'.repeat(60))
    })

    it('T5: stores the key and id from nextConnectionId; a url only for a proxy', async () => {
        const db = migratedDb()
        const before = storedConnections(db).length
        const result = await addConnection(db, { provider: 'mistral', name: 'M', key: 'sk-test-MMMM1234', url: 'https://ignored.invalid' })
        expect(result).toEqual({ ok: true, id: `conn-${before + 1}` })
        expect(storedConnections(db).at(-1)).toEqual({ id: `conn-${before + 1}`, name: 'M', provider: 'mistral', key: 'sk-test-MMMM1234' })
    })

    it('T27: the first proxy becomes the working one when none or a dangling one resolves; a resolving one is kept', async () => {
        const db = { customModels: [] } as unknown as Database
        const first = await addConnection(db, { provider: 'reverse_proxy', name: 'a', key: 'sk-test-AAAA1234', url: 'https://a.invalid' })
        expect(first.ok && db.proxyConnectionId === first.id).toBe(true)
        const second = await addConnection(db, { provider: 'reverse_proxy', name: 'b', key: 'sk-test-BBBB1234', url: 'https://b.invalid' })
        expect(second.ok).toBe(true)
        expect(db.proxyConnectionId).toBe(first.ok ? first.id : '')

        const dangling = { customModels: [], proxyConnectionId: 'conn-77' } as unknown as Database
        const added = await addConnection(dangling, { provider: 'reverse_proxy', name: 'a', key: 'sk-test-AAAA1234', url: 'https://a.invalid' })
        expect(added.ok && dangling.proxyConnectionId === added.id).toBe(true)

        const blanked = { customModels: [], proxyConnectionId: '' } as unknown as Database
        const viaEmpty = await addConnection(blanked, { provider: 'reverse_proxy', name: 'a', key: 'sk-test-AAAA1234', url: 'https://a.invalid' })
        expect(viaEmpty.ok && blanked.proxyConnectionId === viaEmpty.id).toBe(true)
    })

    it('T26: a rejected key write removes the connection, writes no proxy reference and reports keyWrite', async () => {
        const db = { customModels: [] } as unknown as Database
        h.reject = 1
        const result = await addConnection(db, { provider: 'reverse_proxy', name: 'a', key: 'sk-test-AAAA1234', url: 'https://a.invalid' })
        expect(result).toEqual({ ok: false, reason: 'keyWrite' })
        expect(storedConnections(db)).toEqual([])
        expect(db.proxyConnectionId).toBeUndefined()
        expect(JSON.stringify(result)).not.toContain('sk-test')
    })

    it('a successful add drops a stale needsKey entry of a reused id', async () => {
        const db = { customModels: [] } as unknown as Database
        needsKey.add('conn-1')
        await addConnection(db, { provider: 'openai', name: 'OpenAI', key: 'sk-test-AAAA1234' })
        expect(needsKey.has('conn-1')).toBe(false)
    })
})

describe('useProxyForCurrent', () => {
    it('T28: accepts a stored proxy only', () => {
        const db = migratedDb()
        db.proxyConnectionId = ''
        expect(useProxyForCurrent(db, proxyOf(db).id)).toBe(true)
        expect(db.proxyConnectionId).toBe(proxyOf(db).id)
        db.proxyConnectionId = ''
        expect(useProxyForCurrent(db, customOf(db).id)).toBe(false)
        expect(useProxyForCurrent(db, 'conn-404')).toBe(false)
        expect(db.proxyConnectionId).toBe('')
        expect(useProxyForCurrent({ connections: 'x' } as unknown as Database, 'conn-1')).toBe(false)
    })
})

describe('renameConnection', () => {
    it('T6: trims, cuts at 60, refuses empty, warns on a duplicate but saves', () => {
        const db = migratedDb()
        const proxy = proxyOf(db)
        expect(renameConnection(db, proxy.id, '  ' + 'x'.repeat(70))).toEqual({ ok: true, duplicate: false })
        expect(proxyOf(db).name).toBe('x'.repeat(60))
        expect(renameConnection(db, proxy.id, '   ')).toEqual({ ok: false, duplicate: false })
        expect(proxyOf(db).name).toBe('x'.repeat(60))
        const other = customOf(db)
        expect(renameConnection(db, other.id, 'x'.repeat(60))).toEqual({ ok: true, duplicate: true })
        expect(customOf(db).name).toBe('x'.repeat(60))
        expect(renameConnection(db, 'conn-404', 'y')).toEqual({ ok: false, duplicate: false })
    })
})

describe('key effects', () => {
    it('T11: clearing NanoGPT resets its choices; replacing keeps them', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'nanogptKey', 'sk-test-NNNN1234')
        const id = slotConnection(db, 'nanogptKey')!.id
        expect(await replaceKey(db, id, 'sk-test-NNNN5678')).toEqual({ ok: true })
        expect(db.nanogptRequestModel).toBe('m')
        expect(await clearKey(db, id)).toEqual({ ok: true })
        expect(slotConnection(db, 'nanogptKey')!.key).toBe('')
        expect(db).toMatchObject({
            nanogptUseSubscriptionEndpoint: false, nanogptSubscriptionState: '', nanogptRequestModel: '',
            nanogptRequestModelName: '', nanogptProvider: '',
        })
    })

    it('T11: any Vertex key change clears the saved token', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'vertexPrivateKey', 'PEM-SYNTH')
        const id = slotConnection(db, 'vertexPrivateKey')!.id
        expect(await replaceKey(db, id, 'PEM-SYNTH-2')).toEqual({ ok: true })
        expect(db.vertexAccessToken).toBe('')
        expect(db.vertexAccessTokenExpires).toBe(0)
    })

    it('replace refuses a blank value and an unknown id; the confirm lists the effects', async () => {
        const db = migratedDb()
        expect(await replaceKey(db, proxyOf(db).id, ' ')).toEqual({ ok: false, reason: 'blank' })
        expect(await replaceKey(db, 'conn-404', 'sk-test-AAAA1234')).toEqual({ ok: false, reason: 'unknown' })
        expect(await clearKey(db, 'conn-404')).toEqual({ ok: false, reason: 'unknown' })
        expect(keyEffectsOf('nanogpt')).toEqual(['nanogpt'])
        expect(keyEffectsOf('vertex')).toEqual(['vertex'])
        expect(keyEffectsOf('openai')).toEqual([])
    })

    it('T26: a rejected replace changes no key, no effect and no needsKey entry', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'vertexPrivateKey', 'PEM-SYNTH')
        const id = slotConnection(db, 'vertexPrivateKey')!.id
        needsKey.add(id)
        db.vertexAccessToken = 'tok'
        h.reject = 1
        expect(await replaceKey(db, id, 'PEM-SYNTH-2')).toEqual({ ok: false, reason: 'keyWrite' })
        expect(slotConnection(db, 'vertexPrivateKey')!.key).toBe('PEM-SYNTH')
        expect(db.vertexAccessToken).toBe('tok')
        expect(needsKey.has(id)).toBe(true)
        h.reject = 1
        expect(await clearKey(db, id)).toEqual({ ok: false, reason: 'keyWrite' })
        expect(slotConnection(db, 'vertexPrivateKey')!.key).toBe('PEM-SYNTH')
    })

    it('a successful replace drops the needsKey entry', async () => {
        const db = migratedDb()
        const id = proxyOf(db).id
        needsKey.add(id)
        await replaceKey(db, id, 'sk-test-AAAA1234')
        expect(needsKey.has(id)).toBe(false)
    })
})

describe('deleteConnection', () => {
    it('T7: a proxy delete blanks the working and preset references and lists them', () => {
        const db = migratedDb()
        const proxy = proxyOf(db)
        expect(db.proxyConnectionId).toBe(proxy.id)
        const removed = deleteConnection(db, proxy.id)!
        expect(removed.refs).toEqual({ presetIds: ['p1', 'p2'], working: true, modelIds: [] })
        expect(removed.index).toBe(storedConnections(migratedDb()).findIndex((c) => c.provider === 'reverse_proxy'))
        expect(storedConnections(db).some((c) => c.id === proxy.id)).toBe(false)
        expect(db.proxyConnectionId).toBe('')
        expect(db.botPresets.map((p) => p.proxyConnectionId)).toEqual(['', ''])
    })

    it('T8: a custom delete blanks the model reference', () => {
        const db = migratedDb()
        const custom = customOf(db)
        const removed = deleteConnection(db, custom.id)!
        expect(removed.refs.modelIds).toEqual(['ma'])
        expect(db.customModels[0].connectionId).toBe('')
    })

    it('T11: deleting NanoGPT or Vertex applies the empty-key effects', async () => {
        const db = migratedDb()
        await setSlotKey(db, 'nanogptKey', 'sk-test-NNNN1234')
        await setSlotKey(db, 'vertexPrivateKey', 'PEM-SYNTH')
        deleteConnection(db, slotConnection(db, 'nanogptKey')!.id)
        expect(db.nanogptRequestModel).toBe('')
        expect(db.nanogptUseSubscriptionEndpoint).toBe(false)
        deleteConnection(db, slotConnection(db, 'vertexPrivateKey')!.id)
        expect(db.vertexAccessToken).toBe('')
    })

    it('T9: the snapshot is a whitelist: no key, no wrapped field, no other field', () => {
        const db = migratedDb()
        const odd = { id: 'conn-50', name: 'Odd', provider: 'mistral', key: 'sk-test-LEAK1234', wrapped: 'SYNTH-W', options: { a: 1 } }
        db.connections = [...storedConnections(db), odd as unknown as Connection]
        const removed = deleteConnection(db, 'conn-50')!
        expect(removed.snapshot).toEqual({ id: 'conn-50', name: 'Odd', provider: 'mistral' })
        const json = JSON.stringify(removed)
        expect(json).not.toContain('SYNTH-W')
        expect(json).not.toContain('sk-test-LEAK')
    })

    it('returns null for an unknown id or a malformed store; a delete drops a stale needsKey entry', () => {
        const db = migratedDb()
        expect(deleteConnection(db, 'conn-404')).toBeNull()
        expect(deleteConnection({ connections: 'x' } as unknown as Database, 'conn-1')).toBeNull()
        const id = customOf(db).id
        needsKey.add(id)
        deleteConnection(db, id)
        expect(needsKey.has(id)).toBe(false)
    })
})

describe('restoreConnection', () => {
    function deletedProxy(): { db: Database, removed: RemovedConnection } {
        const db = migratedDb()
        return { db, removed: deleteConnection(db, proxyOf(db).id)! }
    }

    it('T10: restores at its place with an empty key and every reference that still reads blank', () => {
        const { db, removed } = deletedProxy()
        expect(restoreConnection(db, removed)).toBe('restored')
        const restored = storedConnections(db)[removed.index]
        expect(restored).toEqual({ id: removed.snapshot.id, name: removed.snapshot.name, provider: 'reverse_proxy', key: '', url: 'https://p.invalid/v1' })
        expect(db.proxyConnectionId).toBe(restored.id)
        expect(db.botPresets.map((p) => p.proxyConnectionId)).toEqual([restored.id, restored.id])
        expect(needsKey.has(restored.id)).toBe(true)
    })

    it('T10: a record carrying key and wrapped does not store them', () => {
        const { db, removed } = deletedProxy()
        const tainted = {
            ...removed,
            snapshot: { ...removed.snapshot, key: 'sk-test-LEAK1234', wrapped: 'SYNTH-W' },
        } as RemovedConnection
        expect(restoreConnection(db, tainted)).toBe('restored')
        expect(storedConnections(db)[removed.index]).toEqual({
            id: removed.snapshot.id, name: removed.snapshot.name, provider: 'reverse_proxy', key: '', url: 'https://p.invalid/v1',
        })
    })

    it('T10: refuses when the id is taken, and when another connection of a single provider exists', async () => {
        const { db, removed } = deletedProxy()
        db.connections = [...storedConnections(db), { id: removed.snapshot.id, name: 'new', provider: 'mistral', key: '' }]
        expect(restoreConnection(db, removed)).toBe('taken')

        const db2 = migratedDb()
        await setSlotKey(db2, 'openAIKey', 'sk-test-AAAA1234')
        await setSlotKey(db2, 'mistralKey', 'sk-test-MMMM0000')
        const gone = deleteConnection(db2, slotConnection(db2, 'openAIKey')!.id)!
        await setSlotKey(db2, 'openAIKey', 'sk-test-BBBB5678')
        const count = storedConnections(db2).length
        expect(restoreConnection(db2, gone)).toBe('provider')
        expect(storedConnections(db2)).toHaveLength(count)
        expect(restoreConnection({ connections: 'x' } as unknown as Database, gone)).toBe('malformed')
    })

    it('T10: a reference changed since the delete is kept; a gone preset or model is skipped', () => {
        const { db, removed } = deletedProxy()
        db.botPresets[0].proxyConnectionId = 'conn-other'
        db.botPresets.splice(1, 1)
        expect(restoreConnection(db, removed)).toBe('restored')
        expect(db.botPresets.map((p) => p.proxyConnectionId)).toEqual(['conn-other'])

        const db2 = migratedDb()
        const custom = deleteConnection(db2, customOf(db2).id)!
        db2.customModels.splice(0, 1)
        expect(restoreConnection(db2, custom)).toBe('restored')
        expect(db2.customModels).toEqual([])
    })

    it('T10: a custom model re-pointed since the delete keeps its new connection', () => {
        const db = migratedDb()
        const custom = deleteConnection(db, customOf(db).id)!
        expect(db.customModels[0].connectionId).toBe('')
        db.customModels[0].connectionId = 'conn-other'
        expect(restoreConnection(db, custom)).toBe('restored')
        expect(db.customModels[0].connectionId).toBe('conn-other')
    })

    it('T10: a proxy used or added after the delete keeps the working reference', async () => {
        const { db, removed } = deletedProxy()
        const added = await addConnection(db, { provider: 'reverse_proxy', name: 'n', key: 'sk-test-NNNN1234', url: 'https://n.invalid' })
        expect(added.ok && db.proxyConnectionId === added.id).toBe(true)
        expect(restoreConnection(db, removed)).toBe('restored')
        expect(db.proxyConnectionId).toBe(added.ok ? added.id : '')
    })

    it('inserts at the end when the stored list is now shorter than the index', () => {
        const { db, removed } = deletedProxy()
        db.connections = []
        expect(restoreConnection(db, { ...removed, index: 9 })).toBe('restored')
        expect(storedConnections(db)).toHaveLength(1)
    })
})
