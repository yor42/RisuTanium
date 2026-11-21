import { afterEach, describe, expect, it, vi } from 'vitest'
import type { botPreset, StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { ownedConnection, slotConnection, type Connection } from '../connections'
import {
    applyPlan, migrateConnections, migrateConnectionsOnLoad, planConnections, takeConnectionsMigrated,
} from '../migrate'
import { absorbLegacyForTest } from './legacyFixture'

function makeDb(over: Record<string, unknown> = {}): StoredDatabase {
    return {
        openAIKey: '', proxyKey: '', forceReplaceUrl: '', claudeAPIKey: '', openrouterKey: '', nanogptKey: '',
        mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', novellistAPI: '', mancerHeader: '', vertexPrivateKey: '',
        novelai: { token: '', model: 'm' }, hordeConfig: { apiKey: '', model: 'h', softPrompt: '' },
        google: { accessToken: '', projectId: 'p' }, OaiCompAPIKeys: {}, botPresets: [], botPresetsId: 0, customModels: [],
        ...over,
    } as unknown as StoredDatabase
}

/** A preset saved by upstream's own save step from a working pair. */
function producerPreset(url: string, key: string, name = 'preset'): botPreset {
    const db = {
        botPresets: [{ name }], botPresetsId: 0, forceReplaceUrl: url, proxyKey: key, openAIKey: 'sk-preset',
    } as unknown as StoredDatabase
    upstreamSaveCurrentPreset(db)
    return db.botPresets[0]
}

function conns(db: StoredDatabase): Connection[] {
    return db.connections ?? []
}

afterEach(() => {
    takeConnectionsMigrated()
    vi.restoreAllMocks()
})

describe('global slots', () => {
    it('absorbs every non-empty key into one connection each and clears the legacy field', () => {
        const db = makeDb({
            openAIKey: 'L1\nL2', claudeAPIKey: '${CLAUDE}', mistralKey: 'sk-m',
            novelai: { token: 'nt', model: 'm' }, google: { accessToken: 'gk', projectId: 'p' },
            hordeConfig: { apiKey: 'hk', model: 'h', softPrompt: '' }, vertexPrivateKey: 'PEM',
        })
        expect(migrateConnections(db)).toBe('applied')
        const byProvider = Object.fromEntries(conns(db).map((c) => [c.provider, c.key]))
        expect(byProvider).toEqual({
            openai: 'L1\nL2', anthropic: '${CLAUDE}', mistral: 'sk-m', novelai: 'nt',
            horde: 'hk', google: 'gk', vertex: 'PEM',
        })
        expect(conns(db).map((c) => c.id)).toEqual(['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6', 'conn-7'])
        expect(conns(db)[0].name).toBe('OpenAI')
        expect(db.openAIKey).toBe('')
        expect(db.novelai).toEqual({ token: '', model: 'm' })
        expect(db.google).toEqual({ accessToken: '', projectId: 'p' })
        expect(db.vertexPrivateKey).toBe('')
    })

    it('writes a pending legacy value into the existing connection of that provider', () => {
        const db = makeDb({ openAIKey: 'sk-new', connections: [{ id: 'conn-3', name: 'OpenAI', provider: 'openai', key: 'sk-old' }] })
        expect(migrateConnections(db)).toBe('applied')
        expect(conns(db)).toEqual([{ id: 'conn-3', name: 'OpenAI', provider: 'openai', key: 'sk-new' }])
    })

    it('absorbs OaiComp entries sorted by kid, into oaicomp connections, and deletes them', () => {
        const db = makeDb({ OaiCompAPIKeys: { deepseek: 'dk', deepinfra: 'di', empty: '', odd: 5 } })
        expect(migrateConnections(db)).toBe('applied')
        expect(conns(db).map((c) => [c.id, c.provider, c.key, c.name])).toEqual([
            ['conn-1', 'oaicomp:deepinfra', 'di', 'deepinfra'],
            ['conn-2', 'oaicomp:deepseek', 'dk', 'deepseek'],
        ])
        expect(db.OaiCompAPIKeys).toEqual({ empty: '', odd: 5 })
    })
})

describe('idempotence, determinism and the flag', () => {
    const legacy = () => makeDb({
        openAIKey: 'sk-a', forceReplaceUrl: 'https://p.invalid/v1', proxyKey: 'K',
        botPresets: [producerPreset('https://p.invalid/v1', 'K'), producerPreset('https://q.invalid', 'Q')],
        customModels: [{ id: 'ma', name: 'M', key: 'ck', url: 'https://c.invalid' }],
    })

    it('a second run changes nothing and returns none', () => {
        const db = legacy()
        expect(migrateConnections(db)).toBe('applied')
        const once = structuredClone(db)
        expect(migrateConnections(db)).toBe('none')
        expect(db).toEqual(once)
    })

    it('gives deep-equal output, ids included, for equal input', () => {
        const a = legacy()
        const b = structuredClone(a)
        migrateConnections(a)
        migrateConnections(b)
        expect(a).toEqual(b)
    })

    it('marks the boot write only on a successful load-time plan', () => {
        const none = makeDb()
        expect(migrateConnectionsOnLoad(none)).toBe('none')
        expect(takeConnectionsMigrated()).toBe(false)
        expect(migrateConnectionsOnLoad(makeDb({ openAIKey: 'sk-a' }))).toBe('applied')
        expect(takeConnectionsMigrated()).toBe(true)
        expect(takeConnectionsMigrated()).toBe(false)
        migrateConnections(makeDb({ openAIKey: 'sk-a' }))
        expect(takeConnectionsMigrated()).toBe(false)
        expect(migrateConnectionsOnLoad(makeDb({ openAIKey: 'x', connections: 'garbage' }))).toBe('skip')
        expect(takeConnectionsMigrated()).toBe(false)
    })

    it('the test adapter migrates in place and is idempotent', () => {
        const db = makeDb({ openAIKey: 'sk-a' })
        expect(absorbLegacyForTest(db)).toBe(db)
        absorbLegacyForTest(db)
        expect(conns(db)).toHaveLength(1)
        expect(db.openAIKey).toBe('')
    })
})

describe('reverse proxies', () => {
    it('shares equal pairs, splits a different key and names them after the host', () => {
        const db = makeDb({
            botPresets: [
                producerPreset('https://p.invalid/v1', 'K1'),
                producerPreset('https://p.invalid/v1', 'K1'),
                producerPreset('https://p.invalid/v1', 'K2'),
            ],
        })
        migrateConnections(db)
        const proxies = conns(db).filter((c) => c.provider === 'reverse_proxy')
        expect(proxies.map((c) => [c.name, c.key, c.url])).toEqual([
            ['p.invalid', 'K1', 'https://p.invalid/v1'],
            ['p.invalid 2', 'K2', 'https://p.invalid/v1'],
        ])
        expect(db.botPresets.map((p) => p.proxyConnectionId)).toEqual(['conn-1', 'conn-1', 'conn-2'])
        expect(db.botPresets.every((p) => p.proxyKey === '' && p.forceReplaceUrl === '' && p.openAIKey === '')).toBe(true)
    })

    it('takes the live working pair as the working reference and keeps a stale active stored pair apart', () => {
        const db = makeDb({
            botPresets: [producerPreset('https://p.invalid/v1', 'K-stale'), producerPreset('https://o.invalid', 'O')],
            botPresetsId: 0,
            forceReplaceUrl: 'https://p.invalid/v1',
            proxyKey: 'K-live',
        })
        migrateConnections(db)
        const working = ownedConnection(db, { slot: 'proxyKey' })
        expect(working).toMatchObject({ key: 'K-live', url: 'https://p.invalid/v1' })
        const active = conns(db).find((c) => c.id === db.botPresets[0].proxyConnectionId)
        expect(active).toMatchObject({ key: 'K-stale' })
        expect(active?.id).not.toBe(working?.id)
    })

    it('overlays a half pair onto the owner it already has (steady state)', () => {
        const db = makeDb({
            connections: [{ id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: 'K1', url: 'https://u1.invalid' }],
            proxyConnectionId: 'conn-1',
            proxyKey: 'K2',
        })
        migrateConnections(db)
        expect(ownedConnection(db, { slot: 'proxyKey' })).toMatchObject({ key: 'K2', url: 'https://u1.invalid' })
        expect(conns(db).find((c) => c.id === 'conn-1')).toMatchObject({ key: 'K1' })
        expect(db.proxyKey).toBe('')
    })

    it('keeps an exact half pair on a first migration', () => {
        const db = makeDb({ forceReplaceUrl: 'https://only.invalid' })
        migrateConnections(db)
        expect(ownedConnection(db, { slot: 'proxyKey' })).toMatchObject({ key: '', url: 'https://only.invalid' })
    })

    it('references an active stored pair when the working pair is empty', () => {
        const db = makeDb({ botPresets: [producerPreset('https://s.invalid', 'Ks')], botPresetsId: 0 })
        migrateConnections(db)
        expect(db.proxyConnectionId).toBeUndefined()
        expect(conns(db).find((c) => c.id === db.botPresets[0].proxyConnectionId)).toMatchObject({ key: 'Ks', url: 'https://s.invalid' })
    })

    it('clears a preset openAIKey and never absorbs it', () => {
        const db = makeDb({ botPresets: [producerPreset('', '')] })
        expect(db.botPresets[0].openAIKey).toBe('sk-preset')
        migrateConnections(db)
        expect(conns(db)).toEqual([])
        expect(db.botPresets[0].openAIKey).toBe('')
    })
})

describe('custom models', () => {
    const shared = { id: 'conn-1', name: 'c', provider: 'custom', key: 'K0', url: 'https://c.invalid' }

    it('gives two models that shared a connection separate pending keys', () => {
        const db = makeDb({
            connections: [{ ...shared }],
            customModels: [
                { id: 'ma', name: 'A', key: 'kA', connectionId: 'conn-1' },
                { id: 'mb', name: 'B', key: 'kB', connectionId: 'conn-1' },
            ],
        })
        migrateConnections(db)
        const [a, b] = db.customModels
        expect(a.connectionId).not.toBe(b.connectionId)
        expect(conns(db).find((c) => c.id === a.connectionId)).toMatchObject({ key: 'kA', url: 'https://c.invalid' })
        expect(conns(db).find((c) => c.id === b.connectionId)).toMatchObject({ key: 'kB', url: 'https://c.invalid' })
        expect(a.key).toBe('')
        expect(b.key).toBe('')
    })

    it('leaves the other model on the shared connection when only one is pending', () => {
        const db = makeDb({
            connections: [{ ...shared }],
            customModels: [
                { id: 'ma', name: 'A', key: 'kA', connectionId: 'conn-1' },
                { id: 'mb', name: 'B', key: '', connectionId: 'conn-1' },
            ],
        })
        migrateConnections(db)
        const [a, b] = db.customModels
        expect(b.connectionId).toBe('conn-1')
        expect(conns(db).find((c) => c.id === 'conn-1')?.key).toBe('K0')
        expect(conns(db).find((c) => c.id === a.connectionId)).toMatchObject({ key: 'kA' })
    })

    it('overlays a sole referrer in place and creates a connection for an unreferenced model', () => {
        const db = makeDb({
            connections: [{ ...shared }],
            customModels: [
                { id: 'ma', name: 'A', url: 'https://new.invalid', connectionId: 'conn-1' },
                { id: 'mb', name: '', key: 'kb', url: '' },
            ],
        })
        migrateConnections(db)
        expect(db.customModels[0].connectionId).toBe('conn-1')
        expect(conns(db)[0]).toMatchObject({ id: 'conn-1', key: 'K0', url: 'https://new.invalid' })
        expect(conns(db)[1]).toMatchObject({ provider: 'custom', name: 'Custom model', key: 'kb', url: '' })
        expect(db.customModels[1].connectionId).toBe('conn-2')
    })

    it('does not follow a reference to a connection of another provider', () => {
        const foreign = { id: 'conn-1', name: 'a', provider: 'anthropic', key: 'sk-ant-X' }
        const db = makeDb({
            connections: [foreign],
            customModels: [{ id: 'ma', name: 'A', key: 'kA', connectionId: 'conn-1' }],
        })
        migrateConnections(db)
        expect(conns(db)[0]).toEqual(foreign)
        expect(slotConnection(db, 'customModels:ma')).toMatchObject({ provider: 'custom', key: 'kA' })
    })
})

describe('no-write rule', () => {
    it('writes no empty reference or field for template presets with empty pairs', () => {
        const template = { name: 't', proxyKey: '', forceReplaceUrl: '', openAIKey: '' }
        const db = makeDb({ openAIKey: 'sk-a', botPresets: [{ ...template }, { name: 'bare' }] })
        const model = { id: 'm', key: '', url: '' }
        db.customModels = [model] as unknown as StoredDatabase['customModels']
        expect(migrateConnections(db)).toBe('applied')
        for (const preset of db.botPresets) {
            expect(Object.hasOwn(preset, 'proxyConnectionId')).toBe(false)
        }
        expect(Object.hasOwn(db.botPresets[1], 'proxyKey')).toBe(false)
        expect(Object.hasOwn(db, 'proxyConnectionId')).toBe(false)
        expect(Object.hasOwn(model, 'connectionId')).toBe(false)
    })

    it('plans none, allocating and writing nothing, when nothing is non-empty', () => {
        const db = makeDb({ connections: [], botPresets: [{ name: 't', proxyKey: '', forceReplaceUrl: '' }] })
        const before = structuredClone(db)
        expect(planConnections(db)).toBe('none')
        expect(migrateConnections(db)).toBe('none')
        expect(db).toEqual(before)
    })
})

describe('malformed store and failed apply', () => {
    it('skips and keeps a malformed store and every legacy value', () => {
        const db = makeDb({ connections: 'garbage', openAIKey: 'sk-a' })
        expect(migrateConnections(db)).toBe('skip')
        expect(db.connections).toBe('garbage')
        expect(db.openAIKey).toBe('sk-a')
    })

    it('replays the journal on a throwing write, leaving an absent property absent', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const presets = [producerPreset('https://a.invalid', 'KA'), producerPreset('https://b.invalid', 'KB')]
        const db = makeDb({ forceReplaceUrl: 'https://a.invalid', proxyKey: 'KA', openAIKey: 'sk-a', botPresets: presets })
        Object.freeze(db.botPresets[1])
        expect(migrateConnections(db)).toBe('failed')
        expect(error).toHaveBeenCalledTimes(1)
        expect(db.connections).toBeUndefined()
        expect(Object.hasOwn(db, 'connections')).toBe(false)
        expect(Object.hasOwn(db, 'proxyConnectionId')).toBe(false)
        expect(Object.hasOwn(db.botPresets[0], 'proxyConnectionId')).toBe(false)
        expect(db.openAIKey).toBe('sk-a')
        expect(db.proxyKey).toBe('KA')
        expect(db.botPresets[0].proxyKey).toBe('KA')
        expect(db.botPresets[1].proxyKey).toBe('KB')
    })

    it('the load hook returns failed on a planner throw, logs once, and sets no flag', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        takeConnectionsMigrated()
        const db = makeDb({ openAIKey: 'sk-a' })
        Object.defineProperty(db, 'connections', { get() { throw new Error('boom') }, configurable: true })
        let result: string | undefined
        expect(() => { result = migrateConnectionsOnLoad(db) }).not.toThrow()
        expect(result).toBe('failed')
        expect(error).toHaveBeenCalledTimes(1)
        expect(db.openAIKey).toBe('sk-a')
        expect(takeConnectionsMigrated()).toBe(false)
    })

    it('a failed apply returns false from applyPlan', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const db = makeDb({ openAIKey: 'sk-a' })
        const plan = planConnections(db)
        expect(typeof plan).toBe('object')
        Object.freeze(db)
        expect(applyPlan(db, plan as Exclude<typeof plan, string>)).toBe(false)
    })
})
