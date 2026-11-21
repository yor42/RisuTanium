import { describe, expect, it } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { slotConnection } from '../connections'
import {
    customModelUrlValue, proxyUrlValue, setCustomModelUrl, setProxyUrl, setSlotKey, slotEditorValue,
} from '../slotEditor'

function makeDb(over: Record<string, unknown> = {}): Database {
    return { customModels: [], ...over } as unknown as Database
}

const sharedCustom = () => makeDb({
    connections: [{ id: 'conn-1', name: 'c', provider: 'custom', key: 'K0', url: 'https://c.invalid' }],
    customModels: [
        { id: 'ma', name: 'A', connectionId: 'conn-1' },
        { id: 'mb', name: 'B', connectionId: 'conn-1' },
    ],
})

describe('global and OaiComp slots', () => {
    it('writes nothing for an empty value with no connection, and creates one on the first value', async () => {
        const db = makeDb()
        await setSlotKey(db, 'openAIKey', '')
        expect(db.connections).toBeUndefined()
        await setSlotKey(db, 'openAIKey', 'sk-a')
        expect(db.connections).toEqual([{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a' }])
        expect(slotEditorValue(db, 'openAIKey')).toBe('sk-a')
    })

    it('edits the slot connection in place and clearing keeps the connection', async () => {
        const db = makeDb()
        await setSlotKey(db, 'openAIKey', 'a')
        const created = db.connections![0]
        await setSlotKey(db, 'openAIKey', 'b')
        expect(db.connections![0]).toBe(created)
        await setSlotKey(db, 'openAIKey', '')
        expect(db.connections).toHaveLength(1)
        expect(slotEditorValue(db, 'openAIKey')).toBe('')
    })

    it('creates OaiComp and Vertex connections by their provider', async () => {
        const db = makeDb()
        await setSlotKey(db, 'OaiCompAPIKeys:deepseek', 'dk')
        await setSlotKey(db, 'vertexPrivateKey', 'PEM')
        expect(db.connections!.map((c) => [c.provider, c.key, c.name])).toEqual([
            ['oaicomp:deepseek', 'dk', 'deepseek'],
            ['vertex', 'PEM', 'Vertex AI'],
        ])
    })
})

describe('proxy', () => {
    it('creates the working proxy on the first value and edits a shared one in place', async () => {
        const db = makeDb()
        setProxyUrl(db, '')
        expect(db.connections).toBeUndefined()
        setProxyUrl(db, 'https://p.invalid/v1')
        await setSlotKey(db, 'proxyKey', 'PK')
        expect(db.connections).toEqual([
            { id: 'conn-1', name: 'p.invalid', provider: 'reverse_proxy', key: 'PK', url: 'https://p.invalid/v1' },
        ])
        expect(db.proxyConnectionId).toBe('conn-1')
        expect(proxyUrlValue(db)).toBe('https://p.invalid/v1')
        await setSlotKey(db, 'proxyKey', 'PK2')
        expect(db.connections).toHaveLength(1)
        expect(db.connections![0].key).toBe('PK2')
    })

    it('does not edit a connection of another provider the reference names', async () => {
        const foreign = { id: 'conn-1', name: 'a', provider: 'anthropic', key: 'sk-ant-X' }
        const db = makeDb({ connections: [foreign], proxyConnectionId: 'conn-1' })
        await setSlotKey(db, 'proxyKey', 'PK')
        expect(db.connections![0]).toEqual(foreign)
        expect(slotEditorValue(db, 'proxyKey')).toBe('PK')
        expect(db.proxyConnectionId).toBe('conn-2')
    })
})

describe('custom models', () => {
    it('clones a shared custom connection for the model written, leaving the other unchanged', async () => {
        const db = sharedCustom()
        await setSlotKey(db, 'customModels:ma', 'new')
        setCustomModelUrl(db, 'ma', 'https://n.invalid')
        const [a, b] = db.customModels
        expect(b.connectionId).toBe('conn-1')
        expect(db.connections!.find((c) => c.id === 'conn-1')).toMatchObject({ key: 'K0', url: 'https://c.invalid' })
        expect(a.connectionId).not.toBe('conn-1')
        expect(slotConnection(db, 'customModels:ma')).toMatchObject({ key: 'new', url: 'https://n.invalid', provider: 'custom' })
        expect(customModelUrlValue(db, 'mb')).toBe('https://c.invalid')
    })

    it('copies the field it does not write from the shared connection', async () => {
        const db = sharedCustom()
        await setSlotKey(db, 'customModels:ma', 'new')
        expect(slotConnection(db, 'customModels:ma')).toMatchObject({ key: 'new', url: 'https://c.invalid' })
        const other = sharedCustom()
        setCustomModelUrl(other, 'ma', 'https://n.invalid')
        expect(slotConnection(other, 'customModels:ma')).toMatchObject({ key: 'K0', url: 'https://n.invalid' })
    })

    it('edits a sole referrer in place', async () => {
        const db = makeDb({
            connections: [{ id: 'conn-1', name: 'c', provider: 'custom', key: 'K0', url: 'https://c.invalid' }],
            customModels: [{ id: 'ma', name: 'A', connectionId: 'conn-1' }],
        })
        await setSlotKey(db, 'customModels:ma', 'new')
        setCustomModelUrl(db, 'ma', 'https://n.invalid')
        expect(db.connections).toEqual([{ id: 'conn-1', name: 'c', provider: 'custom', key: 'new', url: 'https://n.invalid' }])
        expect(db.customModels[0].connectionId).toBe('conn-1')
    })

    it('creates a connection for a model on the first value and ignores an unknown model', async () => {
        const db = makeDb({ customModels: [{ id: 'ma', name: 'A' }] })
        setCustomModelUrl(db, 'ma', '')
        expect(db.connections).toBeUndefined()
        await setSlotKey(db, 'customModels:ma', 'k')
        expect(db.customModels[0].connectionId).toBe('conn-1')
        expect(db.connections![0]).toMatchObject({ provider: 'custom', name: 'A', key: 'k', url: '' })
        await setSlotKey(db, 'customModels:none', 'k')
        expect(db.connections).toHaveLength(1)
    })

    it('does not edit a foreign-provider connection a model names', async () => {
        const foreign = { id: 'conn-1', name: 'a', provider: 'anthropic', key: 'sk-ant-X' }
        const db = makeDb({ connections: [foreign], customModels: [{ id: 'ma', name: 'A', connectionId: 'conn-1' }] })
        await setSlotKey(db, 'customModels:ma', 'k')
        expect(db.connections![0]).toEqual(foreign)
        expect(db.customModels[0].connectionId).toBe('conn-2')
    })
})

describe('malformed store', () => {
    it('refuses every setter', async () => {
        const db = makeDb({ connections: 'garbage' })
        await setSlotKey(db, 'openAIKey', 'sk')
        setProxyUrl(db, 'https://p.invalid')
        setCustomModelUrl(db, 'ma', 'https://c.invalid')
        expect(db.connections).toBe('garbage')
        expect(Object.hasOwn(db, 'proxyConnectionId')).toBe(false)
    })
})
