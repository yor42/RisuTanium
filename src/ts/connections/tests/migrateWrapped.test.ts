import { describe, expect, it } from 'vitest'
import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import type { Connection } from '../connections'
import { planConnections, type Plan } from '../migrate'

/*
 * Connections written the way the vault swap writes them (`key: ''`, `keyWrapped` an opaque
 * envelope) through the legacy planner. Envelopes here are opaque strings; keys are synthetic.
 */
const E = 'AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUm'

function makeDb(over: Record<string, unknown>): StoredDatabase {
    return {
        openAIKey: '', proxyKey: '', forceReplaceUrl: '', claudeAPIKey: '', openrouterKey: '', nanogptKey: '',
        mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', novellistAPI: '', mancerHeader: '', vertexPrivateKey: '',
        novelai: { token: '', model: 'm' }, hordeConfig: { apiKey: '', model: 'h', softPrompt: '' },
        google: { accessToken: '', projectId: 'p' }, OaiCompAPIKeys: {}, botPresets: [], botPresetsId: 0, customModels: [],
        ...over,
    } as unknown as StoredDatabase
}

function planOf(db: StoredDatabase): Plan {
    const plan = planConnections(db)
    if (plan === 'none' || plan === 'skip') {
        throw new Error('expected a plan, got ' + plan)
    }
    return plan
}

const wrappedProxy = (): Connection => ({
    id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: '', keyWrapped: E, url: 'https://a.invalid',
})

describe('planConnections over wrapped connections', () => {
    it('T35(a) a url-only legacy edit keeps the envelope: the same connection when the url is unchanged, a new one carrying it otherwise', () => {
        const same = planOf(makeDb({ connections: [wrappedProxy()], proxyConnectionId: 'conn-1', forceReplaceUrl: 'https://a.invalid' }))
        expect(same.rootRef).toBe('conn-1')
        expect(same.connections).toHaveLength(1)

        const moved = planOf(makeDb({ connections: [wrappedProxy()], proxyConnectionId: 'conn-1', forceReplaceUrl: 'https://b.invalid' }))
        const created = moved.connections.find((conn) => conn.id === moved.rootRef)
        expect(created).toMatchObject({ key: '', keyWrapped: E, url: 'https://b.invalid' })
        expect(moved.rootRef).not.toBe('conn-1')
    })

    it('T35(b) a legacy pair with an empty key never resolves to the wrapped proxy', () => {
        const plan = planOf(makeDb({ connections: [wrappedProxy()], forceReplaceUrl: 'https://a.invalid' }))
        expect(plan.rootRef).not.toBe('conn-1')
        const created = plan.connections.find((conn) => conn.id === plan.rootRef)
        expect(created?.keyWrapped).toBeUndefined()
    })

    it('T35(c) a shared custom connection with a key-less edit gives the new connection the envelope', () => {
        const shared: Connection = { id: 'conn-1', name: 'c', provider: 'custom', key: '', keyWrapped: E, url: 'https://c.invalid' }
        const plan = planOf(makeDb({
            connections: [shared],
            customModels: [
                { id: 'ma', name: 'A', connectionId: 'conn-1', url: 'https://n.invalid', key: '' },
                { id: 'mb', name: 'B', connectionId: 'conn-1' },
            ],
        }))
        const created = plan.connections.find((conn) => conn.id === plan.modelRefs[0].id)
        expect(created).toMatchObject({ key: '', keyWrapped: E, url: 'https://n.invalid' })
        expect(plan.modelRefs[0].id).not.toBe('conn-1')
    })

    it('T35(d) a non-empty legacy key over a wrapped connection is both-set at the clone sites only', () => {
        const slot: Connection = { id: 'conn-1', name: 'o', provider: 'openai', key: '', keyWrapped: E }
        const slotPlan = planOf(makeDb({ connections: [slot], openAIKey: 'SYNTH-LEGACY-1' }))
        expect(slotPlan.connections[0]).toMatchObject({ key: 'SYNTH-LEGACY-1', keyWrapped: E })

        const custom: Connection = { id: 'conn-2', name: 'c', provider: 'custom', key: '', keyWrapped: E }
        const customPlan = planOf(makeDb({
            connections: [custom],
            customModels: [{ id: 'ma', name: 'A', connectionId: 'conn-2', key: 'SYNTH-LEGACY-2' }],
        }))
        expect(customPlan.connections[0]).toMatchObject({ key: 'SYNTH-LEGACY-2', keyWrapped: E })

        const proxyPlan = planOf(makeDb({
            connections: [wrappedProxy()], proxyConnectionId: 'conn-1', forceReplaceUrl: 'https://a.invalid', proxyKey: 'SYNTH-LEGACY-3',
        }))
        const target = proxyPlan.connections.find((conn) => conn.id === proxyPlan.rootRef)
        expect(target).toMatchObject({ key: 'SYNTH-LEGACY-3' })
        expect(target?.keyWrapped).toBeUndefined()
    })

    it('H5 a both-set proxy still matches on its non-empty key, so a legacy edit adds no duplicate', () => {
        const bothSet: Connection = { ...wrappedProxy(), key: 'SYNTH-KEY-1234' }
        const plan = planOf(makeDb({
            connections: [bothSet], proxyConnectionId: 'conn-1', forceReplaceUrl: 'https://a.invalid', proxyKey: 'SYNTH-KEY-1234',
        }))
        expect(plan.rootRef).toBe('conn-1')
        expect(plan.connections).toHaveLength(1)
    })
})
